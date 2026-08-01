import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';

// Belt and braces with the per-route `robots: { index: false }` exports. The
// meta tag is the one that actually keeps a page out of the index — a Disallow
// only stops the crawl, and a disallowed URL can still be indexed from an
// inbound link. This file is here so a crawler doesn't spend its budget on
// routes that answer with a redirect to /login anyway.
//
// /go is the one that matters: one URL per snag id, mailed to real people, and
// public by design because the id is shape-checked rather than looked up.
const DISALLOW = [
  '/dashboard',
  '/snags',
  '/reports',
  '/documents',
  '/go/',
  '/login',
  '/unauthorized',
  '/sign-up/check-email',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: DISALLOW,
    },
    // Absolute, like the sitemap's own <loc>s: the Sitemap directive is the one
    // line in robots.txt that is specified as a full URL, and crawlers ignore a
    // relative one.
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
