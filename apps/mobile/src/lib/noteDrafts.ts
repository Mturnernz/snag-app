import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A note half-typed on a job, kept on this device until it is added.
 *
 * A note is **never sent on blur or on leaving**: it is a message to the other
 * person, and `add_comment` starts the job, so posting what somebody had not
 * finished would say something they did not say and move the job to *Doing*
 * besides. But until this, leaving the page dropped it — the one question
 * CLAUDE.md's job-page review left open. The decision: keep it as a draft on
 * the device, put it back in the box when the job is opened again, and forget
 * it once it is added.
 *
 * **Per device, per job, never per account**, for the list folds' reason: this
 * is where somebody is in their own typing, not a fact about the house. The
 * other person must not open the job and find your unfinished sentence in
 * their box.
 *
 * **Every read and write is guarded**, as `lib/collapsed.ts`'s are: storage can
 * be absent, full or throw (a private window, cleared site data), and failure
 * is always "no draft", which is what there was before.
 */

const PREFIX = 'snag.note-draft.';

/** How long a draft is worth keeping. A sentence left a month is not a draft. */
export const NOTE_DRAFT_DAYS = 30;

type Stored = { text: string; at: number };

export async function readNoteDraft(snagId: string, now: number = Date.now()): Promise<string> {
  const key = PREFIX + snagId;
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(key) ?? null
      : await AsyncStorage.getItem(key);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed?.text !== 'string' || typeof parsed?.at !== 'number') return '';
    if (now - parsed.at > NOTE_DRAFT_DAYS * 86_400_000) {
      await writeNoteDraft(snagId, '');
      return '';
    }
    return parsed.text;
  } catch {
    return '';
  }
}

/** Keeps the draft, or forgets it when it is empty. */
export async function writeNoteDraft(
  snagId: string,
  text: string,
  now: number = Date.now(),
): Promise<void> {
  const key = PREFIX + snagId;
  try {
    if (!text.trim()) {
      if (Platform.OS === 'web') globalThis.localStorage?.removeItem(key);
      else await AsyncStorage.removeItem(key);
      return;
    }
    const raw = JSON.stringify({ text, at: now } satisfies Stored);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, raw);
    else await AsyncStorage.setItem(key, raw);
  } catch {
    // A draft that could not be kept is a draft that is lost on leaving, which
    // is exactly what happened before this existed. Not worth an alert.
  }
}
