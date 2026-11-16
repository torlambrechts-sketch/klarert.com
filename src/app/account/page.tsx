import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { formatDate, formatDateTime, isoDateInZone } from '@/engine/fields/helpers';
import { safeNext } from '@/lib/safe-next';
import { verifiedApps } from '@/lib/two-step';
import { getMyWorkspaces, getSignIn, requireProfile } from '@/server/auth';
import { Button } from '@/components/ui/button';
import { TwoStepPanel } from '@/components/account/two-step-panel';
import { EmailPanel, PasswordPanel, type EmailNotice } from '@/components/account/sign-in-details';
import { DeleteAccountPanel } from '@/components/account/delete-account';
import { NamePanel } from '@/components/account/name-panel';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Your account · ${BRAND.product}` };

// Your account (docs/05 §1): the person's own settings, outside any workspace so a workspace that requires two-step
// sign-in can send people here to set it up. Your name, email address, password, two-step sign-in (an authenticator
// app), this session and Delete my account (`?delete=open` opens its dialog: where the two-step page sends the person
// back to).
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; required?: string; email?: string; delete?: string }>;
}) {
  const { next: rawNext, required, email: emailNotice, delete: deleteOpen } = await searchParams;
  const next = safeNext(rawNext);
  const session = await requireProfile(
    next ? `/account?next=${encodeURIComponent(next)}` : '/account',
  );
  const signIn = await getSignIn();
  const workspaces = await getMyWorkspaces();
  const back = workspaces.find((w) => next?.split('/')[1] === w.slug) ?? workspaces[0];
  const requiredBy = workspaces.find((w) => w.slug === required && w.requireTwoStep);
  const timeZone = back?.time_zone ?? 'Europe/London';
  const apps = verifiedApps(session.user.factors).map((f) => ({
    id: f.id,
    added: formatDate(isoDateInZone(f.created_at, timeZone)),
  }));
  const requiringNames = workspaces.filter((w) => w.requireTwoStep).map((w) => w.name);
  // an email change waiting for its links, and how the last link went (/auth/callback, src/lib/auth-links.ts)
  const pendingEmail = session.user.new_email ?? null;
  const notice: EmailNotice =
    emailNotice === 'confirm-other' || emailNotice === 'link-failed' ? emailNotice : null;
  const signInDetails = (
    <>
      <NamePanel name={session.profile.display_name} />
      <EmailPanel email={session.user.email ?? ''} pendingEmail={pendingEmail} notice={notice} />
      <PasswordPanel />
    </>
  );

  return (
    <main className="bg-soft flex min-h-dvh justify-center px-4 py-8 sm:py-12">
      <div className="flex w-full max-w-xl flex-col gap-5">
        <Link
          href={next ?? '/'}
          className="text-label-13 text-muted-foreground hover:text-ink inline-flex w-fit items-center gap-1.5 rounded-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {back ? `Back to ${back.name}` : 'Back'}
        </Link>
        <div className="flex flex-col gap-1">
          <h1>Your account</h1>
          <p className="text-muted-foreground text-copy-14">
            {session.profile.display_name} · {session.user.email}
          </p>
        </div>

        {requiredBy && session.twoStep.level !== 'aal2' ? (
          <p
            role="status"
            data-testid="two-step-required"
            className="border-warn bg-warn-soft text-copy-13 flex items-start gap-2 rounded-lg border px-4 py-3"
          >
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {requiredBy.name} requires two-step sign-in. Set it up below to open the workspace.
            </span>
          </p>
        ) : null}

        {/* sent here to set up two-step sign-in: that card comes first */}
        {requiredBy ? null : signInDetails}
        <TwoStepPanel
          apps={apps}
          email={session.user.email ?? ''}
          continueTo={requiredBy ? (next ?? `/${requiredBy.slug}`) : null}
          requiredBy={requiringNames}
        />
        {requiredBy ? signInDetails : null}

        <section
          aria-labelledby="session-heading"
          className="border-line bg-background-100 flex flex-col gap-3 rounded-lg border p-5 sm:px-[22px]"
        >
          <h2 id="session-heading" className="text-heading-16">
            This session
          </h2>
          <p className="text-copy-14 m-0" data-testid="signed-in-since">
            {signIn?.signedInAt
              ? `Signed in since ${formatDateTime(signIn.signedInAt, timeZone)}`
              : 'Signed in'}
            {session.twoStep.level === 'aal2' ? ', with two-step sign-in.' : '.'}
          </p>
          <p className="text-muted-foreground text-copy-13 m-0">
            Sessions end some hours after you sign in, and sooner if you are away. Sign out when you
            use a shared computer.
          </p>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </section>

        <DeleteAccountPanel email={session.user.email ?? ''} openOnLoad={deleteOpen === 'open'} />
      </div>
    </main>
  );
}
