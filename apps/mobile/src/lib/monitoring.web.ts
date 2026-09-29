import { scrubBreadcrumb, scrubEvent } from './monitoringScrub';

/**
 * Error reporting on the web build, through Sentry: errors only, scrubbed.
 *
 * **Inert until `EXPO_PUBLIC_SENTRY_DSN` is set** on the Netlify site. Expo
 * inlines it at build time, so it has to be written out literally below.
 *
 * **The SDK is loaded with `import()`, never statically.** Metro does not
 * tree-shake, and a static `import * as Sentry` took the main web bundle from
 * 3.60 MB to 4.81 MB (+1.2 MB, all of replay and feedback with it) for every
 * visitor, DSN or no DSN. Dynamically imported, it is a chunk of its own on
 * the same origin (covered by `script-src 'self'`, like jsPDF's html2canvas
 * chunk), fetched only once a DSN exists. The price is that an error in the
 * first moment after load, before the chunk arrives, is held in a short queue
 * rather than sent at once.
 *
 * What it is allowed to send is the privacy statement's sentence: *what went
 * wrong and on which screen, with links, email addresses and anything you
 * typed removed first, and nothing recording your screen*. So:
 *
 *   * every category of `dataCollection` is off (user, cookies, headers,
 *     bodies, query strings, stack variables);
 *   * no tracing and no replay integration is added;
 *   * every event and breadcrumb goes through `monitoringScrub`, which masks
 *     the join token, the storage signature and email addresses;
 *   * fetch errors are enhanced only in the report
 *     (`enhanceFetchErrorMessages: 'report-only'`), because the app words a
 *     failed request from its own message and the SDK must not rewrite it.
 *
 * The CSP's `connect-src` names Sentry's ingest hosts (`netlify.toml`, pinned
 * by `csp.test.ts`). A report the policy blocks fails in the same silence
 * every other blocked request does.
 */

type SentryModule = typeof import('@sentry/react');

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
/** Errors caught before the SDK has loaded. Bounded: a loop must not grow it. */
const QUEUE_LIMIT = 10;

let sentry: SentryModule | null = null;
let starting = false;
const queued: Array<[unknown, Record<string, string> | undefined]> = [];

function capture(S: SentryModule, error: unknown, context?: Record<string, string>) {
  S.captureException(error, context ? { tags: context } : undefined);
}

export function initMonitoring(): void {
  if (starting || !DSN) return;
  starting = true;
  import('@sentry/react')
    .then((S) => {
      S.init({
        dsn: DSN,
        environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? 'production',
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          stackFrameVariables: false,
        },
        enhanceFetchErrorMessages: 'report-only',
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
      });
      sentry = S;
      for (const [error, context] of queued.splice(0)) capture(S, error, context);
    })
    // A report that cannot be sent is not a reason to disturb the app.
    .catch(() => {});
}

export function reportError(error: unknown, context?: Record<string, string>): void {
  if (!DSN) return;
  if (sentry) capture(sentry, error, context);
  else if (queued.length < QUEUE_LIMIT) queued.push([error, context]);
}
