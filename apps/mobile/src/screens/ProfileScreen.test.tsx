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
}));

const mock_deleteMyAccount = jest.fn().mockResolvedValue(undefined);
const mock_getMyOrphanFilePaths = jest.fn().mockResolvedValue([]);
const mock_deleteStoredFiles = jest.fn().mockResolvedValue(undefined);
const mock_signOut = jest.fn().mockResolvedValue({ forced: false });

jest.mock('../lib/supabase', () => ({
  deleteMyAccount: (...a: unknown[]) => mock_deleteMyAccount(...a),
  getMyOrphanFilePaths: (...a: unknown[]) => mock_getMyOrphanFilePaths(...a),
  deleteStoredFiles: (...a: unknown[]) => mock_deleteStoredFiles(...a),
  signOut: (...a: unknown[]) => mock_signOut(...a),
  upsertProfile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

function arrange() {
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: '2026-01-01T00:00:00Z' },
    profile: { id: 'me', displayName: 'Mike', createdAt: '2026-01-01T00:00:00Z' },
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
