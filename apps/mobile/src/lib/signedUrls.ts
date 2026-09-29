/**
 * Signed links to the bucket, remembered until they are too close to expiring.
 *
 * A photo in this app is a signed URL that lasts an hour. Every screen used to
 * sign its photos once when it loaded and keep the links for as long as the
 * screen lived, and nothing reloaded a screen when the app came back from the
 * background. So an app opened at breakfast and looked at again after lunch
 * asked for links that had expired, and the photos came back as blank tiles.
 * The logs showed it the day before launch: six links signed at 04:32, expired
 * at 05:32, and asked for at 05:34 from a phone.
 *
 * Two rules here, and they are the fix:
 *
 * - **A link is handed out only while it has at least `REFRESH_MARGIN_MS` of
 *   life left.** Anything closer to its expiry is signed again. So a link a
 *   screen receives is good for a quarter of an hour at the very least, which
 *   is longer than any screen here keeps one without a reload.
 * - **A link still inside that window is handed out again, unchanged.** Every
 *   tab switch reloads its screen, and signing afresh each time gave every
 *   thumbnail a new URL — so the browser downloaded every photo on the list
 *   again on every switch, because a new URL is a cache miss. Reusing the link
 *   lets the browser's own cache do its job.
 *
 * Pure, with the clock passed in, so the rules can be asserted without a
 * network. `lib/supabase.ts` does the signing and consults this.
 */

/** How long a link is signed for. The bucket is private; an hour is plenty. */
export const SIGNED_URL_SECONDS = 60 * 60;

/** A link with less life left than this is signed again rather than reused. */
export const REFRESH_MARGIN_MS = 15 * 60_000;

type Entry = { url: string; expiresAt: number };

const cache = new Map<string, Entry>();

/** The remembered link for a path, if it has enough life left to hand out. */
export function freshUrl(path: string, now: number = Date.now()): string | null {
  const entry = cache.get(path);
  if (!entry) return null;
  if (entry.expiresAt - now < REFRESH_MARGIN_MS) {
    cache.delete(path);
    return null;
  }
  return entry.url;
}

/** Remember a link just signed, from the moment it was asked for. */
export function rememberUrl(path: string, url: string, signedAt: number = Date.now()): void {
  cache.set(path, { url, expiresAt: signedAt + SIGNED_URL_SECONDS * 1000 });
}

/** Forget one path's link — it failed to load, so it is not to be trusted. */
export function forgetUrl(path: string): void {
  cache.delete(path);
}

/** Forget everything. On signing out: the next person's files are not these. */
export function clearSignedUrls(): void {
  cache.clear();
}

/**
 * The storage path a signed URL points at, or null if it is not one of ours.
 *
 * A signed URL reads `…/storage/v1/object/sign/<bucket>/<path>?token=…`. Reading
 * the path back out of it means an image that failed to load can ask for a new
 * link with nothing but the link it already had — so the retry does not need
 * every screen to thread the path through to every `<Image>`.
 */
export function pathFromSignedUrl(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/sign/${bucket}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const rest = url.slice(at + marker.length).split(/[?#]/)[0];
  if (!rest) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}
