import { chooseGate, type GateState } from './gates';

// The rung that was wrong, and a table so the next one can't be.

const base: GateState = {
  loading: false,
  fatal: false,
  signedIn: true,
  hasJoinToken: false,
  hasProfile: true,
  hasHousehold: true,
};

const gate = (over: Partial<GateState>) => chooseGate({ ...base, ...over });

describe('the order of the gates', () => {
  it.each([
    ['loading beats everything', { loading: true, fatal: true, signedIn: false }, 'loading'],
    ['an unexposed schema beats auth', { fatal: true, signedIn: false }, 'fatal'],
    ['signed out is the auth screen', { signedIn: false }, 'auth'],
    ['no profile is setup', { hasProfile: false, hasHousehold: false }, 'setup'],
    ['no household is setup', { hasHousehold: false }, 'setup'],
    ['a step not yet shown is setup', { hasPendingSteps: true }, 'setup'],
    ['everything in place is the app', {}, 'app'],
  ])('%s', (_name, over, expected) => {
    expect(gate(over as Partial<GateState>)).toBe(expected);
  });
});

// The bug, as a test. This is the journey the QR exists for and it was the one
// path that didn't work: a scanner has an account and nothing else, so gating
// the join branch on a profile skipped it and dropped them on Setup, whose
// first offer is "Create it". Alyssa made a second 32 Le Roy that way.
describe('holding a join code', () => {
  it('beats setup for somebody who has only just signed up', () => {
    expect(gate({ hasJoinToken: true, hasProfile: false, hasHousehold: false })).toBe('join');
  });

  it('beats the app for somebody who already has a household', () => {
    expect(gate({ hasJoinToken: true })).toBe('join');
  });

  // Not a gate everybody passes — no token, no branch. That is what keeps this
  // three gates rather than four.
  it('is not a branch at all without a code', () => {
    expect(gate({ hasProfile: false, hasHousehold: false })).toBe('setup');
    expect(gate({})).toBe('app');
  });

  // A code cannot be answered by somebody who isn't signed in: the whole home
  // schema is granted to `authenticated` only, so every read would 42501.
  it('still waits for sign-in', () => {
    expect(gate({ hasJoinToken: true, signedIn: false, hasProfile: false })).toBe('auth');
  });

  it('never beats an unexposed schema, which makes it unanswerable anyway', () => {
    expect(gate({ hasJoinToken: true, fatal: true })).toBe('fatal');
  });
});

// A setup step added later reaches people who set up before it existed — but
// never ahead of a code somebody is holding, which is a question about a whole
// household rather than one about their screen.
describe('a step not yet shown', () => {
  it('sends somebody fully set up back through setup', () => {
    expect(gate({ hasPendingSteps: true })).toBe('setup');
  });

  it('never beats a join code', () => {
    expect(gate({ hasPendingSteps: true, hasJoinToken: true })).toBe('join');
  });

  it('never beats sign-in', () => {
    expect(gate({ hasPendingSteps: true, signedIn: false })).toBe('auth');
  });
});

// A run, once on screen, keeps it until it finishes. Making a house answers
// the last required step; letting the app in on that write cut a run off at
// the name and opened whatever screen the address bar last held.
describe('a setup run on screen', () => {
  it('keeps the screen once nothing is pending', () => {
    expect(gate({ setupRunning: true, hasPendingSteps: false })).toBe('setup');
  });

  it('gives it up once it has finished', () => {
    expect(gate({ setupRunning: false, hasPendingSteps: false })).toBe('app');
  });

  it('never beats a join code pasted half way through', () => {
    expect(gate({ setupRunning: true, hasJoinToken: true })).toBe('join');
  });

  it('never beats sign-out', () => {
    expect(gate({ setupRunning: true, signedIn: false })).toBe('auth');
  });
});

// *Add another home* makes a house from inside the app. It gets the same run a
// house made in setup gets — its rooms, the invite, *You're all set*.
describe('a home just added', () => {
  it('takes the screen for its own setup run', () => {
    expect(gate({ homeAdded: true })).toBe('setup');
  });

  it('never beats a join code or sign-out', () => {
    expect(gate({ homeAdded: true, hasJoinToken: true })).toBe('join');
    expect(gate({ homeAdded: true, signedIn: false })).toBe('auth');
  });
});
