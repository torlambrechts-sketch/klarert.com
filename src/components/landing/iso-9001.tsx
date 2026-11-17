import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Check, CircleCheck, FileArchive, KeyRound, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readSiteCatalogue } from '@/lib/site/catalogue';
import screens from '@/lib/site/screens.json';
import { readStandardPage } from '@/lib/site/standard';
import { LICENCE_NOTE } from './content';
import {
  CLAUSES,
  EXAMPLE_CAPTION,
  FAQ,
  ISO9001_PACK,
  ISO9001_PAGE as P,
  ISO9001_PATH,
  ISO9001_SIGNUP,
  PROCESSES,
  SHOTS,
} from './iso-9001-content';
import { SectionHead, SiteShell, WRAP } from './site-chrome';

// `/standards/iso-9001`: the product page for ISO 9001 buyers. A Server Component with no client code of its own, in
// the site's frame (site-chrome.tsx). What the standard installs, the libraries, their edition status and the shared
// registers are read from the catalogue at build time (src/lib/site/standard.ts); the words are in
// iso-9001-content.ts. The screenshots are of the fictional example workspace (pnpm seed:demo, scripts/screenshots.ts),
// served from our own domain with their size known, so nothing shifts while they load.

const SECTION = `${WRAP} flex flex-col gap-10 py-16 sm:py-24`;
const CHIP = 'bg-subtle border-line text-label-12 rounded-md border px-2 py-0.5';
const DT = 'text-muted-foreground text-label-13 font-medium';

type ScreenName = keyof typeof screens;

/** A screenshot of the example workspace in a card, with its caption. */
function Shot({
  name,
  alt,
  priority,
  sizes = '(min-width: 1024px) 50vw, 100vw',
}: {
  name: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
}) {
  const s = screens[name as ScreenName];
  if (!s) throw new Error(`No screenshot ${name} in src/lib/site/screens.json.`);
  return (
    <figure className="bg-card border-line shadow-menu m-0 flex flex-col gap-2 rounded-xl border p-2">
      <Image
        src={`/site/screens/${s.file}`}
        alt={alt}
        width={s.width}
        height={s.height}
        sizes={sizes}
        priority={priority}
        className="border-line h-auto w-full rounded-lg border"
      />
      <figcaption className="text-muted-foreground text-label-12 px-1 pb-0.5">
        {EXAMPLE_CAPTION}
      </figcaption>
    </figure>
  );
}

function Points({ items }: { items: readonly string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((p) => (
        <li key={p} className="text-copy-14 flex items-start gap-2">
          <Check aria-hidden="true" className="text-good mt-0.5 size-4 shrink-0" />
          {p}
        </li>
      ))}
    </ul>
  );
}

function StartButton({ full }: { full?: boolean }) {
  return (
    <Button asChild size="lg" className={full ? 'w-full sm:w-auto' : undefined}>
      <Link href={ISO9001_SIGNUP}>{P.hero.cta}</Link>
    </Button>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className={DT}>{term}</dt>
      <dd className="text-copy-14 m-0">{children}</dd>
    </div>
  );
}

export function Iso9001Page() {
  const page = readStandardPage(ISO9001_PACK);
  const { install } = page;
  const set = readSiteCatalogue()
    .groups.flatMap((g) => g.sets)
    .find((s) => s.key === ISO9001_PACK);
  const current = page.editions[0]!;
  const sharedNames = page.shared.map((s) => s.name);

  return (
    <SiteShell path={ISO9001_PATH}>
      {/* 1. hero */}
      <section aria-labelledby="iso9001-title">
        <div
          className={`${WRAP} grid items-center gap-12 pt-8 pb-16 sm:pt-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:pb-24`}
        >
          <div className="flex flex-col items-start gap-6">
            <span className="bg-background-100 border-line text-label-13 text-ink rounded-full border px-3 py-1 font-medium">
              {P.hero.eyebrow}
            </span>
            <h1
              id="iso9001-title"
              className="text-heading-40 sm:text-heading-48 m-0 max-w-[20ch] text-balance"
            >
              {P.hero.title}
            </h1>
            <p className="text-muted-foreground text-copy-16 sm:text-copy-18 m-0 max-w-[56ch]">
              {P.hero.lead}
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <StartButton full />
              <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                <a href="#install">{P.hero.secondary}</a>
              </Button>
            </div>
            <p className="text-muted-foreground text-label-13 m-0">{P.hero.reassurance}</p>
          </div>
          <Shot
            name={SHOTS.hero.shot}
            alt={SHOTS.hero.alt}
            priority
            sizes="(min-width: 1024px) 55vw, 100vw"
          />
        </div>
      </section>

      {/* 2. what you get */}
      <section
        id="install"
        aria-labelledby="install-title"
        className="border-line scroll-mt-6 border-t"
      >
        <div className={SECTION}>
          <SectionHead id="install-title" {...P.install} />
          <div className="grid gap-4 lg:grid-cols-3">
            <article
              aria-labelledby="install-sheets"
              className="bg-card border-line flex flex-col gap-5 rounded-xl border p-5 sm:p-6 lg:col-span-2"
            >
              <h3 id="install-sheets" className="text-heading-20 m-0">
                {P.install.sheetsTitle}
              </h3>
              <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
                {install.sheets.map((s) => (
                  <li
                    key={s.name}
                    className="border-line flex flex-col gap-1 rounded-lg border p-3"
                  >
                    <span className="text-label-14 flex flex-wrap items-center gap-2 font-semibold">
                      {s.name}
                      {s.level ? <span className={CHIP}>{s.level}</span> : null}
                    </span>
                    {s.description ? (
                      <span className="text-muted-foreground text-label-13">{s.description}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <dl className="m-0 grid gap-4 sm:grid-cols-2">
                <Fact term={P.install.registersTitle}>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {install.registers.map((r) => (
                      <li key={r.name}>
                        <span className="font-medium">{r.name}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {r.columns} {r.columns === 1 ? 'column' : 'columns'}
                          {r.forms.length ? ` · form ${r.forms.join(', ')}` : ''}
                          {r.automations
                            ? ` · ${r.automations} ${r.automations === 1 ? 'automation' : 'automations'}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Fact>
                <Fact term={P.install.libraryTitle}>
                  {current.title} · {current.requirements} requirements
                  {set?.levels.length ? (
                    <p className="text-muted-foreground m-0 mt-2">
                      Levels: {set.levels.join(', ')}
                    </p>
                  ) : null}
                </Fact>
                <Fact term={P.install.formsTitle}>{install.forms.join(', ')}</Fact>
                <Fact term={P.install.dashboardTitle}>{install.dashboards.join(', ')}</Fact>
              </dl>
            </article>
            <div className="flex flex-col gap-4">
              {install.setup ? (
                <article
                  aria-labelledby="install-setup"
                  className="bg-card border-line flex flex-col gap-4 rounded-xl border p-5 sm:p-6"
                >
                  <h3 id="install-setup" className="text-heading-20 m-0">
                    {P.install.setupTitle}
                  </h3>
                  <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {install.setup.steps.map((s, i) => (
                      <li key={s} className="text-copy-14 flex items-start gap-3">
                        <span className="bg-soft text-label-12 flex size-6 shrink-0 items-center justify-center rounded-full font-semibold">
                          {i + 1}
                        </span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </article>
              ) : null}
              <article
                aria-labelledby="install-workflows"
                className="bg-card border-line flex flex-col gap-4 rounded-xl border p-5 sm:p-6"
              >
                <h3 id="install-workflows" className="text-heading-20 m-0">
                  {P.install.workflowsTitle}
                </h3>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {install.workflows.map((w) => (
                    <li key={w.name} className="text-copy-14 flex flex-col">
                      <span className="font-medium">{w.name}</span>
                      <span className="text-muted-foreground text-label-13">
                        {w.steps.join(' → ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
          <article
            aria-labelledby="install-automations"
            className="bg-card border-line flex flex-col gap-4 rounded-xl border p-5 sm:p-6"
          >
            <div className="flex flex-col gap-1">
              <h3 id="install-automations" className="text-heading-20 m-0">
                {P.install.automationsTitle} ({install.automations.length})
              </h3>
              <p className="text-muted-foreground text-copy-14 m-0">{P.install.automationsNote}</p>
            </div>
            <ul className="m-0 grid list-none gap-x-6 gap-y-2 p-0 md:grid-cols-2 xl:grid-cols-3">
              {install.automations.map((a) => (
                <li key={a} className="text-copy-14 flex items-start gap-2">
                  <ArrowRight
                    aria-hidden="true"
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  />
                  {a}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      {/* 3. clause by clause */}
      <section aria-labelledby="library-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="library-title" {...P.library} />
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <Points items={P.library.points} />
              <div className="flex flex-col gap-3">
                <h3 className="text-heading-20 m-0">{P.library.clausesTitle}</h3>
                <ol className="m-0 flex list-none flex-col gap-0 p-0">
                  {CLAUSES.map((c) => (
                    <li
                      key={c.ref}
                      className="border-line grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-b py-3 last:border-b-0"
                    >
                      <span className="text-heading-20 text-ink tabular-nums">{c.ref}</span>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-label-14 font-semibold">
                          {c.title}
                          <span className="text-muted-foreground font-normal">
                            {' '}
                            · {current.byClause[c.ref] ?? 0} requirements in {current.title}
                          </span>
                        </span>
                        <span className="text-muted-foreground text-copy-14">{c.line}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="text-muted-foreground text-label-13 m-0">{P.library.licence}</p>
              </div>
            </div>
            <Shot name={SHOTS.library.shot} alt={SHOTS.library.alt} />
          </div>
        </div>
      </section>

      {/* 4. core quality processes */}
      <section aria-labelledby="processes-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="processes-title" {...P.processes} />
          <div className="flex flex-col gap-6">
            {PROCESSES.map((p, i) => (
              <article
                key={p.key}
                id={p.key}
                aria-labelledby={`${p.key}-title`}
                className="bg-card border-line grid scroll-mt-6 items-center gap-6 rounded-xl border p-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-10"
              >
                <div className={i % 2 === 1 ? 'lg:order-2' : undefined}>
                  <Shot name={p.shot} alt={p.alt} sizes="(min-width: 1024px) 58vw, 100vw" />
                </div>
                <div className="flex flex-col gap-4 px-3 pb-5 lg:py-6 lg:pr-6">
                  <h3 id={`${p.key}-title`} className="text-heading-24 m-0">
                    {p.title}
                  </h3>
                  <Points items={p.lines} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 5. one record counts for every standard */}
      <section aria-labelledby="shared-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="shared-title" {...P.shared} />
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {page.shared.map((s) => (
              <li
                key={s.name}
                className="bg-card border-line flex flex-col gap-3 rounded-xl border p-5"
              >
                <span className="text-heading-16">{s.name}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`${CHIP} border-(--tint-blue-line) bg-(--tint-blue-bg) text-(--tint-blue-ink)`}
                  >
                    ISO 9001
                  </span>
                  {s.usedBy.map((u) => (
                    <span key={u} className={CHIP}>
                      {u}
                    </span>
                  ))}
                </span>
                <span className="text-muted-foreground text-label-13">
                  {s.usedBy.length
                    ? `${P.shared.usedBy} ${s.usedBy.join(', ')}`
                    : 'Shared with every standard you add later'}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-copy-14 m-0 text-center">
            {sharedNames.length} shared registers. {LICENCE_NOTE}
          </p>
        </div>
      </section>

      {/* 6. the edition move */}
      <section aria-labelledby="edition-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="edition-title" {...P.edition} />
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <ol className="m-0 flex list-none flex-col gap-4 p-0">
                {P.edition.steps.map((s, i) => (
                  <li key={s.title} className="flex items-start gap-4">
                    <span className="bg-brand text-primary-foreground text-label-14 flex size-8 shrink-0 items-center justify-center rounded-full font-semibold">
                      {i + 1}
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-heading-16">{s.title}</span>
                      <span className="text-muted-foreground text-copy-14">{s.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {page.move ? (
                <p className="text-copy-14 m-0">
                  {page.move.equivalent} of the {page.move.of} requirements of {page.move.from} map
                  one to one onto {page.move.to}, so their answers copy across; the rest are listed
                  for you to review.
                </p>
              ) : null}
              <section
                aria-labelledby="edition-status"
                className="bg-card border-line flex flex-col gap-4 rounded-xl border p-5"
              >
                <h3 id="edition-status" className="text-heading-16 m-0">
                  {P.edition.statusTitle}
                </h3>
                <ul className="m-0 flex list-none flex-col gap-4 p-0">
                  {page.editions.map((e) => (
                    <li key={e.title} className="flex flex-col gap-1.5">
                      <span className="text-label-14 font-semibold">{e.title}</span>
                      {e.badge ? (
                        <span className="text-warn text-label-13 inline-flex items-start gap-1.5 font-medium">
                          <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
                          {e.badge}
                        </span>
                      ) : (
                        <span className="text-good text-label-13 inline-flex items-center gap-1.5 font-medium">
                          <CircleCheck aria-hidden="true" className="size-4" /> Current edition
                        </span>
                      )}
                      {e.note ? (
                        <span className="text-muted-foreground text-copy-14">{e.note}</span>
                      ) : null}
                      <span className="text-muted-foreground text-label-12">
                        {P.edition.checked} {e.checkedOn}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <Shot name={SHOTS.edition.shot} alt={SHOTS.edition.alt} />
          </div>
        </div>
      </section>

      {/* 7. audit day */}
      <section aria-labelledby="audit-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="audit-title" {...P.audit} />
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {P.audit.points.map((a, i) => {
              const Icon = [KeyRound, CircleCheck, FileArchive][i] ?? Check;
              return (
                <li
                  key={a.title}
                  className="bg-card border-line flex flex-col gap-3 rounded-xl border p-6"
                >
                  <span className="bg-soft flex size-10 items-center justify-center rounded-full">
                    <Icon aria-hidden="true" className="text-ink size-5" />
                  </span>
                  <h3 className="text-heading-16 m-0">{a.title}</h3>
                  <p className="text-muted-foreground text-copy-14 m-0">{a.body}</p>
                </li>
              );
            })}
          </ul>
          <div className="mx-auto w-full max-w-5xl">
            <Shot
              name={SHOTS.audit.shot}
              alt={SHOTS.audit.alt}
              sizes="(min-width: 1024px) 64rem, 100vw"
            />
          </div>
        </div>
      </section>

      {/* 8. own requirements */}
      <section aria-labelledby="own-title" className="border-line border-t">
        <div className={SECTION}>
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="flex flex-col items-start gap-5">
              <span className="bg-background-100 border-line text-label-13 text-ink rounded-full border px-3 py-1 font-medium">
                {P.own.pill}
              </span>
              <h2 id="own-title" className="text-heading-32 sm:text-heading-40 m-0 text-balance">
                {P.own.title}
              </h2>
              <p className="text-muted-foreground text-copy-16 sm:text-copy-18 m-0">{P.own.lead}</p>
              <Points items={P.own.points} />
            </div>
            <Shot name={SHOTS.own.shot} alt={SHOTS.own.alt} />
          </div>
        </div>
      </section>

      {/* 9. FAQ */}
      <section
        id="questions"
        aria-labelledby="faq-title"
        className="border-line scroll-mt-6 border-t"
      >
        <div className={SECTION}>
          <SectionHead
            id="faq-title"
            pill={P.faq.pill}
            title={P.faq.title}
            lead={P.hero.reassurance}
          />
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {FAQ.map((f) => (
              <details
                key={f.q}
                className="bg-card border-line group rounded-xl border px-5 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="text-heading-16 flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4">
                  {f.q}
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground text-heading-20 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="text-muted-foreground text-copy-14 m-0 pb-5">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 10. closing */}
      <section aria-labelledby="iso9001-closing" className="border-line border-t">
        <div className={`${WRAP} py-16 sm:py-24`}>
          <div className="bg-card border-line flex flex-col items-center gap-5 rounded-xl border px-6 py-12 text-center sm:py-16">
            <h2
              id="iso9001-closing"
              className="text-heading-32 sm:text-heading-40 m-0 text-balance"
            >
              {P.closing.title}
            </h2>
            <p className="text-muted-foreground text-copy-16 sm:text-copy-18 m-0">
              {P.closing.lead}
            </p>
            <StartButton full />
            <p className="text-muted-foreground text-label-13 m-0">{P.hero.reassurance}</p>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
