'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Paperclip,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  addDocumentsFieldAction,
  archiveFileAction,
  downloadFileAction,
} from '@/app/[org]/s/panel-actions';
import { formatBytes } from '@/engine/files';
import { formatDate } from '@/engine/fields/helpers';
import {
  categoryLabel,
  CLASSIFICATION_LABEL,
  fileChains,
  isClassification,
  looksLikeControlledDocument,
  previewOf,
  UPLOAD_ACCEPT,
  validityView,
  versionLabel,
  type FileCategory,
  type FileChain,
  type FileVersionRow,
} from '@/engine/item-files';
import { filesExpire } from '@/engine/item-panel';
import type { Ctx, Field, Item } from '@/engine/types';
import type { FoundDocument, LinkedDocuments } from '@/server/commands/documents';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  ArchiveDialog,
  DetailsDialog,
  HistorySheet,
  NewVersionDialog,
  PreviewDialog,
} from './file-dialogs';
import { guessCategory, uploadItemFile, type UploadStep } from './file-upload';
import { LinkDocumentDialog } from './link-document-dialog';

// The item's Files tab (docs/05 §3.4): a drop zone for files of the item itself (not tied to a column) and "Link a
// document"; the linked controlled documents (always their last approved version), then the files, with the files of
// file columns labelled "From column: X". Each file: category, version, validity, classification, personal data;
// preview, download (logged), new version with a note, version history, details, archive (admins).

type Filter = 'all' | 'evidence' | 'expiring';

interface UploadRow {
  key: number;
  name: string;
  step: UploadStep | 'failed';
  reason?: string;
  cancelled: boolean;
}

const STEP_LABEL: Record<UploadStep, string> = {
  checking: 'Checking…',
  uploading: 'Uploading…',
  saving: 'Saving…',
};

const VALIDITY_CLASS = {
  valid: 'text-good',
  expiring: 'text-warn',
  expired: 'text-crit',
} as const;

const CLASSIFICATION_CLASS: Record<string, string> = {
  public: 'border-line text-muted-foreground',
  internal: 'border-line text-ink',
  confidential: 'border-warn/50 text-warn',
  restricted: 'border-crit-line text-crit',
};

async function startDownload(org: string, fileId: string) {
  const r = await downloadFileAction({ org, fileId });
  if (!r.ok) return toast.error(r.error.message);
  const a = document.createElement('a');
  a.href = r.data.url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface FilesTabProps {
  org: string;
  item: Item;
  ctx: Ctx;
  fields: Field[];
  actions: SheetActions;
  versions: FileVersionRow[];
  versionsState: 'loading' | 'error' | 'ready';
  onRetryVersions(): void;
  documents: LinkedDocuments | undefined;
  documentsState: 'loading' | 'error' | 'ready';
  onRetryDocuments(): void;
  categories: FileCategory[];
  canEditItem: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  /** Files or links changed: read the panel's queries again. */
  onChanged(): void;
}

export function FilesTab(p: FilesTabProps) {
  const { org, item, ctx, categories } = p;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [details, setDetails] = useState<FileVersionRow | null>(null);
  const [newVersion, setNewVersion] = useState<FileVersionRow | null>(null);
  const [history, setHistory] = useState<FileChain | null>(null);
  const [archiving, setArchiving] = useState<FileChain | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const fieldById = useMemo(() => new Map(p.fields.map((f) => [f.id, f])), [p.fields]);
  const live = p.versions.filter((v) => !v.archivedAt);
  const chains = useMemo(
    () =>
      fileChains(live).filter(
        (c) => c.current.fieldId === null || fieldById.has(c.current.fieldId),
      ),
    [live, fieldById],
  );
  const archived = useMemo(
    () => fileChains(p.versions.filter((v) => v.archivedAt && v.fieldId === null)),
    [p.versions],
  );
  const isEvidence = (c: FileChain) =>
    c.current.category === 'evidence' ||
    (c.current.fieldId !== null && filesExpire(fieldById.get(c.current.fieldId)!));
  const isExpiring = (c: FileChain) => {
    const v = validityView(c.current.validUntil, ctx.today);
    return v?.validity === 'expiring' || v?.validity === 'expired';
  };
  const shown = chains.filter((c) =>
    filter === 'evidence' ? isEvidence(c) : filter === 'expiring' ? isExpiring(c) : true,
  );
  const docs = p.documents?.documents ?? [];
  const previewable = chains.map((c) => c.current);

  // ───────────── uploads ─────────────

  const patchUpload = (key: number, change: Partial<UploadRow>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  const upload = async (file: File, opts: { replaces?: FileVersionRow; note?: string } = {}) => {
    const key = ++seq.current;
    setUploads((list) => [...list, { key, name: file.name, step: 'checking', cancelled: false }]);
    const cancelledRef = { current: false };
    rowsCancel.current.set(key, () => (cancelledRef.current = true));
    const r = await uploadItemFile({
      org,
      sheetId: item.sheetId,
      itemId: item.id,
      file,
      replaces: opts.replaces?.id ?? null,
      versionNote: opts.note,
      details: opts.replaces ? undefined : { category: guessCategory(file.name) },
      onStep: (step) => patchUpload(key, { step }),
      cancelled: () => cancelledRef.current,
    });
    rowsCancel.current.delete(key);
    if (!r.ok) {
      if (r.cancelled) return setUploads((list) => list.filter((u) => u.key !== key));
      return patchUpload(key, { step: 'failed', reason: r.reason });
    }
    setUploads((list) => list.filter((u) => u.key !== key));
    p.actions.addFileVersion(r.file, opts.replaces?.id ?? null);
    p.onChanged();
    toast(
      opts.replaces
        ? `${r.file.filename} uploaded as ${versionLabel(r.version.versionNo)}. Earlier versions are kept.`
        : `${r.file.filename} added.`,
    );
    for (const m of r.messages) toast(m);
    if (!opts.replaces && looksLikeControlledDocument(r.file.filename, r.version.category))
      setNudge(r.file.filename);
  };
  const rowsCancel = useRef(new Map<number, () => void>());

  const uploadAll = (list: FileList | File[]) => {
    for (const f of Array.from(list)) void upload(f);
  };

  const restore = async (v: FileVersionRow, chain: FileChain) => {
    const r = await downloadFileAction({ org, fileId: v.id });
    if (!r.ok) return toast.error(r.error.message);
    try {
      const blob = await (await fetch(r.data.url)).blob();
      setHistory(null);
      await upload(new File([blob], v.filename), {
        replaces: chain.current,
        note: `Restored ${versionLabel(v.versionNo)}`,
      });
    } catch {
      toast.error('The old version could not be read. Try again.');
    }
  };

  // ───────────── documents ─────────────

  const unlink = async (fieldId: string, docId: string) => {
    const field = fieldById.get(fieldId);
    if (!field) return;
    await p.actions.setLinks(
      item,
      field,
      ctx.links(item.id, fieldId).filter((id) => id !== docId),
    );
    p.onChanged();
  };

  const linkDocs = async (chosen: FoundDocument[]) => {
    const docFields = p.documents?.fields ?? [];
    const bySheet = new Map<string, FoundDocument[]>();
    for (const d of chosen) bySheet.set(d.sheetId, [...(bySheet.get(d.sheetId) ?? []), d]);
    for (const [sheetId, list] of bySheet) {
      let field = fieldById.get(docFields.find((f) => f.targetSheetId === sheetId)?.id ?? '');
      if (!field) {
        if (!p.canEdit) {
          toast.error(
            'This sheet has no field that links to that sheet. Ask an editor or admin.',
          );
          continue;
        }
        const made = await addDocumentsFieldAction({
          org,
          sheetId: item.sheetId,
          targetSheetId: sheetId,
        });
        if (!made.ok) {
          toast.error(made.error.message);
          continue;
        }
        field = made.data.field;
        toast(`${field.name} field added to this sheet.`);
        await p.actions.refresh();
      }
      const before = ctx.links(item.id, field.id);
      await p.actions.setLinks(item, field, [
        ...before,
        ...list.map((d) => d.itemId).filter((id) => !before.includes(id)),
      ]);
    }
    setLinking(false);
    p.onChanged();
  };

  const linkedIds = new Set(docs.map((d) => d.itemId));

  return (
    <div className="flex flex-col gap-5">
      {p.canEditItem ? (
        <div
          className={cn(
            'border-line-strong flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center',
            dragging && 'border-focus bg-sel',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) uploadAll(e.dataTransfer.files);
          }}
          data-testid="files-dropzone"
        >
          <Upload className="text-muted-foreground size-5" aria-hidden />
          <p className="text-copy-14 m-0">
            Drop files or{' '}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => input.current?.click()}
            >
              choose files
            </Button>
          </p>
          <p className="text-muted-foreground text-label-12 m-0">
            PDF, images, Office and OpenDocument files, text or CSV · up to 25 MB each
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-8"
              onClick={() => input.current?.click()}
            >
              <Paperclip aria-hidden /> Choose files
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-8"
              onClick={() => setLinking(true)}
            >
              <Link2 aria-hidden /> Link a document
            </Button>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose files to upload"
            accept={UPLOAD_ACCEPT}
            onChange={(e) => {
              if (e.target.files) uploadAll(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-copy-13 m-0">
          You can view and download these files. Ask an editor or admin to add files.
        </p>
      )}

      {uploads.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Uploads">
          {uploads.map((u) => (
            <li
              key={u.key}
              className={cn(
                'border-line flex flex-wrap items-center gap-2 rounded-md border px-3 py-2',
                u.step === 'failed' && 'border-crit-line bg-crit-soft',
              )}
            >
              <span className="text-label-13 min-w-0 flex-1 truncate font-semibold">{u.name}</span>
              {u.step === 'failed' ? (
                <>
                  <span role="alert" className="text-crit text-copy-13 w-full sm:order-last">
                    ✕ Not uploaded: {u.reason}
                  </span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Dismiss ${u.name}`}
                    onClick={() => setUploads((l) => l.filter((x) => x.key !== u.key))}
                  >
                    <X aria-hidden />
                  </Button>
                </>
              ) : (
                <>
                  <span role="status" className="text-muted-foreground text-copy-13">
                    {STEP_LABEL[u.step]}
                  </span>
                  <span
                    className="bg-soft relative h-1.5 w-20 overflow-hidden rounded-full"
                    aria-hidden
                  >
                    <span
                      className="bg-ink absolute inset-y-0 left-0 rounded-full transition-[width]"
                      style={{
                        width:
                          u.step === 'checking' ? '20%' : u.step === 'uploading' ? '60%' : '90%',
                      }}
                    />
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => rowsCancel.current.get(u.key)?.()}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {nudge ? (
        <div
          role="status"
          className="border-warn/40 bg-warn-soft flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5"
        >
          <ShieldAlert className="text-warn size-4 shrink-0" aria-hidden />
          <p className="text-copy-13 m-0 min-w-0 flex-1">
            {nudge} looks like a policy or procedure. Is this the official approved version? Link
            the document instead.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => setLinking(true)}>
            <Link2 aria-hidden /> Link
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => setNudge(null)}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="files-docs-title" className="flex flex-col gap-2">
        <h3 id="files-docs-title" className="text-heading-14 m-0">
          Documents{docs.length ? ` · ${docs.length}` : ''}
        </h3>
        {p.documentsState === 'loading' && !p.documents ? (
          <div aria-busy="true" className="bg-soft h-16 animate-pulse rounded-lg" />
        ) : p.documentsState === 'error' ? (
          <p className="text-copy-13 m-0 flex items-center gap-2">
            The linked documents could not be loaded.
            <Button type="button" size="sm" variant="outline" onClick={p.onRetryDocuments}>
              Retry
            </Button>
          </p>
        ) : docs.length === 0 ? (
          <p className="text-muted-foreground text-copy-13 m-0">
            No linked documents. Link a policy or procedure from a documents sheet.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Linked documents">
            {docs.map((d) => {
              const approved = d.view.approvedFile;
              return (
                <li
                  key={`${d.fieldId}:${d.itemId}`}
                  className="border-line flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5"
                >
                  <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-label-13 m-0 truncate font-semibold">{d.name}</p>
                    <p className="text-muted-foreground text-label-12 m-0 flex flex-wrap gap-x-2">
                      <span className="text-label-12-mono">{d.documentId ?? d.displayId}</span>
                      {d.owner ? <span>Owner: {d.owner}</span> : null}
                      {d.view.nextReview ? (
                        <span
                          className={cn(d.view.nextReview.overdue && 'text-crit font-semibold')}
                        >
                          {d.view.nextReview.overdue ? '✕ ' : ''}
                          {d.view.nextReview.text}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <span
                    data-testid="document-status"
                    className={cn(
                      'text-label-12 inline-flex h-6 items-center gap-1 rounded-full border px-2 font-semibold',
                      d.view.tone === 'done'
                        ? 'border-good/40 text-good bg-good-soft'
                        : 'border-line text-ink',
                    )}
                  >
                    <span aria-hidden>{d.view.symbol}</span> {d.view.chip}
                  </span>
                  {d.view.draftInReview ? (
                    <span className="text-warn text-label-12 font-semibold">⚠ Draft in review</span>
                  ) : null}
                  <div className="flex w-full flex-wrap gap-1 sm:w-auto">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-11 sm:min-h-8"
                      disabled={!approved}
                      title={approved ? undefined : 'No approved version yet'}
                      aria-label={
                        approved
                          ? `Download the approved version of ${d.name}`
                          : `${d.name} has no approved version yet`
                      }
                      onClick={() => approved && void startDownload(org, approved.id)}
                    >
                      <Download aria-hidden /> {approved ? 'Download' : 'No approved version'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-11 sm:min-h-8"
                      aria-label={`Open ${d.name} in its sheet`}
                      onClick={() =>
                        router.push(
                          `/${org}/s/${d.sheetId}?item=${encodeURIComponent(d.displayId)}`,
                        )
                      }
                    >
                      <ExternalLink aria-hidden /> Open in register
                    </Button>
                    {p.canEditItem ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-11 sm:min-h-8"
                        aria-label={`Unlink ${d.name}`}
                        onClick={() => void unlink(d.fieldId, d.itemId)}
                      >
                        <X aria-hidden /> Unlink
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="files-list-title" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="files-list-title" className="text-heading-14 m-0 flex-1">
            Files{chains.length ? ` · ${chains.length}` : ''}
          </h3>
          <div role="radiogroup" aria-label="Show files" className="flex gap-1">
            {(
              [
                ['all', 'All'],
                ['evidence', 'Evidence'],
                ['expiring', 'Expiring'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={filter === v}
                className={cn(
                  'text-label-12 focus-visible:outline-focus min-h-8 rounded-full border px-2.5 focus-visible:outline-2 max-[759px]:min-h-11',
                  filter === v
                    ? 'border-ink bg-ink text-background-100'
                    : 'border-line hover:bg-gray-alpha-100',
                )}
                onClick={() => setFilter(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {p.versionsState === 'loading' && p.versions.length === 0 ? (
          <div className="flex flex-col gap-1.5" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="bg-soft h-14 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : p.versionsState === 'error' ? (
          <p className="text-copy-13 m-0 flex items-center gap-2">
            The files could not be loaded.
            <Button type="button" size="sm" variant="outline" onClick={p.onRetryVersions}>
              Retry
            </Button>
          </p>
        ) : chains.length === 0 ? (
          <p className="text-muted-foreground text-copy-13 m-0">
            No files yet. Drop evidence, contracts or scans here.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground text-copy-13 m-0">
            {filter === 'evidence' ? 'No evidence files.' : 'Nothing expires within 30 days.'}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Files">
            {shown.map((c) => (
              <FileRowView
                key={c.current.id}
                chain={c}
                ctx={ctx}
                field={c.current.fieldId ? fieldById.get(c.current.fieldId) : undefined}
                categories={categories}
                canEdit={p.canEditItem}
                isAdmin={p.isAdmin}
                onPreview={() => setPreview(c.current.id)}
                onDownload={() => void startDownload(org, c.current.id)}
                onNewVersion={() => setNewVersion(c.current)}
                onHistory={() => setHistory(c)}
                onDetails={() => setDetails(c.current)}
                onArchive={() => setArchiving(c)}
              />
            ))}
          </ul>
        )}
        {p.isAdmin && archived.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((s) => !s)}
            >
              Archived files · {archived.length}
            </Button>
            {showArchived ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Archived files">
                {archived.map((c) => (
                  <li key={c.current.id} className="text-copy-13 flex items-center gap-2">
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">
                      {c.current.filename} · {versionLabel(c.current.versionNo)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const r = await archiveFileAction({
                          org,
                          fileId: c.current.id,
                          archived: false,
                        });
                        if (!r.ok) return toast.error(r.error.message);
                        toast(`${c.current.filename} restored.`);
                        await p.actions.refresh();
                        p.onChanged();
                      }}
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      {linking ? (
        <LinkDocumentDialog
          org={org}
          linked={linkedIds}
          onClose={() => setLinking(false)}
          onLink={linkDocs}
        />
      ) : null}
      {details ? (
        <DetailsDialog
          org={org}
          file={details}
          categories={categories}
          onClose={() => setDetails(null)}
          onSaved={() => {
            setDetails(null);
            void p.actions.refresh();
            p.onChanged();
          }}
        />
      ) : null}
      {newVersion ? (
        <NewVersionDialog
          file={newVersion}
          onClose={() => setNewVersion(null)}
          onUpload={(file, note) => {
            const replaces = newVersion;
            setNewVersion(null);
            void upload(file, { replaces, note });
          }}
        />
      ) : null}
      {history ? (
        <HistorySheet
          chain={history}
          ctx={ctx}
          canRestore={p.canEditItem && history.current.fieldId === null}
          onClose={() => setHistory(null)}
          onDownload={(v) => startDownload(org, v.id)}
          onRestore={(v) => void restore(v, history)}
        />
      ) : null}
      {archiving ? (
        <ArchiveDialog
          org={org}
          chain={archiving}
          onClose={() => setArchiving(null)}
          onArchived={() => {
            setArchiving(null);
            void p.actions.refresh();
            p.onChanged();
          }}
        />
      ) : null}
      {preview ? (
        <PreviewDialog
          org={org}
          files={previewable}
          startId={preview}
          onClose={() => setPreview(null)}
          onDownload={(f) => void startDownload(org, f.id)}
        />
      ) : null}
    </div>
  );
}

function FileRowView({
  chain,
  ctx,
  field,
  categories,
  canEdit,
  isAdmin,
  onPreview,
  onDownload,
  onNewVersion,
  onHistory,
  onDetails,
  onArchive,
}: {
  chain: FileChain;
  ctx: Ctx;
  field: Field | undefined;
  categories: FileCategory[];
  canEdit: boolean;
  isAdmin: boolean;
  onPreview(): void;
  onDownload(): void;
  onNewVersion(): void;
  onHistory(): void;
  onDetails(): void;
  onArchive(): void;
}) {
  const f = chain.current;
  const validity = validityView(f.validUntil, ctx.today);
  const preview = previewOf(f.filename);
  const Icon = preview?.kind === 'image' ? ImageIcon : FileText;
  const uploader = f.uploadedBy
    ? (ctx.people.get(f.uploadedBy)?.name ?? 'Former member')
    : 'Someone';
  return (
    <li
      className="border-line flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5"
      data-testid="file-row"
      data-validity={validity?.validity ?? 'none'}
    >
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 basis-52">
        <p className="text-label-13 m-0 flex min-w-0 flex-wrap items-center gap-1.5 font-semibold">
          <span className="min-w-0 truncate">{f.filename}</span>
          <span className="text-label-12-mono bg-soft rounded px-1.5 font-normal">
            {versionLabel(f.versionNo)}
          </span>
        </p>
        {f.description ? <p className="text-copy-13 m-0">{f.description}</p> : null}
        <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5">
          {f.category ? (
            <span className="border-line text-label-12 rounded-full border px-2">
              {categoryLabel(f.category, categories)}
            </span>
          ) : null}
          {validity ? (
            <span className={cn('text-label-12 font-semibold', VALIDITY_CLASS[validity.validity])}>
              <span aria-hidden>{validity.symbol}</span> {validity.text}
            </span>
          ) : null}
          {f.classification &&
          isClassification(f.classification) &&
          f.classification !== 'internal' ? (
            <span
              className={cn(
                'text-label-12 rounded-full border px-2',
                CLASSIFICATION_CLASS[f.classification],
              )}
            >
              {CLASSIFICATION_LABEL[f.classification]}
            </span>
          ) : null}
          {f.personalData ? (
            <span className="border-line text-label-12 rounded-full border px-2">
              Personal data
            </span>
          ) : null}
        </p>
        <p className="text-muted-foreground text-label-12 m-0 mt-1">
          {uploader} · {formatDate(f.createdAt.slice(0, 10))} · {formatBytes(f.sizeBytes)}
          {field ? ` · From column: ${field.name}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11 sm:min-h-8"
          aria-label={`Download ${f.filename}`}
          onClick={onDownload}
        >
          <Download aria-hidden />
          <span className="max-[759px]:sr-only">Download</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="max-[759px]:size-11"
              aria-label={`More actions for ${f.filename}`}
              title="More actions"
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {preview ? <DropdownMenuItem onSelect={onPreview}>Preview</DropdownMenuItem> : null}
            <DropdownMenuItem onSelect={onDownload}>Download</DropdownMenuItem>
            {canEdit && f.fieldId === null ? (
              <DropdownMenuItem onSelect={onNewVersion}>Upload new version</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onHistory}>Version history</DropdownMenuItem>
            {canEdit ? (
              <DropdownMenuItem onSelect={onDetails}>Edit details</DropdownMenuItem>
            ) : null}
            {isAdmin ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onArchive} className="text-crit">
                  Archive
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
