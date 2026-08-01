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
 */
export function failureReason(err: unknown): string {
  if (err instanceof DeadlineError) return `${err.label.toLowerCase()} timed out`;
  const message = typeof err === 'string' ? err : (err as { message?: string })?.message ?? '';
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'AbortError' || /aborted/i.test(message)) return 'no reply from the server';
  // What fetch throws when the request never left the device: no connectivity,
  // DNS, a blocked CORS preflight. Indistinguishable from each other by design.
  if (name === 'TypeError' || /failed to fetch|network request failed|load failed/i.test(message)) {
    return 'no connection';
  }
  if (!message) return 'unknown error';
  return message.length > 60 ? `${message.slice(0, 57)}…` : message;
}
