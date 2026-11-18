import { Check } from 'lucide-react';
import { LINKS, PLATFORM_FEATURES, PLATFORM_PAGE } from './content';
import { Illustration } from './illustrations';
import { Closing } from './landing';
import { SectionHead, SiteShell, WRAP } from './site-chrome';

// `/platform`: what the product does today, one large card per part, each with an HTML and CSS illustration. Every
// part is built and in docs/06; the words are in content.ts. Server Component, no client code.

export function PlatformPage() {
  return (
    <SiteShell path={LINKS.platform}>
      <section aria-labelledby="platform-page-title">
        <div className={`${WRAP} flex flex-col gap-8 pt-8 pb-12 sm:pt-12`}>
          <SectionHead
            as="h1"
            id="platform-page-title"
            pill="Platform"
            title={PLATFORM_PAGE.title}
            lead={PLATFORM_PAGE.lead}
          />
          <nav aria-label="On this page">
            <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
              {PLATFORM_FEATURES.map((f) => (
                <li key={f.key}>
                  <a
                    href={`#${f.key}`}
                    className="bg-surface border-line text-13 hover:bg-nav-hover flex min-h-11 items-center rounded-full border px-3 font-medium sm:min-h-8"
                  >
                    {f.pill}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      <div className={`${WRAP} flex flex-col gap-6 pb-16 sm:pb-24`}>
        {PLATFORM_FEATURES.map((f, i) => (
          <section
            key={f.key}
            id={f.key}
            aria-labelledby={`${f.key}-title`}
            className="bg-card border-line grid scroll-mt-6 gap-6 rounded-xl border p-3 lg:grid-cols-2 lg:gap-10"
          >
            <Illustration
              name={f.key}
              className={`min-h-64 lg:min-h-80 ${i % 2 === 1 ? 'lg:order-2' : ''}`}
            />
            <div className="flex flex-col justify-center gap-4 px-3 pb-5 lg:py-8 lg:pr-8">
              <span className="text-muted-foreground text-13 font-medium">{f.pill}</span>
              <h2 id={`${f.key}-title`} className="text-kpi sm:text-figure m-0">
                {f.title}
              </h2>
              <p className="text-muted-foreground text-16 m-0">{f.body}</p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {f.points.map((p) => (
                  <li key={p} className="text-14 flex items-start gap-2">
                    <Check aria-hidden="true" className="text-good mt-0.5 size-4 shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>

      <Closing />
    </SiteShell>
  );
}
