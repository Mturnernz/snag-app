import { Platform } from 'react-native';

/**
 * Handing the person a file.
 *
 * **Web is the real path**, because the web export is what people install. A
 * Blob, an object URL, an anchor carrying `download`, one synthetic click, and
 * the URL revoked afterwards — leaving it alive pins the whole file in memory
 * for the life of the tab, and an extract of a house is not small.
 *
 * Things checked against the deployed CSP rather than assumed, since nothing
 * local enforces it (`netlify.toml`, and see lib/csp.test.ts):
 *
 * - A download is a *navigation*, not a fetch, so `connect-src` does not govern
 *   it. `blob:` is on `connect-src` anyway for the upload path.
 * - `object-src 'none'` governs `<object>`/`<embed>`, not `<a download>`.
 * - Nothing is fetched at export time. Both renderers are bundled, which they
 *   have to be: `default-src 'self'` allows no CDN, and `"output": "single"`
 *   in app.json means there are no lazy chunks to fetch either.
 *
 * On native there is no DOM. `expo-file-system` can write the bytes, and the
 * honest limit is that presenting a share sheet afterwards needs
 * `expo-sharing`, which this app does not carry — so native writes the file and
 * says where it went rather than pretending to have handed it over.
 */
export interface SavedFile {
  /** Where it went, for native. Null on web, where the browser decides. */
  path: string | null;
}

export async function saveFile(
  fileName: string,
  contents: string | Uint8Array,
  mimeType: string,
): Promise<SavedFile> {
  if (Platform.OS === 'web') {
    const blob = new Blob([contents as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      // Safari ignores a click on an anchor that isn't in the document.
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Not immediate: Safari starts the download asynchronously and revoking
      // in the same tick cancels it. A tick of leak beats a download that
      // silently never happens.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return { path: null };
  }

  // Native. Imported here rather than at module scope because
  // `expo-file-system` has no web implementation and its stub throws — a
  // top-level import would take the web build down on load. See TESTING.md.
  const FileSystem = require('expo-file-system');
  const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  const path = `${directory}${fileName}`;
  const isText = typeof contents === 'string';
  await FileSystem.writeAsStringAsync(
    path,
    isText ? (contents as string) : bytesToBase64(contents as Uint8Array),
    isText ? undefined : { encoding: FileSystem.EncodingType.Base64 },
  );
  return { path };
}

/** Chunked so a big extract can't blow the argument limit on String.fromCharCode. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}
