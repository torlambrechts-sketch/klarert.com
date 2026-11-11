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
      'id, name, description, item_label, id_prefix, next_seq, is_library, folder_id, archived_at, created_at, folders(name)',
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

/** Prefixes in use (archived sheets keep theirs) and sheets that can be copied. */
export async function getWizardData(orgId: string) {
  const session = await getSession();
  if (!session) return { prefixes: [], sheets: [] };
  const { data } = await session.supabase
    .from('sheets')
    .select('id, name, id_prefix, is_library, archived_at')
    .eq('org_id', orgId)
    .order('name');
  return {
    prefixes: (data ?? []).map((s) => s.id_prefix),
    sheets: (data ?? [])
      .filter((s) => !s.archived_at)
      .map((s) => ({ id: s.id, name: s.name, isLibrary: s.is_library })),
  };
}

/** Open requests to me: the part of the My work badge that exists before M9 (overdue items arrive with M9). */
export const getMyWorkCount = cache(async (orgId: string) => {
  const session = await getSession();
  if (!session) return 0;
  const { count } = await session.supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('user_id', session.user.id)
    .eq('kind', 'request')
    .is('done_at', null);
  return count ?? 0;
});
