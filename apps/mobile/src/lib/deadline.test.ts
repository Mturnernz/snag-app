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
    [new Error('new row violates row-level security policy'), 'new row violates row-level security policy'],
    [new Error(''), 'unknown error'],
  ])('describes %p as "%s"', (err, expected) => {
    expect(failureReason(err)).toBe(expected);
  });

  it('truncates a long message rather than filling the screen with it', () => {
    const reason = failureReason(new Error('x'.repeat(200)));
    expect(reason).toHaveLength(58);
    expect(reason.endsWith('…')).toBe(true);
  });
});
