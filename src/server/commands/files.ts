import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { acceptsFile, safeFilename, storagePath } from '@/engine/files';
import { checkUpload, fileCategories, previewOf } from '@/engine/item-files';
import { resolveFieldType } from '@/engine/fields/resolve';
import '@/engine/fields/registry';
import type { FileRow } from '@/engine/types';
import type { Json } from '@/lib/database.types';
import {
  archiveFileInput,
  confirmUploadInput,
  downloadFileInput,
  prepareUploadInput,
  setFileDetailsInput,
} from '@/lib/schemas/panel';
import { toFile, toFileVersion } from '@/lib/sheet-rows';
import type { Db } from '@/lib/sheet-query';
import { isAdminRole, type Role } from '@/server/auth';
import { runAutomations } from '@/server/automations';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import type { FileVersionRow } from '@/engine/item-files';
import { confirmWith } from './confirm-upload';
import { log, withOrg } from './context';

// Files (docs/02 §8, FR-30/31): prepareUpload hands the browser a signed upload URL for a fresh file id; the browser
// uploads; confirmUpload hashes the stored object on the server, checks what it really is (allow-list, magic bytes,
// 25 MB) and records it with add_file (row + activity entry in one transaction). A file belongs to a file field or,
// with no field, to the item's Files tab. Storage is read and written with the person's own client, so the bucket's
// policies apply. Downloads go through download_file, which logs each one (file_access_log).

const BUCKET = 'files';
/** Signed download links live this long (seconds). */
const LINK_SECONDS = 60;

type FileTarget = {
  orgId: string;
  itemId: string;
  sheetId: string;
  locked: boolean;
  lockReason: string | null;
};

type FieldTarget = { accept: string[]; multiple?: boolean; name: string } | null;

const lockedMessage = (reason: string | null) =>
  reason
    ? `This item is locked: ${reason}. Only owners and admins can change it.`
    : 'This item is locked. Only owners and admins can change it.';

/** The item and (for a file field) the evidence/attachment field an upload is for, checked against the lock. */
async function target(
  db: Db,
  who: { orgId: string; role: Role },
  input: { sheetId: string; itemId: string; fieldId: string | null },
): Promise<Result<{ item: FileTarget; field: FieldTarget }>> {
  const [item, field] = await Promise.all([
    db
      .from('items')
      .select('id, org_id, sheet_id, locked, lock_reason, archived_at')
      .eq('id', input.itemId)
      .maybeSingle(),
    input.fieldId
      ? db
          .from('fields')
          .select('id, sheet_id, type, name, config, archived_at')
          .eq('id', input.fieldId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const it = item.data;
  if (!it || it.org_id !== who.orgId || it.sheet_id !== input.sheetId || it.archived_at)
    return fail('not_found', 'This item no longer exists or was archived.');
  let fieldTarget: FieldTarget = null;
  if (input.fieldId) {
    const f = field.data;
    if (
      !f ||
      f.archived_at ||
      f.sheet_id !== it.sheet_id ||
      resolveFieldType(f.type)?.storage !== 'files'
    )
      return fail('not_found', 'This field no longer exists.');
    const cfg = (f.config ?? {}) as { accept?: string[]; multiple?: boolean };
    fieldTarget = { accept: cfg.accept ?? [], multiple: cfg.multiple, name: f.name };
  }
  if (it.locked && !isAdminRole(who.role)) return fail('forbidden', lockedMessage(it.lock_reason));
  return ok({
    item: {
      orgId: it.org_id,
      itemId: it.id,
      sheetId: it.sheet_id,
      locked: it.locked,
      lockReason: it.lock_reason,
    },
    field: fieldTarget,
  });
}

/** The current, live versions of the field (or of the Files tab) on the item. */
async function currentFiles(db: Db, itemId: string, fieldId: string | null) {
  const q = db
    .from('files')
    .select('id')
    .eq('item_id', itemId)
    .is('replaced_by', null)
    .is('archived_at', null);
  const { data } = await (fieldId ? q.eq('field_id', fieldId) : q.is('field_id', null));
  return (data ?? []).map((r) => r.id);
}

/** A category must be one of the workspace's (stored by id). */
async function knownCategory(db: Db, orgId: string, id: string | null | undefined) {
  if (!id) return true;
  const { data } = await db.from('orgs').select('settings').eq('id', orgId).maybeSingle();
  return fileCategories(data?.settings).some((c) => c.id === id);
}

/** The name-level checks (extension, size): the bytes are checked again once stored. */
function nameProblem(filename: string, size: number): string | null {
  // a head that matches nothing: only the extension and size rules can fail here, never the content rule
  const r = checkUpload(filename, size, new Uint8Array(0));
  if (r.ok) return null;
  return /content does not match/.test(r.reason) ? null : r.reason;
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
      const problem = nameProblem(filename, v.size);
      if (problem) return fail('invalid', problem);
      const field = t.data.field;
      if (field && !acceptsFile(field.accept, filename, v.mime))
        return fail('invalid', `${field.name} accepts ${field.accept.join(', ')} only.`);
      if (!(await knownCategory(supabase, orgId, v.details?.category)))
        return fail('invalid', 'Choose a category.');
      const current = await currentFiles(supabase, v.itemId, v.fieldId);
      if (v.replaces && !current.includes(v.replaces))
        return fail('conflict', 'That file was replaced in the meantime. Reload the item.');
      if (field && !v.replaces && field.multiple === false && current.length > 0)
        return fail('invalid', `${field.name} holds one file. Replace the current file instead.`);
      const fileId = randomUUID();
      const path = storagePath(orgId, v.itemId, fileId, filename);
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) return fromDbError(error ?? { message: 'no upload url' });
      return ok({ fileId, path, token: data.token, filename });
    },
    'prepareUpload',
  );
}

export type ConfirmedUpload = { file: FileRow; version: FileVersionRow; messages: string[] };

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
      if (!(await knownCategory(supabase, orgId, v.details?.category)))
        return fail('invalid', 'Choose a category.');
      const filename = safeFilename(v.filename);
      const path = storagePath(orgId, v.itemId, v.fileId, filename);
      const d = v.details ?? {};
      const meta = {
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.category ? { category: d.category } : {}),
        ...(d.validUntil ? { valid_until: d.validUntil } : {}),
        ...(d.classification ? { classification: d.classification } : {}),
        ...(d.personalData !== undefined ? { personal_data: d.personalData } : {}),
        ...(v.versionNote ? { version_note: v.versionNote } : {}),
      };
      let saved: FileVersionRow | null = null;
      const r = await confirmWith(
        {
          download: async (at) => {
            const { data, error } = await supabase.storage.from(BUCKET).download(at);
            return error || !data ? null : new Uint8Array(await data.arrayBuffer());
          },
          sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
          inspect: (bytes) => {
            const c = checkUpload(filename, bytes.byteLength, bytes.subarray(0, 4096));
            return c.ok ? null : c.reason;
          },
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
              p_replaces: v.replaces ?? null,
              p_meta: meta as Json,
            });
            if (error) return fromDbError(error);
            saved = toFileVersion(data);
            return ok(toFile(data));
          },
          log: (fields) =>
            log('confirmUpload.check', { org: orgId, user: user.id, item: v.itemId, ...fields }),
        },
        { path, sha256: v.sha256, size: v.size },
      );
      if (!r.ok) return r;
      // a file field's value is its current versions: the event names the version replaced and the new one.
      // Files of the Files tab are not a field value: no value event (evidence expiry watches them by date).
      const outcome = v.fieldId
        ? await runAutomations(
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
          )
        : { messages: [] as string[] };
      return ok({ file: r.data, version: saved!, messages: outcome.messages });
    },
    'confirmUpload',
  );
}

/**
 * A short-lived download link for one file version (members). download_file refuses blocked files and, for people
 * who are not admins, archived ones, and logs the download; the link sets Content-Disposition: attachment.
 */
export async function downloadFile(input: unknown): Promise<Result<{ url: string }>> {
  const p = downloadFileInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data: row, error: rpcError } = await supabase.rpc('download_file', {
        p_file: v.fileId,
      });
      if (rpcError) return fromDbError(rpcError);
      if (!row || row.org_id !== orgId) return fail('not_found', 'This file no longer exists.');
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, LINK_SECONDS, { download: row.filename });
      if (error || !data) return fail('failed', 'The download link could not be made. Try again.');
      return ok({ url: data.signedUrl });
    },
    'downloadFile',
  );
}

/**
 * The bytes of a PDF or image for the preview dialog, with the content type forced from the extension (never what
 * the uploader claimed). The route serves them inline with nosniff; every other type is download-only.
 */
export async function previewFile(
  input: unknown,
): Promise<Result<{ bytes: Uint8Array; type: string; filename: string }>> {
  const p = downloadFileInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data: row, error: rpcError } = await supabase.rpc('download_file', {
        p_file: v.fileId,
      });
      if (rpcError) return fromDbError(rpcError);
      if (!row || row.org_id !== orgId) return fail('not_found', 'This file no longer exists.');
      const preview = previewOf(row.filename);
      if (!preview) return fail('invalid', 'This type of file cannot be previewed. Download it.');
      const { data, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
      if (error || !data) return fail('failed', 'The file could not be read. Try again.');
      return ok({
        bytes: new Uint8Array(await data.arrayBuffer()),
        type: preview.type,
        filename: row.filename,
      });
    },
    'previewFile',
  );
}

/** Edit a version's details: category, description, valid until, classification, personal data (file.updated). */
export async function setFileDetails(input: unknown): Promise<Result<{ file: FileVersionRow }>> {
  const p = setFileDetailsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      if (!(await knownCategory(supabase, orgId, v.details.category)))
        return fail('invalid', 'Choose a category.');
      const d = v.details;
      const meta = {
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.category !== undefined ? { category: d.category ?? '' } : {}),
        ...(d.validUntil !== undefined ? { valid_until: d.validUntil ?? '' } : {}),
        ...(d.classification ? { classification: d.classification } : {}),
        ...(d.personalData !== undefined ? { personal_data: d.personalData } : {}),
      };
      const { data, error } = await supabase.rpc('set_file_meta', {
        p_file: v.fileId,
        p_meta: meta as Json,
      });
      if (error) return fromDbError(error);
      if (data.org_id !== orgId) return fail('not_found', 'This file no longer exists.');
      return ok({ file: toFileVersion(data) });
    },
    'setFileDetails',
  );
}

/** Archive (or restore) a file and every version of it. Owners and admins only; logged on the item. */
export async function archiveFile(input: unknown): Promise<Result<{ fileId: string }>> {
  const p = archiveFileInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data: row } = await supabase
        .from('files')
        .select('id, org_id')
        .eq('id', v.fileId)
        .maybeSingle();
      if (!row || row.org_id !== orgId) return fail('not_found', 'This file no longer exists.');
      const { error } = v.archived
        ? await supabase.rpc('archive_file', { p_file: v.fileId, p_note: v.note ?? null })
        : await supabase.rpc('restore_file', { p_file: v.fileId });
      if (error) return fromDbError(error);
      return ok({ fileId: v.fileId });
    },
    'archiveFile',
  );
}
