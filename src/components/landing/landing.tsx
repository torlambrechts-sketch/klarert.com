import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BookOpen,
  FileArchive,
  Layers,
  Library,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readSiteCatalogue, siteFacts, soaExample } from '@/lib/site/catalogue';
import {
  CLOSING,
  FEATURES,
  FLOW,
  FRAMEWORKS_TEASER,
  HERO,
  LICENCE_NOTE,
  LINKS,
  PLATFORM_INTRO,
  PROBLEM,
  STANDARDS,
  STANDARDS_BAND,
  STATS,
  TRUST,
  TRUST_INTRO,
} from './content';
import { HeroMock } from './hero-mock';
import { Illustration, TRUST_ICONS } from './illustrations';
import { SectionHead, SiteShell, WRAP } from './site-chrome';

// The public product site at `/` for signed-out visitors (owner decision, 16 Nov 2026). A Server Component with no
// client code of its own: static HTML in the Geist tokens, no remote images, no trackers. Numbers come from the code
// (src/lib/site/catalogue.ts); the words from content.ts.

const SECTION = `${WRAP} flex flex-col gap-10 py-16 sm:py-24`;

export function Actions({ size = 'lg' }: { size?: 'default' | 'lg' }) {
  return (
    <div className="flex flex-wrap gap-3">
      <Button asChild size={size}>
        <Link href={LINKS.createAccount}>Create account</Link>
      </Button>
      <Button asChild size={size} variant="secondary">
        <Link href={LINKS.signIn}>Sign in</Link>
      </Button>
    </div>
  );
}

function Stats() {
  const facts = siteFacts();
  return (
    <dl className="m-0 grid grid-cols-2 gap-y-6 sm:grid-cols-4">
      {STATS.map((s, i) => (
        <div
          key={s.key}
          className={`border-line flex flex-col gap-1 pr-4 ${i % 2 === 1 ? 'border-l pl-5' : ''} ${i > 0 ? 'sm:border-l sm:pl-5' : ''}`}
        >
          <dt className="text-muted-foreground text-label-13">{s.label}</dt>
          <dd className="text-heading-24 order-first m-0">{facts[s.key as keyof typeof facts]}</dd>
        </div>
      ))}
    </dl>
  );
}

const FLOW_ICONS: Record<string, typeof Activity> = {
  standard: BookOpen,
  library: Library,
  registers: Layers,
  automations: Workflow,
  log: Activity,
  pack: FileArchive,
};

function FlowDiagram() {
  return (
    <ol className="m-0 flex list-none flex-col items-center gap-6 p-0 lg:grid lg:grid-cols-6 lg:items-stretch lg:gap-5">
      {FLOW.steps.map((s, i) => {
        const Icon = FLOW_ICONS[s.key] ?? Layers;
        const last = i === FLOW.steps.length - 1;
        return (
          <li key={s.key} className="relative flex w-full max-w-72 lg:max-w-none">
            {/* the connector: down on phones, across on desktop, spanning the gap to the next node */}
            {!last ? (
              <span
                aria-hidden="true"
                className="bg-line-strong absolute top-full left-1/2 h-6 w-px lg:top-1/2 lg:left-full lg:h-px lg:w-5"
              />
            ) : null}
            <span
              className={`flex w-full items-center gap-3 rounded-full border px-3 py-2 lg:flex-col lg:justify-start lg:gap-2 lg:rounded-xl lg:px-2 lg:py-4 lg:text-center ${last ? 'bg-brand text-primary-foreground border-transparent' : 'bg-background-100 border-line'}`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${last ? 'bg-gray-alpha-300' : 'bg-soft'}`}
              >
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="flex flex-col">
                <span className="text-label-14 font-semibold">{s.title}</span>
                <span
                  className={`text-label-12 ${last ? 'text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  {s.body}
                </span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Landing() {
  const catalogue = readSiteCatalogue();
  return (
    <SiteShell path={LINKS.home}>
      <section aria-labelledby="hero-title">
        <div
          className={`${WRAP} grid items-center gap-12 pt-8 pb-16 sm:pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12 lg:pb-24`}
        >
          <div className="flex flex-col items-start gap-6">
            <h1
              id="hero-title"
              className="text-heading-40 sm:text-heading-48 m-0 max-w-[22ch] text-balance"
            >
              {HERO.title}
            </h1>
            <p className="text-muted-foreground text-copy-16 sm:text-copy-18 m-0 max-w-[52ch]">
              {HERO.lead}
            </p>
            <Actions />
            <div className="mt-6 w-full">
              <Stats />
            </div>
          </div>
          <HeroMock soa={soaExample()} />
        </div>
      </section>

      <section aria-labelledby="sets-band" className="bg-background-100 border-line border-y">
        <div className={`${WRAP} flex flex-col gap-4 py-8 md:flex-row md:items-center md:gap-10`}>
          <h2
            id="sets-band"
            className="text-label-14 text-muted-foreground m-0 shrink-0 font-medium"
          >
            {STANDARDS_BAND.label}
          </h2>
          <ul className="m-0 flex list-none flex-wrap items-center gap-x-8 gap-y-3 p-0">
            {STANDARDS.map((s) => (
              <li key={s.name} className="text-label-16 text-ink font-semibold">
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="problem-title">
        <div className={SECTION}>
          <SectionHead id="problem-title" {...PROBLEM} />
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {PROBLEM.items.map((p) => (
              <li
                key={p.key}
                className="bg-card border-line flex flex-col gap-4 rounded-xl border p-3"
              >
                <Illustration name={p.key} className="h-56" />
                <div className="flex flex-col gap-2 px-2 pb-3">
                  <h3 className="text-heading-20 m-0">{p.title}</h3>
                  <p className="text-muted-foreground text-copy-14 m-0">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="platform-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="platform-title" {...PLATFORM_INTRO} />
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
            {FEATURES.map((f) => (
              <li
                key={f.key}
                className="bg-card border-line flex flex-col gap-4 rounded-xl border p-3"
              >
                <Illustration name={f.key} className="h-60" />
                <div className="flex flex-1 flex-col gap-2 px-2 pb-3">
                  <h3 className="text-heading-20 m-0">{f.title}</h3>
                  <p className="text-muted-foreground text-copy-14 m-0 flex-1">{f.body}</p>
                  <Link
                    href={`${LINKS.platform}#${f.key}`}
                    className="text-info text-label-14 mt-1 inline-flex min-h-11 items-center gap-1 self-start rounded-sm font-medium underline-offset-4 hover:underline sm:min-h-8"
                  >
                    <span>
                      More about this<span className="sr-only">: {f.title}</span>
                    </span>
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-center">
            <Button asChild size="lg" variant="secondary">
              <Link href={LINKS.platform}>See the whole platform</Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="flow-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="flow-title" {...FLOW} />
          <div className="bg-card border-line rounded-xl border p-6 sm:p-10">
            <FlowDiagram />
          </div>
        </div>
      </section>

      <section aria-labelledby="frameworks-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="frameworks-title" {...FRAMEWORKS_TEASER} />
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {catalogue.groups.map((g) => (
              <li
                key={g.id}
                className="bg-card border-line flex flex-col gap-4 rounded-xl border p-6"
              >
                <h3 className="text-heading-16 m-0">{g.title}</h3>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {g.sets.map((s) => (
                    <li key={s.key} className="flex flex-col">
                      <span className="text-label-14 font-medium">{s.title}</span>
                      <span className="text-muted-foreground text-label-12">
                        {s.sheets.length} {s.sheets.length === 1 ? 'sheet' : 'sheets'} ·{' '}
                        {s.sharedRegisters.length} shared{' '}
                        {s.sharedRegisters.length === 1 ? 'register' : 'registers'}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {catalogue.foundation ? (
            <p className="text-muted-foreground text-copy-14 m-0 text-center">
              Every standard builds on the {catalogue.foundation.title.toLowerCase()} (
              {catalogue.foundation.sheets.length} sheets). {LICENCE_NOTE}
            </p>
          ) : null}
          <div className="flex justify-center">
            <Button asChild size="lg" variant="secondary">
              <Link href={LINKS.frameworks}>See every framework</Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="trust-title" className="border-line border-t">
        <div className={SECTION}>
          <SectionHead id="trust-title" {...TRUST_INTRO} />
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((t) => {
              const Icon = TRUST_ICONS[t.key as keyof typeof TRUST_ICONS];
              return (
                <li
                  key={t.key}
                  className="bg-card border-line flex flex-col gap-3 rounded-xl border p-6"
                >
                  {Icon ? (
                    <span className="bg-soft flex size-10 items-center justify-center rounded-full">
                      <Icon aria-hidden="true" className="text-ink size-5" />
                    </span>
                  ) : null}
                  <h3 className="text-heading-16 m-0">{t.title}</h3>
                  <p className="text-muted-foreground text-copy-14 m-0">{t.body}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <Closing />
    </SiteShell>
  );
}

/** The closing call to action, shared by the product pages. */
export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="border-line border-t">
      <div className={`${WRAP} py-16 sm:py-24`}>
        <div className="bg-card border-line flex flex-col items-center gap-5 rounded-xl border px-6 py-12 text-center sm:py-16">
          <h2 id="closing-title" className="text-heading-32 sm:text-heading-40 m-0 text-balance">
            {CLOSING.title}
          </h2>
          <p className="text-muted-foreground text-copy-16 sm:text-copy-18 m-0">{CLOSING.lead}</p>
          <div className="flex justify-center">
            <Actions />
          </div>
        </div>
      </div>
    </section>
  );
}
