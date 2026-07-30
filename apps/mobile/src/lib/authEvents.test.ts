import { createAuthEventQueue } from './authEvents';

// The property under test is the one whose absence deadlocked the whole client:
// work triggered by an auth event must not run while the callback that
// triggered it is still on the stack, because auth-js is holding its lock and
// awaiting that callback. Everything else here (ordering, error isolation) is
// what awaiting the callback used to give for free.

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createAuthEventQueue', () => {
  it('does not start the work while the callback is still running', async () => {
    const queue = createAuthEventQueue();
    let started = false;

    // Stand-in for the onAuthStateChange callback: it queues and returns.
    const callback = () => {
      queue(async () => { started = true; });
    };
    callback();

    // A microtask is not enough to let the work start — which is the point.
    // auth-js releases the lock as the notifying call unwinds, after this.
    await Promise.resolve();
    expect(started).toBe(false);

    await flush();
    await flush();
    expect(started).toBe(true);
  });

  it('runs work in event order, without interleaving', async () => {
    const queue = createAuthEventQueue();
    const log: string[] = [];

    queue(async () => {
      log.push('first:start');
      await new Promise((r) => setTimeout(r, 20));
      log.push('first:end');
    });
    queue(async () => {
      log.push('second:start');
      log.push('second:end');
    });

    await new Promise((r) => setTimeout(r, 80));
    expect(log).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('keeps going after one piece of work fails', async () => {
    const onError = jest.fn();
    const queue = createAuthEventQueue(onError);
    const ran: string[] = [];

    queue(async () => { throw new Error('profile fetch failed'); });
    queue(async () => { ran.push('next'); });

    await new Promise((r) => setTimeout(r, 60));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'profile fetch failed' }));
    // A swallowed rejection here would mean the next auth event is ignored.
    expect(ran).toEqual(['next']);
  });
});
