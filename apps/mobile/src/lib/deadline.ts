/**
 * Rejects if `promise` hasn't settled within `ms`.
 *
 * Used as a backstop, not as the primary timeout: individual requests already
 * carry their own deadline (see `fetchWithTimeout` in lib/supabase.ts). This
 * bounds the *whole* of a multi-step job, so a stage with no deadline of its own
 * — a native module that never calls back, a decode that never finishes — can't
 * leave the UI waiting forever.
 *
 * A spinner with no deadline is not a neutral default. It shows the user their
 * work is in progress when nothing is happening, offers them no way back, and
 * reports nothing to anyone: no error, no log line, no failed request. Every
 * indefinite spinner in this app has turned out to be a bug of exactly that
 * shape.
 */
export class DeadlineError extends Error {
  readonly label: string;

  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'DeadlineError';
    this.label = label;
  }
}

export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** True only where the platform actually answers the question — web. */
function isDefinitelyOnline(): boolean {
  return (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine === true;
}

/**
 * A short, plain-English reason for a failure, for showing next to the thing
 * that failed. The alternative — a generic "something went wrong" — is what
 * makes a failure take a screenshot and a round trip to diagnose.
 *
 * The three ways an upload can stall are deliberately worded apart, because
 * they point at completely different causes and a screenshot is often all the
 * evidence there is:
 *
 * - `preparing timed out` — a local stage never finished. Nothing was sent.
 * - `sending timed out` — the whole send overran its backstop.
 * - `no reply from the server` — the request went out and nothing came back,
 *   which is what an aborted `fetch` means (see fetchWithTimeout).
 * - `no connection` / `blocked before it was sent` — the request never went at
 *   all. Which of the two we say is the most the browser lets us tell apart.
 */
export function failureReason(err: unknown): string {
  if (err instanceof DeadlineError) return `${err.label.toLowerCase()} timed out`;
  const message = typeof err === 'string' ? err : (err as { message?: string })?.message ?? '';
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'AbortError' || /aborted/i.test(message)) return 'no reply from the server';
  // What fetch throws when the request never left the device: no connectivity,
  // DNS, a blocked CORS preflight — and, on the web build, the page's own CSP
  // refusing it. Indistinguishable from each other by design, so "no
  // connection" is a guess at which one, and it was the wrong guess for a whole
  // day of uploads: connect-src was missing blob:, and every failure read as
  // the user's signal rather than our header.
  //
  // navigator.onLine is a weak signal — true only means there is an interface,
  // not that anything is reachable — so it is used the one way it is sound: to
  // withhold the strongest claim, never to make one. Undefined (native, where
  // there is no CSP and a TypeError really is the network) keeps the old
  // wording exactly.
  if (name === 'TypeError' || /failed to fetch|network request failed|load failed/i.test(message)) {
    return isDefinitelyOnline() ? 'blocked before it was sent' : 'no connection';
  }
  if (!message) return 'unknown error';
  return message.length > 60 ? `${message.slice(0, 57)}…` : message;
}

/**
 * How long a request gets, from what is on the other end of it.
 *
 * Lives here rather than inside `fetchWithTimeout` so it can be asserted:
 * `lib/supabase.ts` builds the Supabase client at module scope and wants
 * environment variables to do it, so nothing in the suite imports it for real.
 * The rule is small, it is easy to get subtly wrong, and being wrong is
 * invisible until somebody is watching a spinner.
 *
 * Three answers, and the middle one is the correction:
 *
 * - **Auth** is small and quick, and a stalled token refresh poisons every
 *   later call, so it gets the shortest leash.
 * - **Signing** is a small JSON round trip that every photo strip and every
 *   `Attachments` makes on mount. Its URL is under `/storage/v1/`, so it used
 *   to inherit the upload deadline and a stalled one hung a strip for a full
 *   minute — four times what anything else in the app can impose, and the
 *   opposite of what that number exists for.
 * - **Bytes** are slow rather than broken on a bad connection, and cutting an
 *   upload off at 20s would invent a failure that was not there.
 * - **Reading a label** is a model looking at a photograph, which takes
 *   seconds rather than milliseconds even when nothing is wrong. It is never
 *   waited on — the walkthrough carries on underneath it — so a longer leash
 *   costs nobody a spinner, and a 20s one would call a slow answer a failure.
 */
export const AUTH_TIMEOUT_MS = 15_000;
export const REQUEST_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 60_000;
export const LABEL_TIMEOUT_MS = 45_000;

export function deadlineFor(url: string): number {
  if (url.includes('/auth/v1/')) return AUTH_TIMEOUT_MS;
  if (url.includes('/functions/v1/read-label')) return LABEL_TIMEOUT_MS;
  // Asking for a signed URL, not sending or fetching the bytes behind one.
  if (url.includes('/storage/v1/object/sign')) return REQUEST_TIMEOUT_MS;
  if (url.includes('/storage/v1/')) return UPLOAD_TIMEOUT_MS;
  return REQUEST_TIMEOUT_MS;
}
