import { withDeadline, failureReason, DeadlineError } from './deadline';

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
