/**
 * What an error report is allowed to carry, decided before it leaves the phone.
 *
 * Sentry is told when the app hits an error, and the privacy statement makes
 * a promise about it: *links, email addresses and anything you typed are
 * removed first*. This file is that promise. It is pure, with no SDK import,
 * so jest can hold it to that without a network or a DSN. `monitoring.web.ts`
 * hands every event and breadcrumb through it.
 *
 * Three things in this app are secrets that happen to live in a URL, and each
 * would otherwise ride along in the first report that mentions the address:
 *
 *   * `/join/<token>`: a live invitation into somebody's household.
 *   * `?token=…` on a signed storage URL: the photograph itself, for as long
 *     as the signature lives.
 *   * `#access_token=…`: a recovery link's session, in the fragment.
 *
 * So every URL is cut back to its origin and path, and the join token is
 * masked in the path. Email addresses are masked wherever they appear. The
 * request body, cookies, headers and the user field are dropped outright.
 * Snag's own ids (a job's uuid in `/snags/<id>`) are left, because they
 * identify a row rather than a person and are what makes a report
 * findable.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JOIN_TOKEN = /\/join\/[^/?#\s]+/gi;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)]+/gi;
/** Breadcrumb data keys that hold an address, absolute or relative. */
const URL_KEYS = new Set(['url', 'from', 'to']);

/** An address cut back to origin and path, with a join token masked. */
export function scrubUrl(url: string): string {
  const cut = url.split(/[?#]/, 1)[0];
  return cut.replace(JOIN_TOKEN, '/join/[token]');
}

/** Free text (an error message, a breadcrumb) with its URLs and emails masked. */
export function scrubText(text: string): string {
  return text
    .replace(URL_IN_TEXT, (url) => scrubUrl(url))
    .replace(JOIN_TOKEN, '/join/[token]')
    .replace(EMAIL, '[email]');
}

// Only the shapes this touches. Sentry's own types are wider and change
// between majors, and this file must not depend on them.
interface ScrubbableException {
  value?: string;
}
interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}
interface ScrubbableEvent {
  message?: string;
  transaction?: string;
  user?: unknown;
  request?: {
    url?: string;
    data?: unknown;
    query_string?: unknown;
    cookies?: unknown;
    headers?: unknown;
  };
  exception?: { values?: ScrubbableException[] };
  breadcrumbs?: ScrubbableBreadcrumb[];
}

/**
 * A breadcrumb, or null to drop it.
 *
 * Console breadcrumbs are dropped whole: `console.log(x)` puts whatever `x`
 * was into the report, and nothing here can know what that was. Navigation
 * and fetch breadcrumbs keep their shape with their URLs cut back.
 */
export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(crumb: T): T | null {
  if (crumb.category === 'console') return null;
  const next = { ...crumb };
  if (typeof next.message === 'string') next.message = scrubText(next.message);
  if (next.data) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next.data)) {
      if (key === 'arguments' || key === 'body' || key === 'input') continue;
      if (typeof value !== 'string') data[key] = value;
      // Navigation and fetch breadcrumbs carry addresses as paths as well as
      // full URLs, and a path keeps its query string as readily as a URL does.
      else data[key] = URL_KEYS.has(key) ? scrubUrl(value) : scrubText(value);
    }
    next.data = data;
  }
  return next;
}

/** An event, scrubbed. Never null: an error with its details removed is still worth knowing about. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const next = { ...event };
  delete next.user;
  if (typeof next.message === 'string') next.message = scrubText(next.message);
  if (typeof next.transaction === 'string') next.transaction = scrubText(next.transaction);
  if (next.request) {
    next.request = {
      ...(next.request.url ? { url: scrubUrl(next.request.url) } : {}),
    };
  }
  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((ex) =>
        typeof ex.value === 'string' ? { ...ex, value: scrubText(ex.value) } : ex,
      ),
    };
  }
  if (next.breadcrumbs) {
    next.breadcrumbs = next.breadcrumbs
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is ScrubbableBreadcrumb => crumb !== null);
  }
  return next;
}
