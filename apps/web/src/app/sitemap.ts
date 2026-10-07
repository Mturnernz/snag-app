import type { MetadataRoute } from 'next';
import { INDEXED_PATHS, absoluteUrl } from '@/lib/seo';

// The pages that ask to be indexed, at the addresses they name as canonical.
// See INDEXED_PATHS for why this exists.
//
// No lastModified. A date stamped at build time changes on every deploy
// whether the page did or not, and Google stops trusting a sitemap's dates
// once they turn out to be wrong.
export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXED_PATHS.map((path) => ({ url: absoluteUrl(path) }));
}
