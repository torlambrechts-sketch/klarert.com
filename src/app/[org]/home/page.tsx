import Link from 'next/link';
import { Plus } from 'lucide-react';
import { FolderManager } from '@/components/sheets/folders';
import { Button } from '@/components/ui/button';
import { isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import { getNav } from '@/server/repositories/sheets';

export const metadata = { title: 'Home · Compliance OS' };

export default async function HomePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { workspace, role, profile } = await requireMember(org);
  const nav = await getNav(workspace.id);
  const first = profile.display_name.split(/\s+/)[0];
  const sheetCount = nav.folders.reduce((n, f) => n + f.sheets.length, 0) + nav.unfiled.length;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1>Good to see you, {first}</h1>
        <p className="text-muted-foreground">
          You are in {workspace.name}.{' '}
          {sheetCount === 0
            ? 'There are no sheets yet.'
            : sheetCount === 1
              ? 'It has 1 sheet.'
              : `It has ${sheetCount} sheets.`}
        </p>
      </div>
      {isEditorRole(role) ? (
        <div>
          <Button asChild>
            <Link href={`/${org}/s/new`}>
              <Plus aria-hidden /> New sheet
            </Link>
          </Button>
        </div>
      ) : null}
      {isAdminRole(role) ? (
        <p>
          <Link className="text-focus underline-offset-4 hover:underline" href={`/${org}/settings`}>
            Invite colleagues and set up teams
          </Link>
        </p>
      ) : null}
      {isEditorRole(role) ? (
        <section className="border-line flex flex-col gap-4 rounded-[var(--radius-card)] border bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-bold">Folders</h2>
            <p className="text-muted-foreground text-sm">
              Folders are the sections of the side menu. A folder can be deleted once it is empty.
            </p>
          </div>
          <FolderManager
            org={org}
            folders={nav.folders.map((f) => ({
              id: f.id,
              name: f.name,
              sheetCount: f.sheets.length,
            }))}
          />
        </section>
      ) : null}
    </main>
  );
}
