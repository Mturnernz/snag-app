import { Platform } from 'react-native';
import { isPreservedUrl, resetWebPathIfStale } from './webLocation';

// Signing out from the Profile tab leaves `/you` in the address bar, and React
// Navigation reads it back on the next mount — so signing in landed the user on
// Profile instead of the list. What matters here is that the reset
// happens, and that a snag deep link still survives it.

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const setPlatform = (os: string) => {
  (Platform as unknown as { OS: string }).OS = os;
};

const replaceState = jest.fn();

function atUrl(pathname: string, search = '') {
  (global as unknown as { window: unknown }).window = {
    history: { replaceState },
    location: { pathname, search },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('web');
});

describe('resetWebPathIfStale', () => {
  it('clears a stale tab path so initialRouteName wins', () => {
    atUrl('/profile');
    resetWebPathIfStale();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('clears the snags list tab too — only a specific snag is a destination', () => {
    atUrl('/snags');
    resetWebPathIfStale();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('keeps a snag deep link, which has to survive the sign-in round trip', () => {
    atUrl('/snags/8f1d3c2e-0000-4000-8000-000000000000');
    resetWebPathIfStale();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('keeps a snag deep link carrying ?step=', () => {
    atUrl('/snags/8f1d3c2e-0000-4000-8000-000000000000', '?step=checklist');
    resetWebPathIfStale();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('clears a retired QR landing rather than preserving it', () => {
    // `?report=` was the site-QR intake and `?join=` an org invite. Both went
    // with the B2B product, so these are now just stale query strings.
    atUrl('/snags', '?report=abc123');
    resetWebPathIfStale();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  // The load-bearing one: somebody who just scanned a QR has no account, so the
  // sign-up round trip is the normal case, not the edge. Lose the token there
  // and they land on an empty Setup screen having no idea what they scanned,
  // with nothing on screen able to recover the code.
  it('keeps a join code across the sign-up round trip', () => {
    atUrl('/join/8f1d3c2e-0000-4000-8000-000000000000');
    resetWebPathIfStale();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('does nothing when already at the root', () => {
    atUrl('/');
    resetWebPathIfStale();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('no-ops on native, which has no address bar to be stale', () => {
    setPlatform('ios');
    atUrl('/profile');
    resetWebPathIfStale();
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('isPreservedUrl', () => {
  it.each([
    ['/snags/abc', '', true],
    ['/snags', '', false],
    ['/profile', '', false],
    ['/report', '', false],
    ['/admin', '', false],
    ['/mentions', '', false],
    ['/', '?report=tok', false],
    ['/', '?join=VDJQFNEM', false],
    ['/join/8f1d3c2e-0000-4000-8000-000000000000', '', true],
    ['/join', '', false],
  ])('%s%s -> %s', (pathname, search, expected) => {
    expect(isPreservedUrl(pathname, search)).toBe(expected);
  });
});
