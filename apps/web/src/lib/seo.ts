// The canonical origin for everything apps/web serves: the front page, the
// privacy statement, the terms and password recovery. The app itself is
// app.snaghq.co.nz and the staff portal staff.snaghq.co.nz, each its own site.
//
// Hardcoded rather than read from an env var: this is what every canonical and
// OpenGraph URL is resolved against, and a preview deploy that self-canonicalises
// is worse than one pointing at production.
//
// Nothing here depends on it resolving; a wrong canonical costs SEO, not
// uptime.
export const SITE_URL = 'https://www.snaghq.co.nz';

/**
 * The pages that ask to be indexed (`robots: { index: true }`), which is what
 * sitemap.xml lists. Everything else on this host is an account page and says
 * noindex.
 *
 * Without a sitemap Google found these by following links, and reached most of
 * them through a redirect: the apex and plain http both send it here. Search
 * Console then reports those addresses as *Page with redirect*, which is
 * correct. They redirect on purpose. The sitemap names the addresses the
 * redirects end at. e2e/seo.spec.ts checks that each page listed here says
 * index and names itself as canonical, and that no other route says index.
 */
export const INDEXED_PATHS = ['/', '/privacy', '/terms'] as const;

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
