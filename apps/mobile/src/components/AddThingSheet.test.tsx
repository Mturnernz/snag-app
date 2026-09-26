import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import AddThingSheet from './AddThingSheet';

// The photo comes first and nobody waits on it. What these pin is the half that
// decides whether that can be trusted: the sheet moves on the moment there is a
// picture, the reading fills only the boxes still empty and says which, *Add
// it* waits on the upload and never on the read, and a reading that lands late
// is handed on rather than lost.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
const mock_upload = jest.fn();
jest.mock('../lib/photoUpload', () => ({
  takePhoto: jest.fn().mockResolvedValue('file://plate.jpg'),
  pickPhotos: jest.fn().mockResolvedValue({ uris: ['file://library.jpg'], dropped: 0 }),
  compressAndUpload: (...a: unknown[]) => mock_upload(...a),
  photoFileName: () => 'h1/plate.jpg',
}));
const mock_readLabel = jest.fn();
const mock_resolve = jest.fn();
jest.mock('../lib/supabase', () => ({
  readLabel: (...a: unknown[]) => mock_readLabel(...a),
  resolveLabelReading: (...a: unknown[]) => mock_resolve(...a),
  uploadFile: jest.fn(),
}));

const boxes = (r: RenderResult): Record<string, any> => {
  const found: Record<string, any> = {};
  r.root
    .findAll((n) => typeof n.type === 'string' && !!n.props.accessibilityLabel && 'onChangeText' in n.props,
      { deep: true })
    .forEach((n) => { found[n.props.accessibilityLabel] = n; });
  return found;
};
const textOf = (node: any): string =>
  (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');
const texts = (r: RenderResult) => r.getAllByType('Text').map(textOf);
const press = (r: RenderResult, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.onPress, { deep: true })[0];
const tap = async (r: RenderResult, label: string) => {
  await TestRenderer.act(async () => { await press(r, label).props.onPress(); });
};

const PLATE = {
  legible: true, make: 'Smeg', model: 'C6GMXA8', serial: '1690428', colourName: null,
  colourCode: null, product: null, sheen: null, tint: null, hex: null, consumables: [],
  suggestedConsumables: [], suggestedServiceDays: null,
};
const answer = (reading: unknown, guess: unknown = null) => ({ reading, guess, readingId: 'r1' });

const onAdd = jest.fn().mockResolvedValue(true);
const onLateReading = jest.fn();

async function open(start: { room?: string | null; name?: string | null; kind?: any } | null) {
  let r!: RenderResult;
  await TestRenderer.act(async () => {
    r = render(
      <AddThingSheet
        visible
        locations={[{ id: 'l1', propertyId: 'p', name: 'Kitchen', sortOrder: 0 } as any]}
        pathPrefix="h1"
        start={start}
        onAddRoom={jest.fn()}
        onCancel={jest.fn()}
        onAdd={onAdd}
        onLateReading={onLateReading}
      />
    );
  });
  return r;
}

/** A ghost: room and name already answered, so the photo goes straight to the rest. */
const openGhost = (kind: 'appliance' | 'finish' = 'appliance', name = 'Oven') =>
  open({ room: 'Kitchen', name, kind });

async function shoot(r: RenderResult) {
  await tap(r, 'Photograph the label');
  await TestRenderer.act(async () => {});
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_upload.mockResolvedValue({ path: 'h1/plate.jpg', error: null });
  mock_resolve.mockResolvedValue(undefined);
});

it('opens on the photo, and moves on the moment there is one — before the read is back', async () => {
  mock_readLabel.mockReturnValue(new Promise(() => {}));
  const r = await open(null);
  expect(texts(r)).toContain('Photograph the label');
  expect(texts(r)).toContain('Step 1 of 4');

  await shoot(r);
  expect(texts(r)).toContain('Which room?');
  // Nobody has said what it is yet, so the reader is asked to say.
  expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', null);
});

it('lets the photo be skipped, and a photo from the library does the same as the camera', async () => {
  const skipped = await open(null);
  await tap(skipped, 'Skip for now');
  expect(texts(skipped)).toContain('Which room?');

  mock_readLabel.mockReturnValue(new Promise(() => {}));
  const r = await open(null);
  await tap(r, 'Choose a photo');
  await TestRenderer.act(async () => {});
  expect(mock_upload).toHaveBeenCalledWith('file://library.jpg', 'h1/plate.jpg');
  expect(texts(r)).toContain('Which room?');
});

it('skips what a ghost has already answered, and still says the kind it knows', async () => {
  mock_readLabel.mockResolvedValue(answer(PLATE));
  const r = await openGhost();
  expect(texts(r)).toContain('Step 1 of 2');
  await shoot(r);
  expect(texts(r)).toContain('Anything else?');
  expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', 'appliance');
});

it('lays what the plate says into the empty boxes and names them', async () => {
  mock_readLabel.mockResolvedValue(answer(PLATE));
  const r = await openGhost();
  await shoot(r);

  const b = boxes(r);
  expect(b.Make.props.value).toBe('Smeg');
  expect(b.Model.props.value).toBe('C6GMXA8');
  // Never asked for, but shown in a box when read so it is checked, not saved unseen.
  expect(b.Serial.props.value).toBe('1690428');
  expect(texts(r)).toContain('Read from the photo: make, model, serial. Check against the label before you save.');
});

it('keeps what somebody typed before the reading came back', async () => {
  let land!: (v: unknown) => void;
  mock_readLabel.mockReturnValue(new Promise((resolve) => { land = resolve; }));
  const r = await openGhost();
  await shoot(r);

  await TestRenderer.act(async () => { boxes(r).Model.props.onChangeText('C6GMXA8-2'); });
  await TestRenderer.act(async () => { land(answer({ ...PLATE, serial: null })); });

  expect(boxes(r).Model.props.value).toBe('C6GMXA8-2');
  expect(boxes(r).Make.props.value).toBe('Smeg');
});

it('says so in words when the label cannot be read, and the step carries on', async () => {
  mock_readLabel.mockRejectedValue(new Error("Label reading isn't set up yet — type what the label says."));
  const r = await openGhost();
  await shoot(r);

  expect(texts(r)).toContain("Label reading isn't set up yet — type what the label says.");
  expect(boxes(r).Make.props.value).toBe('');
});

it('never waits on the read: Add it saves now, and a late reading is handed on, not laid in', async () => {
  let land!: (v: unknown) => void;
  mock_readLabel.mockReturnValue(new Promise((resolve) => { land = resolve; }));
  const r = await openGhost('appliance', 'Heat pump');
  await shoot(r);
  expect(texts(r).some((t) => t.startsWith('Still reading the label'))).toBe(true);

  await tap(r, 'Add it to the house');
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Heat pump', photoPaths: ['h1/plate.jpg'], make: null, model: null,
  }));

  await TestRenderer.act(async () => { land(answer(PLATE)); });
  expect(onLateReading).toHaveBeenCalledWith('Heat pump', true);
  // It waits on the thing's page instead: nothing here marks it used.
  expect(mock_resolve).not.toHaveBeenCalled();
});

it('waits on the upload and says so — the one wait left', async () => {
  let sent!: (v: unknown) => void;
  mock_upload.mockReturnValue(new Promise((resolve) => { sent = resolve; }));
  mock_readLabel.mockReturnValue(new Promise(() => {}));
  const r = await openGhost();
  await shoot(r);

  let saving!: Promise<void>;
  await TestRenderer.act(async () => { saving = press(r, 'Add it to the house').props.onPress(); });
  expect(texts(r)).toContain('Uploading the photo…');
  expect(onAdd).not.toHaveBeenCalled();

  await TestRenderer.act(async () => {
    sent({ path: 'h1/plate.jpg', error: null });
    await saving;
  });
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ photoPaths: ['h1/plate.jpg'] }));
});

it('offers a way on without a photo that would not upload, rather than dropping it silently', async () => {
  mock_upload.mockResolvedValue({ path: null, error: new Error('offline') });
  const r = await openGhost();
  await shoot(r);

  expect(texts(r)).toContain("The photo didn't upload.");
  await tap(r, 'Add it to the house');
  expect(onAdd).not.toHaveBeenCalled();

  await tap(r, 'Add it without the photo');
  await tap(r, 'Add it to the house');
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ photoPaths: [] }));
});

it('marks a reading used once it was shown in the boxes, so no card asks again', async () => {
  mock_readLabel.mockResolvedValue(answer(PLATE));
  const r = await openGhost();
  await shoot(r);
  await tap(r, 'Add it to the house');
  expect(mock_resolve).toHaveBeenCalledWith('r1', 'used');
});

it('offers the photo’s guess at what it is, chosen only while nothing else is', async () => {
  mock_readLabel.mockResolvedValue(answer(null, { name: 'Heat pump', kind: 'appliance' }));
  const r = await open(null);
  await shoot(r);
  await tap(r, 'Kitchen');
  await tap(r, 'Next');

  expect(texts(r)).toContain('What is it?');
  const chip = press(r, 'From the photo: Heat pump');
  expect(chip.props.accessibilityState).toEqual({ selected: true });

  // Somebody's own choice is theirs, and the guess does not come back over it.
  await tap(r, 'Dishwasher');
  expect(press(r, 'From the photo: Heat pump').props.accessibilityState).toEqual({ selected: false });
  expect(press(r, 'Dishwasher').props.accessibilityState).toEqual({ selected: true });
});

it('carries a paint’s tin into the record: code, sheen, tint and swatch', async () => {
  mock_readLabel.mockResolvedValue(answer({
    ...PLATE, make: 'Resene', model: null, serial: null, colourName: 'Wan White',
    colourCode: 'N93-005-105', sheen: 'Low sheen', hex: '#EAE8DF',
  }));
  const r = await openGhost('finish', 'Wan White');
  await shoot(r);
  expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', 'finish');

  expect(boxes(r).Brand.props.value).toBe('Resene');
  expect(boxes(r)['Colour code'].props.value).toBe('N93-005-105');
  expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Swatch #EAE8DF', { deep: true }).length)
    .toBeGreaterThan(0);

  await tap(r, 'Add it to the house');
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'finish', make: 'Resene', model: 'N93-005-105', serial: null,
    spec: { sheen: 'Low sheen', hex: '#EAE8DF' },
  }));
});

it('offers what the model suggests on the last step, and records only what is tapped', async () => {
  mock_readLabel.mockResolvedValue(answer({
    ...PLATE, make: 'Mitsubishi Electric', model: 'MSZ-AP50VGK', serial: null,
    suggestedConsumables: ['Air filter MAC-2360FT', 'Remote batteries AAA'], suggestedServiceDays: 365,
  }));
  const r = await openGhost('appliance', 'Heat pump');
  await shoot(r);

  // Offered, labelled as a suggestion, and not in the box.
  expect(boxes(r)['What it takes'].props.value).toBe('');
  expect(texts(r)).toContain('Suggested for this model · check before you buy');
  expect(texts(r)).toContain('Suggested for this model: every year.');

  await tap(r, 'Add Air filter MAC-2360FT');
  // Taken, so no longer offered, and removable.
  expect(press(r, 'Add Air filter MAC-2360FT')).toBeUndefined();
  expect(press(r, 'Remove Air filter MAC-2360FT')).toBeDefined();

  await TestRenderer.act(async () => { boxes(r)['What it takes'].props.onChangeText('Drain hose'); });
  await tap(r, 'Add it to the house');
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
    make: 'Mitsubishi Electric',
    consumables: ['Air filter MAC-2360FT', 'Drain hose'],
    // A suggested cycle is said, never chosen for them.
    serviceDays: null,
  }));
});
