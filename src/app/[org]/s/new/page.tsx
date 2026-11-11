import { NewSheetWizard } from '@/components/sheets/wizard/wizard';
import { isEditorRole, requireMember } from '@/server/auth';
import { getNav, getWizardData } from '@/server/repositories/sheets';

export const metadata = { title: 'New sheet · Compliance OS' };

export default async function NewSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ start?: string }>;
}) {
  const { org } = await params;
  const { start } = await searchParams;
  const { workspace, role } = await requireMember(org);
  if (!isEditorRole(role))
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1>New sheet</h1>
        <p className="text-muted-foreground mt-2">
          Viewers cannot create sheets. Ask an editor or admin to create one for you.
        </p>
      </main>
    );
  const [nav, data] = await Promise.all([getNav(workspace.id), getWizardData(workspace.id)]);
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1>New sheet</h1>
        <p className="text-muted-foreground">
          A sheet is a table of items. Every item gets the sheet’s fields; you can change them
          later.
        </p>
      </div>
      <NewSheetWizard
        startId={start ?? null}
        ctx={{
          org,
          folders: nav.folders.map((f) => ({ id: f.id, name: f.name })),
          prefixes: data.prefixes,
          sheets: data.sheets,
        }}
      />
    </main>
  );
}
