import { PHOTO_PICK_LIMIT, compressAndUpload, photoFileName, pickPhotos } from './photoUpload';
import { showAlert } from './alert';

function failureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message || 'Try again in a moment.';
}

/**
 * Choosing several photographs and getting them into storage, once.
 *
 * Every rule in here was paid for on the thing page and then inherited by
 * `Attachments`; a snag's own strip is the third caller, which is the point at
 * which a copied loop becomes three implementations that drift.
 *
 * - **One write at the end.** Eight photographs must not be eight round trips,
 *   eight re-reads and eight stacked toasts.
 * - **One after another, never in parallel.** Repeated compression is the most
 *   memory-hungry thing this app does, and eight simultaneous uploads is how
 *   the request deadlines start firing.
 * - **What arrived is kept.** Six uploaded with two refused is six added and a
 *   sentence about the two — the same rule the PDF export follows for a
 *   photograph that will not come.
 * - **A cap nobody is told about is indistinguishable from photographs that
 *   failed**, so anything past `PHOTO_PICK_LIMIT` is said out loud.
 *
 * The caller owns the write: each level has its own RPC, and a helper that
 * could write would be a second place a snag's or a thing's photos are set.
 */
export async function addPhotos(
  pathPrefix: string,
  save: (paths: string[]) => Promise<void>
): Promise<void> {
  const { uris, dropped } = await pickPhotos();
  if (uris.length === 0) return;

  const added: string[] = [];
  let lastError: unknown = null;

  for (const uri of uris) {
    try {
      const { path, error } = await compressAndUpload(uri, photoFileName(pathPrefix));
      if (error || !path) throw error ?? new Error('The photo did not upload');
      added.push(path);
    } catch (err: unknown) {
      lastError = err;
    }
  }

  if (added.length > 0) {
    try {
      await save(added);
    } catch (err: unknown) {
      lastError = err;
      // The write is what makes an upload count. Say so rather than reporting
      // the photographs as added, which is the one lie a strip cannot recover
      // from — the bytes are in the bucket and nothing points at them.
      showAlert("Couldn't save those photos", failureReason(err));
      return;
    }
  }

  const missed = uris.length - added.length;
  if (missed > 0) {
    showAlert(
      added.length > 0 ? `${missed} of ${uris.length} didn't save` : "That photo didn't save",
      failureReason(lastError)
    );
  } else if (dropped > 0) {
    showAlert(
      `${PHOTO_PICK_LIMIT} at a time`,
      `${added.length} added. Choose the other ${dropped} in another go.`
    );
  }
}
