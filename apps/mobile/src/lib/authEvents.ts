/**
 * Runs the work an auth event triggers *outside* the auth lock.
 *
 * `onAuthStateChange` callbacks are invoked by auth-js from inside its lock, and
 * it **awaits them**. Any Supabase call needs that same lock, so a callback that
 * awaits one deadlocks the client permanently:
 *
 * ```
 * _acquireLock(fn)                  // lock held
 *   fn = _recoverAndRefresh()
 *     _notifyAllSubscribers('SIGNED_IN')
 *       await ourCallback()         // waits for the query below…
 *         supabase.from(...)        // …which needs the lock…
 *           getSession()
 *             _acquireLock()        // …so it queues behind fn. Circular wait.
 * ```
 *
 * Nothing rejects and nothing is logged. Every later request waits on the same
 * lock, so the client stops issuing requests at all for the life of the page —
 * and because it never gets as far as `fetch`, the per-request deadlines never
 * fire either. All the user sees is a button that does nothing.
 *
 * The trigger in production is mundane: `_onVisibilityChanged` calls
 * `_recoverAndRefresh` when a hidden tab becomes visible, and a session that is
 * valid and not near expiry is announced as `SIGNED_IN` from inside the lock.
 * That is exactly what happens when someone leaves the browser to pick a photo
 * from their gallery and comes back. (`INITIAL_SESSION` is safe: auth-js
 * deliberately defers those notifications for this very reason. A near-expiry
 * session is safe too, because it takes the refresh path and announces
 * `TOKEN_REFRESHED`, which this app ignores. Hence a bug that comes and goes.)
 *
 * So the rule is: **an onAuthStateChange callback must be synchronous.** It may
 * set state; anything that touches Supabase goes through here.
 *
 * The queue also serialises, so two events in quick succession can't interleave
 * their loads — awaiting the callback used to give that ordering for free.
 */
export function createAuthEventQueue(onError?: (err: unknown) => void) {
  let tail: Promise<void> = Promise.resolve();

  return function queueAuthWork(work: () => Promise<void>): void {
    tail = tail
      // A macrotask, not a microtask: the lock is released as the notifying
      // call unwinds, and this has to run after that.
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
      .then(work)
      .catch((err) => {
        // One failed load must not stop the queue, or the next auth event is
        // silently ignored.
        (onError ?? ((e: unknown) => console.error('Auth event handling failed:', e)))(err);
      });
  };
}
