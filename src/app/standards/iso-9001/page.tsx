import { ISO9001_PAGE, ISO9001_PATH } from '@/components/landing/iso-9001-content';
import { Iso9001Page } from '@/components/landing/iso-9001';
import { publicPageMetadata } from '@/components/landing/metadata';

// The ISO 9001 product page: static, indexed, in the sitemap (src/app/sitemap.ts). What the standard installs is read
// from the catalogue at build time (src/lib/site/standard.ts). The same page for everyone, signed in or not.
export const dynamic = 'force-static';
export const metadata = publicPageMetadata({
  title: ISO9001_PAGE.title,
  description: ISO9001_PAGE.description,
  path: ISO9001_PATH,
});

export default function Iso9001() {
  return <Iso9001Page />;
}
