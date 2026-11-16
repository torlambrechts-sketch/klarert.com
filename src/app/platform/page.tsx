import { LINKS, PLATFORM_PAGE } from '@/components/landing/content';
import { publicPageMetadata } from '@/components/landing/metadata';
import { PlatformPage } from '@/components/landing/platform';

// The product's parts in plain words: static, indexed, in the sitemap (src/app/sitemap.ts). The same page for
// everyone, signed in or not.
export const dynamic = 'force-static';
export const metadata = publicPageMetadata({
  title: 'Platform',
  description: PLATFORM_PAGE.description,
  path: LINKS.platform,
});

export default function Platform() {
  return <PlatformPage />;
}
