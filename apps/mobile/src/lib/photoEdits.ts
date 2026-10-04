import { deleteStoredFiles } from './supabase';

/**
 * Taking a photo off a job or a thing, with a way back.
 *
 * The row is written at once, so the photo is gone for everyone in the house
 * the next time their page reads it. The **file** is not: it stays in the
 * bucket for `PHOTO_UNDO_MS`, so *Undo* on the toast can put the path back and
 * find the picture still there. After that it is deleted, which is what stops
 * the orphan a removed photo used to leave behind.
 *
 * The wait is longer than the toast offers *Undo* (`TOAST_ACTION_MS`, pinned by
 * `photoEdits.test.ts`), so the button never outlives the file. It is a timer
 * in this module rather than in a screen, so leaving the page does not cancel
 * it. The one gap is the app being closed inside those seconds: the timer never
 * fires and the file stays in the bucket with nothing pointing at it — some
 * bytes, never a photo somebody wanted.
 */
export const PHOTO_UNDO_MS = 10_000;

const waiting = new Map<string, ReturnType<typeof setTimeout>>();

/** Deletes the file once Undo can no longer want it. Never throws — see deleteStoredFiles. */
export function deleteFileLater(path: string): void {
  keepFile(path);
  waiting.set(path, setTimeout(() => {
    waiting.delete(path);
    void deleteStoredFiles([path]);
  }, PHOTO_UNDO_MS));
}

/** Calls off a delete, because *Undo* was pressed. Synchronous, so it wins any race with the timer. */
export function keepFile(path: string): void {
  const timer = waiting.get(path);
  if (timer === undefined) return;
  clearTimeout(timer);
  waiting.delete(path);
}

/** The strip with one photo taken out. */
export function withoutPhoto(paths: string[], path: string): string[] {
  return paths.filter((p) => p !== path);
}

/**
 * The strip with a photo put back where it was. Clamped, because the other
 * phone may have taken one off since; and a photo already there is not added
 * twice.
 */
export function withPhotoBack(paths: string[], path: string, index: number): string[] {
  if (paths.includes(path)) return paths;
  const at = Math.max(0, Math.min(index, paths.length));
  return [...paths.slice(0, at), path, ...paths.slice(at)];
}
