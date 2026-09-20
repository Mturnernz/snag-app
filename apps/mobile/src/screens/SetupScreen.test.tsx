import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SetupScreen from './SetupScreen';

// This screen is the invitee's end of the mechanism, and the end that used to
// not exist. Adding somebody required them to have already signed up AND saved
// a name; until both were true, the person doing the adding got "That account
// has not finished signing up yet" — an order nothing had published, reported
// to the one person who could not act on it.
//
// What these pin: that an invitation is found and answered here, that the
// answer is genuinely a choice rather than an instruction, and that the screen
// never suggests an email is coming — nothing in this product emails anybody.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mock_getMyInvitations = jest.fn().mockResolvedValue([]);
const mock_acceptInvitation = jest.fn().mockResolvedValue(undefined);
const mock_declineInvitation = jest.fn().mockResolvedValue(undefined);
const mock_upsertProfile = jest.fn().mockResolvedValue(undefined);
const mock_createHousehold = jest.fn().mockResolvedValue(undefined);

jest.mock('../lib/supabase', () => ({
  getMyInvitations: (...a: unknown[]) => mock_getMyInvitations(...a),
  acceptInvitation: (...a: unknown[]) => mock_acceptInvitation(...a),
  declineInvitation: (...a: unknown[]) => mock_declineInvitation(...a),
  upsertProfile: (...a: unknown[]) => mock_upsertProfile(...a),
  createHousehold: (...a: unknown[]) => mock_createHousehold(...a),
  signOut: jest.fn().mockResolvedValue({ forced: false }),
}));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));

const PROFILE = { id: 'me', displayName: 'Alyssa', createdAt: '2026-09-01T00:00:00Z', projectsEnabled: true };

const INVITATION = {
  id: 'i1',
  householdId: 'h',
  householdName: '32 Le Roy',
  invitedByName: 'Mike',
  createdAt: '2026-09-15T00:00:00Z',
};

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

const onReady = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
  mock_getMyInvitations.mockResolvedValue([]);
  mock_upsertProfile.mockResolvedValue(undefined);
});

describe('an invitation waiting at sign-up', () => {
  // It beats both branches: somebody who signed up first and is looking at
  // "Set up your house" must not have to guess that the answer is behind the
  // second button.
  it('is shown ahead of the create-a-house form', async () => {
    mock_getMyInvitations.mockResolvedValue([INVITATION]);
    const r = render(<SetupScreen profile={PROFILE} onReady={onReady} />);
    await settle();

    expect(r.queryByText('32 Le Roy wants to add you')).not.toBeNull();
    expect(r.queryByText('Set up your house')).toBeNull();
  });

  it('is a choice, not an instruction', async () => {
    mock_getMyInvitations.mockResolvedValue([INVITATION]);
    const r = render(<SetupScreen profile={PROFILE} onReady={onReady} />);
    await settle();

    expect(r.queryByText('Join')).not.toBeNull();
    expect(r.queryByText('No thanks')).not.toBeNull();

    await press(pressableAround(r, 'No thanks'));
    expect(mock_declineInvitation).toHaveBeenCalledWith('i1');
    expect(mock_acceptInvitation).not.toHaveBeenCalled();
    // Declining re-reads rather than guessing the list is now empty.
    expect(mock_getMyInvitations).toHaveBeenCalledTimes(2);
  });

  it('joining re-gates the app rather than routing by hand', async () => {
    mock_getMyInvitations.mockResolvedValue([INVITATION]);
    const r = render(<SetupScreen profile={PROFILE} onReady={onReady} />);
    await settle();

    await press(pressableAround(r, 'Join'));
    expect(mock_acceptInvitation).toHaveBeenCalledWith('i1');
    expect(onReady).toHaveBeenCalled();
  });

  // An account with no profile can't accept — accept_invitation needs one —
  // so asking before the name is saved would find nothing and say so for a
  // reason that has nothing to do with whether an invitation exists.
  it('is not looked for before there is a name to accept with', async () => {
    render(<SetupScreen profile={null} onReady={onReady} />);
    await settle();

    expect(mock_getMyInvitations).not.toHaveBeenCalled();
  });
});

describe('waiting to be invited', () => {
  it('says nothing will arrive by email, because nothing will', async () => {
    const r = render(<SetupScreen profile={null} onReady={onReady} />);
    await settle();

    const nameField = r.root.findAll(
      (n: any) => typeof n.type === 'string' && n.type === 'TextInput'
    )[0];
    await TestRenderer.act(async () => nameField.props.onChangeText('Alyssa'));
    await press(pressableAround(r, 'Someone else set ours up'));
    await settle();

    expect(r.queryByText("You're ready")).not.toBeNull();
    const said = r.root
      .findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
      .map((n: any) => JSON.stringify(n.children))
      .join(' ');
    expect(said).toMatch(/doesn't email you/i);
    // Saving the name is what makes accepting possible later.
    expect(mock_upsertProfile).toHaveBeenCalledWith('Alyssa');
  });

  // "Check again" has to re-read the invitations rather than reload the
  // account: there is no household yet, so onReady would find nothing and the
  // screen would look broken to somebody who has just been invited.
  it('checks for the invitation rather than reloading the account', async () => {
    const r = render(<SetupScreen profile={PROFILE} onReady={onReady} />);
    await settle();
    await press(pressableAround(r, 'Someone else set ours up'));
    await settle();

    const before = mock_getMyInvitations.mock.calls.length;
    await press(pressableAround(r, 'Check again'));

    expect(mock_getMyInvitations.mock.calls.length).toBeGreaterThan(before);
    expect(onReady).not.toHaveBeenCalled();
  });
});
