import type { MetadataRoute } from 'next';
import { SITE } from '@/components/landing/content';

// Crawlers may fetch everything (owner decision, 16 Nov 2026). What keeps a page out of search results is its
// `noindex`, which a crawler only sees when it may fetch the page: the root layout makes every page noindex; `/`,
// /platform, /frameworks, `/privacy` and `/terms` opt in to indexing, and only they are in the sitemap.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
