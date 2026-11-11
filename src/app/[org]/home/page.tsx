import Link from 'next/link';
import { isAdminRole, requireMember } from '@/server/auth';

export const metadata = { title: 'Home · Compliance OS' };

export default async function HomePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { workspace, role, profile } = await requireMember(org);
  const first = profile.display_name.split(/\s+/)[0];
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8">
      <h1>Good to see you, {first}</h1>
      <p className="text-muted-foreground">You are in {workspace.name}.</p>
      {isAdminRole(role) ? (
        <p>
          <Link className="text-focus underline-offset-4 hover:underline" href={`/${org}/settings`}>
            Invite colleagues and set up teams
          </Link>
        </p>
      ) : null}
    </main>
  );
}
