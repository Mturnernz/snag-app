import { nameFromIdentity, tokensFromRedirect, webRedirectTarget } from './googleSignIn';

jest.mock('./supabase', () => ({ supabase: { auth: {} } }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

// Google's round trip leaves the page, so whatever was in the address bar has
// to be put back on the way in — or the one piece of it that mattered is gone.

describe('where a web sign-in comes back to', () => {
  const origin = 'https://app.snaghq.co.nz';

  // Somebody who has just scanned a QR has no account; signing up IS the
  // journey. Coming back to `/` would drop the code with nothing able to
  // recover it.
  it('keeps a join code', () => {
    expect(webRedirectTarget(origin, '/join/8f1d3c2e')).toBe(`${origin}/join/8f1d3c2e`);
  });

  it('keeps a sent job and a sent project', () => {
    expect(webRedirectTarget(origin, '/snags/abc')).toBe(`${origin}/snags/abc`);
    expect(webRedirectTarget(origin, '/projects/abc')).toBe(`${origin}/projects/abc`);
  });

  it('sends everything else to the list', () => {
    expect(webRedirectTarget(origin, '/you')).toBe(`${origin}/`);
    expect(webRedirectTarget(origin, '/')).toBe(`${origin}/`);
  });
});

describe('the tokens a native round trip ends on', () => {
  it('reads them from the fragment', () => {
    expect(tokensFromRedirect('snag://auth-callback#access_token=a&refresh_token=r&token_type=bearer'))
      .toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('reads them from a query string too', () => {
    expect(tokensFromRedirect('snag://auth-callback?access_token=a&refresh_token=r'))
      .toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('a half session is not one', () => {
    expect(tokensFromRedirect('snag://auth-callback#access_token=a')).toBeNull();
    expect(tokensFromRedirect('snag://auth-callback#error=access_denied')).toBeNull();
  });
});

describe('the name Google already knows', () => {
  it('is the first name', () => {
    expect(nameFromIdentity({ given_name: 'Alyssa', full_name: 'Alyssa Turner' })).toBe('Alyssa');
    expect(nameFromIdentity({ full_name: 'Mike Turner' })).toBe('Mike');
    expect(nameFromIdentity({ name: 'Mike Turner' })).toBe('Mike');
  });

  it('is nothing when there is none — an email sign-up is asked from scratch', () => {
    expect(nameFromIdentity({})).toBeNull();
    expect(nameFromIdentity(undefined)).toBeNull();
    expect(nameFromIdentity({ full_name: '   ' })).toBeNull();
  });
});
