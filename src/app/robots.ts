import type { MetadataRoute } from 'next';
import { PUBLIC_PATHS, ROBOTS_ASSETS, SITE } from '@/components/landing/content';

// Only the public pages are for search engines (owner decision, 16 Nov 2026): `/`, `/privacy` and `/terms`, each
// exactly (`$`), plus what those pages need to render and share (the built assets, the favicon, the share image).
// Everything else is disallowed; the app's pages also carry `noindex` from the root layout.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [...PUBLIC_PATHS.map((p) => `${p}$`), ...ROBOTS_ASSETS],
      disallow: '/',
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
