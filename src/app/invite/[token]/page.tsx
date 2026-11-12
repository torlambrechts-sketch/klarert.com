import { redirect } from 'next/navigation';
import { ROLE_LABELS } from '@/lib/schemas/workspace';
import { getSession } from '@/server/auth';
import { AcceptForm } from './accept-form';

export const metadata = { title: 'Invitation · Compliance OS' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const here = `/invite/${token}`;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(here)}`);
  if (!session.profile) redirect(`/onboarding?next=${encodeURIComponent(here)}`);

  const { data: invite } = /^[0-9a-f]{48}$/.test(token)
    ? await session.supabase.rpc('get_invite', { p_token: token }).maybeSingle()
    : { data: null };
  const email = session.user.email ?? '';

  return (
    <main className="bg-soft flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="bg-card border-line flex w-full max-w-md flex-col gap-5 rounded-lg border p-6 sm:p-8">
        {!invite ? (
          <>
            <h1>Invite not found</h1>
            <p className="text-muted-foreground">
              This link is not valid. Ask the person who invited you for a new one.
            </p>
          </>
        ) : invite.accepted ? (
          <>
            <h1>Invite already used</h1>
            <p className="text-muted-foreground">
              This invite to {invite.org_name} has been accepted. If that was you, open{' '}
              <a className="text-info underline" href={`/${invite.org_slug}`}>
                the workspace
              </a>
              .
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1>Join {invite.org_name}</h1>
              <p className="text-muted-foreground">
                {invite.invited_by_name ?? 'An admin'} invited{' '}
                <strong className="text-foreground">{invite.email}</strong> as{' '}
                {ROLE_LABELS[invite.role].toLowerCase()}.
              </p>
            </div>
            {invite.email.toLowerCase() !== email.toLowerCase() ? (
              <p role="alert" className="text-warn text-copy-13">
                You are signed in as {email}. Sign out and sign in as {invite.email} to accept.
              </p>
            ) : (
              <AcceptForm token={token} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
