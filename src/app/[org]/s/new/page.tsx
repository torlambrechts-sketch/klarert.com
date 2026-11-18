import Link from 'next/link';
import { HeadCard, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { NewSheetWizard } from '@/components/sheets/wizard/wizard';
import { isEditorRole, requireMember } from '@/server/auth';
import { getNav, getWizardData } from '@/server/repositories/sheets';

export const metadata = { title: 'New sheet · Compliance OS' };

export default async function NewSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ start?: string; folder?: string; source?: string }>;
}) {
  const { org } = await params;
  const { start, folder, source } = await searchParams;
  const { workspace, role } = await requireMember(org);
  // Create is for editors, admins and owners (owner decision 15 Nov 2026): a viewer or auditor who reaches the
  // wizard by its address is told so and led back to Home
  if (!isEditorRole(role))
    return (
      <main className="flex w-full flex-col items-start gap-3 px-4 pt-5 pb-8 sm:px-12 sm:pt-[26px]">
        <h1 className="m-0">New sheet</h1>
        <p className="text-muted-foreground m-0 max-w-[60ch]">
          {role === 'auditor' ? 'Auditors' : 'Viewers'} cannot create sheets. Ask an editor or admin
          to create one for you.
        </p>
        <Button asChild variant="outline">
          <Link href={`/${org}/home`}>Back to Home</Link>
        </Button>
      </main>
    );
  const [nav, data] = await Promise.all([getNav(workspace.id), getWizardData(workspace.id)]);
  return (
    <main className="flex w-full flex-col gap-6 px-4 pt-5 pb-8 [--hero-gap:24px] sm:px-12 sm:pt-[26px]">
      <PageHeader
        crumb={workspace.name}
        title="New sheet"
        description="A sheet is a table of items. Every item gets the sheet’s fields; you can change them later."
      />
      <HeadCard>
        <NewSheetWizard
          startId={start ?? null}
          ctx={{
            org,
            folders: nav.folders.map((f) => ({ id: f.id, name: f.name })),
            prefixes: data.prefixes,
            sheets: data.sheets,
            folderId: folder ?? null,
            sourceId: source ?? null,
          }}
        />
      </HeadCard>
    </main>
  );
}
