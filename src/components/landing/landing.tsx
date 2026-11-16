import Link from 'next/link';
import { Fingerprint, KeyRound, MapPin, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BRAND,
  CLOSING,
  FEATURES,
  HERO,
  LINKS,
  STANDARDS,
  STANDARDS_INTRO,
  TRUST,
  TRUST_INTRO,
} from './content';
import { SheetMock } from './sheet-mock';

// The public product site at `/` for signed-out visitors (owner decision, 16 Nov 2026). A Server Component with no
// client code of its own: static HTML in the Geist tokens, no remote images, no trackers.

const TRUST_ICONS = {
  eu: MapPin,
  trail: ShieldCheck,
  'two-step': KeyRound,
  'by-id': Fingerprint,
} as const;

const WRAP = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8';

function Wordmark() {
  return (
    <Link
      href="/"
      className="text-ink flex flex-col rounded-sm leading-none sm:flex-row sm:items-baseline sm:gap-1.5"
    >
      <span className="text-heading-16">{BRAND.product}</span>
      <span className="text-muted-foreground text-label-12">by {BRAND.company}</span>
    </Link>
  );
}

function Actions({ size }: { size: 'sm' | 'lg' }) {
  return (
    <>
      <Button asChild size={size}>
        <Link href={LINKS.createAccount}>Create account</Link>
      </Button>
      <Button asChild size={size} variant="secondary">
        <Link href={LINKS.signIn}>Sign in</Link>
      </Button>
    </>
  );
}

export function Landing() {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-brand text-primary-foreground text-label-14 sr-only rounded-md px-3 py-2 font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <header className="border-line border-b">
        <div className={`${WRAP} flex h-16 items-center justify-between gap-3`}>
          <Wordmark />
          <nav aria-label="Account" className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link href={LINKS.signIn}>Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={LINKS.createAccount}>Create account</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <section aria-labelledby="hero-title" className="border-line border-b">
          <div
            className={`${WRAP} grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 lg:py-24`}
          >
            <div className="flex flex-col items-start gap-6">
              <h1 id="hero-title" className="text-heading-32 sm:text-heading-48 m-0 max-w-[18ch]">
                {HERO.title}
              </h1>
              <p className="text-muted-foreground text-copy-16 sm:text-copy-18 m-0 max-w-[56ch]">
                {HERO.lead}
              </p>
              <div className="flex flex-wrap gap-3">
                <Actions size="lg" />
              </div>
            </div>
            <SheetMock />
          </div>
        </section>

        <section aria-labelledby="standards-title" className="bg-subtle border-line border-b">
          <div className={`${WRAP} flex flex-col gap-6 py-12 sm:py-16`}>
            <div className="flex max-w-3xl flex-col gap-3">
              <h2 id="standards-title" className="text-heading-24 m-0">
                {STANDARDS_INTRO.title}
              </h2>
              <p className="text-muted-foreground text-copy-16 m-0">{STANDARDS_INTRO.lead}</p>
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {STANDARDS.map((s) => (
                <li
                  key={s.name}
                  className="bg-card border-line text-label-14 rounded-full border px-3.5 py-1.5 font-medium"
                >
                  {s.name}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-copy-13 m-0">{STANDARDS_INTRO.note}</p>
          </div>
        </section>

        <section aria-labelledby="features-title" className="border-line border-b">
          <div className={`${WRAP} flex flex-col gap-8 py-12 sm:py-16`}>
            <h2 id="features-title" className="text-heading-24 m-0">
              What you can do with it
            </h2>
            <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
              {FEATURES.map((f) => (
                <li
                  key={f.key}
                  className="bg-card border-line flex flex-col gap-2 rounded-lg border p-6"
                >
                  <h3 className="text-heading-16 m-0">{f.title}</h3>
                  <p className="text-muted-foreground text-copy-14 m-0">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="trust-title" className="bg-subtle border-line border-b">
          <div className={`${WRAP} flex flex-col gap-8 py-12 sm:py-16`}>
            <h2 id="trust-title" className="text-heading-24 m-0">
              {TRUST_INTRO.title}
            </h2>
            <ul className="m-0 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {TRUST.map((t) => {
                const Icon = TRUST_ICONS[t.key as keyof typeof TRUST_ICONS];
                return (
                  <li key={t.key} className="flex flex-col gap-2">
                    {Icon ? <Icon aria-hidden="true" className="text-ink size-5" /> : null}
                    <h3 className="text-heading-14 m-0">{t.title}</h3>
                    <p className="text-muted-foreground text-copy-14 m-0">{t.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section aria-labelledby="closing-title">
          <div className={`${WRAP} flex flex-col items-start gap-4 py-12 sm:py-16`}>
            <h2 id="closing-title" className="text-heading-24 m-0">
              {CLOSING.title}
            </h2>
            <p className="text-muted-foreground text-copy-16 m-0">{CLOSING.lead}</p>
            <div className="flex flex-wrap gap-3">
              <Actions size="lg" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-line border-t">
        <div
          className={`${WRAP} text-muted-foreground text-label-13 flex flex-col gap-3 py-8 sm:flex-row sm:items-center sm:justify-between`}
        >
          <p className="m-0">
            © {BRAND.company}. {BRAND.product} is made by {BRAND.company}.
          </p>
          {/* TODO(owner): link Privacy and Terms here once those pages exist; none do yet, so none are linked. */}
          <nav aria-label="Footer">
            <ul className="m-0 flex list-none gap-4 p-0">
              <li>
                <Link className="text-info underline-offset-4 hover:underline" href={LINKS.signIn}>
                  Sign in
                </Link>
              </li>
              <li>
                <Link
                  className="text-info underline-offset-4 hover:underline"
                  href={LINKS.createAccount}
                >
                  Create account
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
