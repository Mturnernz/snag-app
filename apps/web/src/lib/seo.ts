// The canonical origin for everything apps/web serves — marketing and portal
// alike. One Next app, one Netlify site, one domain: the two route groups share
// a session, a Supabase client and middleware.ts, so splitting them across a
// subdomain would break the /login?next= round trip that /go/snag/[id] depends
// on to get a supervisor back to the snag they were mailed about.
//
// Hardcoded rather than read from an env var: this is what every canonical and
// OpenGraph URL is resolved against, and a preview deploy that self-canonicalises
// is worse than one pointing at production.
//
// Aspirational until DNS moves — see PRODUCTION_READINESS.md D1. Nothing here
// depends on it resolving; a wrong canonical costs SEO, not uptime.
export const SITE_URL = 'https://www.snaghq.co.nz';

/**
 * Canonical + og:url for one page, from one path.
 *
 * Both have to be absolute and both have to agree, and they are easy to drift
 * apart when each page spells its own path twice. `metadataBase` covers the
 * relative form for `alternates`/`openGraph` — but NOT for sitemap.ts or
 * robots.ts, whose formats require absolute URLs and which silently emit
 * unusable relative ones otherwise. One helper, one string per page.
 *
 * Without an explicit per-page `openGraph.url`, Next inherits the root
 * layout's verbatim, so every shared link claims to be the homepage and
 * Slack/LinkedIn collapse them into one entity.
 */
export function canonical(path: string) {
  const url = absoluteUrl(path);
  return {
    alternates: { canonical: url },
    openGraph: { url },
  } as const;
}

/** Absolute URL for a site-relative path. `/` stays `https://host/`. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}
