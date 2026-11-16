import type { Metadata } from 'next';
import { BRAND, HERO, SITE } from './content';

/** The share image (src/app/opengraph-image.tsx); its size and alt text match that file's exports. */
export const SHARE_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: `${SITE.title}: ${HERO.title}`,
};

/**
 * The metadata of an indexed public page other than `/`: "<title> · Keptrow" (`/` carries the descriptor), its canonical
 * address, index and follow (the root layout is noindex), and Open Graph and Twitter tags with the share image (a
 * page's own openGraph replaces the root's, share image included, so the image is named here again).
 */
export function publicPageMetadata(page: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const title = `${page.title} · ${BRAND.product}`;
  const url = `${SITE.url}${page.path}`;
  return {
    title,
    description: page.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      url,
      siteName: BRAND.product,
      title,
      description: page.description,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: page.description,
      images: [SHARE_IMAGE],
    },
  };
}
