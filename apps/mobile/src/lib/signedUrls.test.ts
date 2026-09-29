import {
  clearSignedUrls, forgetUrl, freshUrl, pathFromSignedUrl, rememberUrl,
  REFRESH_MARGIN_MS, SIGNED_URL_SECONDS,
} from './signedUrls';

const HOUR = 60 * 60_000;
const T0 = Date.UTC(2026, 8, 29, 4, 32);
const PATH = 'c172fb8b-0f4a-47d6-842b-d4bd14e6d5a4/1789427392115-238437.jpg';
const URL_A = `https://x.supabase.co/storage/v1/object/sign/home-photos/${PATH}?token=a`;

describe('signed links', () => {
  beforeEach(() => clearSignedUrls());

  it('signs for an hour and refreshes with a quarter of an hour to spare', () => {
    expect(SIGNED_URL_SECONDS).toBe(3600);
    expect(REFRESH_MARGIN_MS).toBe(15 * 60_000);
  });

  it('hands a remembered link out again while it has life left', () => {
    rememberUrl(PATH, URL_A, T0);
    expect(freshUrl(PATH, T0 + 10 * 60_000)).toBe(URL_A);
    expect(freshUrl(PATH, T0 + 44 * 60_000)).toBe(URL_A);
  });

  // The failure from the launch check: signed at 04:32, expired at 05:32, and
  // asked for at 05:34. Past the margin, the link is never handed out again.
  it('never hands out a link within a quarter of an hour of expiring', () => {
    rememberUrl(PATH, URL_A, T0);
    expect(freshUrl(PATH, T0 + 46 * 60_000)).toBeNull();
    // …and having said no once, it has forgotten it.
    expect(freshUrl(PATH, T0 + 10 * 60_000)).toBeNull();
  });

  it('never hands out a link an hour after it was signed', () => {
    rememberUrl(PATH, URL_A, T0);
    expect(freshUrl(PATH, T0 + HOUR + 2 * 60_000)).toBeNull();
  });

  it('forgets one path, or all of them', () => {
    rememberUrl(PATH, URL_A, T0);
    rememberUrl('other.jpg', 'https://x/other', T0);
    forgetUrl(PATH);
    expect(freshUrl(PATH, T0)).toBeNull();
    expect(freshUrl('other.jpg', T0)).toBe('https://x/other');
    clearSignedUrls();
    expect(freshUrl('other.jpg', T0)).toBeNull();
  });

  it('reads the path back out of a signed link', () => {
    expect(pathFromSignedUrl(URL_A, 'home-photos')).toBe(PATH);
    expect(pathFromSignedUrl(
      'https://x.supabase.co/storage/v1/object/sign/home-photos/h/docs/Heat%20pump%20manual.pdf?token=z',
      'home-photos',
    )).toBe('h/docs/Heat pump manual.pdf');
  });

  it('reads nothing out of a link that is not ours', () => {
    expect(pathFromSignedUrl('blob:https://app.snaghq.co.nz/123', 'home-photos')).toBeNull();
    expect(pathFromSignedUrl(
      'https://x.supabase.co/storage/v1/object/sign/snag-photos/a.jpg?token=z', 'home-photos',
    )).toBeNull();
    expect(pathFromSignedUrl(
      'https://x.supabase.co/storage/v1/object/sign/home-photos/?token=z', 'home-photos',
    )).toBeNull();
  });
});
