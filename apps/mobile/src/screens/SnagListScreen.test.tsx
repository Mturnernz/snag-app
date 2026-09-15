import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SnagListScreen from './SnagListScreen';

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
}));

const mock_getSnags = jest.fn();
const mock_markListSeen = jest.fn();
jest.mock('../lib/supabase', () => ({
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
  markListSeen: () => mock_markListSeen(),
  getFileUrls: jest.fn().mockResolvedValue({}),
  createSnag: jest.fn(),
  updateSnag: jest.fn(),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const ME = 'me';
const THEM = 'sam';
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const snag = (over: Partial<any>): any => ({
  id: 'x', reference: 'S-1', householdId: 'h', propertyId: 'p',
  room: null, photoPaths: [], description: 'A thing', priority: null,
  status: 'open', parts: [], needsParts: false, dueAt: null, repeatDays: null,
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
