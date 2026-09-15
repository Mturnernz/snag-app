import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import HouseholdScreen from './HouseholdScreen';

// Until 20260914160000 nothing in this app could remove anybody from anything,
// and until 20260915090000 adding somebody required them to have finished
// signing up first. What these pin is the shape of both halves, and the ways
// each could silently go wrong:
//
//   - offering a control that can only ever answer with an error (the last
//     member's Leave, the only place's ×),
//   - deleting a place and leaving its photos in the bucket, which is the
//     orphan the delete RPC hands back the keys for,
//   - going back to choosing somebody's place for them, which is what
//     `properties.slice(0, 1)` did before the chips existed,
//   - and the one the retired product actually shipped: a screen claiming an
//     invitation was sent when nothing sends anything.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

const mock_inviteToHousehold = jest.fn().mockResolvedValue(undefined);
const mock_getHouseholdInvitations = jest.fn().mockResolvedValue([]);
const mock_getMyInvitations = jest.fn().mockResolvedValue([]);
const mock_cancelInvitation = jest.fn().mockResolvedValue(undefined);
const mock_acceptInvitation = jest.fn().mockResolvedValue(undefined);
const mock_declineInvitation = jest.fn().mockResolvedValue(undefined);
const mock_createInviteLink = jest.fn();
const mock_revokeInviteLink = jest.fn().mockResolvedValue(undefined);
const mock_removeMember = jest.fn().mockResolvedValue(undefined);
const mock_deleteProperty = jest.fn().mockResolvedValue([]);
const mock_deleteHousehold = jest.fn().mockResolvedValue(undefined);
const mock_getHouseholdFilePaths = jest.fn().mockResolvedValue([]);
const mock_deleteStoredFiles = jest.fn().mockResolvedValue(undefined);
const mock_getSnags = jest.fn().mockResolvedValue([]);
const mock_getThings = jest.fn().mockResolvedValue([]);

jest.mock('../lib/supabase', () => ({
  inviteToHousehold: (...a: unknown[]) => mock_inviteToHousehold(...a),
  getHouseholdInvitations: (...a: unknown[]) => mock_getHouseholdInvitations(...a),
  getMyInvitations: (...a: unknown[]) => mock_getMyInvitations(...a),
  cancelInvitation: (...a: unknown[]) => mock_cancelInvitation(...a),
  acceptInvitation: (...a: unknown[]) => mock_acceptInvitation(...a),
  declineInvitation: (...a: unknown[]) => mock_declineInvitation(...a),
  createInviteLink: (...a: unknown[]) => mock_createInviteLink(...a),
  revokeInviteLink: (...a: unknown[]) => mock_revokeInviteLink(...a),
  removeMember: (...a: unknown[]) => mock_removeMember(...a),
  deleteProperty: (...a: unknown[]) => mock_deleteProperty(...a),
  deleteHousehold: (...a: unknown[]) => mock_deleteHousehold(...a),
  getHouseholdFilePaths: (...a: unknown[]) => mock_getHouseholdFilePaths(...a),
  deleteStoredFiles: (...a: unknown[]) => mock_deleteStoredFiles(...a),
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
  getThings: (...a: unknown[]) => mock_getThings(...a),
  createProperty: jest.fn().mockResolvedValue(undefined),
  renameProperty: jest.fn().mockResolvedValue(undefined),
  getPropertyMemberIds: jest.fn().mockResolvedValue([]),
  setPropertyMember: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const TOKEN = '8f1d3c2e-0000-4000-8000-000000000000';

/** A live join code: one table with the email invitations, addressed by token. */
const LINK = {
  id: 'link1', householdId: 'h', email: null, token: TOKEN,
  expiresAt: '2026-09-16T00:00:00Z', propertyIds: [], invitedBy: 'me',
  createdAt: '2026-09-15T00:00:00Z',
};

const place = (id: string, name: string) => ({ id, householdId: 'h', name });
const member = (id: string, displayName: string) => ({
  householdId: 'h', profileId: id, displayName, role: 'owner' as const,
});

function arrange({
  members = [member('me', 'Me')],
  properties = [place('p1', 'Home')],
} = {}) {
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: '2026-01-01T00:00:00Z' },
    profile: { id: 'me', displayName: 'Me' },
    members,
    properties,
    activeProperty: properties[0] ?? null,
    setActiveProperty: jest.fn(),
    locations: [],
    reloadLocations: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    reloadAccount: jest.fn().mockResolvedValue(undefined),
  };
}

const settle = () => TestRenderer.act(async () => {});

/** The pressable an accessibility label is on. Undefined when nothing is offered. */
const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label && !!n.props?.onPress,
    { deep: true }
  )[0];

/** The nearest ancestor of a label that actually handles a press. */
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

/** The one host TextInput matching a predicate. */
const input = (r: ReturnType<typeof render>, match: (props: any) => boolean) =>
  r.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'TextInput' && match(n.props))[0];

beforeEach(() => {
  jest.clearAllMocks();
  mock_deleteProperty.mockResolvedValue([]);
  mock_deleteHousehold.mockResolvedValue(undefined);
  mock_getHouseholdFilePaths.mockResolvedValue([]);
  mock_deleteStoredFiles.mockResolvedValue(undefined);
  mock_getHouseholdInvitations.mockResolvedValue([]);
  mock_getMyInvitations.mockResolvedValue([]);
  mock_createInviteLink.mockResolvedValue(LINK);
});

describe('who can be taken out', () => {
  it('offers no way to remove the only person here', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();

    expect(byLabel(r, 'Remove Me')).toBeUndefined();
  });

  // remove_member refuses the last member and delete_household refuses a
  // household that still has somebody in it, so exactly one of these can ever
  // succeed. Showing both would put a button on screen that only errors.
  it('offers Delete when you are alone and Leave when you are not', async () => {
    arrange();
    const alone = render(<HouseholdScreen />);
    await settle();
    expect(alone.queryByText('Delete this household')).not.toBeNull();
    expect(alone.queryByText('Leave this household')).toBeNull();

    arrange({ members: [member('me', 'Me'), member('al', 'Alyssa')] });
    const together = render(<HouseholdScreen />);
    await settle();
    expect(together.queryByText('Leave this household')).not.toBeNull();
    expect(together.queryByText('Delete this household')).toBeNull();
    expect(byLabel(together, 'Remove Alyssa')).toBeDefined();
  });
});

describe('deleting a place', () => {
  it('is not offered for the only place there is', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();

    expect(byLabel(r, 'Delete Home')).toBeUndefined();
  });

  it('names what goes with it and will not delete until the name is typed', async () => {
    arrange({ properties: [place('p1', 'Home'), place('p2', 'The bach')] });
    mock_getSnags.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    mock_getThings.mockResolvedValue([{ id: 't1' }]);

    const r = render(<HouseholdScreen />);
    await settle();
    await press(byLabel(r, 'Delete The bach'));
    await settle();

    expect(mock_getSnags).toHaveBeenCalledWith({ propertyId: 'p2' });
    // Singular and plural both, because "1 snags" is the kind of thing nobody
    // notices until it is in front of somebody about to delete their house.
    expect(r.queryByText(
      '2 snags and 1 thing go with it, along with its rooms and every photo. It cannot be undone.'
    )).not.toBeNull();

    expect(input(r, (props) => props.accessibilityLabel === 'Type The bach to confirm')).toBeDefined();
  });

  // The RPC answers with every storage key its cascade orphaned, because SQL
  // cannot clear them itself. Dropping that answer on the floor is the whole
  // bug this exists to catch.
  it('takes the files the cascade orphaned out of the bucket', async () => {
    arrange({ properties: [place('p1', 'Home'), place('p2', 'The bach')] });
    mock_deleteProperty.mockResolvedValue(['h/one.jpg', 'h/docs/manual.pdf']);

    const r = render(<HouseholdScreen />);
    await settle();
    await press(byLabel(r, 'Delete The bach'));
    await settle();

    const dialog = r.root.findAll(
      (n: any) => n.props?.confirmText === 'The bach' && typeof n.props?.onConfirm === 'function'
    )[0];
    await TestRenderer.act(async () => dialog.props.onConfirm());

    expect(mock_deleteProperty).toHaveBeenCalledWith('p2');
    expect(mock_deleteStoredFiles).toHaveBeenCalledWith(['h/one.jpg', 'h/docs/manual.pdf']);
  });
});

describe('deleting the household', () => {
  // The storage delete policy asks home.is_member(<household id>), so deleting
  // the household takes away the permission to clean up after it. Files first
  // is the whole point, and deleteStoredFiles never throws — so getting this
  // backwards orphans every file in the bucket in total silence.
  it('clears the files before the membership that authorises clearing them', async () => {
    arrange();
    mock_getHouseholdFilePaths.mockResolvedValue(['h/one.jpg', 'h/docs/manual.pdf']);
    const order: string[] = [];
    mock_deleteStoredFiles.mockImplementation(async () => { order.push('files'); });
    mock_deleteHousehold.mockImplementation(async () => { order.push('household'); });

    const r = render(<HouseholdScreen />);
    await settle();
    await press(pressableAround(r, 'Delete this household'));
    await settle();

    const dialog = r.root.findAll(
      (n: any) => n.props?.confirmText === 'Home' && typeof n.props?.onConfirm === 'function'
    )[0];
    await TestRenderer.act(async () => dialog.props.onConfirm());

    expect(mock_deleteStoredFiles).toHaveBeenCalledWith(['h/one.jpg', 'h/docs/manual.pdf']);
    expect(order).toEqual(['files', 'household']);
  });
});

describe('adding someone', () => {
  it('asks nothing about places when there is only one', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('Where do they start?')).toBeNull();
  });

  // It used to send them to properties.slice(0, 1) — whichever place happened
  // to be first in the adder's own list — and the hint underneath asserted it
  // as though somebody had chosen.
  it('sends them to the places that were actually picked', async () => {
    arrange({ properties: [place('p1', 'Home'), place('p2', 'The bach')] });
    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('Where do they start?')).not.toBeNull();

    const email = input(r, (props) => props.inputMode === 'email');
    await TestRenderer.act(async () => email.props.onChangeText('alyssa@example.com'));

    // Home is pre-selected as the place being looked at; add the bach as well.
    await press(byLabel(r, 'Start on The bach'));
    await press(pressableAround(r, 'Invite them'));
    await settle();

    expect(mock_inviteToHousehold).toHaveBeenCalledWith(
      'h', 'alyssa@example.com', expect.arrayContaining(['p1', 'p2'])
    );
  });
});

describe('inviting somebody who has not signed up', () => {
  // The bug this replaces: add_member_by_email refused any address without a
  // finished account, so the person doing the adding was told "That account has
  // not finished signing up yet" — an order nothing had published, blamed on
  // the one person who could not act on it.
  it('sends the address straight through, account or not', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();

    const email = input(r, (props) => props.inputMode === 'email');
    await TestRenderer.act(async () => email.props.onChangeText('alyssa@example.com'));
    await press(pressableAround(r, 'Invite them'));
    await settle();

    // undefined, not a list: one place means everybody is on it.
    expect(mock_inviteToHousehold).toHaveBeenCalledWith('h', 'alyssa@example.com', undefined);
  });

  // The retired product's whole failure was the claim, not the row: it said
  // "Invite sent" and nothing was ever sent, for the life of the feature.
  it('never claims anything was sent', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();

    const said = r.root
      .findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
      .map((n: any) => JSON.stringify(n.children))
      .join(' ');
    expect(said).not.toMatch(/\bsent\b/i);
    expect(said).toMatch(/doesn't email them, so tell them yourself/i);
  });

  it('shows who is waiting, without their reading as somebody who is here', async () => {
    arrange();
    mock_getHouseholdInvitations.mockResolvedValue([
      { id: 'i1', householdId: 'h', email: 'alyssa@example.com', propertyIds: [], invitedBy: 'me',
        createdAt: '2026-09-15T00:00:00Z' },
    ]);

    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('alyssa@example.com')).not.toBeNull();
    expect(r.queryByText('Waiting — they need to sign up with this address')).not.toBeNull();

    await press(byLabel(r, 'Cancel the invitation to alyssa@example.com'));
    expect(mock_cancelInvitation).toHaveBeenCalledWith('i1');
  });

  // An invitation to somebody who already has a household has nowhere else to
  // appear: they never see the Setup screen, and there is no household switcher.
  it('lets you answer an invitation addressed to you', async () => {
    arrange();
    mock_getMyInvitations.mockResolvedValue([
      { id: 'i9', householdId: 'other', householdName: '32 Le Roy', invitedByName: 'Alyssa',
        createdAt: '2026-09-15T00:00:00Z' },
    ]);

    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('32 Le Roy wants to add you')).not.toBeNull();

    await press(pressableAround(r, 'No thanks'));
    expect(mock_declineInvitation).toHaveBeenCalledWith('i9');
    expect(mock_acceptInvitation).not.toHaveBeenCalled();

    await press(pressableAround(r, 'Join'));
    expect(mock_acceptInvitation).toHaveBeenCalledWith('i9');
  });
});

describe('a code you can hold up', () => {
  it('offers one, and shows the link once there is one', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('Show a QR code')).not.toBeNull();
    await press(pressableAround(r, 'Show a QR code'));
    await settle();

    // One place, so no property list is passed — everybody is on it.
    expect(mock_createInviteLink).toHaveBeenCalledWith('h', undefined);
    expect(r.queryByText(`https://app.snaghq.co.nz/join/${TOKEN}`)).not.toBeNull();
    expect(r.queryByText('Show a QR code')).toBeNull();
  });

  // One table, two ways of being addressed — so the one thing the partition can
  // get wrong is showing the code as a person who is waiting to arrive.
  it('never reads as somebody waiting under Who is here', async () => {
    arrange();
    mock_getHouseholdInvitations.mockResolvedValue([LINK]);

    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('Waiting — they need to sign up with this address')).toBeNull();
    expect(r.queryByText(`https://app.snaghq.co.nz/join/${TOKEN}`)).not.toBeNull();
  });

  it('can be stopped, which is the whole of its security model', async () => {
    arrange();
    mock_getHouseholdInvitations.mockResolvedValue([LINK]);

    const r = render(<HouseholdScreen />);
    await settle();
    await press(pressableAround(r, 'Stop sharing'));
    await settle();

    expect(mock_revokeInviteLink).toHaveBeenCalledWith('h');
    expect(r.queryByText('Show a QR code')).not.toBeNull();
  });

  // A code minted while a bach is on screen must land people on the places that
  // were picked, exactly as an emailed invitation does — one mechanism.
  it('carries the chosen places, same as an invitation by address', async () => {
    arrange({ properties: [place('p1', 'Home'), place('p2', 'The bach')] });
    const r = render(<HouseholdScreen />);
    await settle();
    await press(byLabel(r, 'Start on The bach'));
    await press(pressableAround(r, 'Show a QR code'));
    await settle();

    expect(mock_createInviteLink).toHaveBeenCalledWith('h', expect.arrayContaining(['p1', 'p2']));
  });
});
