import 'server-only';
import { edgeKey, placeBetween, sortByName } from '@/engine/organise';
import { folderInput, folderRef, moveFolderInput, renameFolderInput } from '@/lib/schemas/sheets';
import type { ServerClient } from '@/lib/supabase/server';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// Folders group sheets in the side menu (docs/05 §2.1). They organise; they do not restrict who sees a sheet.
// Owners and admins create, rename, reorder, sort, archive and delete folders (RLS folders_update/_delete check it
// again). The one exception is a sheet made from a template: createSheet may create the template's folder for an
// editor (docs/02 §1). Every change is logged by the folders_audit trigger on the workspace chain.

export async function activeFolders(db: ServerClient, orgId: string) {
  const { data } = await db
    .from('folders')
    .select('id, name, position')
    .eq('org_id', orgId)
    .is('archived_at', null);
  return data ?? [];
}

async function folderInOrg(db: ServerClient, orgId: string, folderId: string) {
  const { data } = await db
    .from('folders')
    .select('id, name, archived_at')
    .eq('id', folderId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data;
}

const notFound = () => fail('not_found', 'Folder not found.');

/** Insert a folder at the top or the end of the menu. Shared with createSheet (template folders). */
export async function insertFolder(
  db: ServerClient,
  orgId: string,
  name: string,
  at: 'first' | 'last',
): Promise<Result<{ id: string }>> {
  const level = await activeFolders(db, orgId);
  const { data, error } = await db
    .from('folders')
    .insert({ org_id: orgId, name, position: edgeKey(level, at) })
    .select('id')
    .single();
  return error ? fromDbError(error) : ok({ id: data.id });
}

export async function createFolder(input: unknown): Promise<Result<{ id: string }>> {
  const p = folderInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    ({ supabase, orgId }) => insertFolder(supabase, orgId, p.data.name, p.data.at ?? 'last'),
    'createFolder',
  );
}

export async function renameFolder(input: unknown): Promise<Result<null>> {
  const p = renameFolderInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('folders')
        .update({ name: p.data.name })
        .eq('id', p.data.folderId)
        .eq('org_id', orgId)
        .select('id');
      if (error) return fromDbError(error);
      return data.length ? ok(null) : notFound();
    },
    'renameFolder',
  );
}

/** Reorder a folder: the server reads the neighbours' current keys and puts the folder between them. */
export async function moveFolder(
  input: unknown,
): Promise<Result<{ index: number; total: number }>> {
  const p = moveFolderInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const folder = await folderInOrg(supabase, orgId, v.folderId);
      if (!folder || folder.archived_at) return notFound();
      const level = await activeFolders(supabase, orgId);
      const placed = placeBetween(level, folder.id, v.before, v.after);
      if (!placed.ok)
        return fail('conflict', 'The menu changed while you moved the folder. Try again.');
      for (const r of placed.rekey) {
        const { error } = await supabase
          .from('folders')
          .update({ position: r.position })
          .eq('id', r.id)
          .eq('org_id', orgId);
        if (error) return fromDbError(error);
      }
      const { error } = await supabase
        .from('folders')
        .update({ position: placed.position })
        .eq('id', folder.id)
        .eq('org_id', orgId);
      return error ? fromDbError(error) : ok({ index: placed.index, total: placed.total });
    },
    'moveFolder',
  );
}

/** One-off: the folder's sheets get new keys in A–Z order. Sheets added later go to the end as usual. */
export async function sortFolderAZ(input: unknown): Promise<Result<{ sorted: number }>> {
  const p = folderRef.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const folder = await folderInOrg(supabase, orgId, p.data.folderId);
      if (!folder || folder.archived_at) return notFound();
      const { data: sheets, error: readError } = await supabase
        .from('sheets')
        .select('id, name')
        .eq('org_id', orgId)
        .eq('folder_id', folder.id)
        .is('archived_at', null)
        .is('parent_sheet_id', null);
      if (readError) return fromDbError(readError);
      for (const r of sortByName(sheets ?? [])) {
        const { error } = await supabase
          .from('sheets')
          .update({ position: r.position })
          .eq('id', r.id)
          .eq('org_id', orgId);
        if (error) return fromDbError(error);
      }
      return ok({ sorted: sheets?.length ?? 0 });
    },
    'sortFolderAZ',
  );
}

/**
 * Archive a folder together with its sheets (set_folder_archived: one transaction, one timestamp), or restore it
 * with the sheets archived with it. The menu asks first and lists the sheets.
 */
async function setArchived(input: unknown, archived: boolean, command: string) {
  const p = folderRef.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }): Promise<Result<{ sheets: number }>> => {
      const folder = await folderInOrg(supabase, orgId, p.data.folderId);
      if (!folder) return notFound();
      const { data, error } = await supabase.rpc('set_folder_archived', {
        p_folder: folder.id,
        p_archived: archived,
      });
      return error ? fromDbError(error) : ok({ sheets: data ?? 0 });
    },
    command,
  );
}

export const archiveFolder = (input: unknown) => setArchived(input, true, 'archiveFolder');
export const restoreFolder = (input: unknown) => setArchived(input, false, 'restoreFolder');

/** Only empty folders (no sheets, archived ones included) can be deleted: sheets are never moved out silently. */
export async function deleteFolder(input: unknown): Promise<Result<null>> {
  const p = folderRef.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { count } = await supabase
        .from('sheets')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('folder_id', p.data.folderId)
        .is('parent_sheet_id', null);
      if (count)
        return fail(
          'conflict',
          'This folder has sheets, archived ones included. Move them to another folder first.',
        );
      const { data, error } = await supabase
        .from('folders')
        .delete()
        .eq('id', p.data.folderId)
        .eq('org_id', orgId)
        .select('id');
      if (error) return fromDbError(error);
      return data.length ? ok(null) : notFound();
    },
    'deleteFolder',
  );
}
