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

/**
 * What an auth event should actually make the app do.
 *
 * `onAuthStateChange` does not only fire when somebody signs in. auth-js calls
 * `_recoverAndRefresh` whenever a hidden tab becomes visible, and a session that
 * is still valid is re-announced as **`SIGNED_IN`** — the same event, for the
 * same person, who never left. See the note above `createAuthEventQueue`: that
 * is precisely what happens when someone opens the camera and comes back.
 *
 * Treating that as a login is what lost people their photos. `App.tsx` gates the
 * whole tree behind `loading`, so a reload unmounts `NavigationContainer`,
 * `HouseholdProvider` and whatever sheet was open; `resetWebPathIfStale` puts
 * the address bar back to `/`, which `linking.ts` deliberately leaves unmapped;
 * and the remounted navigator therefore falls through to `initialRouteName`.
 * Step three of the walkthrough went in, the list came back out, and the photo —
 * held in component state because nothing is written until the last step — went
 * with it.
 *
 * So the rule is narrow and the whole fix: **an auth event is a sign-in only if
 * the user changed.** Anything else announcing the session we already hold —
 * a returning tab, a token refresh, a profile update — must change nothing on
 * screen.
 *
 * `INITIAL_SESSION` reloads (it is the first we hear of anyone) but never
 * touches the path: reloading a tab is not logging in, and a `/snags/<id>`
 * someone followed has to survive it.
 *
 * Pure, and exported for the test — `App.tsx` sits outside jest's `testMatch`,
 * so a decision left inline there cannot be pinned at all.
 */
export type AuthEventPlan = {
  /** Signed out: drop the profile and household. */
  clearAccount: boolean;
  /** Refetch profile and household behind the loading gate. Unmounts the tree. */
  reloadAccount: boolean;
  /** Put the address bar back to `/`, unless the URL is one somebody meant. */
  resetPath: boolean;
};

export function planAuthEvent(
  event: string,
  prevUserId: string | null,
  nextUserId: string | null,
): AuthEventPlan {
  // No session left, however it was phrased.
  if (event === 'SIGNED_OUT' || !nextUserId) {
    return { clearAccount: true, reloadAccount: false, resetPath: true };
  }

  // The session we already hold, re-announced. The tab came back; leave it be.
  if (prevUserId === nextUserId) {
    return { clearAccount: false, reloadAccount: false, resetPath: false };
  }

  // Somebody new — either the first we've heard of them, or an account switch.
  return {
    clearAccount: false,
    reloadAccount: true,
    resetPath: event !== 'INITIAL_SESSION',
  };
}
