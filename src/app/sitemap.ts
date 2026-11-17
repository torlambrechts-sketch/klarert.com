import type { MetadataRoute } from 'next';
import { SITEMAP_PATHS, SITE } from '@/components/landing/content';

// The public pages and nothing else (owner decision, 16 Nov 2026): `/`, /platform, /frameworks, the standard pages
// (/standards/iso-9001) and the legal pages.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_PATHS.map((p) => ({ url: p === '/' ? SITE.url : `${SITE.url}${p}` }));
}
