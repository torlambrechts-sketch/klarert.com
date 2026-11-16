import { FRAMEWORKS_PAGE, LINKS } from '@/components/landing/content';
import { FrameworksPage } from '@/components/landing/frameworks';
import { publicPageMetadata } from '@/components/landing/metadata';

// Every set and framework edition of the catalogue, read from the repository at build time
// (src/lib/site/catalogue.ts): static, indexed, in the sitemap (src/app/sitemap.ts).
export const dynamic = 'force-static';
export const metadata = publicPageMetadata({
  title: 'Frameworks',
  description: FRAMEWORKS_PAGE.description,
  path: LINKS.frameworks,
});

export default function Frameworks() {
  return <FrameworksPage />;
}
