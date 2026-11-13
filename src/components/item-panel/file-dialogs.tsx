'use client';

import { useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, RotateCcw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { archiveFileAction, setFileDetailsAction } from '@/app/[org]/s/panel-actions';
import { formatBytes } from '@/engine/files';
import { formatDateTime } from '@/engine/fields/helpers';
import {
  CLASSIFICATION_LABEL,
  CLASSIFICATIONS,
  previewOf,
  UPLOAD_ACCEPT,
  versionLabel,
  versionState,
  type Classification,
  type FileCategory,
  type FileChain,
  type FileVersionRow,
} from '@/engine/item-files';
import type { Ctx } from '@/engine/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SideSheetContent,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useDownloads } from './queries';

// The Files tab's dialogs (docs/05 §3.4): edit details, upload a new version with a note, version history (a side
// sheet; a bottom sheet at phone width), preview with previous/next, and archive (admins).

const fieldClass =
  'border-input focus-visible:border-focus focus-visible:ring-focus/30 bg-background-100 text-copy-14 w-full rounded-md border px-2.5 py-2 outline-none focus-visible:ring-2';

const personName = (ctx: Ctx, id: string | null | undefined) =>
  id ? (ctx.people.get(id)?.name ?? 'Former member') : 'Someone';

// ───────────────────────── edit details ─────────────────────────

export function DetailsDialog({
  org,
  file,
  categories,
  onClose,
  onSaved,
}: {
  org: string;
  file: FileVersionRow;
  categories: FileCategory[];
  onClose(): void;
  onSaved(file: FileVersionRow): void;
}) {
  const id = useId();
  const [description, setDescription] = useState(file.description ?? '');
  const [category, setCategory] = useState(file.category ?? '');
  const [validUntil, setValidUntil] = useState(file.validUntil ?? '');
  const [classification, setClassification] = useState<Classification>(
    (file.classification as Classification) ?? 'internal',
  );
  const [personalData, setPersonalData] = useState(!!file.personalData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await setFileDetailsAction({
      org,
      fileId: file.id,
      details: {
        description,
        category: category || null,
        validUntil: validUntil || null,
        classification,
        personalData,
      },
    });
    setSaving(false);
    if (!r.ok) return setError(r.error.message);
    toast('Details saved.');
    onSaved(r.data.file);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={`${id}-desc`}>
        <DialogTitle className="text-heading-16 m-0">Edit details</DialogTitle>
        <DialogDescription id={`${id}-desc`} className="text-muted-foreground text-copy-13 m-0">
          {file.filename} · {versionLabel(file.versionNo)}
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="text-label-13 flex flex-col gap-1">
            Description
            <textarea
              className={cn(fieldClass, 'min-h-16')}
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-label-13 flex flex-col gap-1">
              Category
              <select
                className={fieldClass}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-label-13 flex flex-col gap-1">
              Valid until
              <input
                type="date"
                className={fieldClass}
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </label>
            <label className="text-label-13 flex flex-col gap-1">
              Classification
              <select
                className={fieldClass}
                value={classification}
                onChange={(e) => setClassification(e.target.value as Classification)}
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {CLASSIFICATION_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-label-13 flex min-h-11 items-center gap-2 self-end">
              <input
                type="checkbox"
                className="size-4"
                checked={personalData}
                onChange={(e) => setPersonalData(e.target.checked)}
              />
              Contains personal data
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-crit text-copy-13 m-0">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save details'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── new version ─────────────────────────

export function NewVersionDialog({
  file,
  onClose,
  onUpload,
}: {
  file: FileVersionRow;
  onClose(): void;
  onUpload(file: File, note: string): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState<File | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={`${id}-desc`}>
        <DialogTitle className="text-heading-16 m-0">Upload a new version</DialogTitle>
        <DialogDescription id={`${id}-desc`} className="text-muted-foreground text-copy-13 m-0">
          {file.filename} is {versionLabel(file.versionNo)}. The new file becomes{' '}
          {versionLabel(file.versionNo + 1)}; every earlier version is kept.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) onUpload(chosen, note.trim());
          }}
        >
          <label className="text-label-13 flex flex-col gap-1">
            Version note
            <textarea
              className={cn(fieldClass, 'min-h-16')}
              value={note}
              maxLength={1000}
              placeholder="What changed in this version"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => input.current?.click()}>
              <Upload aria-hidden /> Choose file
            </Button>
            <span className="text-copy-13 text-muted-foreground min-w-0 truncate">
              {chosen ? chosen.name : 'No file chosen'}
            </span>
            <input
              ref={input}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose the new version"
              accept={UPLOAD_ACCEPT}
              onChange={(e) => {
                setChosen(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!chosen}>
              Upload {versionLabel(file.versionNo + 1)}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── version history ─────────────────────────

export function HistorySheet({
  chain,
  ctx,
  canRestore,
  onClose,
  onDownload,
  onRestore,
}: {
  chain: FileChain;
  ctx: Ctx;
  canRestore: boolean;
  onClose(): void;
  onDownload(file: FileVersionRow): Promise<unknown>;
  onRestore(file: FileVersionRow): void;
}) {
  const downloads = useDownloads(
    chain.versions.map((v) => v.id),
    true,
  );
  const byId = new Map(chain.versions.map((v) => [v.id, v]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SideSheetContent
        aria-describedby={undefined}
        className="max-[759px]:inset-x-0 max-[759px]:top-auto max-[759px]:max-h-[85vh] max-[759px]:w-full max-[759px]:rounded-t-xl max-[759px]:border-t max-[759px]:border-l-0"
      >
        <div className="border-line border-b px-5 pt-4 pr-12 pb-3">
          <DialogTitle className="text-heading-16 m-0">Version history</DialogTitle>
          <p className="text-muted-foreground text-copy-13 m-0 truncate">
            {chain.current.filename}
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Versions, newest first">
            {chain.versions.map((v) => {
              const state = versionState(v, chain.current);
              return (
                <li
                  key={v.id}
                  className={cn(
                    'border-line flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2.5',
                    v.id === chain.current.id && 'border-line-strong',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-label-13 m-0 flex flex-wrap items-center gap-1.5 font-semibold">
                      <span className="text-label-12-mono bg-soft rounded px-1.5">
                        {versionLabel(v.versionNo)}
                      </span>
                      <span className="min-w-0 truncate">{v.filename}</span>
                      {state ? (
                        <span
                          className={cn(
                            'text-label-12 rounded-full border px-2',
                            state === 'Obsolete'
                              ? 'border-line text-muted-foreground'
                              : 'border-good/40 text-good',
                          )}
                        >
                          {state === 'Obsolete'
                            ? '✕ Obsolete'
                            : state.includes('Approved')
                              ? `✓ ${state}`
                              : state}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground text-label-12 m-0">
                      {personName(ctx, v.uploadedBy)} · {formatDateTime(v.createdAt, ctx.timeZone)}{' '}
                      · {formatBytes(v.sizeBytes)}
                    </p>
                    {v.versionNote ? (
                      <p className="text-copy-13 m-0 mt-1">Note: {v.versionNote}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-11 sm:min-h-8"
                      aria-label={`Download ${versionLabel(v.versionNo)} of ${v.filename}`}
                      onClick={async () => {
                        await onDownload(v);
                        void downloads.refetch();
                      }}
                    >
                      <Download aria-hidden /> Download
                    </Button>
                    {canRestore && v.id !== chain.current.id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-11 sm:min-h-8"
                        aria-label={`Restore ${versionLabel(v.versionNo)} as a new version`}
                        onClick={() => onRestore(v)}
                      >
                        <RotateCcw aria-hidden /> Restore
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <section aria-labelledby="downloads-title" className="flex flex-col gap-2">
            <h3 id="downloads-title" className="text-heading-14 m-0">
              Downloads
            </h3>
            {downloads.isPending ? (
              <div aria-busy="true" className="bg-soft h-9 animate-pulse rounded" />
            ) : downloads.isError ? (
              <p className="text-copy-13 m-0 flex items-center gap-2">
                The downloads could not be loaded.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void downloads.refetch()}
                >
                  Retry
                </Button>
              </p>
            ) : (downloads.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-copy-13 m-0">
                Nobody has downloaded this file yet.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Downloads">
                {downloads.data!.map((d, i) => (
                  <li key={`${d.fileId}-${d.at}-${i}`} className="text-copy-13">
                    {personName(ctx, d.userId)} downloaded{' '}
                    {versionLabel(byId.get(d.fileId)?.versionNo)} ·{' '}
                    <span className="text-muted-foreground">
                      {formatDateTime(d.at, ctx.timeZone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </SideSheetContent>
    </Dialog>
  );
}

// ───────────────────────── preview ─────────────────────────

export function PreviewDialog({
  org,
  files,
  startId,
  onClose,
  onDownload,
}: {
  org: string;
  files: FileVersionRow[];
  startId: string;
  onClose(): void;
  onDownload(file: FileVersionRow): void;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      files.findIndex((f) => f.id === startId),
    ),
  );
  const file = files[index];
  if (!file) return null;
  const preview = previewOf(file.filename);
  const src = `/${org}/files/${file.id}/preview`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(860px,calc(100vh-32px))] w-[min(960px,calc(100vw-32px))] flex-col gap-3 p-4"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' && index < files.length - 1) setIndex(index + 1);
          if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
        }}
      >
        <div className="flex items-center gap-2 pr-8">
          <DialogTitle className="text-heading-16 m-0 min-w-0 flex-1 truncate">
            {file.filename}
          </DialogTitle>
          <span className="text-muted-foreground text-label-12" aria-live="polite">
            {index + 1} of {files.length}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Previous file"
            title="Previous file"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Next file"
            title="Next file"
            disabled={index >= files.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onDownload(file)}>
            <Download aria-hidden /> Download
          </Button>
        </div>
        <div className="bg-soft flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg">
          {preview?.kind === 'pdf' ? (
            <iframe
              key={file.id}
              title={`Preview of ${file.filename}`}
              src={src}
              className="h-full w-full border-0"
            />
          ) : preview?.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in stream, not a static asset
            <img
              key={file.id}
              src={src}
              alt={file.description || file.filename}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <FileText className="text-muted-foreground size-10" aria-hidden />
              <p className="text-copy-14 m-0">This type of file cannot be previewed here.</p>
              <Button type="button" onClick={() => onDownload(file)}>
                <Download aria-hidden /> Download {file.filename}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── archive ─────────────────────────

export function ArchiveDialog({
  org,
  chain,
  onClose,
  onArchived,
}: {
  org: string;
  chain: FileChain;
  onClose(): void;
  onArchived(): void;
}) {
  const id = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = chain.versions.length;
  const archive = async () => {
    setBusy(true);
    const r = await archiveFileAction({
      org,
      fileId: chain.current.id,
      archived: true,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error.message);
    toast(`${chain.current.filename} archived. Owners and admins can restore it.`);
    onArchived();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={`${id}-desc`}>
        <DialogTitle className="text-heading-16 m-0">Archive {chain.current.filename}?</DialogTitle>
        <DialogDescription id={`${id}-desc`} className="text-copy-14 m-0">
          {n === 1 ? 'The file' : `The file and its ${n} versions`} leave the Files tab, the
          evidence library and expiry checks. Nothing is deleted, and the activity log keeps the
          record.
        </DialogDescription>
        <label className="text-label-13 flex flex-col gap-1">
          Reason (optional)
          <input
            className={fieldClass}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void archive()}
          >
            {busy ? 'Archiving…' : 'Archive'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
