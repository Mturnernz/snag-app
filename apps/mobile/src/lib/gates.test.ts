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
