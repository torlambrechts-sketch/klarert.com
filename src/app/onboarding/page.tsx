import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMyWorkspaces, getSession } from '@/server/auth';
import { CreateWorkspaceForm, ProfileForm } from './forms';

export const metadata = { title: 'Get started · Compliance OS' };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && /^\/(?!\/)/.test(next) ? next : undefined;
  const session = await getSession();
  if (!session) redirect('/login');
  const workspaces = session.profile ? await getMyWorkspaces() : [];

  return (
    <main className="bg-soft flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="bg-card border-line w-full max-w-md rounded-[var(--radius-card)] border p-6 sm:p-8">
        {!session.profile ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <h1>Welcome</h1>
              <p className="text-muted-foreground">Tell your colleagues who you are.</p>
            </div>
            <ProfileForm email={session.user.email ?? ''} next={safeNext} />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <h1>Create a workspace</h1>
              <p className="text-muted-foreground">
                A workspace holds your organisation&apos;s sheets. Invited to an existing one? Open
                the invite link you were sent.
              </p>
            </div>
            <CreateWorkspaceForm defaultTimeZone="Europe/London" />
            {workspaces.length > 0 ? (
              <div className="border-line flex flex-col gap-2 border-t pt-4">
                <h2 className="text-sm font-semibold">Your workspaces</h2>
                <ul className="flex flex-col gap-1">
                  {workspaces.map((w) => (
                    <li key={w.id}>
                      <Link
                        className="text-info underline-offset-4 hover:underline"
                        href={`/${w.slug}`}
                      >
                        {w.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
