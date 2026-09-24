import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import HouseScreen from './HouseScreen';
import { writeCollapsed } from '../lib/collapsed';

// The House tab arrives furnished, and the rule the whole design rests on is
// that a ghost is never a row. These pin the two places that distinction can
// silently blur — the counts and the search — plus the seeded room order the
// List tab shares, and the two things that were taken away: the by-kind
// grouping and the line that undid a dismissal.

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
const mock_getLabelReadingsToCheck = jest.fn();
jest.mock('../lib/supabase', () => ({
  getLabelReadingsToCheck: (...a: unknown[]) => mock_getLabelReadingsToCheck(...a),
  getThings: (...a: unknown[]) => mock_getThings(...a),
  getAbsentThings: (...a: unknown[]) => mock_getAbsentThings(...a),
  markThingAbsent: (...a: unknown[]) => mock_markThingAbsent(...a),
  getFileUrls: jest.fn().mockResolvedValue({}),
  createThing: jest.fn(),
  createLocation: (...a: unknown[]) => mock_createLocation(...a),
}));
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

beforeEach(() => {
  jest.clearAllMocks();
  arrange();
  mock_getThings.mockResolvedValue([]);
  mock_getAbsentThings.mockResolvedValue([]);
  mock_markThingAbsent.mockResolvedValue(undefined);
  mock_getLabelReadingsToCheck.mockResolvedValue([]);
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
    // The record's own count is about the record, not about the answer on
    // screen, so it stands down while a search is running.
    expect(all).not.toContain('1 recorded');
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
    // Nothing is catalogued for a conservatory, and a section with no things
    // and no ghosts is not drawn — so without the universal paint prompt
    // somebody would add a room and watch nothing happen.
    arrange(['Laundry', 'Conservatory']);
    const result = render(<HouseScreen />);
    await settle();

    expect(texts(result)).toContain('Conservatory · 0 of 1');
  });

  it('hides what this house has not got, for good', async () => {
    // Dismissing used to leave a rescue line under the room. It doesn't: "no
    // dryer here" is a small certain fact about this house, and a standing
    // offer to un-say it is clutter on top of the answer. The + is how a dryer
    // that does turn up gets recorded.
    const result = render(<HouseScreen />);
    await settle();
    await TestRenderer.act(async () => pressable(result, 'No dryer here').props.onPress());

    expect(mock_markThingAbsent).toHaveBeenCalledWith('p', 'Laundry', 'Dryer');
    const all = texts(result);
    expect(all).toContain('Laundry · 0 of 3');
    expect(all.some((t) => t.includes('bring it back'))).toBe(false);
  });

  it('groups by room and offers no other layout', async () => {
    // The By room / By kind rail is gone. It charged a control rail on every
    // visit to answer a question the search field above it already answers,
    // and one layout is what keeps this tab and the List tab describing the
    // house in the same words.
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Dryer', room: 'Laundry' }),
      thing({ id: '2', name: 'Deck stain', room: 'Deck', kind: 'finish' }),
    ]);
    const result = render(<HouseScreen />);
    await settle();

    const all = texts(result);
    expect(all).not.toContain('By room');
    expect(all).not.toContain('By kind');
    expect(all).toContain('2 recorded');
    expect(all.some((t) => t.startsWith('Laundry · '))).toBe(true);
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

// ─── folding a room away ──────────────────────────────────────────────────────

describe('folding rooms on the House tab', () => {
  const byLabel = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
        && !!n.props?.onPress,
      { deep: true },
    )[0];

  // The fold persists by design, so a test that folds a room would otherwise
  // fold it for whatever ran next.
  beforeEach(async () => { await writeCollapsed([], 'house'); });

  it('keeps the heading and its count when a room is folded', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Washing machine', room: 'Laundry' }),
    ]);
    const r = render(<HouseScreen />);
    await settle();

    expect(texts(r)).toContain('Washing machine');

    await TestRenderer.act(async () => byLabel(r, 'Laundry · 1 of 4').props.onPress());

    // The heading is the whole point of the grouping, so a fold keeps it.
    expect(texts(r)).toContain('Laundry · 1 of 4');
    expect(texts(r)).not.toContain('Washing machine');
  });

  // Same component and same words as the List tab, so two tabs grouping the
  // same house by the same rooms cannot grow two controls for closing them.
  it('offers to collapse everything, then to expand everything', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Washing machine', room: 'Laundry' }),
    ]);
    const r = render(<HouseScreen />);
    await settle();

    expect(byLabel(r, 'Collapse all')).toBeDefined();
    await TestRenderer.act(async () => byLabel(r, 'Collapse all').props.onPress());

    expect(byLabel(r, 'Expand all')).toBeDefined();
    expect(texts(r)).not.toContain('Washing machine');
  });

  // A search is one flat answer over real records; there is nothing to fold,
  // and a control that could only be a no-op is a control dressed as a choice.
  it('offers no fold control while searching', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Washing machine', room: 'Laundry' }),
    ]);
    const r = render(<HouseScreen />);
    await settle();

    const box = r.root.findAll(
      (n: any) => typeof n.type !== 'string'
        && n.props?.accessibilityLabel === 'Search the house record',
      { deep: true },
    )[0];
    await TestRenderer.act(async () => box.props.onChangeText('washing'));

    expect(byLabel(r, 'Collapse all')).toBeUndefined();
    expect(byLabel(r, 'Expand all')).toBeUndefined();
  });

  // A label read after *Add it* waits on the thing's page. The pill is how
  // somebody finds out, so it is absent at nought and counts only what is
  // ready to check — never one still being read.
  it('says how many labels are waiting to be checked, and nothing at nought', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: '1', name: 'Washing machine', room: 'Laundry' }),
      thing({ id: '2', name: 'Dryer', room: 'Laundry' }),
    ]);
    const none = render(<HouseScreen />);
    await settle();
    expect(texts(none).some((t) => /label/.test(t))).toBe(false);

    mock_getLabelReadingsToCheck.mockResolvedValue([
      { id: 'r1', thingId: '1', status: 'read' },
      { id: 'r2', thingId: '2', status: 'pending' },
    ]);
    const some = render(<HouseScreen />);
    await settle();
    expect(texts(some)).toContain('1 label to check');
    expect(texts(some)).toContain('Label to check');
    expect(mock_getLabelReadingsToCheck).toHaveBeenCalledWith('p');
  });

  it('draws the record when the readings cannot be fetched', async () => {
    mock_getThings.mockResolvedValue([thing({ id: '1', name: 'Washing machine', room: 'Laundry' })]);
    mock_getLabelReadingsToCheck.mockRejectedValue(new Error('offline'));
    const result = render(<HouseScreen />);
    await settle();
    expect(texts(result)).toContain('1 recorded');
  });
});
