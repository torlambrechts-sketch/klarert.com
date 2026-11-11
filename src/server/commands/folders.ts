import 'server-only';
import { keyBetween } from '@/engine/ordering';
import { folderInput, folderRef, renameFolderInput } from '@/lib/schemas/sheets';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// Folders group sheets in the side menu (docs/05 §2.1). Editors manage them (RLS folders_write).

export async function createFolder(input: unknown): Promise<Result<{ id: string }>> {
  const p = folderInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data: last } = await supabase
        .from('folders')
        .select('position')
        .eq('org_id', orgId)
        .order('position', { ascending: false })
        .limit(1);
      const { data, error } = await supabase
        .from('folders')
        .insert({
          org_id: orgId,
          name: p.data.name,
          position: keyBetween(last?.[0]?.position ?? null, null),
        })
        .select('id')
        .single();
      return error ? fromDbError(error) : ok({ id: data.id });
    },
    'createFolder',
  );
}

export async function renameFolder(input: unknown): Promise<Result<null>> {
  const p = renameFolderInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('folders')
        .update({ name: p.data.name })
        .eq('id', p.data.folderId)
        .eq('org_id', orgId)
        .select('id');
      if (error) return fromDbError(error);
      return data.length ? ok(null) : fail('not_found', 'Folder not found.');
    },
    'renameFolder',
  );
}

/** Only empty folders can be deleted: sheets are never moved out silently. */
export async function deleteFolder(input: unknown): Promise<Result<null>> {
  const p = folderRef.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { count } = await supabase
        .from('sheets')
        .select('id', { count: 'exact', head: true })
        .eq('folder_id', p.data.folderId)
        .is('archived_at', null);
      if (count)
        return fail(
          'conflict',
          'This folder has sheets. Move them to another folder in their settings first.',
        );
      const { data, error } = await supabase
        .from('folders')
        .delete()
        .eq('id', p.data.folderId)
        .eq('org_id', orgId)
        .select('id');
      if (error) return fromDbError(error);
      return data.length ? ok(null) : fail('not_found', 'Folder not found.');
    },
    'deleteFolder',
  );
}
