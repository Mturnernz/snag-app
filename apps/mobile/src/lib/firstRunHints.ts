import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * One-time explanations, shown at the moment the thing they explain first
 * matters rather than all together at first launch.
 *
 * The onboarding carousel runs once, before any of it means anything: it
 * describes the lane split to somebody who has not yet filed a snag, and the
 * Manager tab to somebody who is not one. Two moments carry genuinely new
 * concepts later, and neither was explained when it arrived —
 *
 * - the first serious-incident report, which starts an investigation with
 *   obligations attached;
 * - the first visit to the Manager tab, which simply appears one day when
 *   somebody is promoted. That happened to the account this came from: a
 *   worker became a Site Lead and gained a whole tab with no explanation.
 *
 * Keyed per user, like every other preference here, so a shared device does
 * not mark one person's hint as read for the next. Same guard as `lastSeen`:
 * nothing is written before the user id resolves.
 */

export type HintKey = 'seriousReport' | 'managerTab';

const HINT_STORAGE_PREFIX = 'snag.hintSeen.';

const keyFor = (hint: HintKey, userId: string) => `${HINT_STORAGE_PREFIX}${hint}.${userId}`;

/**
 * Whether this hint still needs showing. Unknown user means "don't show":
 * a hint is a one-time thing and burning it on a session we can't attribute
 * would spend it on nobody.
 */
export async function shouldShowHint(hint: HintKey, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return (await AsyncStorage.getItem(keyFor(hint, userId))) === null;
}

export async function markHintSeen(hint: HintKey, userId: string | null): Promise<void> {
  if (!userId) return;
  await AsyncStorage.setItem(keyFor(hint, userId), new Date().toISOString());
}
