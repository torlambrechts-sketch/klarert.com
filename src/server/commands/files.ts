import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { acceptsFile, safeFilename, storagePath } from '@/engine/files';
import { resolveFieldType } from '@/engine/fields/resolve';
import '@/engine/fields/registry';
import type { FileRow } from '@/engine/types';
import { confirmUploadInput, downloadFileInput, prepareUploadInput } from '@/lib/schemas/panel';
import { toFile } from '@/lib/sheet-rows';
import type { Db } from '@/lib/sheet-query';
import { isAdminRole, type Role } from '@/server/auth';
import { runAutomations } from '@/server/automations';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { confirmWith } from './confirm-upload';
import { log, withOrg } from './context';

// Files (docs/02 §8, FR-30/31): prepareUpload hands the browser a signed upload URL for a fresh file id; the browser
// uploads; confirmUpload hashes the stored object on the server and records it with add_file (row + activity entry in
// one transaction). Storage is read and written with the person's own client, so the bucket's policies apply.

const BUCKET = 'files';

type FileTarget = {
  orgId: string;
  itemId: string;
  sheetId: string;
  locked: boolean;
  lockReason: string | null;
};

/** The item and the evidence/attachment field an upload is for, checked against the workspace and the lock. */
async function target(
  db: Db,
  who: { orgId: string; role: Role },
  input: { sheetId: string; itemId: string; fieldId: string },
): Promise<
  Result<{ item: FileTarget; config: { accept?: string[]; multiple?: boolean }; name: string }>
> {
  const [item, field] = await Promise.all([
    db
      .from('items')
      .select('id, org_id, sheet_id, locked, lock_reason, archived_at')
      .eq('id', input.itemId)
      .maybeSingle(),
    db
      .from('fields')
      .select('id, sheet_id, type, name, config, archived_at')
      .eq('id', input.fieldId)
      .maybeSingle(),
  ]);
  const it = item.data;
  if (!it || it.org_id !== who.orgId || it.sheet_id !== input.sheetId || it.archived_at)
    return fail('not_found', 'This item no longer exists or was archived.');
  const f = field.data;
  if (
    !f ||
    f.archived_at ||
    f.sheet_id !== it.sheet_id ||
    resolveFieldType(f.type)?.storage !== 'files'
  )
    return fail('not_found', 'This field no longer exists.');
  if (it.locked && !isAdminRole(who.role))
    return fail(
      'forbidden',
      it.lock_reason
        ? `This item is locked: ${it.lock_reason}. Only owners and admins can change it.`
        : 'This item is locked. Only owners and admins can change it.',
    );
  return ok({
    item: {
      orgId: it.org_id,
      itemId: it.id,
      sheetId: it.sheet_id,
      locked: it.locked,
      lockReason: it.lock_reason,
    },
    config: (f.config ?? {}) as { accept?: string[]; multiple?: boolean },
    name: f.name,
  });
}

/** The current versions of the field on the item. */
async function currentFiles(db: Db, itemId: string, fieldId: string) {
  const { data } = await db
    .from('files')
    .select('id')
    .eq('item_id', itemId)
    .eq('field_id', fieldId)
    .is('replaced_by', null);
  return (data ?? []).map((r) => r.id);
}

export type PreparedUpload = { fileId: string; path: string; token: string; filename: string };

export async function prepareUpload(input: unknown): Promise<Result<PreparedUpload>> {
  const p = prepareUploadInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role }) => {
      const t = await target(supabase, { orgId, role }, v);
      if (!t.ok) return t;
      const filename = safeFilename(v.filename);
      if (!acceptsFile(t.data.config.accept ?? [], filename, v.mime))
        return fail(
          'invalid',
          `${t.data.name} accepts ${(t.data.config.accept ?? []).join(', ')} only.`,
        );
      const current = await currentFiles(supabase, v.itemId, v.fieldId);
      if (v.replaces && !current.includes(v.replaces))
        return fail('conflict', 'That file was replaced in the meantime. Reload the item.');
      if (!v.replaces && t.data.config.multiple === false && current.length > 0)
        return fail('invalid', `${t.data.name} holds one file. Replace the current file instead.`);
      const fileId = randomUUID();
      const path = storagePath(orgId, v.itemId, fileId, filename);
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) return fromDbError(error ?? { message: 'no upload url' });
      return ok({ fileId, path, token: data.token, filename });
    },
    'prepareUpload',
  );
}

export type ConfirmedUpload = { file: FileRow; messages: string[] };

export async function confirmUpload(input: unknown): Promise<Result<ConfirmedUpload>> {
  const p = confirmUploadInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const t = await target(supabase, { orgId, role }, v);
      if (!t.ok) return t;
      const filename = safeFilename(v.filename);
      const path = storagePath(orgId, v.itemId, v.fileId, filename);
      const r = await confirmWith(
        {
          download: async (at) => {
            const { data, error } = await supabase.storage.from(BUCKET).download(at);
            return error || !data ? null : new Uint8Array(await data.arrayBuffer());
          },
          sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
          addFile: async () => {
            const { data, error } = await supabase.rpc('add_file', {
              p_item: v.itemId,
              p_field: v.fieldId,
              p_file: v.fileId,
              p_path: path,
              p_filename: filename,
              p_mime: v.mime,
              p_size: v.size,
              p_sha256: v.sha256,
              p_replaces: v.replaces,
            });
            return error ? fromDbError(error) : ok(toFile(data));
          },
          log: (fields) =>
            log('confirmUpload.check', { org: orgId, user: user.id, item: v.itemId, ...fields }),
        },
        { path, sha256: v.sha256, size: v.size },
      );
      if (!r.ok) return r;
      // a file field's value is its current versions: the event names the version replaced and the new one
      const outcome = await runAutomations(
        [
          {
            type: 'value.changed',
            sheetId: v.sheetId,
            itemId: v.itemId,
            fieldId: v.fieldId,
            before: v.replaces ?? null,
            after: r.data.id,
            actor: { kind: 'user', id: user.id },
          },
        ],
        { orgId, userId: user.id, workspace: v.org },
      );
      return ok({ file: r.data, messages: outcome.messages });
    },
    'confirmUpload',
  );
}

/** A short-lived download link for one file version (members; storage RLS checks the path). */
export async function downloadFile(input: unknown): Promise<Result<{ url: string }>> {
  const p = downloadFileInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data: row } = await supabase
        .from('files')
        .select('storage_path, filename, org_id')
        .eq('id', v.fileId)
        .maybeSingle();
      if (!row || row.org_id !== orgId) return fail('not_found', 'This file no longer exists.');
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, 60, { download: row.filename });
      if (error || !data) return fail('failed', 'The download link could not be made. Try again.');
      return ok({ url: data.signedUrl });
    },
    'downloadFile',
  );
}
