import { notFound, redirect } from 'next/navigation';
import { SheetView } from '@/components/grid/sheet-view';
import { readTabSettings } from '@/engine/views/tabs';
import { NoAccess } from '@/components/access/no-access';
import { toLevel } from '@/engine/access';
import { requireMember } from '@/server/auth';
import { getSheet, getSheetAccess } from '@/server/repositories/sheets';
import { getSheetBundle } from '@/server/bundles/read';
import { getSheetSystem } from '@/server/packs/system';

function defaultViewOf(settings: unknown): string | null {
  const id =
    settings && typeof settings === 'object' && 'defaultViewId' in settings
      ? (settings as { defaultViewId?: unknown }).defaultViewId
      : null;
  return typeof id === 'string' && /^[0-9a-z-]{4,36}$/.test(id) ? id : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string; sheetId: string }>;
}) {
  const { org, sheetId } = await params;
  const { workspace } = await requireMember(org);
  const sheet = await getSheet(workspace.id, sheetId);
  return { title: `${sheet?.name ?? 'Sheet'} · Compliance OS` };
}

// The sheet page (docs/05 §3): the view tabs and the active view (?view=, else the sheet's default view, else List).
export default async function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; sheetId: string }>;
  searchParams: Promise<{ group?: string; item?: string }>;
}) {
  const { org, sheetId } = await params;
  const { group, item } = await searchParams;
  const { workspace, role, user } = await requireMember(org);
  const [sheet, access, bundle] = await Promise.all([
    getSheet(workspace.id, sheetId),
    getSheetAccess(workspace.id, sheetId),
    getSheetBundle(workspace.id, sheetId),
  ]);
  // a restricted sheet the person cannot open: owners and admins see that it exists (docs/02 §16)
  if (!sheet && access?.level === 'none') return <NoAccess org={org} name={access.name} />;
  if (!sheet) notFound();
  // sub-items live inside their parent sheet (docs/02 §12)
  if (sheet.parent_sheet_id)
    redirect(
      `/${org}/s/${sheet.parent_sheet_id}${item ? `?item=${encodeURIComponent(item)}` : ''}`,
    );
  const system = await getSheetSystem(workspace.id, sheet.id, sheet.settings);
  return (
    <>
      {sheet.archived_at ? (
        <p
          role="status"
          className="border-warn/40 text-warn bg-warn-soft text-copy-13 mx-4 mt-4 rounded-lg border px-3 py-2 sm:mx-7"
        >
          This sheet is archived. It is hidden from the side menu. Restore it in its settings.
        </p>
      ) : null}
      <SheetView
        org={org}
        sheetId={sheet.id}
        sheetName={sheet.name}
        description={sheet.description}
        folderName={sheet.folderName}
        archived={!!sheet.archived_at}
        userId={user.id}
        timeZone={workspace.time_zone}
        role={role}
        access={toLevel(access?.level ?? 'none')}
        restricted={!!access?.restricted}
        onlyGroup={group ?? null}
        defaultViewId={defaultViewOf(sheet.settings)}
        tabSet={readTabSettings(sheet.settings)}
        bundle={bundle}
        system={system}
      />
    </>
  );
}
