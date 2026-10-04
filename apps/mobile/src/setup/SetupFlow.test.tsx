import React, { useState } from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SetupFlow from './SetupFlow';
import type { Household, Profile } from '../types';

// The whole of first run, driven the way App.tsx drives it: SetupFlow is handed
// the account, writes through the same functions as ever, and asks for the
// account to be re-read after each write that the next step depends on.
//
// Carried over from the Setup screen it replaced, and still the point: an
// invitation beats the question, it is a choice rather than an instruction,
// and nothing here suggests an email is coming — nothing in this product
// emails anybody.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mock = {
  markSetupSeen: jest.fn(),
  getMyInvitations: jest.fn(),
  acceptInvitation: jest.fn(),
  declineInvitation: jest.fn(),
  upsertProfile: jest.fn(),
  createHousehold: jest.fn(),
  getMyProperties: jest.fn(),
  getLocations: jest.fn(),
  createLocation: jest.fn(),
  deleteLocation: jest.fn(),
  getHouseholdInvitations: jest.fn(),
  createInviteLink: jest.fn(),
  revokeInviteLink: jest.fn(),
  takePhoto: jest.fn(),
  shareLink: jest.fn(),
};

jest.mock('../lib/supabase', () => ({
  markSetupSeen: (...a: unknown[]) => mock.markSetupSeen(...a),
  getMyInvitations: (...a: unknown[]) => mock.getMyInvitations(...a),
  acceptInvitation: (...a: unknown[]) => mock.acceptInvitation(...a),
  declineInvitation: (...a: unknown[]) => mock.declineInvitation(...a),
  upsertProfile: (...a: unknown[]) => mock.upsertProfile(...a),
  createHousehold: (...a: unknown[]) => mock.createHousehold(...a),
  getMyProperties: (...a: unknown[]) => mock.getMyProperties(...a),
  getLocations: (...a: unknown[]) => mock.getLocations(...a),
  createLocation: (...a: unknown[]) => mock.createLocation(...a),
  deleteLocation: (...a: unknown[]) => mock.deleteLocation(...a),
  getHouseholdInvitations: (...a: unknown[]) => mock.getHouseholdInvitations(...a),
  createInviteLink: (...a: unknown[]) => mock.createInviteLink(...a),
  revokeInviteLink: (...a: unknown[]) => mock.revokeInviteLink(...a),
  signOut: jest.fn().mockResolvedValue({ forced: false }),
}));
jest.mock('../lib/photoUpload', () => ({ takePhoto: () => mock.takePhoto() }));
jest.mock('../lib/share', () => ({ shareLink: (...a: unknown[]) => mock.shareLink(...a) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const profile = (seen: string[] = [], name = 'Alyssa'): Profile => ({
  id: 'me', displayName: name, createdAt: '2026-09-01T00:00:00Z', projectsEnabled: true, setupSeen: seen,
});
const HOUSE = { id: 'h', name: '32 Le Roy', createdAt: '2026-09-01T00:00:00Z' } as Household;

const INVITATION = {
  id: 'i1',
  householdId: 'h',
  householdName: '32 Le Roy',
  invitedByName: 'Mike',
  createdAt: '2026-09-15T00:00:00Z',
  propertyNames: ["Martin's Bay"],
};

/** What the server holds, as the mocks see it; `onReady` reads it back like loadAccount. */
let world: { profile: Profile | null; household: Household | null; members: number };

const settle = () => TestRenderer.act(async () => {});

const pressableAround = (r: ReturnType<typeof render>, text: string) => {
  let node: any = r.getByText(text);
  while (node) {
    if (typeof node.props?.onPress === 'function') return node;
    node = node.parent;
  }
  throw new Error(`Nothing pressable around "${text}"`);
};

const press = async (r: ReturnType<typeof render>, text: string) => {
  await TestRenderer.act(async () => {
    await pressableAround(r, text).props.onPress();
  });
  await settle();
};

const field = (r: ReturnType<typeof render>, label: string) => r.root.findAll(
  (n: any) => typeof n.type === 'string' && n.props?.accessibilityLabel === label
)[0];

const type = async (r: ReturnType<typeof render>, label: string, text: string) => {
  await TestRenderer.act(async () => field(r, label).props.onChangeText(text));
};

const onFinish = jest.fn();
const onJoinToken = jest.fn();

function Harness({ suggestedName }: { suggestedName?: string | null }) {
  const [account, setAccount] = useState({ ...world });
  return (
    <SetupFlow
      profile={account.profile}
      household={account.household}
      memberCount={account.members}
      suggestedName={suggestedName}
      onReady={async () => setAccount({ ...world })}
      onJoinToken={onJoinToken}
      onFinish={onFinish}
    />
  );
}

async function start(suggestedName?: string | null) {
  const r = render(<Harness suggestedName={suggestedName} />);
  await settle();
  return r;
}

const title = (r: ReturnType<typeof render>, text: string) => r.queryByText(text) !== null;

beforeEach(() => {
  jest.clearAllMocks();
  world = { profile: null, household: null, members: 0 };
  mock.markSetupSeen.mockResolvedValue(undefined);
  mock.getMyInvitations.mockResolvedValue([]);
  mock.upsertProfile.mockImplementation(async (name: string) => {
    world.profile = profile(world.profile?.setupSeen ?? [], name);
    return world.profile;
  });
  mock.createHousehold.mockImplementation(async () => {
    world.household = HOUSE;
    world.members = 1;
    return HOUSE;
  });
  mock.acceptInvitation.mockImplementation(async () => {
    world.household = HOUSE;
    world.members = 2;
  });
  mock.getMyProperties.mockResolvedValue([{ id: 'p', householdId: 'h', name: '32 Le Roy' }]);
  mock.getLocations.mockResolvedValue([
    { id: 'l1', name: 'Kitchen' },
    { id: 'l2', name: 'Garage' },
  ]);
  mock.getHouseholdInvitations.mockResolvedValue([]);
  mock.createInviteLink.mockResolvedValue({ id: 'link', token: 'tok', householdId: 'h' });
  mock.shareLink.mockResolvedValue('shared');
  mock.takePhoto.mockResolvedValue('file://first.jpg');
});

describe('a brand-new account, start to finish', () => {
  it('asks one thing at a time and writes each answer as it goes', async () => {
    const r = await start();

    expect(title(r, 'What should we call you?')).toBe(true);
    await type(r, 'Your name', 'Alyssa');
    await press(r, 'Continue');
    expect(mock.upsertProfile).toHaveBeenCalledWith('Alyssa');

    expect(title(r, 'Nice to meet you, Alyssa')).toBe(true);
    await press(r, 'Start a new house');

    expect(title(r, 'What do you call your place?')).toBe(true);
    await type(r, "Your place's name", '32 Le Roy');
    await press(r, 'Create it');
    // One answer, both names: "Home" under a house called 32 Le Roy is a name
    // nobody chose.
    expect(mock.createHousehold).toHaveBeenCalledWith('32 Le Roy', '32 Le Roy');

    expect(title(r, 'Here are your rooms')).toBe(true);
    expect(title(r, 'Garage')).toBe(true);
    await press(r, 'Continue');

    expect(title(r, 'Bring someone in')).toBe(true);
    await press(r, 'Set up later');

    expect(title(r, "You're all set, Alyssa")).toBe(true);
    expect(mock.markSetupSeen.mock.calls.map((c) => c[0][0])).toEqual(
      ['name', 'household', 'rooms', 'invite']
    );
  });

  it("offers the name Google already knows, and it is still the person's to change", async () => {
    const r = await start('Alyssa');
    expect(field(r, 'Your name').props.value).toBe('Alyssa');
    await type(r, 'Your name', 'Lys');
    await press(r, 'Continue');
    expect(mock.upsertProfile).toHaveBeenCalledWith('Lys');
  });

  it('never goes back to "Start a new house" once there is a house', async () => {
    world = { profile: profile(['name', 'household']), household: HOUSE, members: 1 };
    const r = await start();
    expect(title(r, 'Here are your rooms')).toBe(true);
    // Nothing earlier in this run to go back to.
    expect(r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Back')).toHaveLength(0);
  });
});

describe('the last screen', () => {
  async function allSet() {
    world = { profile: profile(['name', 'household', 'rooms', 'invite']), household: HOUSE, members: 1 };
    // Nothing pending, first run: straight to the end.
    const r = await start();
    return r;
  }

  it('opens the camera from its own press and hands the photo on', async () => {
    const r = await allSet();
    await press(r, 'Snap your first job');
    expect(mock.takePhoto).toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledWith('file://first.jpg');
  });

  it('a camera closed without a photo is simply the list', async () => {
    mock.takePhoto.mockResolvedValue(null);
    const r = await allSet();
    await press(r, 'Snap your first job');
    expect(onFinish).toHaveBeenCalledWith(null);
  });

  it('can go to the list without a photo', async () => {
    const r = await allSet();
    await press(r, 'Take me to the list');
    expect(mock.takePhoto).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledWith(null);
  });
});

describe('the second person', () => {
  it('sees the rooms and is not asked to invite anybody', async () => {
    world = { profile: profile(), household: HOUSE, members: 2 };
    const r = await start();
    expect(title(r, 'Here are your rooms')).toBe(true);
    await press(r, 'Continue');
    expect(title(r, 'Bring someone in')).toBe(false);
    expect(title(r, "You're all set, Alyssa")).toBe(true);
  });

  // The rooms are the other person's too, so taking one away still asks.
  it('is asked before a room is removed', async () => {
    const { showAlert } = jest.requireMock('../lib/alert');
    world = { profile: profile(), household: HOUSE, members: 2 };
    const r = await start();
    await TestRenderer.act(async () => {
      await r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Remove Garage'
        && typeof n.props.onPress === 'function')[0].props.onPress();
    });
    expect(showAlert).toHaveBeenCalled();
    expect(mock.deleteLocation).not.toHaveBeenCalled();
  });

  // The rooms are cards, and the last one is a dashed card that names a room
  // in place.
  it('adds another room from the dashed card', async () => {
    world = { profile: profile(['name', 'household']), household: HOUSE, members: 1 };
    const r = await start();
    expect(title(r, 'Kitchen')).toBe(true);
    await press(r, 'Add another room');
    await type(r, 'Name the room', 'Sleepout');
    mock.getLocations.mockResolvedValue([
      { id: 'l1', name: 'Kitchen' },
      { id: 'l2', name: 'Garage' },
      { id: 'l3', name: 'Sleepout' },
    ]);
    await press(r, 'Add');
    expect(mock.createLocation).toHaveBeenCalledWith('p', 'Sleepout');
    expect(title(r, 'Sleepout')).toBe(true);
    expect(title(r, 'Add another room')).toBe(true);
  });

  it('a first owner removes a room in one tap: nothing has been filed there yet', async () => {
    world = { profile: profile(['name', 'household']), household: HOUSE, members: 1 };
    const r = await start();
    await TestRenderer.act(async () => {
      await r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Remove Garage'
        && typeof n.props.onPress === 'function')[0].props.onPress();
    });
    expect(mock.deleteLocation).toHaveBeenCalledWith('l2');
  });
});

describe('an invitation waiting at sign-up', () => {
  const named = () => { world = { profile: profile(['name']), household: null, members: 0 }; };

  it('is shown ahead of starting a house', async () => {
    named();
    mock.getMyInvitations.mockResolvedValue([INVITATION]);
    const r = await start();
    expect(title(r, "Join Martin's Bay?")).toBe(true);
    expect(title(r, 'Start a new house')).toBe(false);
  });

  it('is a choice, not an instruction', async () => {
    named();
    mock.getMyInvitations.mockResolvedValue([INVITATION]);
    const r = await start();
    await press(r, 'No thanks');
    expect(mock.declineInvitation).toHaveBeenCalledWith('i1');
    expect(mock.acceptInvitation).not.toHaveBeenCalled();
    // Declining re-reads rather than guessing the list is now empty.
    expect(mock.getMyInvitations).toHaveBeenCalledTimes(2);
  });

  it('joining carries on to the rooms of the house joined', async () => {
    named();
    mock.getMyInvitations.mockResolvedValue([INVITATION]);
    const r = await start();
    await press(r, 'Join');
    expect(mock.acceptInvitation).toHaveBeenCalledWith('i1');
    expect(title(r, 'Here are your rooms')).toBe(true);
  });

  // It used to wait for a profile, on the belief that asking first would find
  // nothing. It wouldn't: my_invitations matches on the signed-in address. And
  // waiting is how an invitee met *Create it* and made a household of their own.
  it('is looked for before there is a name, and named on the very first question', async () => {
    mock.getMyInvitations.mockResolvedValue([INVITATION]);
    const r = await start();
    expect(title(r, 'What should we call you?')).toBe(true);
    expect(title(r, "Mike has invited you to Martin's Bay. First, the name they'll see.")).toBe(true);
    await type(r, 'Your name', 'Alyssa');
    await press(r, 'Continue');
    expect(title(r, "Join Martin's Bay?")).toBe(true);
    expect(title(r, 'Start a new house')).toBe(false);
  });

  it('never leaves the name step with a dead button', async () => {
    const r = await start();
    await press(r, 'Continue');
    expect(title(r, 'Tell us what to call you.')).toBe(true);
    expect(mock.upsertProfile).not.toHaveBeenCalled();
  });
});

describe('waiting to be invited', () => {
  async function waiting() {
    world = { profile: profile(['name']), household: null, members: 0 };
    const r = await start();
    await press(r, "Join someone's house");
    return r;
  }

  it('takes a pasted link to the same join question a tapped one reaches', async () => {
    const r = await waiting();
    await type(r, 'Paste an invite link',
      'Join us! https://app.snaghq.co.nz/join/8F1D3C2E-0000-4000-8000-000000000000');
    await press(r, 'Use this link');
    expect(onJoinToken).toHaveBeenCalledWith('8f1d3c2e-0000-4000-8000-000000000000');
  });

  it('says so when what was pasted is not a link, and does nothing', async () => {
    const r = await waiting();
    await type(r, 'Paste an invite link', 'hello');
    expect(title(r, "That doesn't look like a Snag invite link.")).toBe(true);
    await press(r, 'Use this link');
    expect(onJoinToken).not.toHaveBeenCalled();
  });

  // Snag emails a sign-up code now, so the claim is narrowed to what is true:
  // an invitation itself never arrives by email.
  it('says the invitation will not arrive by email, because it will not', async () => {
    const r = await waiting();
    const said = r.root
      .findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
      .map((n: any) => JSON.stringify(n.children))
      .join(' ');
    expect(said).toMatch(/doesn't email invitations/i);
  });

  // "Check again" re-reads the invitations rather than the account: there is
  // no household yet, so a reload would find nothing and look broken.
  it('checks for the invitation rather than reloading the account', async () => {
    const r = await waiting();
    const before = mock.getMyInvitations.mock.calls.length;
    await press(r, 'Check again');
    expect(mock.getMyInvitations.mock.calls.length).toBeGreaterThan(before);
  });

  it('an invitation that has arrived since replaces the waiting screen', async () => {
    const r = await waiting();
    mock.getMyInvitations.mockResolvedValue([INVITATION]);
    await press(r, 'Check again');
    expect(title(r, "Join Martin's Bay?")).toBe(true);
  });
});

describe('bringing someone in', () => {
  async function invite() {
    world = { profile: profile(['name', 'household', 'rooms']), household: HOUSE, members: 1 };
    return start();
  }

  it('shares the household link through the phone and never says it was sent', async () => {
    const r = await invite();
    await press(r, 'Share an invite link');
    expect(mock.createInviteLink).toHaveBeenCalledWith('h', undefined);
    expect(mock.shareLink).toHaveBeenCalled();
    const said = r.root
      .findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
      .map((n: any) => JSON.stringify(n.children))
      .join(' ');
    expect(said).not.toMatch(/\bsent\b/i);
  });

  // Two controls with one outcome is a choice that isn't one.
  it('reads Set up later until there is a link, then Continue', async () => {
    const r = await invite();
    expect(title(r, 'Set up later')).toBe(true);
    await press(r, 'Show a QR code');
    expect(title(r, 'Set up later')).toBe(false);
    expect(title(r, 'Continue')).toBe(true);
  });

  it('reuses a live code rather than minting another over it', async () => {
    mock.getHouseholdInvitations.mockResolvedValue([{ id: 'link', token: 'live', householdId: 'h' }]);
    const r = await invite();
    await press(r, 'Share an invite link');
    expect(mock.createInviteLink).not.toHaveBeenCalled();
  });
});
