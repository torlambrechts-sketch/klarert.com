import { Check } from 'lucide-react';
import { AUTH_PANEL } from '@/components/landing/content';
import { Panel, Dot } from '@/components/landing/mock-kit';
import { Wordmark } from '@/components/landing/site-chrome';

// The sign-in pages (sign in, create account, email link, forgot password, two-step, new password, account deleted)
// in the public site's look: the dotted light page in a large rounded container, the wordmark top left, the form card
// on one side and a calm panel of product facts on the other from 1024 px; one column on phones. Layout only: the
// pages' words, forms and behaviour are their own. The pages open with "Compliance OS" (h1) and then the step (h2);
// here the h1 reads as a small label over the step's title.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-soft flex min-h-dvh flex-col sm:p-3 lg:p-4">
      <div className="bg-subtle bg-dots border-line sm:rounded-page mx-auto flex w-full max-w-[1440px] flex-1 flex-col sm:border">
        <header className="mx-auto flex h-18 w-full max-w-6xl items-center px-4 sm:h-20 sm:px-8 lg:px-12">
          <Wordmark />
        </header>
        <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 pt-2 pb-12 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:px-12 lg:pb-20">
          <main className="bg-card border-line [&_h1]:text-label-13 [&_h1]:text-muted-foreground [&_h2]:text-heading-24 mx-auto w-full max-w-md rounded-xl border p-6 sm:p-8 lg:mx-0 lg:justify-self-end [&_h1]:font-medium">
            {children}
          </main>
          <aside aria-label="About Compliance OS" className="hidden flex-col gap-6 lg:flex">
            <p className="text-heading-32 m-0 max-w-[16ch] text-balance">{AUTH_PANEL.title}</p>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {AUTH_PANEL.points.map((p) => (
                <li key={p} className="text-copy-16 flex items-start gap-2">
                  <Check aria-hidden="true" className="text-good mt-1 size-4 shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
            <div aria-hidden="true" className="relative mt-2 max-w-sm">
              <Panel float className="flex rotate-1 flex-col gap-2 p-4">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-label-13 font-semibold">Activity log</span>
                  <Dot tone="good">✓ Chain intact</Dot>
                </span>
                <span className="text-label-12">Status · In treatment → Done</span>
                <span className="text-muted-foreground text-label-11-mono">sha256 3f9a…c21e</span>
              </Panel>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
