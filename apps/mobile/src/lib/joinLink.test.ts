import { Platform } from 'react-native';
import { clearJoinToken, confirmRedirectUrl, parseJoinToken, readJoinToken } from './joinLink';

// A join code arrives in the address bar and nowhere else: the QR is scanned by
// the scanner's own camera, which opens a URL in their browser. So this is the
// one piece of the invite mechanism that only ever runs on the web build.
//
// Two things it must not do, and both would be silent: read a token out of a
// path that isn't a join link, and leave one in the address bar after it has
// been answered — which would re-ask the question on every reload for ever.

const TOKEN = '8f1d3c2e-0000-4000-8000-000000000000';

const replaceState = jest.fn();

function atPath(pathname: string) {
  (global as any).window = { location: { pathname }, history: { replaceState } };
}

function setPlatform(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('web');
});

describe('readJoinToken', () => {
  it('reads the token out of a join path', () => {
    atPath(`/join/${TOKEN}`);
    expect(readJoinToken()).toBe(TOKEN);
  });

  it('tolerates a trailing slash, which a QR scanner may well add', () => {
    atPath(`/join/${TOKEN}/`);
    expect(readJoinToken()).toBe(TOKEN);
  });

  it('lower-cases it, so a code typed by hand still matches the uuid stored', () => {
    atPath(`/join/${TOKEN.toUpperCase()}`);
    expect(readJoinToken()).toBe(TOKEN);
  });

  it.each([
    ['/'],
    ['/snags'],
    [`/snags/${TOKEN}`],
    ['/join'],
    ['/join/'],
    ['/join/not-a-uuid'],
    [`/join/${TOKEN}/extra`],
  ])('finds nothing in %s', (pathname) => {
    atPath(pathname);
    expect(readJoinToken()).toBeNull();
  });

  // Native never sees one: the person scanning hasn't installed the app, which
  // is the whole reason they are being handed a link.
  it('is null on native, which has no address bar', () => {
    setPlatform('ios');
    atPath(`/join/${TOKEN}`);
    expect(readJoinToken()).toBeNull();
  });
});

describe('clearJoinToken', () => {
  it('takes an answered code out of the address bar', () => {
    atPath(`/join/${TOKEN}`);
    clearJoinToken();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  // It must not touch a URL it didn't put there — a snag deep link is somebody
  // else's journey and clearing it would drop them on the default tab.
  it('leaves any other path alone', () => {
    atPath(`/snags/${TOKEN}`);
    clearJoinToken();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('no-ops on native', () => {
    setPlatform('ios');
    atPath(`/join/${TOKEN}`);
    clearJoinToken();
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('parseJoinToken', () => {
  it('reads the code out of a whole link, whatever came with it', () => {
    expect(parseJoinToken(`Join us https://app.snaghq.co.nz/join/${TOKEN.toUpperCase()} x`)).toBe(TOKEN);
  });

  it('reads a bare code', () => {
    expect(parseJoinToken(` ${TOKEN} `)).toBe(TOKEN);
  });

  it('reads nothing out of something that holds no code', () => {
    expect(parseJoinToken('https://app.snaghq.co.nz/snags/123')).toBeNull();
    expect(parseJoinToken('')).toBeNull();
  });
});

// Where a sign-up confirmation email's link lands. Without a redirect Auth uses
// the Site URL, which drops the join code — and somebody who scanned a QR then
// lands on *Set up your house* instead of the question the code asks.
describe('confirmRedirectUrl', () => {
  it('carries the join code through the email', () => {
    (global as any).window = { location: { origin: 'https://app.snaghq.co.nz', pathname: `/join/${TOKEN}` } };
    expect(confirmRedirectUrl(TOKEN)).toBe(`https://app.snaghq.co.nz/join/${TOKEN}`);
  });

  it('lands on the root when there is no code', () => {
    (global as any).window = { location: { origin: 'https://app.snaghq.co.nz', pathname: '/' } };
    expect(confirmRedirectUrl(null)).toBe('https://app.snaghq.co.nz/');
  });

  // A local build confirms back to itself, not to production.
  it("uses the page's own origin on the web", () => {
    (global as any).window = { location: { origin: 'http://localhost:8081', pathname: '/' } };
    expect(confirmRedirectUrl(null)).toBe('http://localhost:8081/');
  });

  it('uses the app host off the web, where there is no address bar', () => {
    setPlatform('ios');
    expect(confirmRedirectUrl(null)).toBe('https://app.snaghq.co.nz/');
  });
});
