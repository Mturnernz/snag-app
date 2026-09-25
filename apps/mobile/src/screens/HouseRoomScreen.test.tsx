import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import HouseRoomScreen from './HouseRoomScreen';

// One room of the house record. What these pin is the reading of a room — its
// things grouped by kind only when there is more than one kind to tell apart —
// and the rule the whole tab rests on, one screen further in: what is not
// recorded yet is a ghost, under its own heading, never a row among the
// records, and dismissing one is final.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mock_navigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mock_navigate, goBack: jest.fn(), addListener: () => () => {} }),
}));
jest.mock('../components/AddThingSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => {
      (global as any).__addSheet = props;
      return React.createElement(Text, null, 'add sheet');
    },
  };
});

const mock_getThings = jest.fn();
const mock_getAbsentThings = jest.fn();
const mock_markThingAbsent = jest.fn();
const mock_getFileUrls = jest.fn();
jest.mock('../lib/supabase', () => ({
  getThings: (...a: unknown[]) => mock_getThings(...a),
  getAbsentThings: (...a: unknown[]) => mock_getAbsentThings(...a),
  markThingAbsent: (...a: unknown[]) => mock_markThingAbsent(...a),
  getFileUrls: (...a: unknown[]) => mock_getFileUrls(...a),
  createThing: jest.fn(),
  createLocation: jest.fn(),
}));
jest.mock('../lib/serviceJob', () => ({ fileServiceJob: jest.fn() }));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
const mock_showAlert = jest.fn();
jest.mock('../lib/alert', () => ({ showAlert: (...a: unknown[]) => mock_showAlert(...a) }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const thing = (over: Partial<any>): any => ({
  id: 'x', householdId: 'h', propertyId: 'p', kind: 'appliance',
  name: 'A thing', room: null, photoPaths: [],
  make: null, model: null, serial: null, consumables: [], documentPaths: [],
  installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
  createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  propertyName: 'Home', snagCount: 0, openSnagCount: 0,
  ...over,
});

const settle = () => TestRenderer.act(async () => {});

const walk = (node: any): string =>
  (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : walk(c))).join('');

const texts = (r: ReturnType<typeof render>) => r.getAllByType('Text').map(walk);

const pressable = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label && !!n.props?.onPress,
    { deep: true }
  )[0];

async function open(room: string | null) {
  const r = render(<HouseRoomScreen route={{ key: 'k', name: 'HouseRoom', params: { room } } as any} navigation={{} as any} />);
  await settle();
  return r;
}

const sheet = () => (global as any).__addSheet;

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: '2026-01-01T00:00:00Z' },
    profile: { id: 'me', displayName: 'Me' },
    members: [],
    properties: [{ id: 'p', householdId: 'h', name: 'Home' }],
    activeProperty: { id: 'p', householdId: 'h', name: 'Home' },
    setActiveProperty: jest.fn(),
    locations: ['Kitchen', 'Laundry', 'Hallway'].map((name, i) => ({ id: `l${i}`, propertyId: 'p', name, sortOrder: i + 1 })),
    reloadLocations: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn(),
    reloadAccount: jest.fn(),
  };
  mock_getThings.mockResolvedValue([]);
  mock_getAbsentThings.mockResolvedValue([]);
  mock_markThingAbsent.mockResolvedValue(undefined);
  mock_getFileUrls.mockResolvedValue({});
});

describe('reading a room', () => {
  it('heads each kind when the room holds more than one, with a tile beside the paint', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Oven', room: 'Kitchen' }),
      thing({ id: '2', name: 'Wan White', room: 'Kitchen', kind: 'finish' }),
      thing({ id: '3', name: 'Splashback tile', room: 'Kitchen', kind: 'tile' }),
    ]);
    const all = texts(await open('Kitchen'));

    const at = (text: string) => all.indexOf(text);
    expect(at('Appliances')).toBeGreaterThan(-1);
    expect(at('Appliances')).toBeLessThan(at('Oven'));
    // A tile takes paint's shape, not an appliance's.
    expect(at('Paint and finishes')).toBeLessThan(at('Splashback tile'));
    expect(at('Oven')).toBeLessThan(at('Paint and finishes'));
  });

  it('draws no heading over a room of one kind', async () => {
    // A heading over the only group there is is a heading pretending to be a
    // category — the Projects tab's implicit-layer rule.
    mock_getThings.mockResolvedValue([thing({ id: '1', name: 'Wan White', room: 'Hallway', kind: 'finish' })]);
    const all = texts(await open('Hallway'));

    expect(all).toContain('Wan White');
    expect(all).not.toContain('Paint and finishes');
    expect(all).not.toContain('Appliances');
  });

  it('shows this room only', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Dryer', room: 'Laundry' }),
      thing({ id: '2', name: 'Oven', room: 'Kitchen' }),
    ]);
    const all = texts(await open('Laundry'));

    expect(all).toContain('Dryer');
    expect(all).not.toContain('Oven');
  });

  it('signs only this room’s covers', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Dryer', room: 'Laundry', photoPaths: ['h/dryer.jpg'] }),
      thing({ id: '2', name: 'Oven', room: 'Kitchen', photoPaths: ['h/oven.jpg'] }),
    ]);
    await open('Laundry');

    expect(mock_getFileUrls).toHaveBeenCalledWith(['h/dryer.jpg']);
  });

  it('opens a thing on its spec sheet', async () => {
    mock_getThings.mockResolvedValue([thing({ id: 'd1', name: 'Dryer', room: 'Laundry' })]);
    const r = await open('Laundry');

    await TestRenderer.act(async () => pressable(r, 'Dryer').props.onPress());
    expect(mock_navigate).toHaveBeenCalledWith('ThingDetail', { thingId: 'd1' });
  });
});

describe('what a room has not got recorded yet', () => {
  it('lists the suggestions under their own heading, after the records', async () => {
    mock_getThings.mockResolvedValue([thing({ id: '1', name: 'Washing machine', room: 'Laundry' })]);
    const all = texts(await open('Laundry'));

    expect(all.indexOf('Not recorded yet')).toBeGreaterThan(all.indexOf('Washing machine'));
    for (const name of ['Dryer', 'Water filter', 'Paint']) expect(all).toContain(name);
    // The record, not the suggestion: nothing already recorded is offered.
    expect(all.filter((t) => t === 'Washing machine')).toHaveLength(1);
  });

  it('is the whole page when nothing is recorded, so the room still arrives furnished', async () => {
    const all = texts(await open('Laundry'));

    expect(all).toContain('Not recorded yet');
    expect(all).not.toContain('Nothing recorded here');
  });

  it('hides a suggestion for good when this house has not got one', async () => {
    const r = await open('Laundry');
    await TestRenderer.act(async () => pressable(r, 'No dryer here').props.onPress());

    expect(mock_markThingAbsent).toHaveBeenCalledWith('p', 'Laundry', 'Dryer');
    expect(texts(r)).not.toContain('Dryer');
  });

  it('puts the suggestion back, and says so, when the server refuses', async () => {
    mock_markThingAbsent.mockRejectedValue(new Error('Not allowed'));
    const r = await open('Laundry');
    await TestRenderer.act(async () => pressable(r, 'No dryer here').props.onPress());

    expect(texts(r)).toContain('Dryer');
    expect(mock_showAlert).toHaveBeenCalledWith("Couldn't hide that", 'Not allowed');
  });

  it('opens the walkthrough on the label when a suggestion is tapped', async () => {
    // It has already answered which room and what it is.
    const r = await open('Laundry');
    await TestRenderer.act(async () => pressable(r, 'Add the dryer').props.onPress());

    expect(sheet().visible).toBe(true);
    expect(sheet().start).toEqual({ room: 'Laundry', name: 'Dryer', kind: 'appliance' });
  });
});

describe('adding to a room', () => {
  it('opens the walkthrough with the room already chosen', async () => {
    const r = await open('Laundry');
    expect(sheet().visible).toBe(false);

    await TestRenderer.act(async () => pressable(r, 'Add something to Laundry').props.onPress());
    expect(sheet().visible).toBe(true);
    expect(sheet().start).toEqual({ room: 'Laundry' });
  });
});

describe('Whole house', () => {
  it('holds the things with no room, and is never furnished', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Meter box', room: null }),
      thing({ id: '2', name: 'Dryer', room: 'Laundry' }),
    ]);
    const r = await open(null);
    const all = texts(r);

    expect(all).toContain('Whole house');
    expect(all).toContain('Meter box');
    expect(all).not.toContain('Dryer');
    expect(all).not.toContain('Not recorded yet');

    // Null is a choice here: the walkthrough opens on "what is it".
    await TestRenderer.act(async () => pressable(r, 'Add something to Whole house').props.onPress());
    expect(sheet().start).toEqual({ room: null });
  });
});
