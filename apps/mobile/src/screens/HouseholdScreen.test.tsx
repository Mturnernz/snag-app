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
//
// Since 20261004100000 it is grouped by place with an owner on each. On
// 4 October 2026 a joiner removed the two people who built a household and then
// deleted it; so the ×, *Make owner* and sharing are the place owner's alone,
// and *Leave* is everybody's.

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
const mock_getPlaceMembers = jest.fn();
const mock_transferPropertyOwnership = jest.fn().mockResolvedValue(undefined);
const mock_setPropertyMember = jest.fn().mockResolvedValue(undefined);
const mock_removeMember = jest.fn().mockResolvedValue(undefined);
const mock_deleteProperty = jest.fn().mockResolvedValue([]);
const mock_deleteHousehold = jest.fn().mockResolvedValue(undefined);
const mock_getHouseholdFilePaths = jest.fn().mockResolvedValue([]);
const mock_deleteStoredFiles = jest.fn().mockResolvedValue(undefined);
const mock_getSnags = jest.fn().mockResolvedValue([]);
const mock_getThings = jest.fn().mockResolvedValue([]);
const mock_createHousehold = jest.fn();
const mock_rememberHousehold = jest.fn().mockResolvedValue(undefined);

jest.mock('../lib/supabase', () => ({
  inviteToHousehold: (...a: unknown[]) => mock_inviteToHousehold(...a),
  getHouseholdInvitations: (...a: unknown[]) => mock_getHouseholdInvitations(...a),
  getMyInvitations: (...a: unknown[]) => mock_getMyInvitations(...a),
  cancelInvitation: (...a: unknown[]) => mock_cancelInvitation(...a),
  acceptInvitation: (...a: unknown[]) => mock_acceptInvitation(...a),
  declineInvitation: (...a: unknown[]) => mock_declineInvitation(...a),
  createInviteLink: (...a: unknown[]) => mock_createInviteLink(...a),
  getPlaceMembers: (...a: unknown[]) => mock_getPlaceMembers(...a),
  transferPropertyOwnership: (...a: unknown[]) => mock_transferPropertyOwnership(...a),
  removeMember: (...a: unknown[]) => mock_removeMember(...a),
  deleteProperty: (...a: unknown[]) => mock_deleteProperty(...a),
  deleteHousehold: (...a: unknown[]) => mock_deleteHousehold(...a),
  getHouseholdFilePaths: (...a: unknown[]) => mock_getHouseholdFilePaths(...a),
  deleteStoredFiles: (...a: unknown[]) => mock_deleteStoredFiles(...a),
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
  getThings: (...a: unknown[]) => mock_getThings(...a),
  createHousehold: (...a: unknown[]) => mock_createHousehold(...a),
  renameProperty: jest.fn().mockResolvedValue(undefined),
  setPropertyMember: (...a: unknown[]) => mock_setPropertyMember(...a),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
const mock_shareLink = jest.fn();
jest.mock('../lib/share', () => ({ shareLink: (...a: unknown[]) => mock_shareLink(...a) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../lib/currentHome', () => ({
  rememberHousehold: (...a: unknown[]) => mock_rememberHousehold(...a),
}));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const TOKEN = '8f1d3c2e-0000-4000-8000-000000000000';

/** A live join code: one table with the email invitations, addressed by token. */
const LINK = {
  id: 'link1', householdId: 'h', email: null, token: TOKEN,
  expiresAt: '2026-09-16T00:00:00Z', propertyIds: ['p1'], invitedBy: 'me',
  createdAt: '2026-09-15T00:00:00Z',
};

const place = (id: string, name: string) => ({ id, householdId: 'h', name });
const member = (id: string, displayName: string, role: 'owner' | 'member' = 'owner') => ({
  householdId: 'h', profileId: id, displayName, role,
});
const onPlace = (propertyId: string, id: string, displayName: string, role: 'owner' | 'member') => ({
  propertyId, profileId: id, displayName, role,
});

function arrange({
  members = [member('me', 'Me')],
  properties = [place('p1', 'Home')],
  people,
}: {
  members?: ReturnType<typeof member>[];
  properties?: ReturnType<typeof place>[];
  people?: ReturnType<typeof onPlace>[];
} = {}) {
  // By default I own every place, and everybody else in the household is on
  // each of them as a member.
  mock_getPlaceMembers.mockResolvedValue(people ?? properties.flatMap((p) => members.map((m) =>
    onPlace(p.id, m.profileId, m.displayName, m.profileId === 'me' ? 'owner' : 'member'))));
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
    expect(byLabel(r, 'Leave Home')).toBeUndefined();
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

    arrange({ members: [member('me', 'Me'), member('al', 'Alyssa', 'member')] });
    const together = render(<HouseholdScreen />);
    await settle();
    expect(together.queryByText('Leave this household')).not.toBeNull();
    expect(together.queryByText('Delete this household')).toBeNull();
    expect(byLabel(together, 'Remove Alyssa')).toBeDefined();
  });

  it('labels the owner of each place', async () => {
    arrange({ members: [member('me', 'Me'), member('al', 'Alyssa', 'member')] });
    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.getAllByText('Owner')).toHaveLength(1);
  });

  // 4 October 2026, from the joiner's side: a member sees the people on their
  // place, and nothing that takes anybody off it.
  it('gives a member no ×, no Make owner and no sharing — only Leave', async () => {
    arrange({
      members: [member('mike', 'Mike'), member('me', 'Me', 'member')],
      properties: [place('p2', "Martin's Bay")],
      people: [
        onPlace('p2', 'mike', 'Mike', 'owner'),
        onPlace('p2', 'me', 'Me', 'member'),
      ],
    });
    const r = render(<HouseholdScreen />);
    await settle();

    expect(byLabel(r, 'Remove Mike')).toBeUndefined();
    expect(byLabel(r, "Make Mike an owner of Martin's Bay")).toBeUndefined();
    expect(r.queryByText('Share an invite link')).toBeNull();
    expect(byLabel(r, "Delete Martin's Bay")).toBeUndefined();
    expect(r.queryByText("The owner of Martin's Bay decides who is on it.")).not.toBeNull();
    expect(byLabel(r, "Leave Martin's Bay")).toBeDefined();
  });

  it('leaves a place through the place, and re-reads the account', async () => {
    arrange({
      members: [member('mike', 'Mike'), member('me', 'Me', 'member')],
      properties: [place('p2', "Martin's Bay")],
      people: [onPlace('p2', 'mike', 'Mike', 'owner'), onPlace('p2', 'me', 'Me', 'member')],
    });
    const r = render(<HouseholdScreen />);
    await settle();
    await press(byLabel(r, "Leave Martin's Bay"));

    const dialog = r.root.findAll(
      (n: any) => n.props?.title === "Leave Martin's Bay?" && typeof n.props?.onConfirm === 'function'
    )[0];
    await TestRenderer.act(async () => dialog.props.onConfirm());

    expect(mock_setPropertyMember).toHaveBeenCalledWith('p2', 'me', false);
    expect((global as any).__household.reloadAccount).toHaveBeenCalled();
  });

  it('lets the owner take a member off their place', async () => {
    arrange({ members: [member('me', 'Me'), member('al', 'Alyssa', 'member')] });
    const r = render(<HouseholdScreen />);
    await settle();
    await press(byLabel(r, 'Remove Alyssa'));

    const dialog = r.root.findAll(
      (n: any) => n.props?.title === 'Remove Alyssa from Home?' && typeof n.props?.onConfirm === 'function'
    )[0];
    await TestRenderer.act(async () => dialog.props.onConfirm());

    expect(mock_setPropertyMember).toHaveBeenCalledWith('p1', 'al', false);
    expect(mock_removeMember).not.toHaveBeenCalled();
  });

  it('lets the owner make somebody an owner, after saying what that gives them', async () => {
    arrange({ members: [member('me', 'Me'), member('al', 'Alyssa', 'member')] });
    const r = render(<HouseholdScreen />);
    await settle();
    await press(byLabel(r, 'Make Alyssa an owner of Home'));

    const dialog = r.root.findAll(
      (n: any) => n.props?.title === 'Make Alyssa an owner of Home?' && typeof n.props?.onConfirm === 'function'
    )[0];
    expect(dialog.props.message).toMatch(/you included/);
    await TestRenderer.act(async () => dialog.props.onConfirm());

    expect(mock_transferPropertyOwnership).toHaveBeenCalledWith('p1', 'al');
  });

  it('offers to put somebody from the household on a place they are not on', async () => {
    arrange({
      members: [member('me', 'Me'), member('al', 'Alyssa', 'member')],
      properties: [place('p1', 'Home'), place('p2', 'The bach')],
      people: [
        onPlace('p1', 'me', 'Me', 'owner'), onPlace('p1', 'al', 'Alyssa', 'member'),
        onPlace('p2', 'me', 'Me', 'owner'),
      ],
    });
    const r = render(<HouseholdScreen />);
    await settle();
    await press(byLabel(r, 'Add Alyssa to The bach'));

    expect(mock_setPropertyMember).toHaveBeenCalledWith('p2', 'al', true);
  });

  it('offers no Delete this household to somebody alone who does not own it', async () => {
    arrange({ members: [member('me', 'Me', 'member')] });
    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('Delete this household')).toBeNull();
  });
});

describe('deleting a place', () => {
  it('is not offered for the only place there is', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();

    expect(byLabel(r, 'Delete Home')).toBeUndefined();
  });

  it('is offered only to its owner', async () => {
    arrange({
      properties: [place('p1', 'Home'), place('p2', 'The bach')],
      people: [onPlace('p1', 'me', 'Me', 'owner'), onPlace('p2', 'me', 'Me', 'member')],
    });
    const r = render(<HouseholdScreen />);
    await settle();

    expect(byLabel(r, 'Delete Home')).toBeDefined();
    expect(byLabel(r, 'Delete The bach')).toBeUndefined();
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
      '2 jobs and 1 item go with it, along with its rooms and every photo. It cannot be undone.'
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

describe('sharing a place', () => {
  // A link is to a place, never to the household: the bach's link must not
  // let anybody into the house.
  it('shares each place by its own link, through the phone\'s own sheet', async () => {
    arrange({ properties: [place('p1', 'Home'), place('p2', 'The bach')] });
    mock_shareLink.mockResolvedValue('shared');
    mock_createInviteLink.mockResolvedValue({ ...LINK, propertyIds: ['p2'] });
    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('Share The bach')).not.toBeNull();
    const shares = r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.label === 'Share an invite link' && !!n.props?.onPress
    );
    await press(shares[1]);
    expect(mock_createInviteLink).toHaveBeenCalledWith('h', ['p2']);
    expect(mock_shareLink).toHaveBeenCalledWith(
      expect.stringContaining(`/join/${LINK.token}`), expect.stringContaining('The bach'));
  });

  // Minting a code kills the old one, so a second share must not break the
  // link the first person has not opened yet.
  it('shares the live link again rather than minting a new one', async () => {
    arrange();
    mock_shareLink.mockResolvedValue('shared');
    const r = render(<HouseholdScreen />);
    await settle();

    await press(pressableAround(r, 'Share an invite link'));
    await press(pressableAround(r, 'Share an invite link'));
    expect(mock_createInviteLink).toHaveBeenCalledTimes(1);
    expect(mock_shareLink).toHaveBeenCalledTimes(2);
  });

  it('keeps the email address second, behind the link', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();

    expect(input(r, (props) => props.inputMode === 'email')).toBeUndefined();
    await press(byLabel(r, 'Invite an email address to Home'));

    const email = input(r, (props) => props.inputMode === 'email');
    await TestRenderer.act(async () => email.props.onChangeText('alyssa@example.com'));
    await press(pressableAround(r, 'Invite them'));
    await settle();

    expect(mock_inviteToHousehold).toHaveBeenCalledWith('h', 'alyssa@example.com', ['p1']);
  });

  // The retired product's whole failure was the claim, not the row: it said
  // "Invite sent" and nothing was ever sent, for the life of the feature.
  it('never claims anything was sent', async () => {
    arrange();
    const r = render(<HouseholdScreen />);
    await settle();
    await press(byLabel(r, 'Invite an email address to Home'));

    const said = r.root
      .findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
      .map((n: any) => JSON.stringify(n.children))
      .join(' ');
    expect(said).not.toMatch(/\bsent\b/i);
    expect(said).toMatch(/doesn't email them/i);
    expect(said).toMatch(/tell them yourself/i);
  });

  it('shows who is waiting on a place, without their reading as somebody who is here', async () => {
    arrange();
    mock_getHouseholdInvitations.mockResolvedValue([
      { id: 'i1', householdId: 'h', email: 'alyssa@example.com', propertyIds: ['p1'], invitedBy: 'me',
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
  // appear: they never see the Setup screen again.
  it('lets you answer an invitation addressed to you, by the place it names', async () => {
    arrange();
    mock_getMyInvitations.mockResolvedValue([
      { id: 'i9', householdId: 'other', householdName: '32 Le Roy', invitedByName: 'Alyssa',
        createdAt: '2026-09-15T00:00:00Z', propertyNames: ["Martin's Bay"] },
    ]);

    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText("Join Martin's Bay?")).not.toBeNull();

    await press(pressableAround(r, 'No thanks'));
    expect(mock_declineInvitation).toHaveBeenCalledWith('i9');
    expect(mock_acceptInvitation).not.toHaveBeenCalled();

    await press(pressableAround(r, 'Join'));
    expect(mock_acceptInvitation).toHaveBeenCalledWith('i9');
    // Another home beside this one, and the one to open on: remembered before
    // the account is re-read, so the re-read lands there.
    expect(mock_rememberHousehold).toHaveBeenCalledWith('other');
    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(mock_rememberHousehold))
      .toBeLessThan(order((global as any).__household.reloadAccount));
  });
});

// A home is a household. The bach is a household of its own, so this screen
// is one household's, and another home is another household.
describe('another home', () => {
  it("lists only this household's place, not the other homes", async () => {
    arrange({ properties: [place('p1', '32 Le Roy'), { id: 'p2', householdId: 'bach', name: 'Martins Bay' }] });
    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('32 Le Roy')).not.toBeNull();
    expect(r.queryByText('Martins Bay')).toBeNull();
    expect(mock_getPlaceMembers).toHaveBeenCalledWith(['p1']);
  });

  it('adds another home as a household of its own, and opens on it', async () => {
    arrange();
    mock_createHousehold.mockResolvedValue({ id: 'h2', name: 'Martins Bay', createdAt: '' });
    const r = render(<HouseholdScreen />);
    await settle();

    // Never a second place in this household: nobody here would be kept out.
    expect(r.queryByText('Add a place')).toBeNull();
    const box = input(r, (p) => p.placeholder === 'The bach');
    await TestRenderer.act(async () => box.props.onChangeText('Martins Bay'));
    const button = r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.label === 'Add another home' && !!n.props?.onPress,
    )[0];
    await press(button);

    expect(mock_createHousehold).toHaveBeenCalledWith('Martins Bay', 'Martins Bay');
    expect(mock_rememberHousehold).toHaveBeenCalledWith('h2');
    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(mock_rememberHousehold))
      .toBeLessThan(order((global as any).__household.reloadAccount));
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

    expect(mock_createInviteLink).toHaveBeenCalledWith('h', ['p1']);
    expect(r.queryByText(`https://app.snaghq.co.nz/join/${TOKEN}`)).not.toBeNull();
    expect(r.queryByText('Show a QR code')).toBeNull();
  });

  // One table, two ways of being addressed — so the one thing the partition can
  // get wrong is showing the code as a person who is waiting to arrive.
  it('never reads as somebody waiting', async () => {
    arrange();
    mock_getHouseholdInvitations.mockResolvedValue([LINK]);

    const r = render(<HouseholdScreen />);
    await settle();

    expect(r.queryByText('Waiting — they need to sign up with this address')).toBeNull();
    expect(r.queryByText(`https://app.snaghq.co.nz/join/${TOKEN}`)).not.toBeNull();
  });

  // Stopping one place's link must leave the other place's working.
  it('can be stopped, this link only, which is the whole of its security model', async () => {
    arrange();
    mock_getHouseholdInvitations.mockResolvedValue([LINK]);

    const r = render(<HouseholdScreen />);
    await settle();
    await press(pressableAround(r, 'Stop sharing'));
    await settle();

    expect(mock_cancelInvitation).toHaveBeenCalledWith('link1');
    expect(r.queryByText('Show a QR code')).not.toBeNull();
  });
});
