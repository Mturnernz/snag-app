import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';

// Everything may be crawled, and nothing is blocked here on purpose. Each
// account page says noindex in its own metadata, and a crawler blocked from a
// page never reads that tag, so a blocked page somebody links to can still be
// listed as a bare address. Leaving it crawlable is how its noindex is obeyed.
//
// The sitemap line is the reason this file exists. Before it, /robots.txt and
// /sitemap.xml both answered 404.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
