import { createAuthEventQueue, planAuthEvent } from './authEvents';

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

// The rule that keeps a returning tab from looking like a login.
//
// auth-js re-announces SIGNED_IN for a session nobody left, every time a hidden
// tab becomes visible. App.tsx used to treat that as a fresh sign-in: it reset
// the address bar to `/` and set `loading`, which unmounts the navigator and
// every open sheet. Coming back from the camera on step three of the House
// walkthrough therefore landed on the list with the photo gone — it lived in
// component state, because nothing is written until the last step.
const ME = 'user-1';
const SOMEONE_ELSE = 'user-2';

describe('planAuthEvent', () => {
  it('does nothing when SIGNED_IN announces the session we already hold', () => {
    // The camera case. If this ever reloads again, the photo is lost again.
    expect(planAuthEvent('SIGNED_IN', ME, ME)).toEqual({
      clearAccount: false,
      reloadAccount: false,
      resetPath: false,
    });
  });

  it('reloads and clears the path when somebody actually signs in', () => {
    expect(planAuthEvent('SIGNED_IN', null, ME)).toEqual({
      clearAccount: false,
      reloadAccount: true,
      resetPath: true,
    });
  });

  it('reloads and clears the path when the account switches', () => {
    expect(planAuthEvent('SIGNED_IN', ME, SOMEONE_ELSE)).toEqual({
      clearAccount: false,
      reloadAccount: true,
      resetPath: true,
    });
  });

  it('clears the account and the path on SIGNED_OUT', () => {
    expect(planAuthEvent('SIGNED_OUT', ME, null)).toEqual({
      clearAccount: true,
      reloadAccount: false,
      resetPath: true,
    });
  });

  it('treats a missing session as a sign-out whatever the event says', () => {
    expect(planAuthEvent('TOKEN_REFRESHED', ME, null).clearAccount).toBe(true);
  });

  it('loads on the first INITIAL_SESSION but leaves the address bar alone', () => {
    // Reloading a tab is not logging in, and a /snags/<id> somebody followed
    // has to survive the round trip.
    expect(planAuthEvent('INITIAL_SESSION', null, ME)).toEqual({
      clearAccount: false,
      reloadAccount: true,
      resetPath: false,
    });
  });

  it('ignores the INITIAL_SESSION that follows getSession claiming the user', () => {
    expect(planAuthEvent('INITIAL_SESSION', ME, ME).reloadAccount).toBe(false);
  });

  it('is inert for a token refresh and a profile update', () => {
    for (const event of ['TOKEN_REFRESHED', 'USER_UPDATED']) {
      expect(planAuthEvent(event, ME, ME)).toEqual({
        clearAccount: false,
        reloadAccount: false,
        resetPath: false,
      });
    }
  });
});
