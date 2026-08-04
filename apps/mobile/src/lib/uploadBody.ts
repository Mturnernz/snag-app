import { Platform } from 'react-native';
import { File } from 'expo-file-system';

/**
 * Reads a locally picked file into something Storage can upload.
 *
 * The two platforms hand us different kinds of URI and need different readers,
 * and storage-js then sends the two results down different paths — which is the
 * point, because each platform's working path is the other's broken one:
 *
 * - **Native** gives a `file://` path, read as an **ArrayBuffer**. A Blob from
 *   `fetch(uri).blob()` there is one storage-js can't reliably read, and the API
 *   rejects it with a 400 before the bucket's RLS check ever runs.
 * - **Web** gives a `blob:` URL (expo-image-manipulator's web build saves via
 *   `URL.createObjectURL`), read back with `fetch` as a **Blob** — no filesystem
 *   can open it, and expo-file-system has no web implementation anyway. Handing
 *   storage-js a Blob puts the upload on `multipart/form-data`, which is the
 *   path every browser upload takes; an ArrayBuffer instead becomes a raw binary
 *   POST body, which is the unusual path and the one that was stalling.
 *
 * The app is shipped to the browser as well as to phones (`expo export
 * --platform web`, deployed to Netlify), so both branches are production paths.
 */
export async function readForUpload(
  localUri: string,
  mimeType?: string | null,
): Promise<ArrayBuffer | Blob> {
  if (Platform.OS === 'web') {
    // Say which half failed. This fetch is the one thing between a picked file
    // and the upload, and when it throws it throws the same opaque TypeError a
    // dead network does — so the failure arrived on screen as "no connection",
    // on a phone with full signal, with nothing in the Storage logs to correct
    // it. The deployed CSP has to allow blob: in *connect-src* for this line to
    // work at all (see netlify.toml); naming the stage is what stops the next
    // reason it can't read the file from being read as a network problem.
    let response: Response;
    try {
      response = await fetch(localUri);
    } catch {
      throw new Error("couldn't read the photo on this device");
    }
    if (!response.ok) throw new Error(`Couldn't read the picked file (${response.status})`);
    const blob = await response.blob();
    // Multipart carries the Blob's own type, not storage-js's contentType
    // option, so a blob that lost its type would be stored as
    // application/octet-stream and download as a file nobody can open.
    if (mimeType && blob.type !== mimeType) return new Blob([blob], { type: mimeType });
    return blob;
  }
  return new File(localUri).arrayBuffer();
}
