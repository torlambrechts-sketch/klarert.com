import type { MetadataRoute } from 'next';
import { PUBLIC_PATHS, SITE } from '@/components/landing/content';

// The public pages and nothing else (owner decision, 16 Nov 2026).
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((p) => ({ url: p === '/' ? SITE.url : `${SITE.url}${p}` }));
}
