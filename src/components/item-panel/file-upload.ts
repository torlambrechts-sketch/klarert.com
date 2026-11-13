'use client';

import { confirmUploadAction, prepareUploadAction } from '@/app/[org]/s/panel-actions';
import { toHex } from '@/engine/files';
import { checkUpload, previewOf, type FileVersionRow } from '@/engine/item-files';
import type { FileRow } from '@/engine/types';
import { createClient } from '@/lib/supabase/client';

// One upload from the Files tab (docs/02 §8): check the name, size and first bytes in the browser (the server checks
// the stored bytes again), hash, get a signed upload URL, upload, confirm. Cancelling before the confirm leaves the
// object unreferenced: no files row ever points at it.

export type UploadStep = 'checking' | 'uploading' | 'saving';

export interface UploadRequest {
  org: string;
  sheetId: string;
  itemId: string;
  file: File;
  replaces?: string | null;
  versionNote?: string;
  details?: { category?: string | null; validUntil?: string | null };
  onStep?(step: UploadStep): void;
  cancelled?(): boolean;
}

export type UploadOutcome =
  | { ok: true; file: FileRow; version: FileVersionRow; messages: string[] }
  | { ok: false; reason: string; cancelled?: boolean };

const CANCELLED: UploadOutcome = { ok: false, reason: 'Cancelled.', cancelled: true };

export async function uploadItemFile(r: UploadRequest): Promise<UploadOutcome> {
  try {
    r.onStep?.('checking');
    const head = new Uint8Array(await r.file.slice(0, 4096).arrayBuffer());
    const check = checkUpload(r.file.name, r.file.size, head);
    if (!check.ok) return { ok: false, reason: check.reason };
    const sha256 = toHex(await crypto.subtle.digest('SHA-256', await r.file.arrayBuffer()));
    if (r.cancelled?.()) return CANCELLED;
    // the stored type comes from the extension for previewable files, never the browser's guess for the rest
    const mime = previewOf(r.file.name)?.type ?? 'application/octet-stream';
    const meta = {
      org: r.org,
      sheetId: r.sheetId,
      itemId: r.itemId,
      fieldId: null,
      filename: r.file.name,
      mime,
      size: r.file.size,
      sha256,
      ...(r.replaces ? { replaces: r.replaces } : {}),
      ...(r.versionNote ? { versionNote: r.versionNote } : {}),
      ...(r.details ? { details: r.details } : {}),
    };
    const prepared = await prepareUploadAction(meta);
    if (!prepared.ok) return { ok: false, reason: prepared.error.message };
    if (r.cancelled?.()) return CANCELLED;
    r.onStep?.('uploading');
    const { error } = await createClient()
      .storage.from('files')
      .uploadToSignedUrl(prepared.data.path, prepared.data.token, r.file, { contentType: mime });
    if (error)
      return { ok: false, reason: 'The upload failed. Check your connection and try again.' };
    if (r.cancelled?.()) return CANCELLED;
    r.onStep?.('saving');
    const saved = await confirmUploadAction({ ...meta, fileId: prepared.data.fileId });
    if (!saved.ok) return { ok: false, reason: saved.error.message };
    return { ok: true, ...saved.data };
  } catch {
    return { ok: false, reason: 'The upload failed. Check your connection and try again.' };
  }
}

/** A guess for the category of a new file: photos for images, else none. */
export const guessCategory = (filename: string): string | null =>
  previewOf(filename)?.kind === 'image' ? 'photo' : null;
