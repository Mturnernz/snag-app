import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SnagListScreen from './SnagListScreen';
import { readCollapsed, writeCollapsed } from '../lib/collapsed';

// The list is the app's home now, and two pieces of logic carry the concept:
// what counts as "new", and grouping by room. With no notifications anywhere in
// this product, the New rule is the only way one person learns what the other
// added — getting it wrong is not a cosmetic bug.

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
  };
});

const mock_writeExport = jest.fn().mockResolvedValue({ fileName: 'list.csv', path: null });
jest.mock('../lib/exportFile', () => ({
  writeExport: (...a: unknown[]) => mock_writeExport(...a),
  // Photographs ride in the PDF only. Fetching them is `exportFile`'s own
  // business and is pinned in `exportFile.test.ts` against the real library;
  // what this file cares about is which rows reached the extract.
  loadExportImages: async () => [],
}));

const mock_getSnags = jest.fn();
const mock_markListSeen = jest.fn();
const mock_setPartBought = jest.fn().mockResolvedValue(undefined);
const mock_updateSnag = jest.fn();
const mock_setSnagStatus = jest.fn();
jest.mock('../lib/supabase', () => ({
  setSnagStatus: (...a: unknown[]) => mock_setSnagStatus(...a),
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
  markListSeen: () => mock_markListSeen(),
  getFileUrls: jest.fn().mockResolvedValue({}),
  getThings: jest.fn().mockResolvedValue([]),
  createSnag: jest.fn(),
  updateSnag: (...a: unknown[]) => mock_updateSnag(...a),
  setPartBought: (...a: unknown[]) => mock_setPartBought(...a),
}));
const mock_showToast = jest.fn();
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: mock_showToast }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const ME = 'me';
const THEM = 'sam';
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const snag = (over: Partial<any>): any => ({
  id: 'x', reference: 'S-1', householdId: 'h', propertyId: 'p',
  linkedThings: [],
  room: null, photoPaths: [], description: 'A thing', priority: null,
  status: 'open', parts: [], bought: [], needsParts: false, dueAt: null, repeatDays: null,
  assigneeId: null, reporterId: ME, createdAt: ago(10), updatedAt: ago(10),
  lastDoneAt: null, doneAt: null, propertyName: 'Home', reporterName: 'Me',
  assigneeName: null, commentCount: 0,
  ...over,
});

function arrange(locations = ['Kitchen', 'Bathroom', 'Garage']) {
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: ago(100) },
    profile: { id: ME, displayName: 'Me' },
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

beforeEach(() => {
  jest.clearAllMocks();
  arrange();
  mock_markListSeen.mockResolvedValue(ago(2));
  mock_getSnags.mockImplementation((filter: any) =>
    Promise.resolve(filter.status?.includes('done') ? [] : [])
  );
});

describe('SnagListScreen', () => {
  it("calls somebody else's recent addition new, and not your own", async () => {
    mock_getSnags.mockImplementation((filter: any) =>
      Promise.resolve(
        filter.status?.includes('done')
          ? []
          : [
            snag({ id: 'theirs', description: 'Gutters', reporterId: THEM, createdAt: ago(1) }),
            snag({ id: 'mine', description: 'Shelf', reporterId: ME, createdAt: ago(1) }),
            snag({ id: 'old', description: 'Fence', reporterId: THEM, createdAt: ago(30) }),
          ]
      )
    );
    const result = render(<SnagListScreen />);
    await settle();

    const all = texts(result);
    expect(all).toContain('New');
    // One addition, theirs. Yours is not news to you, and a month-old one of
    // theirs was already seen.
    expect(all.some((t) => t.startsWith('3 to do') && t.includes('1 added'))).toBe(true);
  });

  it('calls nothing new on a first-ever visit', async () => {
    // A null stamp means we have never recorded a visit. Treating that as
    // "everything is new" greets a new member with the household's backlog.
    mock_markListSeen.mockResolvedValue(null);
    mock_getSnags.mockImplementation((filter: any) =>
      Promise.resolve(
        filter.status?.includes('done') ? [] : [snag({ id: 'a', reporterId: THEM, createdAt: ago(1) })]
      )
    );
    const result = render(<SnagListScreen />);
    await settle();
    expect(texts(result)).not.toContain('New');
  });

  it('groups by room in the seeded order, with untagged last', async () => {
    mock_getSnags.mockImplementation((filter: any) =>
      Promise.resolve(
        filter.status?.includes('done')
          ? []
          : [
            snag({ id: '1', room: 'Garage', reporterId: ME }),
            snag({ id: '2', room: 'Kitchen', reporterId: ME }),
            snag({ id: '3', room: null, reporterId: ME }),
            snag({ id: '4', room: 'Kitchen', reporterId: ME }),
          ]
      )
    );
    const result = render(<SnagListScreen />);
    await settle();

    const headings = texts(result).filter((t) => t.includes(' · '));
    // Kitchen before Garage because that is the seeded order, not the
    // alphabet and not the order things were filed.
    expect(headings).toEqual(['Kitchen · 2', 'Garage · 1', 'Everywhere else · 1']);
  });

  it('offers done as a line at the foot, not as a lens', async () => {
    mock_getSnags.mockImplementation((filter: any) =>
      Promise.resolve(
        filter.status?.includes('done')
          ? [snag({ id: 'd', status: 'done', doneAt: ago(2), reporterId: ME })]
          : [snag({ id: 'a', reporterId: ME })]
      )
    );
    const result = render(<SnagListScreen />);
    await settle();
    expect(texts(result)).toContain('Show 1 done this week');
  });

  it('forgets something finished a fortnight ago', async () => {
    mock_getSnags.mockImplementation((filter: any) =>
      Promise.resolve(
        filter.status?.includes('done')
          ? [snag({ id: 'd', status: 'done', doneAt: ago(14), reporterId: ME })]
          : []
      )
    );
    const result = render(<SnagListScreen />);
    await settle();
    expect(texts(result).some((t) => t.includes('done this week'))).toBe(false);
  });
});

// An extract is an archive. The screen-level job is which rows go in, and the
// way to get that wrong is to let "Everything" quietly inherit the lens you set
// twenty minutes ago — a file you would then read as the whole list.
describe('taking the list out', () => {
  const settle = () => TestRenderer.act(async () => {});

  const pressableAround = (r: ReturnType<typeof render>, text: string) => {
    let node: any = r.getByText(text);
    while (node) {
      if (typeof node.props?.onPress === 'function') return node;
      node = node.parent;
    }
    throw new Error(`Nothing pressable around "${text}"`);
  };

  const openSheet = async (r: ReturnType<typeof render>) => {
    await TestRenderer.act(async () => {
      await pressableAround(r, 'Export this list').props.onPress();
    });
    return r.root.findAll(
      (n: any) => typeof n.type !== 'string' && typeof n.props?.onExport === 'function',
    )[0];
  };

  beforeEach(() => {
    mock_writeExport.mockClear();
    mock_writeExport.mockResolvedValue({ fileName: 'list.csv', path: null });
  });

  it('offers the extract at the foot of the list, not on the compose bar', async () => {
    arrange();
    mock_getSnags.mockResolvedValue([snag({ id: 'a', room: 'Kitchen' })]);
    const r = render(<SnagListScreen />);
    await settle();

    expect(r.queryByText('Export this list')).not.toBeNull();
    // The compose bar is mocked to a single Text node; the export control is
    // nowhere inside it. Nothing goes on the compose bar.
    expect(r.queryByText('compose bar')).not.toBeNull();
  });

  it('puts every snag in "Everything", done ones included and no lens applied', async () => {
    arrange();
    // The screen reads open and done separately, so the mock has to answer the
    // status it was asked for — returning everything twice would double the
    // rows and hide whatever this test is trying to say.
    const all = [
      snag({ id: 'a', room: 'Kitchen', needsParts: false }),
      snag({ id: 'b', room: 'Garage', needsParts: true }),
      snag({ id: 'c', status: 'done', doneAt: ago(1) }),
    ];
    mock_getSnags.mockImplementation(async (filter: any) =>
      all.filter((s) => filter.status.includes(s.status)));
    const r = render(<SnagListScreen />);
    await settle();

    const sheet = await openSheet(r);
    await TestRenderer.act(async () => sheet.props.onExport('all', 'csv'));

    const [table] = mock_writeExport.mock.calls[0];
    expect(table.rows).toHaveLength(3);
    expect(table.subtitle).toContain('Everything');
  });

  it('names the house and the place at the top of the file', async () => {
    arrange();
    mock_getSnags.mockResolvedValue([snag({ id: 'a', room: 'Kitchen' })]);
    const r = render(<SnagListScreen />);
    await settle();

    const sheet = await openSheet(r);
    await TestRenderer.act(async () => sheet.props.onExport('view', 'pdf'));

    const [table, format] = mock_writeExport.mock.calls[0];
    expect(table.name).toBe('Home list');
    expect(table.subtitle).toContain('Home');
    expect(format).toBe('pdf');
  });
});

// ─── the shopping pill and the trip sheet ─────────────────────────────────────

describe('the shopping list', () => {
  const byLabel = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
        && !!n.props?.onPress,
      { deep: true },
    )[0];

  const withParts = () => {
    arrange();
    const all = [
      snag({ id: 'a', room: 'Bathroom', parts: ['Seal', 'Washer'], bought: ['Washer'], needsParts: true }),
      snag({ id: 'b', room: 'Outside', parts: ['Brackets'], bought: [], needsParts: true }),
      snag({ id: 'c', room: 'Kitchen' }),
    ];
    mock_getSnags.mockImplementation(async (filter: any) =>
      all.filter((s) => filter.status.includes(s.status)));
  };

  beforeEach(async () => {
    mock_setPartBought.mockClear();
    mock_updateSnag.mockClear();
    // The trip sheet's folds persist by design, so a test that folds a room
    // would otherwise fold it for whatever ran next.
    await writeCollapsed([], 'shopping');
  });

  it('counts what is left across the whole list, not the lens', async () => {
    withParts();
    const r = render(<SnagListScreen />);
    await settle();

    // Three items listed, one already got.
    expect(byLabel(r, 'View shopping list, 2 things to get')).toBeDefined();
  });

  it('is not there at all when there is nothing to get', async () => {
    // At nought it is a control dressed as a choice, and this screen evicted
    // two filter rails for charging rent on every visit.
    arrange();
    mock_getSnags.mockResolvedValue([snag({ id: 'a', room: 'Kitchen' })]);
    const r = render(<SnagListScreen />);
    await settle();

    expect(byLabel(r, 'View shopping list, 1 thing to get')).toBeUndefined();
    expect(byLabel(r, 'View shopping list, 0 things to get')).toBeUndefined();
  });

  it('opens the lens it already has, rather than a second place parts live', async () => {
    withParts();
    const r = render(<SnagListScreen />);
    await settle();

    expect(r.queryByText('Pick up on the way')).toBeNull();
    await TestRenderer.act(async () => byLabel(r, 'View shopping list, 2 things to get').props.onPress());
    expect(r.queryByText('Pick up on the way')).not.toBeNull();
  });

  // A cart with a number on it says there is shopping to do; it does not say
  // that pressing it swaps what the screen is showing. The caption names the
  // view it goes to, and turns round once you are there.
  it('names the view it goes to, and says the other one once it is open', async () => {
    withParts();
    const r = render(<SnagListScreen />);
    await settle();

    expect(r.queryByText('View shopping list')).not.toBeNull();
    expect(r.queryByText('View jobs list')).toBeNull();

    await TestRenderer.act(async () => byLabel(r, 'View shopping list, 2 things to get').props.onPress());

    expect(r.queryByText('View jobs list')).not.toBeNull();
    expect(r.queryByText('View shopping list')).toBeNull();
  });

  // The card names what is left to get and claims nothing about the trip. It
  // said "One trip clears 5 jobs", which is a promise about the world rather
  // than a fact about the list — five jobs can easily be three shops.
  it('claims nothing about how many trips it takes', async () => {
    withParts();
    const r = render(<SnagListScreen />);
    await settle();
    await TestRenderer.act(async () => byLabel(r, 'View shopping list, 2 things to get').props.onPress());

    expect(r.queryByText('Pick up on the way')).not.toBeNull();
    expect(texts(r).some((t) => /One trip/i.test(t))).toBe(false);
  });

  // The failure that prompted this: with the parts lens up the card is most of
  // what is on screen, so a Collapse all that reached only the sections behind
  // it read as a button that did nothing.
  it('collapses the trip sheet too, not just the list behind it', async () => {
    withParts();
    const r = render(<SnagListScreen />);
    await settle();
    await TestRenderer.act(async () => byLabel(r, 'View shopping list, 2 things to get').props.onPress());

    expect(byLabel(r, 'Seal, tick off')).toBeDefined();

    await TestRenderer.act(async () => byLabel(r, 'Collapse all').props.onPress());

    // The rooms on the card fold with everything else, and the headings stay.
    expect(byLabel(r, 'Seal, tick off')).toBeUndefined();
    expect(byLabel(r, 'Brackets, tick off')).toBeUndefined();
    expect(byLabel(r, 'Bathroom, 1 to get')).toBeDefined();

    // And it now offers the way back, rather than still saying Collapse all.
    await TestRenderer.act(async () => byLabel(r, 'Expand all').props.onPress());
    expect(byLabel(r, 'Seal, tick off')).toBeDefined();
  });

  // "Outside" nine times down the right-hand edge is a column of noise where
  // one heading would do, and a trip to the shop batches the way the list does.
  it('groups the trip sheet by room, and folds a room away', async () => {
    withParts();
    const r = render(<SnagListScreen />);
    await settle();
    await TestRenderer.act(async () => byLabel(r, 'View shopping list, 2 things to get').props.onPress());

    // The room is a heading, and the item sits under it. The count is what is
    // still to get, not what was ever listed — the Washer is already bought.
    expect(byLabel(r, 'Seal, tick off')).toBeDefined();
    const head = byLabel(r, 'Bathroom, 1 to get');
    expect(head).toBeDefined();
    // Two rooms, each named once, rather than the room repeated per row.
    expect(byLabel(r, 'Outside, 1 to get')).toBeDefined();

    await TestRenderer.act(async () => head.props.onPress());

    // The heading stays with its count; only its own rows go.
    expect(byLabel(r, 'Bathroom, 1 to get')).toBeDefined();
    expect(byLabel(r, 'Seal, tick off')).toBeUndefined();
    expect(byLabel(r, 'Brackets, tick off')).toBeDefined();
  });

  it('ticks an item off without touching the job', async () => {
    // Changing the list starts the job; buying something off it is not adding
    // one, so it must not go through update_snag.
    withParts();
    const r = render(<SnagListScreen />);
    await settle();
    await TestRenderer.act(async () => byLabel(r, 'View shopping list, 2 things to get').props.onPress());

    await TestRenderer.act(async () => byLabel(r, 'Seal, tick off').props.onPress());

    expect(mock_setPartBought).toHaveBeenCalledWith('a', 'Seal', true);
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  it('keeps what has been got on screen, and offers it back', async () => {
    withParts();
    const r = render(<SnagListScreen />);
    await settle();
    await TestRenderer.act(async () => byLabel(r, 'View shopping list, 2 things to get').props.onPress());

    // Undoing a mis-tap must not mean remembering which job the item was for.
    const got = byLabel(r, 'Washer, got it');
    expect(got).toBeDefined();
    await TestRenderer.act(async () => got.props.onPress());
    expect(mock_setPartBought).toHaveBeenCalledWith('a', 'Washer', false);
  });

  it('stops a card asking for something once it has been bought', async () => {
    // A card claiming it needs the seal you bought on Saturday is a card you
    // stop believing.
    arrange();
    const all = [snag({ id: 'a', room: 'Bathroom', parts: ['Seal'], bought: ['Seal'], needsParts: false })];
    mock_getSnags.mockImplementation(async (filter: any) =>
      all.filter((s) => filter.status.includes(s.status)));
    const r = render(<SnagListScreen />);
    await settle();

    expect(r.queryByText('Seal')).toBeNull();
  });
});

// ─── a repeat that has been done ──────────────────────────────────────────────

describe('a job that comes round again', () => {
  const DAY = 86_400_000;
  const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

  const sectionTitles = (r: ReturnType<typeof render>) =>
    r.root.findAll((n: any) => typeof n.type !== 'string'
      && typeof n.props?.sections === 'object')[0]?.props.sections.map((x: any) => x.title);

  const withParked = () => {
    arrange();
    const all = [
      snag({ id: 'a', room: 'Kitchen', description: 'Cupboard door' }),
      snag({
        id: 'b', room: 'Outside', description: 'Heat pump filter',
        repeatDays: 180, lastDoneAt: at(-1), dueAt: at(179),
      }),
    ];
    mock_getSnags.mockImplementation(async (filter: any) =>
      all.filter((s) => filter.status.includes(s.status)));
  };

  it('sinks past every room to the foot of the list', async () => {
    // It cannot leave the way a finished snag does, so this is the only version
    // of that reward available to it.
    withParked();
    const r = render(<SnagListScreen />);
    await settle();

    const titles = sectionTitles(r);
    expect(titles[titles.length - 1]).toBe('Comes round again · 1');
    expect(titles).toContain('Kitchen · 1');
    expect(titles).not.toContain('Outside · 1');
  });

  it('is dimmed, and still opens', async () => {
    withParked();
    const r = render(<SnagListScreen />);
    await settle();

    const card = r.root.findAll((n: any) => typeof n.type !== 'string'
      && n.props?.snag?.id === 'b')[0];
    expect(card).toBeDefined();
    expect(typeof card.props.onPress).toBe('function');
    // The translucency is the card's own, the same one a finished snag gets.
    const styles = card.findAll((n: any) => typeof n.type === 'string'
      && Array.isArray(n.props?.style))[0]?.props.style.flat();
    expect(JSON.stringify(styles)).toContain('0.62');
  });

  it('is not counted as something to do', async () => {
    // "2 to do" over a list where one is dimmed and parked at the bottom is the
    // screen contradicting itself.
    withParked();
    const r = render(<SnagListScreen />);
    await settle();
    expect(r.queryByText('1 to do')).not.toBeNull();
  });

  it('leaves an ordinary repeat exactly where it was', async () => {
    // Due next month and never done: there is work to do, so it stays in its
    // room with everything else.
    arrange();
    const all = [snag({
      id: 'b', room: 'Outside', description: 'Gutters', repeatDays: 180, dueAt: at(30),
    })];
    mock_getSnags.mockImplementation(async (filter: any) =>
      all.filter((s) => filter.status.includes(s.status)));
    const r = render(<SnagListScreen />);
    await settle();

    expect(sectionTitles(r)).toContain('Outside · 1');
    expect(r.queryByText('1 to do')).not.toBeNull();
  });
});

// ---------------------------------------------------------------- folding
//
// The list groups by room because that is how work is batched — you do the
// garage once — and a household with a dozen rooms and forty jobs scrolls a
// long way to reach the one it came for. Folding keeps the answer the grouping
// gives ("there are three things in the Garage") while costing none of the
// height.

// ---------------------------------------------------------------- due soon
//
// Nothing in this product reminds anybody, so the list is the reminder. A job
// due on Saturday used to sit in its room with everything else.

describe('what is due soon', () => {
  const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
  const sectionTitles = (r: ReturnType<typeof render>) =>
    texts(r).filter((t) => / · \d+$/.test(t));

  it('lifts what is overdue or due this week above every room, soonest first', async () => {
    const all = [
      snag({ id: 'a', room: 'Kitchen', description: 'Tap', dueAt: at(5) }),
      snag({ id: 'b', room: 'Garage', description: 'Filter', dueAt: at(-2) }),
      snag({ id: 'c', room: 'Kitchen', description: 'Shelf', dueAt: at(40) }),
      snag({ id: 'd', room: 'Kitchen', description: 'Hinge' }),
    ];
    mock_getSnags.mockImplementation(async (filter: any) =>
      all.filter((s) => filter.status.includes(s.status)));
    const r = render(<SnagListScreen />);
    await settle();

    const titles = sectionTitles(r);
    expect(titles[0]).toBe('Due soon · 2');
    expect(titles).toContain('Kitchen · 2');
    expect(titles).not.toContain('Garage · 1');
    const words = texts(r);
    expect(words.indexOf('Filter')).toBeLessThan(words.indexOf('Tap'));
  });

  it('leaves a repeat that is parked until next time out of it', async () => {
    const all = [snag({
      id: 'a', room: 'Kitchen', description: 'Filter', repeatDays: 7, dueAt: at(5), lastDoneAt: ago(2),
    })];
    mock_getSnags.mockImplementation(async (filter: any) =>
      all.filter((s) => filter.status.includes(s.status)));
    const r = render(<SnagListScreen />);
    await settle();
    expect(sectionTitles(r).some((t) => t.startsWith('Due soon'))).toBe(false);
  });

  it('has no Show me button any more — the cart is the only lens', async () => {
    const r = render(<SnagListScreen />);
    await settle();
    const found = r.root.findAll((n) => n.props?.accessibilityLabel === 'Show me', { deep: true });
    expect(found).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- finishing
//
// Marking something done is the most common thing done to a job that already
// exists, and it was four actions and a scroll away.

describe('finishing from the list', () => {
  const tick = (r: ReturnType<typeof render>, headline: string) =>
    r.root.findAll((n) => typeof n.type !== 'string' && !!n.props?.onPress
      && n.props?.accessibilityLabel === `Mark done: ${headline}`, { deep: true });

  it('finishes a job from its card and offers to take it back', async () => {
    mock_getSnags.mockImplementation(async (filter: any) =>
      filter.status.includes('done') ? [] : [snag({ id: 'a', description: 'Hinge' })]);
    mock_setSnagStatus.mockResolvedValue(snag({ id: 'a', status: 'done' }));
    const r = render(<SnagListScreen />);
    await settle();

    await TestRenderer.act(async () => { await tick(r, 'Hinge')[0].props.onPress(); });
    expect(mock_setSnagStatus).toHaveBeenCalledWith('a', 'done');
    const [message, action] = mock_showToast.mock.calls.at(-1)!;
    expect(message).toBe('Done: Hinge');
    expect(action.label).toBe('Undo');

    mock_setSnagStatus.mockResolvedValue(snag({ id: 'a' }));
    await TestRenderer.act(async () => { action.onPress(); });
    expect(mock_setSnagStatus).toHaveBeenLastCalledWith('a', 'open');
  });

  it('says a repeat is back on the list, and offers no undo', async () => {
    mock_getSnags.mockImplementation(async (filter: any) =>
      filter.status.includes('done') ? [] : [snag({ id: 'a', description: 'Filter', repeatDays: 90 })]);
    mock_setSnagStatus.mockResolvedValue(
      snag({ id: 'a', status: 'open', repeatDays: 90, dueAt: new Date(Date.now() + 90 * DAY).toISOString() }));
    const r = render(<SnagListScreen />);
    await settle();

    await TestRenderer.act(async () => { await tick(r, 'Filter')[0].props.onPress(); });
    const [message, action] = mock_showToast.mock.calls.at(-1)!;
    expect(message).toMatch(/back on the list/);
    expect(action).toBeUndefined();
  });

  it('offers no tick on a job that is already done', async () => {
    mock_getSnags.mockImplementation(async (filter: any) =>
      filter.status.includes('done') ? [snag({ id: 'z', description: 'Fence', status: 'done', doneAt: ago(1) })] : []);
    const r = render(<SnagListScreen />);
    await settle();
    expect(tick(r, 'Fence')).toHaveLength(0);
  });
});

describe('folding a room away', () => {
  // The fold is remembered on the device, which means it survives a remount —
  // including the one the *next* test does. Cleared between them so each starts
  // from the open list everybody actually opens the app to.
  beforeEach(async () => { await writeCollapsed([]); });

  const byLabel = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && !!n.props?.onPress
        && n.props?.accessibilityLabel === label,
      { deep: true },
    )[0];

  const press = async (node: any) => {
    await TestRenderer.act(async () => { await node.props.onPress(); });
  };

  async function withRooms() {
    mock_getSnags.mockImplementation((filter: any) => Promise.resolve(
      filter.status?.includes('done') ? [] : [
        snag({ id: 'a', description: 'Rangehood filter', room: 'Kitchen' }),
        snag({ id: 'b', description: 'Shelf brackets', room: 'Garage' }),
      ]
    ));
    const r = render(<SnagListScreen />);
    await settle();
    return r;
  }

  it('opens with everything showing', async () => {
    const r = await withRooms();
    expect(texts(r)).toContain('Rangehood filter');
    expect(texts(r)).toContain('Shelf brackets');
  });

  // A fold that took the heading with it would be a filter rather than a fold:
  // "there are three things in the Garage" is what the grouping exists to say.
  it('keeps the heading and its count when a room is folded', async () => {
    const r = await withRooms();
    await press(byLabel(r, 'Kitchen · 1, hide'));

    expect(texts(r)).toContain('Kitchen · 1');
    expect(texts(r)).not.toContain('Rangehood filter');
    // Only the one that was folded.
    expect(texts(r)).toContain('Shelf brackets');
  });

  it('unfolds on a second press', async () => {
    const r = await withRooms();
    await press(byLabel(r, 'Kitchen · 1, hide'));
    await press(byLabel(r, 'Kitchen · 1, show'));
    expect(texts(r)).toContain('Rangehood filter');
  });

  // It says what pressing it does, and decides that from whether anything is
  // still open — so the press on offer is never a no-op.
  it('offers to collapse everything, then to expand everything', async () => {
    const r = await withRooms();
    expect(byLabel(r, 'Collapse all')).toBeDefined();

    await press(byLabel(r, 'Collapse all'));
    expect(texts(r)).not.toContain('Rangehood filter');
    expect(texts(r)).not.toContain('Shelf brackets');
    expect(texts(r)).toContain('Kitchen · 1');

    expect(byLabel(r, 'Expand all')).toBeDefined();
    await press(byLabel(r, 'Expand all'));
    expect(texts(r)).toContain('Rangehood filter');
  });

  it('remembers the fold for next time, on this device', async () => {
    const r = await withRooms();
    await press(byLabel(r, 'Garage · 1, hide'));

    // Through the helper rather than the storage behind it: which store that
    // is differs between the phone and the browser, and what matters is that
    // the fold comes back.
    const kept = await readCollapsed();
    expect(kept).toContain('room:Garage');
    expect(kept).not.toContain('room:Kitchen');
  });

  it('comes back folded when the screen is opened again', async () => {
    const first = await withRooms();
    await press(byLabel(first, 'Garage · 1, hide'));

    const again = render(<SnagListScreen />);
    await settle();
    expect(texts(again)).toContain('Garage · 1');
    expect(texts(again)).not.toContain('Shelf brackets');
  });
});
