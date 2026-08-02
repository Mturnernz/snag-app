import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * When this user last left the snag list — the timestamp the "NEW" badge is
 * measured against. See snagFreshness.ts for what is done with it.
 *
 * Two rules, both of which the screen got wrong in an earlier draft and which
 * live here so they can be tested without rendering it:
 *
 * - **Marked on the way out, not the way in.** Stamping it on focus would
 *   clear every badge before the reader had looked at one of them; the badge
 *   would only ever be visible to somebody who wasn't there.
 * - **Nothing is written before the user id resolves.** Same guard the filter
 *   preferences use: on a shared device an unguarded write puts one person's
 *   visit under whoever is signed in next.
 */

const LAST_SEEN_STORAGE_PREFIX = 'snag.lastSeenAt.';

const keyFor = (userId: string) => LAST_SEEN_STORAGE_PREFIX + userId;

export async function readLastSeen(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  return AsyncStorage.getItem(keyFor(userId));
}

/** Records "the reader has now seen this list". `now` is injectable for tests. */
export async function markSeen(userId: string | null, now: Date = new Date()): Promise<void> {
  if (!userId) return;
  await AsyncStorage.setItem(keyFor(userId), now.toISOString());
}
