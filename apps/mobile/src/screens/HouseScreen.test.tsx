import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import HouseScreen from './HouseScreen';

// The House tab is a grid of rooms, each opening a page of its own. It still
// arrives furnished, and the rule the whole design rests on is still that a
// ghost is never a row. These pin the places that distinction can silently
// blur — the counts, the tile's facts line and the search — plus the seeded
// room order the List tab shares, the door into each room, and the controls
// that were taken away: the by-kind rail and the fold.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mock_navigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mock_navigate, addListener: () => () => {} }),
}));
jest.mock('../components/AddThingSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'add sheet') };
});

const mock_writeExport = jest.fn().mockResolvedValue({ fileName: 'house.csv', path: null });
jest.mock('../lib/exportFile', () => ({
  writeExport: (...a: unknown[]) => mock_writeExport(...a),
  // Photographs ride in the PDF only. Fetching them is `exportFile`'s own
  // business and is pinned in `exportFile.test.ts` against the real library;
  // what this file cares about is which rows reached the extract.
  loadExportImages: async () => [],
}));

const mock_createLocation = jest.fn();
const mock_getThings = jest.fn();
const mock_getAbsentThings = jest.fn();
const mock_markThingAbsent = jest.fn();
jest.mock('../lib/supabase', () => ({
  getThings: (...a: unknown[]) => mock_getThings(...a),
  getAbsentThings: (...a: unknown[]) => mock_getAbsentThings(...a),
  markThingAbsent: (...a: unknown[]) => mock_markThingAbsent(...a),
  getFileUrls: jest.fn().mockResolvedValue({}),
  createThing: jest.fn(),
  createLocation: (...a: unknown[]) => mock_createLocation(...a),
}));
jest.mock('../lib/serviceJob', () => ({ fileServiceJob: jest.fn() }));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
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
    reloadLocations: mock_reloadLocations,
    refresh: jest.fn(),
    reloadAccount: jest.fn(),
  };
}

const mock_reloadLocations = jest.fn().mockResolvedValue(undefined);

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

/** Every room tile, in the order drawn — "Laundry, 0 of 4". */
const tiles = (r: ReturnType<typeof render>) => {
  const labels = r.root.findAll(
    (n: any) => typeof n.type !== 'string' && !!n.props?.onPress
      && /^.+, \d+( of \d+)?$/.test(n.props?.accessibilityLabel ?? ''),
    { deep: true },
  ).map((n: any) => n.props.accessibilityLabel as string);
  // A Pressable renders through more than one composite; keep each label once.
  return labels.filter((label, i) => labels.indexOf(label) === i);
};

beforeEach(() => {
  jest.clearAllMocks();
  arrange();
  mock_getThings.mockResolvedValue([]);
  mock_getAbsentThings.mockResolvedValue([]);
  mock_markThingAbsent.mockResolvedValue(undefined);
  mock_createLocation.mockResolvedValue(undefined);
  mock_reloadLocations.mockResolvedValue(undefined);
});

describe('HouseScreen', () => {
  it('arrives furnished rather than empty, in the seeded room order', async () => {
    // Day one, before anybody has typed a model number. An empty state here is
    // the failure this whole design exists to avoid: a tab that answers nothing
    // on the day it ships never gets opened again.
    const result = render(<HouseScreen />);
    await settle();

    expect(texts(result)).not.toContain('Nothing recorded yet');
    // Elsewhere is the location seed's escape hatch — suggesting its contents
    // would be nonsense, so it gets no tile at all.
    expect(tiles(result)).toEqual(['Laundry, 0 of 4', 'Deck, 0 of 1']);
  });

  it('says a suggestion is not recorded before it names one', async () => {
    // A tile for a room with nothing recorded names what it probably has —
    // which is exactly where a suggestion could be read as a record, so the
    // words come first.
    const result = render(<HouseScreen />);
    await settle();

    expect(texts(result)).toContain('Not recorded yet · Washing machine, Dryer, Water filter, Paint');
  });

  it('counts what is recorded against what the room still offers', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Washing machine', room: 'Laundry' }),
      thing({ id: '2', name: 'Dryer', room: 'Laundry' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();

    expect(tiles(result)).toContain('Laundry, 2 of 4');
    const all = texts(result);
    // Once anything is recorded the tile names the records, and only those.
    expect(all).toContain('Dryer, Washing machine');
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

    const all = tiles(result);
    expect(all[all.length - 1]).toBe('Whole house, 1');
  });

  it('opens a room on its own page', async () => {
    mock_getThings.mockResolvedValue([thing({ id: '1', name: 'Meter box', room: null })]);
    const result = render(<HouseScreen />);
    await settle();

    await TestRenderer.act(async () => pressable(result, 'Laundry, 0 of 4').props.onPress());
    expect(mock_navigate).toHaveBeenCalledWith('HouseRoom', { room: 'Laundry' });

    // Whole house is the page for things with no room, so it goes as null
    // rather than as a room called "Whole house".
    await TestRenderer.act(async () => pressable(result, 'Whole house, 1').props.onPress());
    expect(mock_navigate).toHaveBeenCalledWith('HouseRoom', { room: null });
  });

  it('answers a search flat, with no ghosts and no tiles in the result', async () => {
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
    expect(all).toContain('Washing machine');
    expect(all.some((t) => t.startsWith('Not recorded yet'))).toBe(false);
    expect(tiles(result)).toEqual([]);
    // The record's own count is about the record, not about the answer on
    // screen, so it stands down while a search is running.
    expect(all).not.toContain('1 recorded');
  });

  it('opens a search result on its spec sheet', async () => {
    mock_getThings.mockResolvedValue([thing({ id: 'w1', name: 'Washing machine', room: 'Laundry' })]);
    const result = render(<HouseScreen />);
    await settle();
    await search(result, 'wash');

    await TestRenderer.act(async () => pressable(result, 'Washing machine').props.onPress());
    expect(mock_navigate).toHaveBeenCalledWith('ThingDetail', { thingId: 'w1' });
  });

  it('adds a room to the tags everything else uses, not just this tab', async () => {
    // A conservatory, a study, a movie room. `home.locations` is the same list
    // the List tab groups by and capture offers, so a room added here is a room
    // everywhere — two places keeping separate ideas of what rooms exist is how
    // the two tabs stop describing the same house.
    const result = render(<HouseScreen />);
    await settle();
    await TestRenderer.act(async () => pressable(result, 'Add a room').props.onPress());

    const field = result.root.findAll(
      (n: any) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Name the room',
      { deep: true }
    )[0];
    await TestRenderer.act(async () => field.props.onChangeText('Conservatory'));
    await TestRenderer.act(async () => pressable(result, 'Add the room').props.onPress());

    expect(mock_createLocation).toHaveBeenCalledWith('p', 'Conservatory');
    expect(mock_reloadLocations).toHaveBeenCalled();
  });

  it('shows a brand-new room rather than swallowing it', async () => {
    // Nothing is catalogued for a conservatory, and a room with no things and
    // no ghosts gets no tile — so without the universal paint prompt somebody
    // would add a room and watch nothing happen.
    arrange(['Laundry', 'Conservatory']);
    const result = render(<HouseScreen />);
    await settle();

    expect(tiles(result)).toContain('Conservatory, 0 of 1');
  });

  it('leaves out what this house has not got', async () => {
    mock_getAbsentThings.mockResolvedValue([{ propertyId: 'p', room: 'Laundry', name: 'Dryer' }]);
    const result = render(<HouseScreen />);
    await settle();

    expect(tiles(result)).toContain('Laundry, 0 of 3');
  });

  it('groups by room, and offers no other layout and nothing to fold', async () => {
    // The By room / By kind rail went because the search field above it
    // already answers "what appliances do we have". The fold went with the
    // long list it existed to manage: a room is a page now, and a grid of
    // tiles has nothing to collapse.
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Dryer', room: 'Laundry' }),
      thing({ id: '2', name: 'Deck stain', room: 'Deck', kind: 'finish' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();

    const all = texts(result);
    for (const gone of ['By room', 'By kind', 'Collapse all', 'Expand all']) {
      expect(all).not.toContain(gone);
    }
    expect(all).toContain('2 recorded');
  });
});

// The rule the whole tab rests on is that a ghost is not a row, and an extract
// is the third place it could blur — after the header count and the search. A
// file full of suggestions nobody has confirmed is exactly the record you check
// in a shop and find nothing behind.
describe('taking the house record out', () => {
  const openSheet = async (r: ReturnType<typeof render>) => {
    const control = r.root.findAll(
      (n: any) => typeof n.type !== 'string'
        && n.props?.accessibilityLabel === 'Export the house record'
        && !!n.props?.onPress,
      { deep: true },
    )[0];
    await TestRenderer.act(async () => control.props.onPress());
    return r.root.findAll(
      (n: any) => typeof n.type !== 'string' && typeof n.props?.onExport === 'function',
    )[0];
  };

  beforeEach(() => {
    mock_writeExport.mockClear();
    mock_writeExport.mockResolvedValue({ fileName: 'house.csv', path: null });
  });

  it('carries recorded things and not one ghost', async () => {
    arrange(['Laundry', 'Deck', 'Elsewhere']);
    mock_getThings.mockResolvedValue([
      thing({ id: 't1', name: 'Dryer', room: 'Laundry' }),
    ]);
    mock_getAbsentThings.mockResolvedValue([]);

    const r = render(<HouseScreen />);
    await settle();

    const sheet = await openSheet(r);
    await TestRenderer.act(async () => sheet.props.onExport('all', 'csv'));

    const [table] = mock_writeExport.mock.calls[0];
    // The Laundry's catalogue suggests several things; exactly one is recorded.
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toContain('Dryer');
    expect(table.name).toBe('Home house');
  });
});
