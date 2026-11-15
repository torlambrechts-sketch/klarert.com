'use client';

import { useRef, useState } from 'react';
import { Download, FileText, History, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  confirmUploadAction,
  downloadFileAction,
  prepareUploadAction,
} from '@/app/[org]/s/panel-actions';
import {
  acceptAttribute,
  acceptsFile,
  formatBytes,
  freshnessView,
  MAX_FILE_BYTES,
  toHex,
} from '@/engine/files';
import type { Freshness } from '@/engine/fields/evidence';
import { formatDate } from '@/engine/fields/helpers';
import { previewOf } from '@/engine/item-files';
import { filesExpire } from '@/engine/item-panel';
import type { Ctx, Field, FileRow, Item } from '@/engine/types';
import { Chip } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import type { FileVersion } from './queries';

// Evidence and attachment fields in the panel (docs/02 §8, FR-30/31): add, replace (the old version is kept),
// download through a short-lived signed URL, and evidence freshness. The browser hashes the file (SHA-256) before
// uploading; the server hashes the stored object again before it records the file.

const FRESH_COLOR: Record<Freshness, string> = {
  current: 'green',
  expiring: 'orange',
  expired: 'red',
  none: 'grey',
};

async function sha256Hex(file: File): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
}

export function FilesField({
  org,
  item,
  field,
  ctx,
  editable,
  versions,
  onSaved,
}: {
  org: string;
  item: Item;
  field: Field;
  ctx: Ctx;
  editable: boolean;
  versions: FileVersion[];
  onSaved(file: FileRow, replaces: string | null): void;
}) {
  const cfg = field.config as { accept?: string[]; multiple?: boolean };
  const accept = cfg.accept ?? [];
  const current = ctx.files(item.id, field.id);
  const expires = filesExpire(field);
  const fresh = expires ? freshnessView(current, ctx.today) : null;
  const input = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const older = versions.filter((v) => v.fieldId === field.id && v.replacedBy && !v.archivedAt);

  const pick = (replaces: string | null) => {
    replacing.current = replaces;
    input.current?.click();
  };

  const upload = async (file: File, replaces: string | null) => {
    if (file.size === 0) return toast.error('The file is empty.');
    if (file.size > MAX_FILE_BYTES) return toast.error('Files can be at most 25 MB.');
    if (!acceptsFile(accept, file.name, file.type))
      return toast.error(`${field.name} accepts ${accept.join(', ')} only.`);
    setBusy(replaces ? `Replacing with ${file.name}…` : `Uploading ${file.name}…`);
    try {
      const sha256 = await sha256Hex(file);
      const meta = {
        org,
        sheetId: item.sheetId,
        itemId: item.id,
        fieldId: field.id,
        filename: file.name,
        // the stored type comes from the extension for previewable files, never the browser's guess (0054)
        mime: previewOf(file.name)?.type ?? 'application/octet-stream',
        size: file.size,
        sha256,
        ...(replaces ? { replaces } : {}),
      };
      const prepared = await prepareUploadAction(meta);
      if (!prepared.ok) return toast.error(prepared.error.message);
      const { error } = await createClient()
        .storage.from('files')
        .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, {
          contentType: meta.mime,
        });
      if (error) return toast.error('The upload failed. Check your connection and try again.');
      const saved = await confirmUploadAction({ ...meta, fileId: prepared.data.fileId });
      if (!saved.ok) return toast.error(saved.error.message);
      onSaved(saved.data.file, replaces);
      toast(
        replaces
          ? `${saved.data.file.filename} replaced the old version. The old version is kept.`
          : `${saved.data.file.filename} added.`,
      );
      for (const m of saved.data.messages) toast(m);
    } catch {
      toast.error('The upload failed. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const download = async (f: FileRow) => {
    const r = await downloadFileAction({ org, fileId: f.id });
    if (!r.ok) return toast.error(r.error.message);
    const a = document.createElement('a');
    a.href = r.data.url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const canAdd = editable && (cfg.multiple !== false || current.length === 0);

  return (
    <div className="flex flex-col gap-2 py-1">
      {fresh && current.length > 0 ? (
        <p className="text-copy-13 flex flex-wrap items-center gap-2">
          <Chip
            option={{
              id: fresh.freshness,
              label: fresh.label,
              color: FRESH_COLOR[fresh.freshness],
              done: fresh.freshness === 'current',
            }}
          />
          <span className="text-muted-foreground">{fresh.detail}</span>
        </p>
      ) : null}
      {current.length === 0 ? (
        <p className="text-muted-foreground text-copy-13">No files yet.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label={`${field.name} files`}>
          {current.map((f) => (
            <li
              key={f.id}
              className="border-line text-label-13 flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5"
            >
              <FileText className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{f.filename}</span>
                <span className="text-muted-foreground text-label-12 block">
                  {formatBytes(f.sizeBytes)} · collected {formatDate(f.collectedAt)}
                  {f.validUntil ? ` · valid until ${formatDate(f.validUntil)}` : ''}
                  <span className="font-mono"> · SHA-256 {f.sha256.slice(0, 8)}</span>
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Download ${f.filename}`}
                onClick={() => void download(f)}
              >
                <Download aria-hidden /> Download
              </Button>
              {editable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Replace ${f.filename}`}
                  disabled={!!busy}
                  onClick={() => pick(f.id)}
                >
                  <RefreshCw aria-hidden /> Replace
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {busy ? (
        <p role="status" className="text-muted-foreground text-copy-13">
          {busy}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canAdd ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => pick(null)}
          >
            <Plus aria-hidden /> Add file
          </Button>
        ) : null}
        {older.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={showOlder}
            onClick={() => setShowOlder((s) => !s)}
          >
            <History aria-hidden /> Older versions · {older.length}
          </Button>
        ) : null}
      </div>
      {showOlder && older.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={`Older versions of ${field.name}`}>
          {older.map((f) => (
            <li key={f.id} className="text-label-12 flex items-center gap-2">
              <span className="text-muted-foreground min-w-0 flex-1 truncate">
                {f.filename} · {formatBytes(f.sizeBytes)} · collected {formatDate(f.collectedAt)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Download old version ${f.filename}`}
                onClick={() => void download(f)}
              >
                <Download aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {editable ? (
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label={`Choose a file for ${field.name}`}
          accept={acceptAttribute(accept) || undefined}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file, replacing.current);
          }}
        />
      ) : null}
    </div>
  );
}
