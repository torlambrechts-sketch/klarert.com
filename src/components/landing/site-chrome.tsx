import Link from 'next/link';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BRAND, CONTACT, LINKS, NAV } from './content';

// The frame of the public pages (`/`, `/platform`, `/frameworks`, `/privacy`, `/terms`): skip link, a very light
// page with a dotted pattern inside a large rounded container, the header with the active page as a pill, main and
// the footer. Server Component: the phone menu is a <details>, so the pages ship no client code of their own.

export const WRAP = 'mx-auto w-full max-w-6xl px-4 sm:px-8 lg:px-12';

const LINK = 'text-info rounded-sm underline-offset-4 hover:underline';

export function Wordmark() {
  return (
    <Link
      href={LINKS.home}
      className="text-ink flex min-h-11 flex-col justify-center rounded-sm leading-none sm:flex-row sm:items-baseline sm:gap-1.5"
    >
      <span className="text-heading-16">{BRAND.product}</span>
      <span className="text-muted-foreground text-label-12">by {BRAND.company}</span>
    </Link>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'text-label-14 flex h-9 items-center rounded-full border px-3.5 font-medium transition-colors',
        active
          ? 'bg-background-100 border-line text-ink'
          : 'text-muted-foreground hover:bg-nav-hover hover:text-ink border-transparent',
      )}
    >
      {label}
    </Link>
  );
}

/** `path` is the page's own address: it marks the active nav item and resets the phone menu between pages. */
export function SiteShell({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <div className="bg-soft flex min-h-dvh flex-col sm:p-3 lg:p-4">
      <a
        href="#main"
        className="bg-brand text-primary-foreground text-label-14 sr-only rounded-md px-3 py-2 font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <div className="bg-subtle bg-dots border-line sm:rounded-page mx-auto flex w-full max-w-[1440px] flex-1 flex-col overflow-clip sm:border">
        <header>
          <div className={`${WRAP} flex h-18 items-center justify-between gap-3 sm:h-20`}>
            <Wordmark />
            <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
              {NAV.map((n) => (
                <NavLink key={n.href} {...n} active={n.href === path} />
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" className="hidden md:inline-flex">
                <Link href={LINKS.signIn}>Sign in</Link>
              </Button>
              <Button asChild className="h-11 md:h-10">
                <Link href={LINKS.createAccount}>Create account</Link>
              </Button>
              <nav aria-label="Main" className="relative md:hidden">
                <details key={path} className="group">
                  <summary className="border-line bg-background-100 text-ink text-label-14 flex size-11 cursor-pointer list-none items-center justify-center rounded-md border font-medium [&::-webkit-details-marker]:hidden">
                    <Menu aria-hidden="true" className="size-5" />
                    <span className="sr-only">Menu</span>
                  </summary>
                  <ul className="bg-popover border-line shadow-menu absolute top-full right-0 z-40 m-0 mt-2 flex w-56 list-none flex-col gap-1 rounded-lg border p-1.5">
                    {[...NAV, { href: LINKS.signIn, label: 'Sign in' }].map((n) => (
                      <li key={n.href}>
                        <Link
                          href={n.href}
                          aria-current={n.href === path ? 'page' : undefined}
                          className="text-label-14 hover:bg-nav-hover aria-[current=page]:bg-nav-active flex h-11 items-center rounded-md px-3 font-medium"
                        >
                          {n.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </nav>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>

        <footer className="bg-background-100 border-line border-t">
          <div
            className={`${WRAP} text-muted-foreground text-label-13 flex flex-col gap-6 py-10 md:flex-row md:items-start md:justify-between`}
          >
            <div className="flex flex-col gap-2">
              <Wordmark />
              <p className="m-0">
                © {BRAND.company}. {BRAND.product} is made by {BRAND.company}.
              </p>
              <p className="m-0">
                Questions:{' '}
                <a className={LINK} href={`mailto:${CONTACT.email}`}>
                  {CONTACT.email}
                </a>
              </p>
            </div>
            <nav aria-label="Footer">
              <ul className="m-0 grid list-none grid-cols-2 gap-x-10 gap-y-1 p-0 sm:grid-cols-3">
                {[
                  { href: LINKS.platform, label: 'Platform' },
                  { href: LINKS.frameworks, label: 'Frameworks' },
                  { href: LINKS.signIn, label: 'Sign in' },
                  { href: LINKS.createAccount, label: 'Create account' },
                  { href: LINKS.privacy, label: 'Privacy notice' },
                  { href: LINKS.terms, label: 'Terms' },
                ].map((l) => (
                  <li key={l.href}>
                    <Link className={`${LINK} flex min-h-11 items-center sm:min-h-8`} href={l.href}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** A section head: the small pill label, a centred h2 and a grey lead. */
export function SectionHead({
  id,
  pill,
  title,
  lead,
  as: Heading = 'h2',
}: {
  id: string;
  pill: string;
  title: string;
  lead: string;
  as?: 'h1' | 'h2';
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
      <span className="bg-background-100 border-line text-label-13 text-ink rounded-full border px-3 py-1 font-medium">
        {pill}
      </span>
      <Heading
        id={id}
        className={cn(
          'm-0 text-balance',
          Heading === 'h1'
            ? 'text-heading-32 sm:text-heading-48'
            : 'text-heading-32 sm:text-heading-40',
        )}
      >
        {title}
      </Heading>
      <p className="text-muted-foreground text-copy-16 sm:text-copy-18 m-0 max-w-[60ch] text-pretty">
        {lead}
      </p>
    </div>
  );
}
