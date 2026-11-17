'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Loader2,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { inputClass } from '@/components/fields/shared';
import {
  draftDetailProblems,
  emptyRow,
  isGroup,
  OWN_LIMITS,
  ownFrameworkProblems,
  ownLicence,
  publishDecision,
  trimDraft,
  type DraftMapping,
  type DraftProblem,
  type DraftRequirement,
  type FrameworkDraft,
} from '@/engine/frameworks/own';
import { RELATION_LABEL, FRAMEWORK_KINDS, type FrameworkKind } from '@/engine/frameworks/types';
import { parseRequirementKey } from '@/engine/frameworks/refs';
import { cn } from '@/lib/utils';
import type { OwnFrameworkEditor, PublishResult } from '@/server/commands/own-frameworks';
import { AdoptFramework } from './frameworks';
import { deleteOwnDraftAction, publishOwnFrameworkAction, saveOwnDraftAction } from './own-actions';
import { KIND_TEXT, ProblemList } from './own-start';

// The grid of a workspace's own framework (docs/12 Your own frameworks): one row per group or requirement, each row's
// problems under it (ownFrameworkProblems, with row numbers), saved as a draft whenever the person chooses and
// published through the dialog, which says whether this is the first publish, a new revision or a new edition
// (publishDecision) and asks for the licence confirmation and the source line. The rules are the engine's.

const PAGE = 50;

const ROW_KINDS: { id: string; label: string }[] = [
  { id: 'theme', label: 'Group' },
  { id: 'clause', label: 'Clause' },
  { id: 'control', label: 'Control' },
  { id: 'article', label: 'Article' },
  { id: 'paragraph', label: 'Paragraph' },
];

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

function Row({
  index,
  row,
  problems,
  mappings,
  mappingLabel,
  refsId,
  onChange,
  onRemove,
  onUnmap,
}: {
  index: number;
  row: DraftRequirement;
  problems: DraftProblem[];
  mappings: DraftMapping[];
  mappingLabel(m: DraftMapping): string;
  refsId: string;
  onChange(patch: Partial<DraftRequirement>): void;
  onRemove(): void;
  onUnmap(m: DraftMapping): void;
}) {
  const n = index + 1;
  const base = `own-row-${n}`;
  const bad = (c: string) => problems.some((p) => p.column === c);
  const describedBy = problems.length ? `${base}-problems` : undefined;
  const group = isGroup(row);
  const cell = 'flex min-w-0 flex-col gap-1';
  const lab = 'text-label-12 text-muted-foreground sm:sr-only';
  return (
    <li
      className={cn(
        'border-line flex flex-col gap-2 border-b px-3 py-2.5 last:border-b-0',
        group && 'bg-subtle',
      )}
      data-testid="draft-row"
      aria-label={`Row ${n}${row.ref ? ` ${row.ref}` : ''}`}
    >
      <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[3rem_7rem_7.5rem_7rem_minmax(0,1fr)_minmax(0,1.4fr)_2.5rem]">
        <span className="text-label-12-mono text-muted-foreground col-span-2 pt-2 sm:col-span-1">
          {problems.length ? (
            <TriangleAlert className="text-warn mr-1 inline size-3.5" aria-label="Has problems" />
          ) : null}
          {n}
        </span>
        <div className={cell}>
          <label htmlFor={`${base}-ref`} className={lab}>
            Ref
          </label>
          <input
            id={`${base}-ref`}
            aria-label={`Ref, row ${n}`}
            className={cn(inputClass, 'text-label-13-mono h-9')}
            value={row.ref}
            aria-invalid={bad('ref') || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange({ ref: e.target.value })}
          />
        </div>
        <div className={cell}>
          <label htmlFor={`${base}-kind`} className={lab}>
            Kind
          </label>
          <select
            id={`${base}-kind`}
            aria-label={`Kind, row ${n}`}
            className={cn(inputClass, 'h-9')}
            value={row.kind}
            aria-invalid={bad('kind') || undefined}
            aria-describedby={describedBy}
            onChange={(e) =>
              onChange(
                e.target.value === 'theme'
                  ? { kind: e.target.value, parent: '' }
                  : { kind: e.target.value },
              )
            }
          >
            {ROW_KINDS.some((k) => k.id === row.kind) ? null : (
              <option value={row.kind}>{row.kind || 'Choose'}</option>
            )}
            {ROW_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className={cell}>
          <label htmlFor={`${base}-parent`} className={lab}>
            Parent
          </label>
          <input
            id={`${base}-parent`}
            aria-label={`Parent, row ${n}`}
            className={cn(inputClass, 'text-label-13-mono h-9')}
            value={row.parent}
            list={refsId}
            disabled={group}
            placeholder={group ? 'None' : ''}
            aria-invalid={bad('parent') || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange({ parent: e.target.value })}
          />
        </div>
        <div className={cn(cell, 'col-span-2 sm:col-span-1')}>
          <label htmlFor={`${base}-title`} className={lab}>
            Title
          </label>
          <input
            id={`${base}-title`}
            aria-label={`Title, row ${n}`}
            className={cn(inputClass, 'h-9')}
            value={row.title}
            aria-invalid={bad('title') || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange({ title: e.target.value })}
          />
          <span
            className={cn(
              'text-label-12 tabular-nums',
              row.title.trim().length > OWN_LIMITS.title
                ? 'text-crit-ink'
                : 'text-muted-foreground',
            )}
          >
            {row.title.trim().length}/{OWN_LIMITS.title}
          </span>
        </div>
        <div className={cn(cell, 'col-span-2 sm:col-span-1')}>
          <label htmlFor={`${base}-text`} className={lab}>
            Text
          </label>
          <textarea
            id={`${base}-text`}
            aria-label={`Text, row ${n}`}
            className={cn(inputClass, 'h-auto min-h-9 py-1.5 font-normal')}
            rows={group ? 1 : 2}
            value={row.text}
            disabled={group}
            placeholder={group ? 'Groups have no text' : 'The full wording (optional)'}
            aria-invalid={bad('text') || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </div>
        <div className="col-span-2 flex justify-end sm:col-span-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove row ${n}`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      {mappings.length ? (
        <ul
          aria-label={`Mappings of row ${n}`}
          className="m-0 flex list-none flex-wrap gap-1 p-0 sm:pl-14"
        >
          {mappings.map((m) => (
            <li
              key={m.to}
              className="border-line bg-soft text-label-12 inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2"
            >
              Maps to <span className="text-label-12-mono font-medium">{mappingLabel(m)}</span> ·{' '}
              {RELATION_LABEL[m.relation]}
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove the mapping to ${mappingLabel(m)}`}
                onClick={() => onUnmap(m)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {problems.length ? (
        <ul
          id={`${base}-problems`}
          className="text-copy-13 text-crit-ink m-0 flex list-none flex-col gap-0.5 p-0 sm:pl-14"
        >
          {problems.map((p, i) => (
            <li key={i} className="flex items-start gap-1">
              <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {p.message}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type Publish =
  | { kind: 'form' }
  | { kind: 'publishing' }
  | { kind: 'failed'; message: string }
  | { kind: 'done'; result: PublishResult };

function PublishDialog({
  org,
  data,
  draft,
  canPublish,
  onPublished,
}: {
  org: string;
  data: OwnFrameworkEditor;
  draft: FrameworkDraft;
  canPublish: boolean;
  onPublished(): void;
}) {
  const ids = { source: useId(), rights: useId() };
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(data.published?.source ?? '');
  const [rights, setRights] = useState(false);
  const [step, setStep] = useState<Publish>({ kind: 'form' });
  const published = data.published;
  const clean = trimDraft(draft);
  const detailsChanged =
    !!published &&
    (published.title !== clean.title ||
      published.shortTitle !== clean.shortTitle ||
      published.kind !== clean.kind ||
      published.source !== source.trim());
  const decision = publishDecision(
    published?.requirements ?? null,
    clean.requirements,
    detailsChanged,
  );
  const items = clean.requirements.filter((r) => !isGroup(r)).length;
  const nextEdition = published ? Number(published.version) + 1 : 1;
  const busy = step.kind === 'publishing';

  async function publish() {
    if (decision.kind === 'unchanged') return;
    setStep({ kind: 'publishing' });
    try {
      const r = await publishOwnFrameworkAction({
        org,
        key: data.key,
        draft: clean,
        source,
        rightsConfirmed: rights,
        expect: decision.kind,
      });
      if (!r.ok) {
        setStep({
          kind: 'failed',
          message: r.error.fieldErrors ? Object.values(r.error.fieldErrors)[0]! : r.error.message,
        });
        return;
      }
      setStep({ kind: 'done', result: r.data });
    } catch {
      setStep({
        kind: 'failed',
        message: 'Publishing did not finish. Nothing was changed. Try again.',
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next && step.kind === 'done') onPublished();
      }}
    >
      <Button
        type="button"
        disabled={!canPublish}
        onClick={() => {
          setStep({ kind: 'form' });
          setRights(false);
          setOpen(true);
        }}
      >
        <Upload aria-hidden /> Publish
      </Button>
      <DialogContent className="flex max-h-[85vh] w-[min(600px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-heading-20">Publish {clean.title}</DialogTitle>
          <DialogDescription className="text-copy-14 text-muted-foreground">
            Written by your workspace. Klarert does not review it.
          </DialogDescription>
        </div>

        {step.kind === 'done' ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-copy-16 m-0 flex items-center gap-1.5 font-medium">
              <Check className="text-good size-4 shrink-0" aria-hidden /> Published{' '}
              {step.result.title}, edition {step.result.version}, revision {step.result.revision}:{' '}
              {plural(step.result.requirements, 'requirement')}.
            </p>
            {step.result.mappings ? (
              <p className="text-copy-14 m-0">
                {plural(step.result.mappings, 'mapping')} to catalogue requirements added.
              </p>
            ) : null}
            {step.result.kind === 'revision' ? (
              <p className="text-copy-14 m-0">
                Libraries that adopted it show “Update available” on Frameworks. The update keeps
                applicability, status, owner and evidence.
              </p>
            ) : (
              <p className="text-copy-14 m-0">
                {step.result.kind === 'edition'
                  ? 'Adopt the new edition, then move your work to it from Frameworks.'
                  : 'Adopt it to get its library sheet, statement of applicability and coverage.'}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild variant="outline">
                <Link href={`/${org}/settings?tab=frameworks`}>Back to Frameworks</Link>
              </Button>
              {step.result.kind !== 'revision' ? (
                <AdoptFramework
                  org={org}
                  framework={{
                    key: step.result.key,
                    version: step.result.version,
                    title: step.result.title,
                  }}
                  controls={data.controlsSheets}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div
              className="border-line flex flex-col gap-1.5 rounded-md border p-3"
              data-testid="publish-decision"
            >
              {decision.kind === 'first' ? (
                <p className="text-copy-14 m-0">
                  Publishes edition 1 with {plural(items, 'requirement')}. You can adopt it straight
                  after.
                </p>
              ) : null}
              {decision.kind === 'revision' && published ? (
                <p className="text-copy-14 m-0">
                  Publishes revision {published.revision + 1} of edition {published.version}:{' '}
                  {plural(decision.reworded.length, 'requirement')} changed,{' '}
                  {plural(decision.added.length, 'requirement')} added. Libraries that adopted it
                  get “Update available” and keep their applicability, status, owner and evidence.
                </p>
              ) : null}
              {decision.kind === 'edition' ? (
                <>
                  <p className="text-copy-14 m-0 font-medium">
                    This makes edition {nextEdition}: requirements were removed, renumbered or
                    moved.
                  </p>
                  <p className="text-copy-13 m-0">
                    {[...decision.removed, ...decision.moved].slice(0, 20).join(', ')}
                    {decision.removed.length + decision.moved.length > 20 ? ' and more' : ''}.
                  </p>
                  <p className="text-copy-13 text-muted-foreground m-0">
                    Edition {published?.version} stays as it is. Adopt edition {nextEdition}, then
                    move your work to it: answers are copied where a requirement kept its ref and
                    wording, the rest is listed for review.
                  </p>
                </>
              ) : null}
              {decision.kind === 'unchanged' ? (
                <p className="text-copy-14 m-0">Nothing changed since the last publish.</p>
              ) : null}
              {clean.mappings.length ? (
                <p className="text-copy-13 text-muted-foreground m-0">
                  Adds {plural(clean.mappings.length, 'mapping')} to catalogue requirements, shown
                  as your mappings.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.source} className="text-label-13 font-medium">
                Source
              </label>
              <input
                id={ids.source}
                className={cn(inputClass, 'h-9')}
                value={source}
                maxLength={OWN_LIMITS.source}
                disabled={busy}
                placeholder="Acme master services agreement, schedule 3"
                aria-describedby={`${ids.source}-help`}
                onChange={(e) => setSource(e.target.value)}
              />
              <span id={`${ids.source}-help`} className="text-label-12 text-muted-foreground">
                Where the text comes from. The library, the item panel and the statement of
                applicability say: “{ownLicence(source.trim() || '…', data.workspace)}”
              </span>
            </div>
            <label htmlFor={ids.rights} className="text-label-13 flex items-start gap-2">
              <input
                id={ids.rights}
                type="checkbox"
                className="mt-0.5 size-4"
                checked={rights}
                disabled={busy}
                onChange={(e) => setRights(e.target.checked)}
              />
              We have the right to use this text in our workspace.
            </label>
            {step.kind === 'failed' ? (
              <p role="alert" className="m-0 flex items-center gap-1.5">
                <X className="text-crit size-4 shrink-0" aria-hidden /> {step.message}
              </p>
            ) : null}
            {busy ? (
              <p role="status" className="text-copy-14 m-0 flex items-center gap-1.5">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Publishing in one step.
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || !rights || !source.trim() || decision.kind === 'unchanged'}
                onClick={() => void publish()}
              >
                {busy ? 'Publishing…' : step.kind === 'failed' ? 'Try again' : 'Publish'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDraftButton({
  org,
  draftKey,
  title,
  size = 'default',
}: {
  org: string;
  draftKey: string;
  title: string;
  size?: 'default' | 'sm';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(n) => (busy ? undefined : setOpen(n))}>
      <Button
        type="button"
        variant="outline"
        size={size}
        aria-label={`Delete the draft of ${title}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden /> Delete draft
      </Button>
      <DialogContent className="flex w-[min(480px,calc(100vw-32px))] flex-col gap-4">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-heading-20">Delete the draft of {title}</DialogTitle>
          <DialogDescription className="text-copy-14 text-muted-foreground">
            Your changes since the last publish are lost. A published framework stays as it is.
          </DialogDescription>
        </div>
        {error ? (
          <p role="alert" className="m-0 flex items-center gap-1.5">
            <X className="text-crit size-4 shrink-0" aria-hidden /> {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await deleteOwnDraftAction({ org, key: draftKey }).catch(() => null);
              setBusy(false);
              if (!r || !r.ok) {
                setError(r ? r.error.message : 'The draft could not be deleted. Try again.');
                return;
              }
              setOpen(false);
              router.push(`/${org}/settings?tab=frameworks`);
              router.refresh();
            }}
          >
            {busy ? 'Deleting…' : 'Delete draft'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { DeleteDraftButton };

export function OwnFrameworkGrid({ org, data }: { org: string; data: OwnFrameworkEditor }) {
  const router = useRouter();
  const ids = { title: useId(), short: useId(), kind: useId(), refs: useId(), only: useId() };
  const [draft, setDraft] = useState<FrameworkDraft>(data.draft!);
  const [savedAt, setSavedAt] = useState<string | null>(data.savedAt);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const rows = draft.requirements;
  const problems = useMemo(() => ownFrameworkProblems(rows), [rows]);
  const details = draftDetailProblems(draft);
  const byRow = useMemo(() => {
    const m = new Map<number, DraftProblem[]>();
    for (const p of problems) if (p.row) m.set(p.row - 1, [...(m.get(p.row - 1) ?? []), p]);
    return m;
  }, [problems]);
  const listProblems = problems.filter((p) => p.row === null);
  const shown = useMemo(
    () => rows.map((r, i) => ({ r, i })).filter(({ i }) => !onlyProblems || byRow.has(i)),
    [rows, byRow, onlyProblems],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * PAGE, current * PAGE + PAGE);
  const catalogueTitle = new Map(data.catalogue.map((f) => [`${f.key}@${f.version}`, f.title]));
  const mappingLabel = (m: DraftMapping) => {
    const id = parseRequirementKey(m.to);
    return id
      ? `${catalogueTitle.get(`${id.framework}@${id.version}`) ?? id.framework} ${id.ref}`
      : m.to;
  };

  const change = (next: Partial<FrameworkDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setDirty(true);
  };
  const setRow = (i: number, patch: Partial<DraftRequirement>) =>
    change({ requirements: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRow = (row: DraftRequirement) => {
    change({ requirements: [...rows, row] });
    setOnlyProblems(false);
    setPage(Math.floor(rows.length / PAGE));
  };
  const lastGroup = [...rows].reverse().find(isGroup)?.ref ?? '';

  async function save() {
    setSaving(true);
    try {
      const r = await saveOwnDraftAction({ org, key: data.key, draft });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      setSavedAt(r.data.savedAt);
      setDirty(false);
      toast.success('Draft saved.');
    } catch {
      toast.error('The draft could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const ready = problems.length === 0 && details.length === 0;
  return (
    <div className="flex flex-col gap-5">
      <section className="border-line bg-background-100 flex flex-col gap-4 rounded-lg border p-5 sm:px-[22px]">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.title} className="text-label-13 font-medium">
              Name
            </label>
            <input
              id={ids.title}
              className={cn(inputClass, 'h-9')}
              value={draft.title}
              maxLength={OWN_LIMITS.frameworkTitle}
              onChange={(e) => change({ title: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.short} className="text-label-13 font-medium">
              Short name
            </label>
            <input
              id={ids.short}
              className={cn(inputClass, 'h-9')}
              value={draft.shortTitle}
              maxLength={OWN_LIMITS.shortTitle}
              onChange={(e) => change({ shortTitle: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.kind} className="text-label-13 font-medium">
              Kind
            </label>
            <select
              id={ids.kind}
              className={cn(inputClass, 'h-9')}
              value={draft.kind}
              onChange={(e) => change({ kind: e.target.value as FrameworkKind })}
            >
              {FRAMEWORK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_TEXT[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-label-13 text-muted-foreground m-0">
          {data.published
            ? `Published: edition ${data.published.version}, revision ${data.published.revision}. `
            : 'Not published yet. '}
          {savedAt ? 'Draft saved.' : 'Not saved as a draft yet.'}
          {dirty ? ' Unsaved changes.' : ''}
          {draft.copiedFrom
            ? ` Structure copied from ${catalogueTitle.get(draft.copiedFrom) ?? draft.copiedFrom}: write every title.`
            : ''}
        </p>
        {ready ? (
          <p role="status" className="text-copy-14 m-0 flex items-center gap-1.5">
            <Check className="text-good size-4 shrink-0" aria-hidden /> Ready to publish:{' '}
            {plural(rows.filter((r) => !isGroup(r)).length, 'requirement')} in{' '}
            {plural(rows.filter(isGroup).length, 'group')}.
          </p>
        ) : (
          <>
            {details.map((d) => (
              <p key={d} role="alert" className="text-copy-14 m-0 flex items-center gap-1.5">
                <X className="text-crit size-4 shrink-0" aria-hidden /> {d}
              </p>
            ))}
            <ProblemList problems={problems} limit={8} label="Problems to fix" />
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
          <PublishDialog
            org={org}
            data={data}
            draft={draft}
            canPublish={ready}
            onPublished={() => router.push(`/${org}/settings?tab=frameworks`)}
          />
          {savedAt ? (
            <DeleteDraftButton
              org={org}
              draftKey={data.key!}
              title={draft.title || 'this framework'}
            />
          ) : null}
          {!ready ? (
            <span className="text-label-13 text-muted-foreground">
              Fix the problems to publish.
            </span>
          ) : null}
        </div>
      </section>

      <section
        aria-labelledby="own-grid-heading"
        className="border-line bg-background-100 flex flex-col rounded-lg border"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-[22px]">
          <h2 id="own-grid-heading" className="text-heading-16 m-0">
            Groups and requirements
          </h2>
          <label htmlFor={ids.only} className="text-label-13 flex items-center gap-2">
            <input
              id={ids.only}
              type="checkbox"
              className="size-4"
              checked={onlyProblems}
              onChange={(e) => {
                setOnlyProblems(e.target.checked);
                setPage(0);
              }}
            />
            Only rows with problems ({byRow.size.toLocaleString('en-GB')})
          </label>
        </div>
        <datalist id={ids.refs}>
          {rows.map((r, i) => (r.ref.trim() ? <option key={i} value={r.ref.trim()} /> : null))}
        </datalist>
        <div
          aria-hidden
          className="border-line text-label-12 text-muted-foreground hidden grid-cols-[3rem_7rem_7.5rem_7rem_minmax(0,1fr)_minmax(0,1.4fr)_2.5rem] gap-2 border-y px-3 py-1.5 font-medium sm:grid"
        >
          <span>Row</span>
          <span>Ref</span>
          <span>Kind</span>
          <span>Parent</span>
          <span>Title</span>
          <span>Text</span>
          <span />
        </div>
        {slice.length === 0 ? (
          <p className="text-copy-14 text-muted-foreground m-0 px-3 py-6 sm:px-[22px]">
            {onlyProblems
              ? 'No rows with problems.'
              : 'No rows yet. Add a group, then requirements in it.'}
          </p>
        ) : (
          <ol aria-label="Draft rows" className="m-0 list-none p-0">
            {slice.map(({ r, i }) => (
              <Row
                key={i}
                index={i}
                row={r}
                problems={byRow.get(i) ?? []}
                mappings={draft.mappings.filter((m) => m.ref === r.ref.trim())}
                mappingLabel={mappingLabel}
                refsId={ids.refs}
                onChange={(patch) => setRow(i, patch)}
                onRemove={() => change({ requirements: rows.filter((_, j) => j !== i) })}
                onUnmap={(m) =>
                  change({
                    mappings: draft.mappings.filter((x) => !(x.ref === m.ref && x.to === m.to)),
                  })
                }
              />
            ))}
          </ol>
        )}
        {listProblems.length ? (
          <ul className="text-copy-13 text-crit-ink m-0 list-none px-3 py-2 sm:px-[22px]">
            {listProblems.map((p) => (
              <li key={p.message}>{p.message}</li>
            ))}
          </ul>
        ) : null}
        <div className="border-line flex flex-wrap items-center justify-between gap-2 border-t px-3 py-3 sm:px-[22px]">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addRow(emptyRow({ parent: lastGroup }))}
            >
              <Plus aria-hidden /> Add a requirement
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addRow(emptyRow({ kind: 'theme' }))}
            >
              <FolderPlus aria-hidden /> Add a group
            </Button>
          </div>
          {pages > 1 ? (
            <nav aria-label="Pages of rows" className="flex items-center gap-2">
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Previous rows"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <span className="text-label-13 tabular-nums">
                Rows {(shown[current * PAGE]!.i + 1).toLocaleString('en-GB')}–
                {(slice.at(-1)!.i + 1).toLocaleString('en-GB')} · page {current + 1} of {pages}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Next rows"
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
              >
                <ChevronRight aria-hidden />
              </Button>
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
