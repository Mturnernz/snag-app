import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';

// Only the routes a stranger should be able to find. Everything auth-gated is
// absent here *and* disallowed in robots.ts — a sitemap listing a page that
// answers with a redirect to /login is a coverage error in Search Console, not
// a crawl hint.
//
// `<loc>` MUST be absolute. metadataBase does not reach this file: relative
// paths are emitted verbatim, and a sitemap with relative locs is rejected
// wholesale rather than partially — so the failure is every URL, silently, in
// a file nothing else reads. Hence absoluteUrl() off the same SITE_URL the
// canonical tags use.
const PUBLIC_ROUTES: {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/sign-up', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    lastModified,
    changeFrequency,
    priority,
  }));
}
