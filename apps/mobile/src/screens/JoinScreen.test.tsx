import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import JoinScreen from './JoinScreen';

// The far end of a QR code. Three arrivals are all real and all have to be
// answered in words, because the person reading this screen has usually just
// met the app:
//
//   - a live code, which asks rather than tells — an invitation you can't
//     refuse is an instruction,
//   - a dead one, from a screenshot or a revoked share, which is not an error
//     state and must not read like one,
//   - and a code for a house they're already in, because people scan twice.
//
// The fourth thing it must do is clear the token from the URL on the way out.
// Left there, the same question is asked on every reload for ever.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mock_getInvitationByToken = jest.fn();
const mock_acceptInvitationByToken = jest.fn().mockResolvedValue(undefined);

jest.mock('../lib/supabase', () => ({
  getInvitationByToken: (...a: unknown[]) => mock_getInvitationByToken(...a),
  acceptInvitationByToken: (...a: unknown[]) => mock_acceptInvitationByToken(...a),
}));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));

const TOKEN = '8f1d3c2e-0000-4000-8000-000000000000';

const LIVE = {
  id: 'i1',
  householdId: 'h',
  householdName: '32 Le Roy',
  invitedByName: 'Mike',
  expiresAt: '2026-09-16T00:00:00Z',
  alreadyAMember: false,
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

const onJoined = jest.fn().mockResolvedValue(undefined);
const onDismiss = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mock_acceptInvitationByToken.mockResolvedValue(undefined);
});

describe('a live code', () => {
  beforeEach(() => mock_getInvitationByToken.mockResolvedValue(LIVE));

  it('names the house and who is offering it, and asks', async () => {
    const r = render(<JoinScreen token={TOKEN} onJoined={onJoined} onDismiss={onDismiss} />);
    await settle();

    expect(r.queryByText('Join 32 Le Roy?')).not.toBeNull();
    expect(r.queryByText('Join')).not.toBeNull();
    expect(r.queryByText('No thanks')).not.toBeNull();
  });

  it('joins by the token it was given', async () => {
    const r = render(<JoinScreen token={TOKEN} onJoined={onJoined} onDismiss={onDismiss} />);
    await settle();
    await press(pressableAround(r, 'Join'));

    expect(mock_acceptInvitationByToken).toHaveBeenCalledWith(TOKEN);
    expect(onJoined).toHaveBeenCalled();
  });

  // Order matters: onJoined re-gates the whole app, so the token has to be out
  // of the address bar before that, or the next reload asks again about a
  // household they are now in.
  it('clears the code before re-gating the app', async () => {
    const order: string[] = [];
    onDismiss.mockImplementation(() => { order.push('cleared'); });
    onJoined.mockImplementation(async () => { order.push('regated'); });

    const r = render(<JoinScreen token={TOKEN} onJoined={onJoined} onDismiss={onDismiss} />);
    await settle();
    await press(pressableAround(r, 'Join'));

    expect(order).toEqual(['cleared', 'regated']);
  });

  it('walking away clears the code and joins nothing', async () => {
    const r = render(<JoinScreen token={TOKEN} onJoined={onJoined} onDismiss={onDismiss} />);
    await settle();
    await press(pressableAround(r, 'No thanks'));

    expect(onDismiss).toHaveBeenCalled();
    expect(mock_acceptInvitationByToken).not.toHaveBeenCalled();
  });
});

describe('a code that is no longer any good', () => {
  it('says so in words rather than failing', async () => {
    mock_getInvitationByToken.mockResolvedValue(null);
    const r = render(<JoinScreen token={TOKEN} onJoined={onJoined} onDismiss={onDismiss} />);
    await settle();

    expect(r.queryByText('That code has expired')).not.toBeNull();
    expect(r.queryByText('Join')).toBeNull();
    expect(r.queryByText('Carry on')).not.toBeNull();
  });

  // A read that throws is the same situation from the user's side: they cannot
  // act on this code. It must not leave them on a spinner.
  it('reads the same way when the lookup itself fails', async () => {
    mock_getInvitationByToken.mockRejectedValue(new Error('offline'));
    const r = render(<JoinScreen token={TOKEN} onJoined={onJoined} onDismiss={onDismiss} />);
    await settle();

    expect(r.queryByText('That code has expired')).not.toBeNull();
  });
});

describe('a code for a house you are already in', () => {
  it('says that instead of offering to join', async () => {
    mock_getInvitationByToken.mockResolvedValue({ ...LIVE, alreadyAMember: true });
    const r = render(<JoinScreen token={TOKEN} onJoined={onJoined} onDismiss={onDismiss} />);
    await settle();

    expect(r.queryByText("You're already in 32 Le Roy")).not.toBeNull();
    expect(r.queryByText('Join')).toBeNull();
  });
});
