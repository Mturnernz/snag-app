import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import AddThingSheet from './AddThingSheet';

// Label reading is off for v1 (lib/labelReading.ts). These specs pin how it
// behaves when it is on, so it comes back as it went; the off state has its own.
const LABEL_FLAG = process.env.EXPO_PUBLIC_LABEL_READING;
beforeAll(() => { process.env.EXPO_PUBLIC_LABEL_READING = 'on'; });
afterAll(() => {
  if (LABEL_FLAG === undefined) delete process.env.EXPO_PUBLIC_LABEL_READING;
  else process.env.EXPO_PUBLIC_LABEL_READING = LABEL_FLAG;
});

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
  manufactured: null,
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
  expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', null, ['Kitchen']);
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

it('offers to enter the details by hand under the camera, passing over the photo', async () => {
  const r = await open(null);
  await tap(r, 'Enter details manually');
  expect(texts(r)).toContain('Which room?');
  expect(mock_upload).not.toHaveBeenCalled();
});

it('skips what a ghost has already answered, and still says the kind it knows', async () => {
  mock_readLabel.mockResolvedValue(answer(PLATE));
  const r = await openGhost();
  expect(texts(r)).toContain('Step 1 of 2');
  await shoot(r);
  expect(texts(r)).toContain('Anything else?');
  expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', 'appliance', ['Kitchen']);
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

async function openIn(rooms: string[]) {
  let r!: RenderResult;
  await TestRenderer.act(async () => {
    r = render(
      <AddThingSheet
        visible
        locations={rooms.map((name, i) => ({ id: `l${i}`, propertyId: 'p', name, sortOrder: i }) as any)}
        pathPrefix="h1"
        start={null}
        onAddRoom={jest.fn()}
        onCancel={jest.fn()}
        onAdd={onAdd}
        onLateReading={onLateReading}
      />
    );
  });
  return r;
}

describe('the photo suggests the room', () => {
  it('chooses the room the photo says, from the place’s own rooms, and says so', async () => {
    mock_readLabel.mockResolvedValue(answer(null, { name: 'Oven', kind: 'appliance', room: null }));
    const r = await openIn(['Kitchen', 'Laundry']);
    await shoot(r);
    expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', null, ['Kitchen', 'Laundry']);
    expect(press(r, 'Kitchen').props.accessibilityState).toEqual({ selected: true });
    expect(texts(r).join(' ')).toContain('Kitchen, from the photo');
  });

  it('takes the reader’s own room when it is one of the place’s, in the place’s spelling', async () => {
    mock_readLabel.mockResolvedValue(answer(null, { name: 'Thing', kind: 'appliance', room: 'laundry' }));
    const r = await openIn(['Kitchen', 'Laundry']);
    await shoot(r);
    expect(press(r, 'Laundry').props.accessibilityState).toEqual({ selected: true });
  });

  it('ignores a room the place has not got', async () => {
    mock_readLabel.mockResolvedValue(answer(null, { name: 'Thing', kind: 'appliance', room: 'Garage' }));
    const r = await openIn(['Kitchen', 'Laundry']);
    await shoot(r);
    expect(press(r, 'Kitchen').props.accessibilityState).toEqual({ selected: false });
    expect(press(r, 'Laundry').props.accessibilityState).toEqual({ selected: false });
  });

  it('never lays the photo’s room over a tap', async () => {
    let land!: (v: unknown) => void;
    mock_readLabel.mockReturnValue(new Promise((resolve) => { land = resolve; }));
    const r = await openIn(['Kitchen', 'Laundry']);
    await shoot(r);
    await tap(r, 'Laundry');
    await TestRenderer.act(async () => { land(answer(null, { name: 'Oven', kind: 'appliance', room: null })); });
    expect(press(r, 'Laundry').props.accessibilityState).toEqual({ selected: true });
    expect(press(r, 'Kitchen').props.accessibilityState).toEqual({ selected: false });
    expect(texts(r).join(' ')).not.toContain('from the photo');
  });

  it('leaves a room the + already answered alone', async () => {
    mock_readLabel.mockResolvedValue(answer(null, { name: 'Dryer', kind: 'appliance', room: null }));
    const r = await open({ room: 'Kitchen' });
    await shoot(r);
    await tap(r, 'Back');
    expect(press(r, 'Kitchen').props.accessibilityState).toEqual({ selected: true });
  });
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
  expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', 'finish', ['Kitchen']);

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

it('offers nothing the model remembers, and says the maker is being looked up instead', async () => {
  // A reply from a function still deployed with the old instructions: its
  // suggestions were the model's memory, and one heat pump got three sets.
  mock_readLabel.mockResolvedValue(answer({
    ...PLATE, make: 'Mitsubishi Electric', model: 'MSZ-GS60VFD', serial: null, manufactured: '2016',
    suggestedConsumables: [{ item: 'Air cleaning filter', code: 'MAC-2370FT-E' }], suggestedServiceMonths: 12,
  }));
  const r = await openGhost('appliance', 'Heat pump');
  await shoot(r);

  expect(boxes(r)['What it takes'].props.value).toBe('');
  expect(texts(r).join(' ')).not.toMatch(/Suggested for this model/);
  expect(press(r, 'Add Air cleaning filter MAC-2370FT-E')).toBeUndefined();
  // Said once, so nobody looks for the answer here: it lands on the thing's page.
  expect(texts(r)).toContain(
    "The MSZ-GS60VFD's manual, parts and servicing are being searched for. What can be checked will be on its page.",
  );
  // The year made is the plate's, in a box to be checked.
  expect(boxes(r)['Year made'].props.value).toBe('2016');

  await tap(r, 'Add it to the house');
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
    make: 'Mitsubishi Electric',
    consumables: [],
    serviceDays: null,
    spec: { manufactured: '2016' },
  }));
});

it('sends no spec for an appliance whose plate printed no year', async () => {
  mock_readLabel.mockResolvedValue(answer({ ...PLATE }));
  const r = await openGhost('appliance', 'Oven');
  await shoot(r);
  expect(boxes(r)['Year made']).toBeUndefined();
  await tap(r, 'Add it to the house');
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ make: 'Smeg', spec: undefined }));
});

/** Label reading as v1 ships it: off (lib/labelReading.ts). */
describe('a name the room already has', () => {
  // The second weed killer in the Garage was recorded because the first looked
  // lost. The walkthrough says so above *Add it* and offers the one already
  // there — a warning, never a lock, because two smoke alarms are real.
  const onOpenThing = jest.fn();
  const recordedThing = (room: string | null, name: string) => ({
    id: 'already', householdId: 'h', propertyId: 'p', kind: 'appliance', name, room,
  }) as any;

  async function openOver(recorded: any[], room = 'Kitchen', name = 'Oven') {
    let r!: RenderResult;
    await TestRenderer.act(async () => {
      r = render(
        <AddThingSheet
          visible
          locations={[{ id: 'l1', propertyId: 'p', name: 'Kitchen', sortOrder: 0 } as any]}
          pathPrefix="h1"
          start={{ room, name, kind: 'appliance' }}
          onAddRoom={jest.fn()}
          onCancel={jest.fn()}
          onAdd={onAdd}
          recorded={recorded}
          onOpenThing={onOpenThing}
        />
      );
    });
    // Room and name are answered, so passing the photo lands on the last step.
    await tap(r, 'Skip for now');
    expect(texts(r)).toContain('Anything else?');
    return r;
  }

  it('says the room already has one, in its own spelling, and opens it without writing', async () => {
    const r = await openOver([recordedThing('Kitchen', 'oven')]);
    expect(texts(r)).toContain('Kitchen already has oven');

    await tap(r, 'Open the oven already recorded');
    expect(onOpenThing).toHaveBeenCalledWith('already');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('still adds a second one when asked', async () => {
    const r = await openOver([recordedThing('Kitchen', 'Oven')]);
    await tap(r, 'Add it to the house');
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ room: 'Kitchen', name: 'Oven' }));
  });

  it('says nothing about the same name in another room', async () => {
    const r = await openOver([recordedThing('Laundry', 'Oven')]);
    expect(texts(r).some((t) => /already has/.test(t))).toBe(false);
  });

  it('says nothing about a longer name', async () => {
    const r = await openOver([recordedThing('Kitchen', 'Wall oven')]);
    expect(texts(r).some((t) => /already has/.test(t))).toBe(false);
  });
});

function withLabelReadingOff() {
  beforeEach(() => { process.env.EXPO_PUBLIC_LABEL_READING = 'off'; });
  afterEach(() => { process.env.EXPO_PUBLIC_LABEL_READING = 'on'; });
}

describe('with label reading off, as v1 ships', () => {
  withLabelReadingOff();

  it('takes the photo and never sends it to be read', async () => {
    const r = await open(null);
    await shoot(r);
    expect(mock_upload).toHaveBeenCalledWith('file://plate.jpg', 'h1/plate.jpg');
    expect(texts(r)).toContain('Which room?');
    expect(mock_readLabel).not.toHaveBeenCalled();
  });

  it('does not promise the plate will be read', async () => {
    const r = await open(null);
    expect(texts(r)).toContain('The plate carries the make, model and serial, so it is the photo worth keeping.');
    expect(texts(r).some((t) => /read while you carry on/.test(t))).toBe(false);
  });
});

describe('a consumable', () => {
  const dishwasher = { id: 'd', kind: 'appliance', name: 'Bosch dishwasher', room: 'Kitchen' } as any;
  const mower = { id: 'm', kind: 'appliance', name: 'Lawnmower', room: 'Garage' } as any;
  const tabsOnShelf = { id: 't', kind: 'consumable', name: 'Rinse aid', room: 'Kitchen' } as any;
  const PACK = {
    legible: true, make: 'Finish', model: null, serial: null, manufactured: null, colourName: null,
    colourCode: null, product: 'Quantum Ultimate', sheen: null, tint: null, hex: null, consumables: [],
    size: '60 tablets', usedFor: 'dishwashers',
  };

  async function openWith(recorded: any[]) {
    let r!: RenderResult;
    await TestRenderer.act(async () => {
      r = render(
        <AddThingSheet
          visible
          locations={['Garage', 'Kitchen'].map((name, i) => ({ id: `l${i}`, propertyId: 'p', name, sortOrder: i }) as any)}
          pathPrefix="h1"
          start={null}
          recorded={recorded}
          onAddRoom={jest.fn()}
          onCancel={jest.fn()}
          onAdd={onAdd}
          onLateReading={onLateReading}
        />
      );
    });
    return r;
  }

  it('is put where the appliance it is for lives, ticked against it, and added with the link', async () => {
    mock_readLabel.mockResolvedValue(answer(PACK, { name: 'Dishwasher tablets', kind: 'consumable', room: null }));
    const r = await openWith([dishwasher, mower, tabsOnShelf]);
    await shoot(r);
    expect(press(r, 'Kitchen').props.accessibilityState).toEqual({ selected: true });
    await tap(r, 'Next');
    expect(press(r, 'From the photo: Dishwasher tablets').props.accessibilityState).toEqual({ selected: true });
    await tap(r, 'Next');

    expect(texts(r)).toContain("What's it used with?");
    expect(press(r, 'Bosch dishwasher · Kitchen').props.accessibilityState).toEqual({ selected: true });
    expect(press(r, 'Lawnmower · Garage').props.accessibilityState).toEqual({ selected: false });
    // Another consumable is never something a consumable is used with.
    expect(press(r, 'Rinse aid · Kitchen')).toBeUndefined();
    expect(boxes(r).Size.props.value).toBe('60 tablets');
    expect(boxes(r).Product.props.value).toBe('Quantum Ultimate');
    // A pack takes nothing and is never serviced.
    expect(texts(r)).not.toContain('Serviced how often?');

    await tap(r, 'Add it to the house');
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'consumable', room: 'Kitchen', name: 'Dishwasher tablets', make: 'Finish',
      model: 'Quantum Ultimate', spec: { size: '60 tablets' }, consumables: [], serviceDays: null,
      usedWith: ['d'],
    }));
  });

  it('never ticks over somebody’s own answer', async () => {
    let land!: (v: unknown) => void;
    mock_readLabel.mockReturnValue(new Promise((resolve) => { land = resolve; }));
    const r = await openWith([dishwasher, mower]);
    await shoot(r);
    await tap(r, 'Garage');
    await tap(r, 'Next');
    await tap(r, 'Something else…');
    await TestRenderer.act(async () => { boxes(r)['What is it'].props.onChangeText('Weed killer'); });
    await tap(r, 'Consumable');
    await tap(r, 'Next');
    await tap(r, 'Lawnmower · Garage');
    await TestRenderer.act(async () => { land(answer(PACK, { name: 'Dishwasher tablets', kind: 'consumable', room: null })); });
    expect(press(r, 'Bosch dishwasher · Kitchen').props.accessibilityState).toEqual({ selected: false });
    expect(press(r, 'Lawnmower · Garage').props.accessibilityState).toEqual({ selected: true });
  });
});
