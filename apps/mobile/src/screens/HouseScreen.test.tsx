import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import HouseScreen from './HouseScreen';

// The House tab arrives furnished, and the rule the whole design rests on is
// that a ghost is never a row. These pin the three places that distinction can
// silently blur — the counts, the search, and the by-kind grouping — plus the
// seeded room order the List tab shares.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), addListener: () => () => {} }),
}));
jest.mock('../components/AddThingSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'add sheet') };
});

const mock_getThings = jest.fn();
const mock_getAbsentThings = jest.fn();
const mock_markThingAbsent = jest.fn();
const mock_restoreAbsentThings = jest.fn();
jest.mock('../lib/supabase', () => ({
  getThings: (...a: unknown[]) => mock_getThings(...a),
  getAbsentThings: (...a: unknown[]) => mock_getAbsentThings(...a),
  markThingAbsent: (...a: unknown[]) => mock_markThingAbsent(...a),
  restoreAbsentThings: (...a: unknown[]) => mock_restoreAbsentThings(...a),
  getSnagPhotoUrls: jest.fn().mockResolvedValue({}),
  createThing: jest.fn(),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const thing = (over: Partial<any>): any => ({
  id: 'x', householdId: 'h', propertyId: 'p', kind: 'appliance',
  name: 'A thing', room: null, photoPaths: [],
  make: null, model: null, serial: null, consumables: [],
  installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
  createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  propertyName: 'Home', snagCount: 0, openSnagCount: 0,
  ...over,
});

/** Laundry and Deck keep the catalogue small enough to assert on exactly. */
function arrange(locations = ['Laundry', 'Deck', 'Elsewhere']) {
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: '2026-01-01T00:00:00Z' },
    profile: { id: 'me', displayName: 'Me' },
    members: [],
    properties: [{ id: 'p', householdId: 'h', name: 'Home' }],
    activeProperty: { id: 'p', householdId: 'h', name: 'Home' },
    setActiveProperty: jest.fn(),
    locations: locations.map((name, i) => ({ id: `l${i}`, propertyId: 'p', name, sortOrder: i + 1 })),
    reloadLocations: jest.fn(),
    refresh: jest.fn(),
    reloadAccount: jest.fn(),
  };
}

const settle = () => TestRenderer.act(async () => {});

const walk = (node: any): string =>
  (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : walk(c))).join('');

const texts = (r: ReturnType<typeof render>) => r.getAllByType('Text').map(walk);

async function search(r: ReturnType<typeof render>, query: string) {
  const field = r.root.findAll(
    (n: any) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Search the house record',
    { deep: true }
  )[0];
  await TestRenderer.act(async () => field.props.onChangeText(query));
}

const pressable = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label && !!n.props?.onPress,
    { deep: true }
  )[0];

beforeEach(() => {
  jest.clearAllMocks();
  arrange();
  mock_getThings.mockResolvedValue([]);
  mock_getAbsentThings.mockResolvedValue([]);
  mock_markThingAbsent.mockResolvedValue(undefined);
  mock_restoreAbsentThings.mockResolvedValue(undefined);
});

describe('HouseScreen', () => {
  it('arrives furnished rather than empty, in the seeded room order', async () => {
    // Day one, before anybody has typed a model number. An empty state here is
    // the failure this whole design exists to avoid: a tab that answers nothing
    // on the day it ships never gets opened again.
    const result = render(<HouseScreen />);
    await settle();

    const all = texts(result);
    expect(all).not.toContain('Nothing recorded yet');
    expect(all).toContain('Laundry · 0 of 4');
    expect(all).toContain('Deck · 0 of 1');
    // Elsewhere is the location seed's escape hatch — suggesting its contents
    // would be nonsense, so it gets no section at all.
    expect(all.some((t) => t.startsWith('Elsewhere'))).toBe(false);
    expect(all).toContain('Washing machine');
    expect(all).toContain('Not recorded yet');
  });

  it('counts what is recorded against what the room still offers', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Washing machine', room: 'Laundry' }),
      thing({ id: '2', name: 'Dryer', room: 'Laundry' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();

    const all = texts(result);
    expect(all).toContain('Laundry · 2 of 4');
    // The header counts records, never ghosts — the first place the two would
    // blur is a number that includes both.
    expect(all).toContain('2 recorded');
  });

  it('puts things with no room under Whole house, last and unfurnished', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Meter box', room: null }),
      thing({ id: '2', name: 'Dryer', room: 'Laundry' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();

    const headings = texts(result).filter((t) => t.includes(' · ') || t.startsWith('Whole house'));
    expect(headings[headings.length - 1]).toBe('Whole house · 1');
  });

  it('answers a search flat, with no ghosts in the result', async () => {
    // A ghost in a search result is the app offering something it does not
    // have, to somebody standing in a shop.
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Washing machine', room: 'Laundry', make: 'Fisher & Paykel' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();
    await search(result, 'wash');

    const all = texts(result);
    expect(all).toContain('1 found');
    expect(all).not.toContain('Not recorded yet');
    expect(all).not.toContain('By room');
  });

  it('keeps ghosts out of By kind, which answers what you have', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Dryer', room: 'Laundry' }),
      thing({ id: '2', name: 'Deck stain', room: 'Deck', kind: 'finish' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();
    await TestRenderer.act(async () => pressable(result, 'By kind').props.onPress());

    const all = texts(result);
    expect(all).toEqual(expect.arrayContaining(['Appliances · 1', 'Paint · 1']));
    expect(all).not.toContain('Not recorded yet');
  });

  it('hides what this house has not got, and offers a way back', async () => {
    const result = render(<HouseScreen />);
    await settle();
    await TestRenderer.act(async () => pressable(result, 'No dryer here').props.onPress());

    expect(mock_markThingAbsent).toHaveBeenCalledWith('p', 'Laundry', 'Dryer');
    const all = texts(result);
    expect(all).toContain('Laundry · 0 of 3');
    // Dismissing is a tap; undoing it is a rescue, and a rescue with no door is
    // a dead end — the same reason `Elsewhere` is in the location seed.
    expect(all).toContain('1 not here · bring it back');
  });
});
