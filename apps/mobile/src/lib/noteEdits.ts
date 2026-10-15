import { TOAST_ACTION_MS } from '../hooks/useToast';
import { deleteComment } from './supabase';

/**
 * Taking a note back, with a way back (October 2026).
 *
 * A note is deleted **after** the toast's *Undo* has had its chance, not
 * before: putting a deleted note back would mean writing it again, which gives
 * it a new time and — through `add_comment` — starts the job, both of which
 * would be the app rewriting what happened. So the page hides it at once and
 * the delete waits `NOTE_UNDO_MS`, a second longer than the toast offers
 * *Undo* (`TOAST_ACTION_MS`), so the button never outlives the note. The timer
 * lives here rather than in the screen, so leaving the page does not cancel
 * it; an app closed inside those seconds keeps the note, which is the safe
 * way for that to fail.
 */
export const NOTE_UNDO_MS = TOAST_ACTION_MS + 1000;

const waiting = new Map<string, ReturnType<typeof setTimeout>>();

/** Deletes the note once Undo can no longer want it. Resolves false if the delete was refused. */
export function deleteNoteLater(commentId: string): Promise<boolean> {
  keepNote(commentId);
  return new Promise((resolve) => {
    waiting.set(commentId, setTimeout(() => {
      waiting.delete(commentId);
      deleteComment(commentId).then(() => resolve(true), () => resolve(false));
    }, NOTE_UNDO_MS));
  });
}

/** Calls the delete off, because *Undo* was pressed. Synchronous, so it wins any race with the timer. */
export function keepNote(commentId: string): void {
  const timer = waiting.get(commentId);
  if (timer === undefined) return;
  clearTimeout(timer);
  waiting.delete(commentId);
}
