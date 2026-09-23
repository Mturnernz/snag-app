import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import AddThingSheet from './AddThingSheet';

// Step three photographs the label, and the label is now read. What these pin
// is the half that decides whether it can be trusted: it fills only the boxes
// still empty, says which, and a failure is a sentence rather than a dead end.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../lib/photoUpload', () => ({
  takePhoto: jest.fn().mockResolvedValue('file://plate.jpg'),
  compressAndUpload: jest.fn().mockResolvedValue({ path: 'h1/plate.jpg', error: null }),
  photoFileName: () => 'h1/plate.jpg',
}));
const mock_readLabel = jest.fn();
jest.mock('../lib/supabase', () => ({
  readLabel: (...a: unknown[]) => mock_readLabel(...a),
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

const onAdd = jest.fn().mockResolvedValue(undefined);

async function openOnLabel(kind: 'appliance' | 'finish' = 'appliance', name = 'Oven') {
  let r!: RenderResult;
  await TestRenderer.act(async () => {
    r = render(
      <AddThingSheet
        visible
        locations={[{ id: 'l1', propertyId: 'p', name: 'Kitchen', sortOrder: 0 } as any]}
        pathPrefix="h1"
        start={{ room: 'Kitchen', name, kind }}
        onAddRoom={jest.fn()}
        onCancel={jest.fn()}
        onAdd={onAdd}
      />
    );
  });
  return r;
}

async function shoot(r: RenderResult) {
  await TestRenderer.act(async () => { await press(r, 'Photograph the label').props.onPress(); });
  await TestRenderer.act(async () => {});
}

beforeEach(() => jest.clearAllMocks());

it('lays what the plate says into the empty boxes and names them', async () => {
  mock_readLabel.mockResolvedValue({
    legible: true, make: 'Smeg', model: 'C6GMXA8', serial: '1690428', colourName: null,
    colourCode: null, product: null, sheen: null, tint: null, hex: null, consumables: [],
  });
  const r = await openOnLabel();
  await shoot(r);

  expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', 'appliance');
  const b = boxes(r);
  expect(b.Make.props.value).toBe('Smeg');
  expect(b.Model.props.value).toBe('C6GMXA8');
  // Never asked for, but shown in a box when read so it is checked, not saved unseen.
  expect(b.Serial.props.value).toBe('1690428');
  expect(texts(r)).toContain('Read from the photo: make, model, serial. Check against the label before you save.');
});

it('keeps what somebody typed before the reading came back', async () => {
  let answer!: (v: unknown) => void;
  mock_readLabel.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  const r = await openOnLabel();
  await shoot(r);

  await TestRenderer.act(async () => { boxes(r).Model.props.onChangeText('C6GMXA8-2'); });
  await TestRenderer.act(async () => {
    answer({
      legible: true, make: 'Smeg', model: 'C6GMXA8', serial: null, colourName: null,
      colourCode: null, product: null, sheen: null, tint: null, hex: null, consumables: [],
    });
  });

  expect(boxes(r).Model.props.value).toBe('C6GMXA8-2');
  expect(boxes(r).Make.props.value).toBe('Smeg');
});

it('says so in words when the label cannot be read, and the step carries on', async () => {
  mock_readLabel.mockRejectedValue(new Error("Label reading isn't set up yet — type what the label says."));
  const r = await openOnLabel();
  await shoot(r);

  expect(texts(r)).toContain("Label reading isn't set up yet — type what the label says.");
  expect(boxes(r).Make.props.value).toBe('');
});

it('carries a paint’s tin into the record: code, sheen, tint and swatch', async () => {
  mock_readLabel.mockResolvedValue({
    legible: true, make: 'Resene', model: null, serial: null, colourName: 'Wan White',
    colourCode: 'N93-005-105', product: null, sheen: 'Low sheen', tint: null, hex: '#EAE8DF',
    consumables: [],
  });
  const r = await openOnLabel('finish', 'Wan White');
  await TestRenderer.act(async () => { await press(r, 'Photograph the label').props.onPress(); });
  await TestRenderer.act(async () => {});

  expect(boxes(r).Brand.props.value).toBe('Resene');
  expect(boxes(r)['Colour code'].props.value).toBe('N93-005-105');
  expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Swatch #EAE8DF', { deep: true }).length)
    .toBeGreaterThan(0);

  // Through step four to the one write, which carries what the tin said.
  await TestRenderer.act(async () => { press(r, 'Next').props.onPress(); });
  await TestRenderer.act(async () => { await press(r, 'Add it to the house').props.onPress(); });
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'finish', make: 'Resene', model: 'N93-005-105', serial: null,
    spec: { sheen: 'Low sheen', hex: '#EAE8DF' },
  }));
});
