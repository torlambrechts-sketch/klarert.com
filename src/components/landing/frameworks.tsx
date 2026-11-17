import Link from 'next/link';
import { ArrowRight, Check, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SiteLibrary, SiteSet } from '@/engine/packs/site-catalogue';
import { readSiteCatalogue } from '@/lib/site/catalogue';
import { FRAMEWORKS_PAGE, LINKS, STANDARD_PAGES } from './content';
import { Closing } from './landing';
import { SectionHead, SiteShell, WRAP } from './site-chrome';

// `/frameworks`: every set (templates/packs) and every framework edition (templates/frameworks) of the catalogue,
// read at build time through src/lib/site/catalogue.ts, never hard-coded. Names, levels, sheets, shared registers,
// libraries and apps come from the manifests in the words people read (src/engine/packs/words.ts); only titles and
// counts of the standards are shown, never their text (docs/12 Licensing).

const DT = 'text-muted-foreground text-label-12 font-medium';
const CHIP = 'bg-subtle border-line text-label-12 rounded-md border px-2 py-0.5';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className={DT}>{term}</dt>
      <dd className="text-copy-14 m-0">{children}</dd>
    </div>
  );
}

function EditionStatus({ lib }: { lib: SiteLibrary }) {
  if (lib.tone === 'current' || !lib.badge)
    return (
      <span className="text-good text-label-13 inline-flex items-center gap-1.5 font-medium">
        <Check aria-hidden="true" className="size-4" /> {lib.status}
      </span>
    );
  const replaced = lib.tone === 'replaced';
  const badge = lib.badge;
  const Icon = replaced ? TriangleAlert : RefreshCw;
  return (
    <span
      className={`${replaced ? 'text-warn' : 'text-ink'} text-label-13 inline-flex items-start gap-1.5 font-medium`}
    >
      <Icon aria-hidden="true" className="mt-px size-4 shrink-0" /> {badge}
    </span>
  );
}

function SetCard({ set, wide }: { set: SiteSet; wide?: boolean }) {
  const id = `set-${set.key}`;
  return (
    <article
      aria-labelledby={id}
      className="bg-card border-line flex flex-col gap-5 rounded-xl border p-5 sm:p-6"
    >
      <div className="flex flex-col gap-2">
        <h3 id={id} className="text-heading-20 m-0">
          {set.title}
        </h3>
        <p className="text-muted-foreground text-copy-14 m-0">{set.line}</p>
      </div>
      <dl className={`m-0 grid gap-4 ${wide ? 'md:grid-cols-2' : ''}`}>
        <Fact term="Levels">
          {set.levels.length ? set.levels.join(', ') : 'One level: the whole set'}
        </Fact>
        <Fact term={`Sheets it adds (${set.sheets.length})`}>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {set.sheets.map((s) => (
              <li key={s.name} className={CHIP}>
                {s.name}
                {s.level ? <span className="text-muted-foreground"> · {s.level}</span> : null}
              </li>
            ))}
          </ul>
        </Fact>
        {set.sharedRegisters.length ? (
          <Fact term={`Shared registers it builds on (${set.sharedRegisters.length})`}>
            {set.sharedRegisters.join(', ')}
          </Fact>
        ) : null}
        {set.sharedWith.length ? (
          <Fact term={wide ? 'Used by' : 'Shares registers with'}>{set.sharedWith.join(', ')}</Fact>
        ) : null}
        {set.libraries.length ? (
          <Fact term={set.libraries.length === 1 ? 'Requirement library' : 'Requirement libraries'}>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {set.libraries.map((l) => (
                <li key={l.title}>
                  {l.title} · {plural(l.requirements, 'requirement', 'requirements')}
                  {l.optional ? ' · linked when you have adopted it' : ''}
                </li>
              ))}
            </ul>
          </Fact>
        ) : null}
        {set.apps.length ? (
          <Fact term={set.apps.length === 1 ? 'App' : 'Apps'}>{set.apps.join(', ')}</Fact>
        ) : null}
      </dl>
      <div className="mt-auto flex flex-wrap gap-3">
        <Button asChild variant="secondary" className="h-11 sm:h-10">
          <Link href={LINKS.createAccount}>
            Create account<span className="sr-only"> to set up {set.title}</span>
          </Link>
        </Button>
        {STANDARD_PAGES[set.key] ? (
          <Button asChild variant="ghost" className="h-11 sm:h-10">
            <Link href={STANDARD_PAGES[set.key]!}>
              More about {set.title}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function LibraryCard({ lib }: { lib: SiteLibrary }) {
  const id = `library-${lib.key}-${lib.version}`;
  return (
    <article
      aria-labelledby={id}
      className="bg-card border-line flex flex-col gap-3 rounded-xl border p-5"
    >
      <h3 id={id} className="text-heading-16 m-0">
        {lib.title}
      </h3>
      <p className="text-muted-foreground text-label-13 m-0">
        {lib.kind} · {lib.publisher} · {plural(lib.requirements, 'requirement', 'requirements')}
      </p>
      <EditionStatus lib={lib} />
      <p className="text-muted-foreground text-label-13 m-0">
        {lib.usedBy.length ? `Used by ${lib.usedBy.join(', ')}` : 'Adopt it on its own'}
      </p>
    </article>
  );
}

export function FrameworksPage() {
  const site = readSiteCatalogue();
  return (
    <SiteShell path={LINKS.frameworks}>
      <section aria-labelledby="frameworks-page-title">
        <div className={`${WRAP} flex flex-col items-center gap-6 pt-8 pb-12 sm:pt-12`}>
          <SectionHead
            as="h1"
            id="frameworks-page-title"
            pill="Frameworks"
            title={FRAMEWORKS_PAGE.title}
            lead={FRAMEWORKS_PAGE.lead}
          />
          <ul className="text-label-13 m-0 flex list-none flex-wrap justify-center gap-2 p-0">
            {[
              plural(site.counts.sets, 'ready-made set', 'ready-made sets'),
              plural(site.counts.frameworks, 'framework', 'frameworks'),
              plural(site.counts.editions, 'edition', 'editions'),
            ].map((t) => (
              <li
                key={t}
                className="bg-background-100 border-line rounded-full border px-3 py-1 font-medium"
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className={`${WRAP} flex flex-col gap-16 pb-16 sm:pb-24`}>
        {site.foundation ? (
          <section aria-labelledby="foundation-title" className="flex flex-col gap-4">
            <h2 id="foundation-title" className="text-heading-24 m-0">
              {FRAMEWORKS_PAGE.foundationTitle}
            </h2>
            <SetCard set={site.foundation} wide />
          </section>
        ) : null}

        {site.groups.map((g) => (
          <section key={g.id} aria-labelledby={`group-${g.id}`} className="flex flex-col gap-4">
            <h2 id={`group-${g.id}`} className="text-heading-24 m-0">
              {g.title}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {g.sets.map((s) => (
                <SetCard key={s.key} set={s} />
              ))}
            </div>
          </section>
        ))}

        <section aria-labelledby="libraries-title" className="flex flex-col gap-4">
          <div className="flex max-w-3xl flex-col gap-2">
            <h2 id="libraries-title" className="text-heading-24 m-0">
              {FRAMEWORKS_PAGE.librariesTitle}
            </h2>
            <p className="text-muted-foreground text-copy-14 m-0">
              {FRAMEWORKS_PAGE.librariesLead}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {site.libraries.map((l) => (
              <LibraryCard key={`${l.key}@${l.version}`} lib={l} />
            ))}
          </div>
        </section>
      </div>

      <Closing />
    </SiteShell>
  );
}
