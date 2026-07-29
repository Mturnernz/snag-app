import { Platform } from 'react-native';
import { File } from 'expo-file-system';

/**
 * Reads a locally picked file into an ArrayBuffer for a Storage upload.
 *
 * The two platforms hand us different kinds of URI, and each one's reader is
 * broken on the other:
 *
 * - **Native** gives a `file://` path. `fetch(uri).blob()` there produces a
 *   Blob that storage-js can't reliably read, and Storage rejects the request
 *   with a 400 before the bucket's RLS check ever runs — so the file is read
 *   through expo-file-system instead.
 * - **Web** gives a `blob:` URL (expo-image-manipulator's web build saves via
 *   `URL.createObjectURL`), which no filesystem can open. expo-file-system has
 *   no web implementation at all: its `File` is a stub that logs "not
 *   supported on web" and is missing the methods the JS class calls, so
 *   `new File(uri)` throws on construction. `fetch` is the browser's own way
 *   to read a blob URL, and the Blob it returns there is a real one.
 *
 * The app is shipped to the browser as well as to phones (`expo export
 * --platform web`, deployed to Netlify), so both branches are production
 * paths, not one real one and one fallback.
 *
 * Getting this wrong is quiet in a specific way: the read throws before any
 * request is made, so every photo shows "Couldn't upload" and blocks Submit
 * while the Storage logs show nothing at all.
 */
export async function readForUpload(localUri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    const response = await fetch(localUri);
    if (!response.ok) throw new Error(`Couldn't read the picked file (${response.status})`);
    return response.arrayBuffer();
  }
  return new File(localUri).arrayBuffer();
}
