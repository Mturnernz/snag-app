import { test, expect } from '@playwright/test';

// What this host tells a search engine. Search Console reports the apex, plain
// http and the old /staff path as *Page with redirect*. That is correct: each
// one redirects on purpose. These tests check the other half, that the
// addresses those redirects end at are the ones the sitemap names.
//
// Checked against what each page says about itself, not against the list in
// src/lib/seo.ts, so a page that starts asking to be indexed without being
// added to the sitemap fails here.

const SITE = 'https://www.snaghq.co.nz';

// Every route this host serves (the same list a11y.spec.ts walks).
const ROUTES = ['/', '/forgot-password', '/reset-password', '/privacy', '/terms'] as const;

function attr(html: string, pattern: RegExp): string | null {
  return html.match(pattern)?.[1] ?? null;
}

async function sitemapUrls(request: import('@playwright/test').APIRequestContext): Promise<string[]> {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

test('robots.txt allows everything and names the sitemap', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/^Allow: \/$/m);
  expect(body).not.toMatch(/^Disallow: \S/m);
  expect(body).toContain(`Sitemap: ${SITE}/sitemap.xml`);
});

test('the sitemap lists every indexed page at its canonical address, and nothing else', async ({ request }) => {
  const listed = await sitemapUrls(request);
  expect(listed.length).toBeGreaterThan(0);
  // Absolute, on the canonical host, never the apex or http (those redirect).
  for (const url of listed) expect(url.startsWith(`${SITE}/`)).toBe(true);

  for (const path of ROUTES) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    const html = await res.text();
    const robots = attr(html, /<meta name="robots" content="([^"]+)"/);
    const indexed = robots !== null && /(^|,\s*)index\b/.test(robots);
    const address = new URL(path, SITE).href;

    expect(listed.includes(address), `${path} says "${robots}"`).toBe(indexed);
    if (indexed) {
      const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
      expect(canonical, `${path} names no canonical`).not.toBeNull();
      // The front page renders its canonical without the trailing slash. For
      // the root they are the same address, so compare them as URLs.
      expect(new URL(canonical!).href, path).toBe(address);
    }
  }
});
