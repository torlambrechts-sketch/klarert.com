import { PageHeader } from '@/components/shell/page-header';
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
  if (!isEditorRole(role))
    return (
      <main className="w-full px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
        <h1>New sheet</h1>
        <p className="text-muted-foreground mt-2">
          Viewers cannot create sheets. Ask an editor or admin to create one for you.
        </p>
      </main>
    );
  const [nav, data] = await Promise.all([getNav(workspace.id), getWizardData(workspace.id)]);
  return (
    <main className="flex w-full flex-col gap-6 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
      <PageHeader
        className="border-line border-b pb-[18px]"
        crumb={workspace.name}
        title="New sheet"
        description="A sheet is a table of items. Every item gets the sheet’s fields; you can change them later."
      />
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
    </main>
  );
}
