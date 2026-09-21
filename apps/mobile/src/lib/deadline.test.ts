import {
  withDeadline, failureReason, DeadlineError,
  deadlineFor, AUTH_TIMEOUT_MS, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS,
} from './deadline';

// The point of this helper is that no job can end in "still going" forever. The
// cases worth pinning are the ones that have actually shipped: a stage that
// never settles, and a failure whose reason the user never sees.

describe('withDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes a value through untouched when it settles in time', async () => {
    const result = withDeadline(Promise.resolve('done'), 1000, 'The upload');
    await expect(result).resolves.toBe('done');
  });

  it('passes a rejection through, rather than turning it into a timeout', async () => {
    const boom = new Error('403: not allowed');
    const result = withDeadline(Promise.reject(boom), 1000, 'The upload');
    await expect(result).rejects.toBe(boom);
  });

  it('rejects a promise that never settles', async () => {
    const result = withDeadline(new Promise(() => {}), 65_000, 'Sending');
    const assertion = expect(result).rejects.toThrow(/Sending timed out after 65s/);
    jest.advanceTimersByTime(65_000);
    await assertion;
  });

  it('clears its timer, so a settled job leaves nothing pending', async () => {
    await withDeadline(Promise.resolve(1), 1000, 'x');
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('failureReason', () => {
  it.each([
    // The three stalls are worded apart on purpose: nothing sent, send
    // overran, or sent-and-no-answer. They point at different causes.
    [new DeadlineError('Preparing', 30_000), 'preparing timed out'],
    [new DeadlineError('Sending', 65_000), 'sending timed out'],
    [Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' }), 'no reply from the server'],
    [new TypeError('Failed to fetch'), 'no connection'],
    [new Error('Network request failed'), 'no connection'],
    [new Error("couldn't read the photo on this device"), "couldn't read the photo on this device"],
    [new Error('new row violates row-level security policy'), 'new row violates row-level security policy'],
    [new Error(''), 'unknown error'],
  ])('describes %p as "%s"', (err, expected) => {
    expect(failureReason(err)).toBe(expected);
  });

  // The blanket "no connection" is a guess at which of several identical-looking
  // failures happened, and on the web build it was the wrong one: a CSP missing
  // blob: in connect-src throws the same TypeError, so a header of ours was
  // reported as the user's signal. Where the platform can say we are online,
  // stop making the claim.
  describe('when a TypeError could be the page blocking its own request', () => {
    const setOnLine = (value: boolean | undefined) => {
      if (value === undefined) delete (globalThis as { navigator?: unknown }).navigator;
      else (globalThis as { navigator?: unknown }).navigator = { onLine: value };
    };
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    afterEach(() => {
      delete (globalThis as { navigator?: unknown }).navigator;
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    });

    it('does not blame the connection when the browser says there is one', () => {
      setOnLine(true);
      expect(failureReason(new TypeError('Failed to fetch'))).toBe('blocked before it was sent');
    });

    it('still says no connection when the browser says there is none', () => {
      setOnLine(false);
      expect(failureReason(new TypeError('Failed to fetch'))).toBe('no connection');
    });

    it('keeps the old wording where nothing answers — native, which has no CSP', () => {
      setOnLine(undefined);
      expect(failureReason(new Error('Network request failed'))).toBe('no connection');
    });
  });

  it('truncates a long message rather than filling the screen with it', () => {
    const reason = failureReason(new Error('x'.repeat(200)));
    expect(reason).toHaveLength(58);
    expect(reason.endsWith('…')).toBe(true);
  });
});

/**
 * How long each kind of request gets.
 *
 * The signing case is the one that was wrong, and it was invisible: a signed
 * URL is asked for by every photo strip and every `Attachments` on mount, its
 * path is under `/storage/v1/`, and it therefore took the 60-second upload
 * deadline. Nothing failed — a stalled strip simply sat there for a minute.
 */
describe('deadlineFor', () => {
  const REST = 'https://p.supabase.co/rest/v1/snags_with_details?select=*';
  const AUTH = 'https://p.supabase.co/auth/v1/token?grant_type=refresh_token';
  const SIGN = 'https://p.supabase.co/storage/v1/object/sign/home-photos';
  const UPLOAD = 'https://p.supabase.co/storage/v1/object/home-photos/h/1.jpg';

  it('gives a stalled token refresh the shortest leash', () => {
    // It poisons every later call: supabase-js resolves a token before each
    // request, so one that never settles means nothing is ever issued again.
    expect(deadlineFor(AUTH)).toBe(AUTH_TIMEOUT_MS);
    expect(deadlineFor(AUTH)).toBeLessThan(deadlineFor(REST));
  });

  it('treats asking for a signed URL as the data call it is', () => {
    expect(deadlineFor(SIGN)).toBe(REQUEST_TIMEOUT_MS);
    // The regression, stated as the thing that must not come back.
    expect(deadlineFor(SIGN)).not.toBe(UPLOAD_TIMEOUT_MS);
  });

  it('still lets the bytes themselves take their time', () => {
    // An upload on a bad connection is slow rather than broken, and cutting it
    // off at the data deadline would invent a failure that was not there.
    expect(deadlineFor(UPLOAD)).toBe(UPLOAD_TIMEOUT_MS);
  });

  it('gives an ordinary read the data deadline', () => {
    expect(deadlineFor(REST)).toBe(REQUEST_TIMEOUT_MS);
  });
});
