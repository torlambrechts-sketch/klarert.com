import Link from 'next/link';
import type { Metadata } from 'next';
import { TriangleAlert } from 'lucide-react';
import { LINKS } from './content';
import type { Block, Inline, LegalPage } from './legal';
import { publicPageMetadata } from './metadata';
import { SiteShell } from './site-chrome';

// The privacy notice and the terms: static Server Components in the public pages' frame, indexed (the root layout
// is noindex), linked from each other and from the footer. Both are drafts until a lawyer reviews them.

export function legalMetadata(page: LegalPage): Metadata {
  return publicPageMetadata(page);
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
      <p className="text-16 m-0">
        <Text runs={block.p} />
      </p>
    );
  return (
    <ul className="text-16 m-0 flex list-disc flex-col gap-2 pl-5">
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
    <SiteShell path={page.path}>
      <div className="px-3 pt-2 pb-12 sm:px-6 sm:pb-16">
        <article
          aria-labelledby="legal-title"
          className="bg-card border-line mx-auto w-full max-w-3xl rounded-xl border px-4 py-8 sm:px-10 sm:py-12"
        >
          <div
            role="note"
            aria-label="Draft"
            className="border-warn bg-warn-soft text-warn mb-8 flex items-start gap-2 rounded-lg border px-4 py-3"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="text-14 m-0">
              <strong className="font-semibold">Draft, to be reviewed.</strong> This page has not
              been reviewed by a lawyer yet. Text in square brackets is still to be filled in.
            </p>
          </div>

          <h1 id="legal-title" className="text-figure m-0">
            {page.title}
          </h1>
          <p className="text-muted-foreground text-16 mt-3 mb-0">
            <Text runs={page.intro} />
          </p>

          <nav aria-label="On this page" className="mt-6">
            <ul className="text-14 m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
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
              <h2 id={`${s.id}-title`} className="text-panel-title m-0">
                {s.title}
              </h2>
              {s.blocks.map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
            </section>
          ))}

          <p className="text-14 text-muted-foreground border-line mt-10 mb-0 border-t pt-6">
            See also the{' '}
            <Link className={LINK} href={other.path}>
              {other.path === LINKS.terms ? 'terms' : 'privacy notice'}
            </Link>
            .
          </p>
        </article>
      </div>
    </SiteShell>
  );
}
