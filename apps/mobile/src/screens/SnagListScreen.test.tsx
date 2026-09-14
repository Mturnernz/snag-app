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

const mock_getSnags = jest.fn();
const mock_markListSeen = jest.fn();
jest.mock('../lib/supabase', () => ({
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
  markListSeen: () => mock_markListSeen(),
  getSnagPhotoUrls: jest.fn().mockResolvedValue({}),
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
