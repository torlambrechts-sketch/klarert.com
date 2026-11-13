import 'server-only';
import { cache } from 'react';
import { sheetCodes } from '@/lib/sheet-codes';
import { getSession } from '@/server/auth';

// Reads for the app shell and the sheet pages. Run under the user's session and RLS.

export type NavSheet = { id: string; name: string; code: string; folderId: string | null };
export type NavFolder = { id: string; name: string; sheets: NavSheet[] };
export type Nav = { folders: NavFolder[]; unfiled: NavSheet[] };

/** Folders with their (non-archived) sheets and rail codes. */
export const getNav = cache(async (orgId: string): Promise<Nav> => {
  const session = await getSession();
  if (!session) return { folders: [], unfiled: [] };
  const db = session.supabase;
  const [{ data: folders }, { data: sheets }] = await Promise.all([
    db.from('folders').select('id, name, position').eq('org_id', orgId).order('position'),
    db
      .from('sheets')
      .select('id, name, folder_id, position, created_at')
      .eq('org_id', orgId)
      .is('archived_at', null)
      // sub-item sheets live inside their parent sheet, not in the side menu (docs/02 §12)
      .is('parent_sheet_id', null)
      .order('position'),
  ]);
  const codes = sheetCodes(
    (sheets ?? []).map((s) => ({ id: s.id, name: s.name, createdAt: s.created_at })),
  );
  const nav = (sheets ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    code: codes.get(s.id)!,
    folderId: s.folder_id,
  }));
  const folderIds = new Set((folders ?? []).map((f) => f.id));
  return {
    folders: (folders ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      sheets: nav.filter((s) => s.folderId === f.id),
    })),
    unfiled: nav.filter((s) => !s.folderId || !folderIds.has(s.folderId)),
  };
});

export type SheetGroup = {
  id: string;
  name: string;
  color: string;
  position: string;
  count: number;
};

/** One sheet of the workspace with its groups and the number of (non-archived) items in each. */
export const getSheet = cache(async (orgId: string, sheetId: string) => {
  const session = await getSession();
  if (!session) return null;
  const db = session.supabase;
  if (!/^[0-9a-f-]{36}$/i.test(sheetId)) return null;
  const { data: sheet } = await db
    .from('sheets')
    .select(
      'id, name, description, item_label, id_prefix, next_seq, is_library, folder_id, archived_at, created_at, settings, parent_sheet_id, folders(name)',
    )
    .eq('id', sheetId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (!sheet) return null;
  const { data: groups } = await db
    .from('groups')
    .select('id, name, color, position')
    .eq('sheet_id', sheet.id)
    .order('position');
  const counts = await Promise.all(
    (groups ?? []).map((g) =>
      db
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', g.id)
        .is('archived_at', null)
        .then((r) => r.count ?? 0),
    ),
  );
  const withCounts: SheetGroup[] = (groups ?? []).map((g, i) => ({ ...g, count: counts[i]! }));
  return {
    ...sheet,
    folderName: sheet.folders?.name ?? null,
    groups: withCounts,
    total: counts.reduce((a, b) => a + b, 0),
  };
});

export type SheetDetail = NonNullable<Awaited<ReturnType<typeof getSheet>>>;

export async function getFields(sheetId: string) {
  const session = await getSession();
  if (!session) return [];
  const { data } = await session.supabase
    .from('fields')
    .select('id, key, name, type, locked')
    .eq('sheet_id', sheetId)
    .is('archived_at', null)
    .order('position');
  return data ?? [];
}

/** Archived items of a sheet, newest first (FR-13: they can be restored from the sheet settings). */
/** The sheet's views the person can see (shared ones and their own), in view order. */
export async function getViews(sheetId: string) {
  const session = await getSession();
  if (!session) return [];
  const { data } = await session.supabase
    .from('views')
    .select('*')
    .eq('sheet_id', sheetId)
    .order('position');
  return data ?? [];
}

export async function getArchivedItems(sheetId: string) {
  const session = await getSession();
  if (!session) return [];
  const { data } = await session.supabase
    .from('items')
    .select('id, display_id, name, archived_at')
    .eq('sheet_id', sheetId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
    .limit(200);
  return (data ?? []).map((r) => ({
    id: r.id,
    displayId: r.display_id,
    name: r.name,
    archivedAt: r.archived_at!,
  }));
}

/** Prefixes in use (archived sheets keep theirs) and sheets that can be copied. */
export async function getWizardData(orgId: string) {
  const session = await getSession();
  if (!session) return { prefixes: [], sheets: [] };
  const { data } = await session.supabase
    .from('sheets')
    .select('id, name, id_prefix, is_library, archived_at, parent_sheet_id')
    .eq('org_id', orgId)
    .order('name');
  return {
    prefixes: (data ?? []).flatMap((s) => (s.id_prefix ? [s.id_prefix] : [])),
    sheets: (data ?? [])
      .filter((s) => !s.archived_at && !s.parent_sheet_id)
      .map((s) => ({ id: s.id, name: s.name, isLibrary: s.is_library })),
  };
}

/** The child sheet of a sheet with sub-items, and the key of its first date field ("Due in N days" in templates). */
export async function getSubitemSheet(sheetId: string) {
  const session = await getSession();
  if (!session) return null;
  const db = session.supabase;
  const { data: child } = await db
    .from('sheets')
    .select('id')
    .eq('parent_sheet_id', sheetId)
    .maybeSingle();
  if (!child) return null;
  const { data: fields } = await db
    .from('fields')
    .select('key, type')
    .eq('sheet_id', child.id)
    .is('archived_at', null)
    .order('position');
  return { id: child.id, dueKey: (fields ?? []).find((f) => f.type === 'date')?.key ?? null };
}
