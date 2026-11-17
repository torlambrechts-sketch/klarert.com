import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { confirmCopy } from '@/lib/email-link';
import { ContinueForm } from './continue-form';
import { BRAND } from '@/lib/brand';

// Where our auth emails link to (docs/05 §1, docs/09 §12): `/auth/confirm?token_hash=…&type=…&next=…&redirect_to=…`.
// Link scanners (Microsoft Defender Safe Links and the like) open every link in an email before the person does, so
// this GET only shows the page and never opens the link: the token stays in a form, and the person's click on the
// button posts it to `/auth/callback`, which opens the session. Never indexed, no referrer (next.config.ts too), and
// the parameters are never logged.

export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : null);

/** The fields the form posts: only the four the callback reads. */
const FIELDS = ['token_hash', 'type', 'next', 'redirect_to'] as const;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}): Promise<Metadata> {
  const copy = confirmCopy(one((await searchParams).type));
  return {
    title: `${copy?.heading ?? 'Email link'} · ${BRAND.product}`,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function ConfirmEmailLinkPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const copy = confirmCopy(one(params.type));
  const fields: Record<string, string> = {};
  for (const name of FIELDS) {
    const value = one(params[name]);
    if (value) fields[name] = value;
  }

  if (!copy || !fields.token_hash) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1>{BRAND.product}</h1>
          <h2 className="text-heading-16">This link is not complete</h2>
        </div>
        <p role="alert" className="text-crit text-copy-13 m-0" data-testid="email-link-broken">
          Copy the whole link from the email, or ask for a new link.
        </p>
        <Link href="/login" autoFocus className={buttonVariants({ className: 'w-fit' })}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>{BRAND.product}</h1>
        <h2 className="text-heading-16">{copy.heading}</h2>
      </div>
      <ContinueForm fields={fields} button={copy.button} />
    </div>
  );
}
