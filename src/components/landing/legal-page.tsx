import Link from 'next/link';
import type { Metadata } from 'next';
import { TriangleAlert } from 'lucide-react';
import { HERO, LINKS, SITE } from './content';
import type { Block, Inline, LegalPage } from './legal';
import { SiteShell } from './site-chrome';

// The privacy notice and the terms: static Server Components in the public pages' frame, indexed (the root layout
// is noindex), linked from each other and from the footer. Both are drafts until a lawyer reviews them.

/** The share image (src/app/opengraph-image.tsx); its size and alt text match that file's exports. */
const SHARE_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: `${SITE.title}: ${HERO.title}`,
};

export function legalMetadata(page: LegalPage): Metadata {
  const title = `${page.title} · ${SITE.title}`;
  const url = `${SITE.url}${page.path}`;
  return {
    title,
    description: page.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    // a page's own openGraph replaces the root's, share image included, so the image is named here again
    openGraph: {
      type: 'website',
      url,
      siteName: SITE.title,
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

const LINK = 'text-info rounded-sm underline underline-offset-4';

function Text({ runs }: { runs: Inline[] }) {
  return runs.map((run, i) => {
    if (typeof run === 'string') return run;
    if ('placeholder' in run)
      return (
        <mark key={i} data-placeholder className="bg-warn-soft text-warn rounded-sm font-medium">
          [{run.placeholder}]
        </mark>
      );
    return run.link.startsWith('/') ? (
      <Link key={i} className={LINK} href={run.link}>
        {run.text}
      </Link>
    ) : (
      <a key={i} className={LINK} href={run.link}>
        {run.text}
      </a>
    );
  });
}

function BlockView({ block }: { block: Block }) {
  if ('p' in block)
    return (
      <p className="text-copy-16 m-0">
        <Text runs={block.p} />
      </p>
    );
  return (
    <ul className="text-copy-16 m-0 flex list-disc flex-col gap-2 pl-5">
      {block.list.map((runs, i) => (
        <li key={i}>
          <Text runs={runs} />
        </li>
      ))}
    </ul>
  );
}

export function LegalPageView({ page, other }: { page: LegalPage; other: LegalPage }) {
  return (
    <SiteShell>
      <article
        aria-labelledby="legal-title"
        className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14"
      >
        <div
          role="note"
          aria-label="Draft"
          className="border-warn bg-warn-soft text-warn mb-8 flex items-start gap-2 rounded-lg border px-4 py-3"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="text-copy-14 m-0">
            <strong className="font-semibold">Draft, to be reviewed.</strong> This page has not been
            reviewed by a lawyer yet. Text in square brackets is still to be filled in.
          </p>
        </div>

        <h1 id="legal-title" className="text-heading-32 m-0">
          {page.title}
        </h1>
        <p className="text-muted-foreground text-copy-16 mt-3 mb-0">
          <Text runs={page.intro} />
        </p>

        <nav aria-label="On this page" className="mt-6">
          <ul className="text-label-14 m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
            {page.sections.map((s) => (
              <li key={s.id}>
                <a className={LINK} href={`#${s.id}`}>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {page.sections.map((s) => (
          <section
            key={s.id}
            id={s.id}
            aria-labelledby={`${s.id}-title`}
            className="border-line mt-8 flex scroll-mt-6 flex-col gap-3 border-t pt-8"
          >
            <h2 id={`${s.id}-title`} className="text-heading-20 m-0">
              {s.title}
            </h2>
            {s.blocks.map((b, i) => (
              <BlockView key={i} block={b} />
            ))}
          </section>
        ))}

        <p className="text-copy-14 text-muted-foreground border-line mt-10 mb-0 border-t pt-6">
          See also the{' '}
          <Link className={LINK} href={other.path}>
            {other.path === LINKS.terms ? 'terms' : 'privacy notice'}
          </Link>
          .
        </p>
      </article>
    </SiteShell>
  );
}
