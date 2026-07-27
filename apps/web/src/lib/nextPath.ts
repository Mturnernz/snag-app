/**
 * Validates a post-login return path.
 *
 * `?next=` is an open-redirect waiting to happen: anything that reaches
 * `redirect()` unchecked lets a link on our domain bounce someone to an
 * attacker's, which is exactly the trick a phishing mail wants. So this
 * accepts only a same-origin *path* and rejects everything else, rather than
 * trying to sanitise a URL.
 *
 * Rejected, specifically:
 *   - absolute URLs (`https://evil.example`), including our own origin — a
 *     path is all a redirect here ever needs
 *   - protocol-relative (`//evil.example`), which browsers treat as absolute
 *   - backslash variants (`/\evil.example`), which some parsers normalise to
 *     the protocol-relative form
 *   - anything not starting with `/`
 */
export function safeNextPath(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!value.startsWith('/')) return null;
  // A second leading slash or backslash makes it protocol-relative.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  // Control characters can be used to smuggle a newline past a naive check.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}
