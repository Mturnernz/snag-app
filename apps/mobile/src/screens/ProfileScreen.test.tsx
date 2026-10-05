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
const mock_getMyAccountDeletions = jest.fn().mockResolvedValue([]);
const mock_signOut = jest.fn().mockResolvedValue({ forced: false });
const mock_getAllProjects = jest.fn().mockResolvedValue([]);
const mock_getSnags = jest.fn().mockResolvedValue([]);

const mock_setProjectsEnabled = jest.fn().mockResolvedValue(undefined);
const mock_getMyData = jest.fn();
const mock_saveFile = jest.fn().mockResolvedValue({ path: null });
jest.mock('../lib/download', () => ({ saveFile: (...a: unknown[]) => mock_saveFile(...a) }));
jest.mock('../lib/supabase', () => ({
  getMyData: (...a: unknown[]) => mock_getMyData(...a),
  deleteMyAccount: (...a: unknown[]) => mock_deleteMyAccount(...a),
  getMyOrphanFilePaths: (...a: unknown[]) => mock_getMyOrphanFilePaths(...a),
  deleteStoredFiles: (...a: unknown[]) => mock_deleteStoredFiles(...a),
  getMyAccountDeletions: (...a: unknown[]) => mock_getMyAccountDeletions(...a),
  signOut: (...a: unknown[]) => mock_signOut(...a),
  upsertProfile: jest.fn().mockResolvedValue(undefined),
  setProjectsEnabled: (...a: unknown[]) => mock_setProjectsEnabled(...a),
  getAllProjects: (...a: unknown[]) => mock_getAllProjects(...a),
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
const mock_showAlert = jest.fn();
jest.mock('../lib/alert', () => ({ showAlert: (...a: unknown[]) => mock_showAlert(...a) }));
const mock_openUrl = jest.fn();
jest.mock('../lib/openUrl', () => ({ openUrl: (...a: unknown[]) => mock_openUrl(...a) }));
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
  mock_getMyAccountDeletions.mockResolvedValue([]);
  mock_signOut.mockResolvedValue({ forced: false });
  mock_getAllProjects.mockResolvedValue([]);
  mock_getSnags.mockResolvedValue([]);
  mock_getMyData.mockResolvedValue({ exported_at: '2026-09-28T01:00:00Z', snags: [{ id: 's1' }] });
  mock_saveFile.mockResolvedValue({ path: null });
});

describe('deleting your account', () => {
  // A joiner deleting their account on 4 October 2026 took a household with
  // them. The confirmation now names what would actually go, read from the
  // server, rather than warning in general.
  it('names the household that would actually be deleted', async () => {
    mock_getMyAccountDeletions.mockResolvedValue([
      { householdId: 'h', householdName: '32 Le Roy', propertyNames: ['32 Le Roy', "Martin's Bay"] },
    ]);
    const r = render(<ProfileScreen />);
    await settle();
    await press(pressableAround(r, 'Delete my account'));

    const dialog = r.root.findAll(
      (n: any) => n.props?.confirmText === 'Mike' && typeof n.props?.onConfirm === 'function'
    )[0];
    expect(dialog.props.message).toMatch(/32 Le Roy \(Martin's Bay\)/);
    expect(dialog.props.message).toMatch(/is deleted/);
  });

  it('says nothing is deleted when every household is shared', async () => {
    const r = render(<ProfileScreen />);
    await settle();
    await press(pressableAround(r, 'Delete my account'));

    const dialog = r.root.findAll(
      (n: any) => n.props?.confirmText === 'Mike' && typeof n.props?.onConfirm === 'function'
    )[0];
    expect(dialog.props.message).toMatch(/Nothing is deleted with you/);
  });

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
// Seeing and correcting what is kept is not only for the moment of signing
// up, so the statement Create account links to is reachable from here too.
describe('privacy', () => {
  it('opens the privacy statement', async () => {
    const r = await renderProfile();
    await TestRenderer.act(async () => pressableAround(r, 'Privacy statement').props.onPress());
    expect(mock_openUrl).toHaveBeenCalledWith('https://www.snaghq.co.nz/privacy');
  });

  it('opens the terms beside it', async () => {
    const r = await renderProfile();
    await TestRenderer.act(async () => pressableAround(r, 'Terms').props.onPress());
    expect(mock_openUrl).toHaveBeenCalledWith('https://www.snaghq.co.nz/terms');
  });
});

// A copy of what is kept is the Privacy Act's own ask, so it is one press
// here rather than an email to somebody who runs queries by hand.
describe('downloading your data', () => {
  it('reads it once and hands over one JSON file named for the day', async () => {
    const r = await renderProfile();
    await press(pressableAround(r, 'Download my data'));

    expect(mock_getMyData).toHaveBeenCalledTimes(1);
    expect(mock_saveFile).toHaveBeenCalledTimes(1);
    const [fileName, contents, mime] = mock_saveFile.mock.calls[0];
    expect(fileName).toMatch(/^snag-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe('application/json');
    expect(JSON.parse(contents)).toEqual({ exported_at: '2026-09-28T01:00:00Z', snags: [{ id: 's1' }] });
  });

  it('says why in words when the read is refused, and saves nothing', async () => {
    mock_getMyData.mockRejectedValueOnce(new Error('Sign in to download your data'));
    const r = await renderProfile();
    await press(pressableAround(r, 'Download my data'));

    expect(mock_saveFile).not.toHaveBeenCalled();
    expect(mock_showAlert).toHaveBeenCalledWith("Couldn't gather your data", 'Sign in to download your data');
    // Still on screen, still signing out: a failed copy is not a broken page.
    expect(r.getByText('Sign out')).toBeTruthy();
  });
});

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
// v1 ships without the renovations tab. It is off for everybody but the two
// accounts it was turned on for in SQL, and the You tab offers no way to turn
// it on: a switch here would be offering everybody a tab the launch does not
// include. `profiles.projects_enabled` still decides whether the tab exists.

describe('projects in v1', () => {
  it('offers no switch to show or hide them', async () => {
    const r = await renderProfile();
    const labels = r.root
      .findAll((n: any) => typeof n.props?.accessibilityLabel === 'string', { deep: true })
      .map((n: any) => n.props.accessibilityLabel);
    expect(labels).not.toContain('Show projects');
    expect(labels).not.toContain('Hide projects');
    const said = r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));
    expect(said).not.toContain('Projects');
    expect(mock_setProjectsEnabled).not.toHaveBeenCalled();
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

describe('How Snag works', () => {
  it('opens the tour again, with no Try it', async () => {
    const r = await renderProfile();
    await TestRenderer.act(async () => { pressableAround(r, 'How Snag works').props.onPress(); });
    expect(r.queryByText('Set up your house')).not.toBeNull();
    expect(r.queryByText('Add a room')).toBeNull();
  });
});
