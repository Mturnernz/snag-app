import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ProfileScreen from './ProfileScreen';

// Deleting an account is the one action here that can take a whole household
// with it, and it has the same two failure modes as deleting a place:
//
//   - doing it on a mis-tap, which is why it asks for the name to be typed,
//   - and clearing the files after the membership that authorises clearing
//     them, which orphans every byte in silence because deleteStoredFiles
//     deliberately never throws. Same rule as deleting a household.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));

const mock_deleteMyAccount = jest.fn().mockResolvedValue(undefined);
const mock_getMyOrphanFilePaths = jest.fn().mockResolvedValue([]);
const mock_deleteStoredFiles = jest.fn().mockResolvedValue(undefined);
const mock_signOut = jest.fn().mockResolvedValue({ forced: false });
const mock_getAllProjects = jest.fn().mockResolvedValue([]);
const mock_getSnags = jest.fn().mockResolvedValue([]);

const mock_setProjectsEnabled = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/supabase', () => ({
  deleteMyAccount: (...a: unknown[]) => mock_deleteMyAccount(...a),
  getMyOrphanFilePaths: (...a: unknown[]) => mock_getMyOrphanFilePaths(...a),
  deleteStoredFiles: (...a: unknown[]) => mock_deleteStoredFiles(...a),
  signOut: (...a: unknown[]) => mock_signOut(...a),
  upsertProfile: jest.fn().mockResolvedValue(undefined),
  setProjectsEnabled: (...a: unknown[]) => mock_setProjectsEnabled(...a),
  getAllProjects: (...a: unknown[]) => mock_getAllProjects(...a),
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

function arrange() {
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: '2026-01-01T00:00:00Z' },
    profile: { id: 'me', displayName: 'Mike', createdAt: '2026-01-01T00:00:00Z', projectsEnabled: true },
    members: [{ householdId: 'h', profileId: 'me', displayName: 'Mike', role: 'owner' }],
    properties: [],
    activeProperty: null,
    setActiveProperty: jest.fn(),
    locations: [],
    reloadLocations: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    reloadAccount: jest.fn().mockResolvedValue(undefined),
  };
}

const settle = () => TestRenderer.act(async () => {});

/** Render and let the loose-ends reads land before anything is asserted. */
async function renderProfile() {
  const r = render(<ProfileScreen />);
  await settle();
  return r;
}

const pressableAround = (r: ReturnType<typeof render>, text: string) => {
  let node: any = r.getByText(text);
  while (node) {
    if (typeof node.props?.onPress === 'function') return node;
    node = node.parent;
  }
  throw new Error(`Nothing pressable around "${text}"`);
};

const press = async (node: any) => {
  await TestRenderer.act(async () => {
    await node.props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  arrange();
  mock_getMyOrphanFilePaths.mockResolvedValue([]);
  mock_deleteStoredFiles.mockResolvedValue(undefined);
  mock_deleteMyAccount.mockResolvedValue(undefined);
  mock_signOut.mockResolvedValue({ forced: false });
  mock_getAllProjects.mockResolvedValue([]);
  mock_getSnags.mockResolvedValue([]);
});

describe('deleting your account', () => {
  it('will not go through until the name is typed', async () => {
    const r = render(<ProfileScreen />);
    await settle();
    await press(pressableAround(r, 'Delete my account'));

    const dialog = r.root.findAll(
      (n: any) => n.props?.confirmText === 'Mike' && typeof n.props?.onConfirm === 'function'
    )[0];
    expect(dialog).toBeDefined();
    expect(mock_deleteMyAccount).not.toHaveBeenCalled();
  });

  it('clears the files before the account that authorises clearing them', async () => {
    mock_getMyOrphanFilePaths.mockResolvedValue(['h/one.jpg', 'h/docs/manual.pdf']);
    const order: string[] = [];
    mock_deleteStoredFiles.mockImplementation(async () => { order.push('files'); });
    mock_deleteMyAccount.mockImplementation(async () => { order.push('account'); });
    mock_signOut.mockImplementation(async () => { order.push('signout'); return { forced: false }; });

    const r = render(<ProfileScreen />);
    await settle();
    await press(pressableAround(r, 'Delete my account'));

    const dialog = r.root.findAll(
      (n: any) => n.props?.confirmText === 'Mike' && typeof n.props?.onConfirm === 'function'
    )[0];
    await TestRenderer.act(async () => dialog.props.onConfirm());

    expect(mock_deleteStoredFiles).toHaveBeenCalledWith(['h/one.jpg', 'h/docs/manual.pdf']);
    expect(order).toEqual(['files', 'account', 'signout']);
  });

  // The session now belongs to an account that doesn't exist, so staying signed
  // in renders a navigator over data every read will refuse.
  it('signs out afterwards', async () => {
    const r = render(<ProfileScreen />);
    await settle();
    await press(pressableAround(r, 'Delete my account'));

    const dialog = r.root.findAll(
      (n: any) => n.props?.confirmText === 'Mike' && typeof n.props?.onConfirm === 'function'
    )[0];
    await TestRenderer.act(async () => dialog.props.onConfirm());

    expect(mock_signOut).toHaveBeenCalled();
  });

  // Signing out is the everyday door; this is the other one. Both being equally
  // loud is how somebody ends their account meaning to close the tab.
  it('sits quieter than signing out', async () => {
    const r = render(<ProfileScreen />);
    await settle();

    // The Button component itself, not the Pressable it renders through: the
    // variant is the thing being asserted and it only exists up there.
    const button = (label: string) =>
      r.root.findAll(
        (n: any) => typeof n.type !== 'string' && n.props?.label === label
      )[0];

    expect(button('Sign out').props.variant).toBe('outline');
    expect(button('Delete my account').props.variant).toBe('ghost');
  });
});

/**
 * The quiet list, and the rule it exists under.
 *
 * *A global completeness meter is the shaming number that gets an app closed
 * and not reopened.* These pin the four ways this section would become one.
 */
describe('worth finishing', () => {
  const project = (over: Record<string, unknown> = {}) => ({
    id: 'p1', householdId: 'h', propertyId: 'prop', name: 'Downstairs laundry',
    summary: null, status: 'underway',
    startedOn: null, targetOn: null, finishedOn: null,
    budget: null, budgetInclGst: true, photoPaths: [], documentPaths: [],
    createdBy: 'me', createdAt: '', updatedAt: '',
    propertyName: 'Home', createdByName: 'Kate',
    elementCount: 1, shownElementCount: 0, fileCount: 0,
    snagCount: 0, openSnagCount: 0, thingCount: 0, installedCount: 0,
    itemCount: 0, pricedCount: 0, quotedCount: 0,
    chosenTotal: null, rangeLow: null, rangeHigh: null, spentTotal: null,
    ...over,
  });

  const open = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
        && !!n.props?.onPress,
      { deep: true }
    )[0];

  it('draws nothing at all when there is nothing outstanding', async () => {
    mock_getAllProjects.mockResolvedValue([]);
    mock_getSnags.mockResolvedValue([]);
    const r = await renderProfile();
    // A control at zero is a control dressed as a choice — the same rule as the
    // shopping pill and *Fit* in the photo viewer.
    expect(r.queryByText('1 thing worth finishing')).toBeNull();
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    expect(text).not.toContain('worth finishing');
  });

  it('is one muted line, collapsed, until it is asked to open', async () => {
    mock_getAllProjects.mockResolvedValue([project({ installedCount: 2, thingCount: 0 })]);
    mock_getSnags.mockResolvedValue([]);
    const r = await renderProfile();
    r.getByText('1 thing worth finishing');
    // The detail is behind the line: somebody opening the You tab came to
    // change their name or sign out.
    expect(r.queryByText('Recording one puts its model number where you’ll look for it in a shop.'))
      .toBeNull();
  });

  it('names the outstanding work and its payoff once opened', async () => {
    mock_getAllProjects.mockResolvedValue([project({ installedCount: 2, thingCount: 0 })]);
    mock_getSnags.mockResolvedValue([]);
    const r = await renderProfile();
    await TestRenderer.act(async () => open(r, '1 thing worth finishing').props.onPress());
    r.getByText('2 things put in by Downstairs laundry aren’t in the house record');
    r.getByText('Recording one puts its model number where you’ll look for it in a shop.');
  });

  it('shows no percentage, meter or total of everything', async () => {
    mock_getAllProjects.mockResolvedValue([
      project({ installedCount: 2, thingCount: 0, itemCount: 40, pricedCount: 3 }),
    ]);
    mock_getSnags.mockResolvedValue([]);
    const r = await renderProfile();
    await TestRenderer.act(async () => open(r, '1 thing worth finishing').props.onPress());
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    expect(text).not.toContain('%');
    expect(text).not.toMatch(/\b\d+\s+of\s+\d+\b/);
    expect(text.toLowerCase()).not.toContain('complete');
  });

  it('never stops somebody signing out when the reads fail', async () => {
    // This screen is also the escape hatch from a broken session. A list of
    // optional tidying must not be what takes it down.
    mock_getAllProjects.mockRejectedValue(new Error('offline'));
    mock_getSnags.mockRejectedValue(new Error('offline'));
    const r = await renderProfile();
    expect(r.getByText('Sign out')).toBeTruthy();
  });
});

// ---------------------------------------------------------------- projects off
//
// The one setting in this app that belongs to a person rather than to the
// house. Everything else the schema remembers is per household or per property,
// because there is one house and two people disagreeing about whether it has a
// dryer is not a state worth modelling. A renovation is not that: not every
// household has one, and a tab that answers nothing is a fifth of the only
// navigation this app has.

describe('putting projects away', () => {
  const byLabel = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
        && !!n.props?.onPress,
      { deep: true }
    )[0];

  it('offers two named halves, with the one already true lit', async () => {
    const r = await renderProfile();
    expect(byLabel(r, 'Show projects').props.accessibilityState.selected).toBe(true);
    expect(byLabel(r, 'Hide projects').props.accessibilityState.selected).toBe(false);
  });

  it('writes nothing when the answer already on screen is pressed again', async () => {
    mock_setProjectsEnabled.mockClear();
    const r = await renderProfile();
    await TestRenderer.act(async () => { await byLabel(r, 'Show projects').props.onPress(); });
    expect(mock_setProjectsEnabled).not.toHaveBeenCalled();
  });

  it('turns them off, and re-reads the account so the tab can go', async () => {
    mock_setProjectsEnabled.mockClear();
    const r = await renderProfile();
    await TestRenderer.act(async () => { await byLabel(r, 'Hide projects').props.onPress(); });

    expect(mock_setProjectsEnabled).toHaveBeenCalledWith(false);
    // The navigator reads the answer off the profile in context, so the one
    // that came back from the write has to be the one everything reads.
    expect((global as any).__household.reloadAccount).toHaveBeenCalled();
  });

  it('says the jobs go too, because that is the surprising half', async () => {
    const r = await renderProfile();
    const said = r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));
    expect(said.some((t: string) => t.includes('jobs filed against a renovation'))).toBe(true);
    expect(said.some((t: string) => t.includes('Nothing is deleted'))).toBe(true);
  });

  it('asks for neither the renovations nor their jobs once they are off', async () => {
    mock_getAllProjects.mockClear();
    mock_getSnags.mockClear();
    (global as any).__household.profile.projectsEnabled = false;
    await renderProfile();

    expect(mock_getAllProjects).not.toHaveBeenCalled();
    expect(mock_getSnags).toHaveBeenCalledWith({ excludeProjectSnags: true });
  });
});
