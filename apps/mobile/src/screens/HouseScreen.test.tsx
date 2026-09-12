import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import HouseScreen from './HouseScreen';

// Two rules carry this screen, and both are invisible until they are wrong:
// the record has to describe the house in the same words and the same order the
// list does, and a search has to be a flat answer rather than a filing system
// with three headings and one row under each.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), addListener: () => () => {} }),
}));
jest.mock('../components/ComposeBar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'compose bar'),
    AmendRow: ({ children }: { children: React.ReactNode }) => children,
    AmendLabel: ({ text }: { text: string }) => React.createElement(Text, null, text),
  };
});

const mock_getThings = jest.fn();
jest.mock('../lib/supabase', () => ({
  getThings: (...a: unknown[]) => mock_getThings(...a),
  getSnagPhotoUrls: jest.fn().mockResolvedValue({}),
  createThing: jest.fn(),
  updateThing: jest.fn(),
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

function arrange(locations = ['Kitchen', 'Bathroom', 'Garage']) {
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

const texts = (r: ReturnType<typeof render>) =>
  r.getAllByType('Text').map((n) => {
    const walk = (node: any): string =>
      (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : walk(c))).join('');
    return walk(n);
  });

/** Types into the one search field on the screen. */
async function search(r: ReturnType<typeof render>, query: string) {
  const field = r.root.findAll(
    (n: any) =>
      typeof n.type === 'string' &&
      n.props?.accessibilityLabel === 'Search the house record',
    { deep: true }
  )[0];
  await TestRenderer.act(async () => {
    field.props.onChangeText(query);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  arrange();
  mock_getThings.mockResolvedValue([]);
});

describe('HouseScreen', () => {
  it('groups by room in the seeded order, with the whole house last', async () => {
    // The same order the list groups snags in, from the same `locations`. If
    // these two ever diverge, the room a snag is in and the room a thing is in
    // stop reading as the same place.
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Mower', room: 'Garage' }),
      thing({ id: '2', name: 'Dishwasher', room: 'Kitchen' }),
      thing({ id: '3', name: 'Meter box', room: null }),
      thing({ id: '4', name: 'Oven', room: 'Kitchen' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();

    const headings = texts(result).filter((t) => t.includes(' · '));
    expect(headings).toEqual(['Kitchen · 2', 'Garage · 1', 'Whole house · 1']);
  });

  it('answers a search flat, without the room headings', async () => {
    // A result of three split across three headings buries the answer under
    // its own filing — and the person reading it is in a shop.
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Downlights', room: 'Kitchen', consumables: ['GU10 2700K'] }),
      thing({ id: '2', name: 'Wall lights', room: 'Garage', consumables: ['GU10 2700K'] }),
      thing({ id: '3', name: 'Dishwasher', room: 'Kitchen' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();
    await search(result, 'gu10');

    const all = texts(result);
    expect(all).toContain('2 found');
    expect(all).toContain('Downlights');
    expect(all).toContain('Wall lights');
    expect(all).not.toContain('Dishwasher');
    // No grouping, and no By room / By kind rail competing with the answer.
    expect(all).not.toContain('Kitchen · 1');
    expect(all).not.toContain('By room');
  });

  it('says what to do rather than that there is nothing, when empty', async () => {
    // The one screen in the app that is empty on the day it ships. "No items"
    // is how an inventory stays at 0%.
    const result = render(<HouseScreen />);
    await settle();
    const all = texts(result);
    expect(all).toContain('Nothing recorded yet');
    expect(all.some((t) => t.includes('Photograph a rating plate'))).toBe(true);
  });

  it('groups by kind when asked, in the order the enum declares', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Walls', kind: 'finish', room: 'Hallway' }),
      thing({ id: '2', name: 'Heat pump', kind: 'appliance', room: 'Living room' }),
      thing({ id: '3', name: 'Trim', kind: 'finish', room: 'Hallway' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();

    const byKind = result.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === 'By kind' && !!n.props?.onPress,
      { deep: true }
    )[0];
    await TestRenderer.act(async () => byKind.props.onPress());

    const headings = texts(result).filter((t) => t.includes(' · '));
    expect(headings).toEqual(['Appliance · 1', 'Paint · 2']);
  });
});
