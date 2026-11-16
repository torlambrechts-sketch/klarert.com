import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BRAND, CONTACT, LINKS } from './content';

// The frame of the public pages (`/`, `/privacy`, `/terms`): skip link, header, main and footer. Server Component,
// no client code, no remote resources.

export const WRAP = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8';

const LINK = 'text-info rounded-sm underline-offset-4 hover:underline';

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

export function SiteShell({ children }: { children: React.ReactNode }) {
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
        {children}
      </main>

      <footer className="border-line border-t">
        <div
          className={`${WRAP} text-muted-foreground text-label-13 flex flex-col gap-4 py-8 md:flex-row md:items-center md:justify-between`}
        >
          <div className="flex flex-col gap-1">
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
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
              <li>
                <Link className={LINK} href={LINKS.privacy}>
                  Privacy notice
                </Link>
              </li>
              <li>
                <Link className={LINK} href={LINKS.terms}>
                  Terms
                </Link>
              </li>
              <li>
                <Link className={LINK} href={LINKS.signIn}>
                  Sign in
                </Link>
              </li>
              <li>
                <Link className={LINK} href={LINKS.createAccount}>
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
