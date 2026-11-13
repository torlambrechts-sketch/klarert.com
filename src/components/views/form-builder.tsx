'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Eye,
  GripVertical,
  Lock,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { saveFormAction, submitInternalFormAction } from '@/app/[org]/s/view-actions';
import { formatDateTime } from '@/engine/fields/helpers';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field } from '@/engine/types';
import {
  LEGAL_BASES,
  LEGAL_BASIS_LABEL,
  type FormFieldLayout,
  type FormLayout,
  type PrivacyNotice,
  type SavedView,
} from '@/engine/views/config';
import {
  checkFormAnswers,
  formAccess,
  formFieldChoices,
  formQuestions,
  formStatus,
  nextNotice,
  noticeProblems,
  noticeReviewed,
  openProblems,
  privacyWarnings,
} from '@/engine/views/form';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { FormFill, Question } from './form-fill';
import { FormShareDialog, type FormLinkRow } from './form-share';

// The form builder (docs/05 §3.3): three columns on a desktop (fields to include; a live preview where questions
// are labelled, explained, made required and dragged into order; settings), one column with Fields | Preview |
// Settings at the bottom on a phone. Top bar: name, Draft/Open, Preview and Share. Saves itself; every saved change
// is a new version of the form (the database logs it). Only owners and admins get here with write access.

type Panel = 'fields' | 'preview' | 'settings';
type Draft = { name: string; form: FormLayout };

const label = 'text-label-13 flex flex-col gap-1 font-semibold';
const field = cn(inputClass, 'h-9 font-normal');
const area = cn(inputClass, 'h-auto min-h-16 py-1.5 font-normal');

/** ISO → the value of a datetime-local input (the browser's time zone), and back. */
const toLocal = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export function FormBuilder({
  org,
  data,
  ctx,
  view,
  link,
  onLink,
  onSaved,
  onBack,
}: {
  org: string;
  data: SheetData;
  ctx: Ctx;
  view: SavedView;
  link: FormLinkRow | null;
  onLink(link: FormLinkRow | null): void;
  onSaved(view: SavedView): void;
  onBack(): void;
}) {
  const saved = useMemo<Draft>(
    () => ({ name: view.name, form: view.config.form ?? { fields: [] } }),
    [view],
  );
  const [draft, setDraft] = useState<Draft>(saved);
  const [panel, setPanel] = useState<Panel>('preview');
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [problems, setProblems] = useState<string[]>([]);
  const [share, setShare] = useState(false);
  const [preview, setPreview] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const save = async (next: Draft) => {
    const mine = ++seq.current;
    setState('saving');
    const r = await saveFormAction({ org, viewId: view.id, name: next.name, form: next.form });
    if (mine !== seq.current) return;
    if (!r.ok) {
      setState('error');
      toast.error(r.error.message);
      return false;
    }
    setState('saved');
    onSaved(r.data.view);
    // the database keeps the notice's version and review stamp: take them back
    const stored = r.data.view.config.form;
    if (stored)
      setDraft((d) => (d === next ? { ...d, form: { ...d.form, notice: stored.notice } } : d));
    return true;
  };

  const change = (update: (d: Draft) => Draft, now = false) => {
    setDraft((d) => {
      const next = update(d);
      if (timer.current) clearTimeout(timer.current);
      if (now) void save(next);
      else timer.current = setTimeout(() => void save(next), 800);
      return next;
    });
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const setForm = (patch: Partial<FormLayout>, now = false) =>
    change((d) => ({ ...d, form: { ...d.form, ...patch } }), now);

  const form = draft.form;
  const status = formStatus(form);
  const access = formAccess(form);
  const choices = formFieldChoices(data.fields, access);
  const on = form.fields.filter((q) => choices.some((f) => f.key === q.key));
  const questions = formQuestions(form, data.fields);
  const nameLabel = form.nameLabel?.trim() || data.sheet.itemLabel;
  const warnings = privacyWarnings(questions, nameLabel);
  const title = form.title?.trim() || draft.name;

  const setStatus = (s: 'draft' | 'open' | 'closed') => {
    if (s === 'open') {
      const p = openProblems({ ...form, status: 'open' }, data.fields);
      setProblems(p);
      if (p.length) {
        setPanel('settings');
        toast.error('This form cannot open yet. See what is missing in Settings.');
        return;
      }
    } else setProblems([]);
    setForm({ status: s }, true);
  };

  const panels: Record<Panel, React.ReactNode> = {
    fields: (
      <FieldsPanel
        fields={data.fields}
        choices={choices}
        on={on}
        access={access}
        onChange={(fields) => setForm({ fields })}
      />
    ),
    preview: (
      <PreviewPanel
        form={form}
        on={on}
        fields={data.fields}
        itemLabel={data.sheet.itemLabel}
        sheetName={data.sheet.name}
        onChange={setForm}
      />
    ),
    settings: (
      <SettingsPanel
        data={data}
        ctx={ctx}
        form={form}
        saved={saved.form}
        problems={problems}
        warnings={warnings}
        onChange={setForm}
      />
    ),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="bg-background-100 border-line sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden /> All forms
        </Button>
        <input
          aria-label="Form name"
          className={cn(field, 'text-label-14 min-w-0 flex-1 basis-40 font-semibold')}
          value={draft.name}
          maxLength={60}
          onChange={(e) => change((d) => ({ ...d, name: e.target.value }))}
        />
        <div className="flex items-center gap-2">
          {status === 'closed' ? (
            <>
              <StatusChip status="closed" />
              <Button type="button" size="sm" variant="outline" onClick={() => setStatus('open')}>
                Reopen
              </Button>
            </>
          ) : (
            <div
              role="radiogroup"
              aria-label="Status"
              className="border-line flex rounded-md border p-0.5"
            >
              {(['draft', 'open'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => status !== s && setStatus(s)}
                  className={cn(
                    'text-label-13 focus-visible:outline-focus flex h-7 items-center gap-1 rounded px-2.5 focus-visible:outline-2',
                    status === s
                      ? 'bg-ink text-background-100'
                      : 'text-muted-foreground hover:text-ink',
                  )}
                >
                  {s === 'open' ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}
                  {s === 'draft' ? 'Draft' : 'Open'}
                </button>
              ))}
            </div>
          )}
          {status === 'open' ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setStatus('closed')}>
              Close
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setPreview(true)}>
            <Eye aria-hidden /> Preview
          </Button>
          <Button type="button" size="sm" onClick={() => setShare(true)}>
            <Share2 aria-hidden /> Share
          </Button>
        </div>
        <p className="text-label-12 text-muted-foreground w-full" aria-live="polite">
          {state === 'saving'
            ? 'Saving…'
            : state === 'error'
              ? 'Not saved. Check the message and try again.'
              : `Saved · version ${view.formVersion ?? 1}`}
        </p>
      </header>

      {/* desktop: three columns */}
      <div className="hidden min-h-0 flex-1 gap-4 overflow-auto py-4 lg:grid lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <section aria-label="Fields" className="min-w-0">
          {panels.fields}
        </section>
        <section aria-label="Preview" className="min-w-0">
          {panels.preview}
        </section>
        <section aria-label="Settings" className="min-w-0">
          {panels.settings}
        </section>
      </div>
      {/* phone and tablet: one column, the panel chosen at the bottom */}
      <div className="flex min-h-0 flex-1 flex-col pb-16 lg:hidden">
        <section
          id="form-panel"
          role="tabpanel"
          aria-label={panel === 'fields' ? 'Fields' : panel === 'preview' ? 'Preview' : 'Settings'}
          className="min-w-0 py-4"
        >
          {panels[panel]}
        </section>
        <div
          role="tablist"
          aria-label="Builder panels"
          className="border-line bg-background-100 fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 gap-1 border-t p-2"
        >
          {(['fields', 'preview', 'settings'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={panel === p}
              aria-controls="form-panel"
              onClick={() => setPanel(p)}
              className={cn(
                'text-label-13 focus-visible:outline-focus h-9 rounded-md focus-visible:outline-2',
                panel === p ? 'bg-ink text-background-100' : 'text-muted-foreground hover:bg-soft',
              )}
            >
              {p === 'fields' ? 'Fields' : p === 'preview' ? 'Preview' : 'Settings'}
            </button>
          ))}
        </div>
      </div>

      <FormShareDialog
        open={share}
        onClose={() => setShare(false)}
        org={org}
        sheetId={data.sheet.id}
        viewId={view.id}
        title={title}
        access={access}
        link={link}
        canEdit
        onLink={onLink}
      />
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-h-[90dvh] w-[min(440px,calc(100vw-32px))] overflow-y-auto">
          <DialogTitle className="text-heading-20">Preview</DialogTitle>
          <DialogDescription className="text-copy-13 text-muted-foreground">
            {status === 'open'
              ? 'Fill it in here to add an item as yourself.'
              : 'How people see the form. It takes answers once it is open.'}
          </DialogDescription>
          <FillForm
            org={org}
            viewId={view.id}
            ctx={ctx}
            form={form}
            fields={data.fields}
            title={title}
            nameLabel={nameLabel}
            canSend={status === 'open'}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StatusChip({
  status,
}: {
  status: 'draft' | 'open' | 'closed' | 'scheduled' | 'full';
}) {
  const text = {
    draft: 'Draft',
    open: 'Open',
    closed: 'Closed',
    scheduled: 'Not open yet',
    full: 'Full',
  }[status];
  return (
    <span
      className={cn(
        'text-label-12 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
        status === 'open'
          ? 'border-good/40 bg-good-soft text-good'
          : status === 'draft'
            ? 'border-line text-muted-foreground'
            : 'border-warn/40 bg-warn-soft text-warn',
      )}
    >
      {status === 'open' ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : status === 'draft' ? null : (
        <Lock className="size-3" aria-hidden />
      )}
      {text}
    </span>
  );
}

// ───────────────────────── fields ─────────────────────────

function FieldsPanel({
  fields,
  choices,
  on,
  access,
  onChange,
}: {
  fields: Field[];
  choices: Field[];
  on: FormFieldLayout[];
  access: 'public' | 'internal';
  onChange(fields: FormFieldLayout[]): void;
}) {
  const left = fields.length - choices.length;
  return (
    <div className="border-line bg-background-100 flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-heading-16">Fields</h2>
      <p className="text-copy-13 text-muted-foreground">Choose the questions the form asks.</p>
      <ul className="flex flex-col gap-1.5">
        {choices.map((f) => {
          const asked = on.some((q) => q.key === f.key);
          return (
            <li key={f.id} className="flex items-center justify-between gap-2">
              <label htmlFor={`ask-${f.id}`} className="text-label-13 min-w-0 truncate">
                {f.name}
              </label>
              <Switch
                id={`ask-${f.id}`}
                aria-label={`Ask ${f.name}`}
                checked={asked}
                onCheckedChange={(c) =>
                  onChange(
                    c
                      ? [...on, { key: f.key, required: f.required || undefined }]
                      : on.filter((q) => q.key !== f.key),
                  )
                }
              />
            </li>
          );
        })}
      </ul>
      {left > 0 ? (
        <p className="text-label-12 text-muted-foreground">
          {access === 'public'
            ? 'Files, people, teams, roles, entities and calculated fields cannot be asked on a public form.'
            : 'Calculated fields, links, files and other values the app keeps cannot be asked on a form.'}
        </p>
      ) : null}
    </div>
  );
}

// ───────────────────────── preview (inline editing, drag to reorder) ─────────────────────────

function PreviewPanel({
  form,
  on,
  fields,
  itemLabel,
  sheetName,
  onChange,
}: {
  form: FormLayout;
  on: FormFieldLayout[];
  fields: Field[];
  itemLabel: string;
  sheetName: string;
  onChange(patch: Partial<FormLayout>): void;
}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const move = (from: number, to: number) => {
    if (to < 0 || to >= on.length) return;
    const next = [...on];
    const [q] = next.splice(from, 1);
    next.splice(to, 0, q!);
    onChange({ fields: next });
  };
  const setQ = (key: string, patch: Partial<FormFieldLayout>) =>
    onChange({ fields: on.map((q) => (q.key === key ? { ...q, ...patch } : q)) });
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(
      on.findIndex((q) => q.key === e.active.id),
      on.findIndex((q) => q.key === e.over!.id),
    );
  };
  return (
    <div className="border-line bg-background-100 mx-auto flex w-full max-w-[560px] flex-col gap-4 rounded-lg border p-5">
      <input
        aria-label="Form title"
        className={cn(field, 'text-heading-20 h-10 border-transparent px-1')}
        placeholder={sheetName}
        value={form.title ?? ''}
        maxLength={200}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <textarea
        aria-label="Form description"
        className={cn(area, 'border-transparent px-1')}
        placeholder="Tell people what this form is for"
        value={form.description ?? ''}
        maxLength={2000}
        onChange={(e) => onChange({ description: e.target.value })}
      />
      <div className="border-line flex flex-col gap-1.5 rounded-md border border-dashed p-3">
        <label className={label}>
          Name question
          <input
            className={field}
            value={form.nameLabel ?? ''}
            maxLength={200}
            placeholder={itemLabel}
            onChange={(e) => onChange({ nameLabel: e.target.value })}
          />
        </label>
        <p className="text-label-12 text-muted-foreground">Always asked and required.</p>
      </div>
      {on.length === 0 ? (
        <p className="text-copy-13 text-muted-foreground">
          Only the name is asked. Turn on fields to add questions.
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={on.map((q) => q.key)} strategy={verticalListSortingStrategy}>
          <ol aria-label="Questions" className="flex flex-col gap-2">
            {on.map((q, i) => {
              const f = byKey.get(q.key)!;
              return (
                <SortableQuestion
                  key={q.key}
                  id={q.key}
                  name={f.name}
                  q={q}
                  required={q.required ?? f.required}
                  first={i === 0}
                  last={i === on.length - 1}
                  onMove={(by) => move(i, i + by)}
                  onRemove={() => onChange({ fields: on.filter((x) => x.key !== q.key) })}
                  onSet={(patch) => setQ(q.key, patch)}
                  fieldHelp={f.description ?? ''}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableQuestion({
  id,
  name,
  q,
  required,
  first,
  last,
  fieldHelp,
  onMove,
  onRemove,
  onSet,
}: {
  id: string;
  name: string;
  q: FormFieldLayout;
  required: boolean;
  first: boolean;
  last: boolean;
  fieldHelp: string;
  onMove(by: number): void;
  onRemove(): void;
  onSet(patch: Partial<FormFieldLayout>): void;
}) {
  const s = useSortable({ id });
  const rid = useId();
  return (
    <li
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cn(
        'border-line bg-background-100 flex flex-col gap-2 rounded-md border p-3',
        s.isDragging && 'shadow-lg',
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`Drag to reorder ${q.label || name}`}
          className="text-muted-foreground hover:text-ink focus-visible:outline-focus cursor-grab rounded p-1 focus-visible:outline-2"
          {...s.attributes}
          {...s.listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <input
          aria-label={`${name} label`}
          className={cn(field, 'text-label-14 min-w-0 flex-1 font-medium')}
          value={q.label ?? ''}
          placeholder={name}
          maxLength={200}
          onChange={(e) => onSet({ label: e.target.value })}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Move ${name} up`}
          disabled={first}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Move ${name} down`}
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </div>
      <input
        aria-label={`${name} help text`}
        className={cn(field, 'text-label-13')}
        value={q.help ?? ''}
        placeholder={fieldHelp || 'Help text'}
        maxLength={1000}
        onChange={(e) => onSet({ help: e.target.value })}
      />
      <label htmlFor={rid} className="text-label-13 flex items-center gap-2 self-start">
        <input
          id={rid}
          type="checkbox"
          checked={required}
          onChange={(e) => onSet({ required: e.target.checked })}
        />
        Required
      </label>
    </li>
  );
}

// ───────────────────────── settings ─────────────────────────

function SettingsPanel({
  data,
  ctx,
  form,
  saved,
  problems,
  warnings,
  onChange,
}: {
  data: SheetData;
  ctx: Ctx;
  form: FormLayout;
  saved: FormLayout;
  problems: string[];
  warnings: string[];
  onChange(patch: Partial<FormLayout>, now?: boolean): void;
}) {
  const access = formAccess(form);
  const status = formStatus(form);
  const groups = [...data.groups].sort((a, b) => (a.position < b.position ? -1 : 1));
  const people = [...ctx.people.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  const notice = form.notice ?? {};
  const noticeLocked = status === 'open' && access === 'public';
  const expected = nextNotice(saved.notice, { ...notice });
  const reviewed = noticeReviewed(form.notice) && expected.version === notice.version;
  const reviewer = notice.reviewedBy ? ctx.people.get(notice.reviewedBy)?.name : null;
  const setNotice = (patch: Partial<PrivacyNotice>) =>
    onChange({ notice: { ...notice, ...patch, reviewedVersion: undefined } });
  const asked = new Set(form.fields.map((q) => q.key));
  const prefill = form.prefill ?? [];
  const hideable = formFieldChoices(data.fields, 'internal').filter(
    (f) => !asked.has(f.key) && !prefill.some((p) => p.key === f.key),
  );
  const [addKey, setAddKey] = useState('');
  return (
    <div className="flex flex-col gap-4">
      {problems.length ? (
        <div
          role="alert"
          className="border-crit-line bg-crit-soft text-crit-ink rounded-lg border p-3"
        >
          <p className="text-label-13 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4" aria-hidden /> Before this form can open
          </p>
          <ul className="text-copy-13 mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length ? (
        <div className="border-warn/40 bg-warn-soft rounded-lg border p-3">
          <p className="text-label-13 text-warn flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4" aria-hidden /> Privacy
          </p>
          <ul className="text-copy-13 mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section title="Access">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">Who can fill it in</legend>
          {(
            [
              [
                'public',
                'Public',
                'Anyone with the link, no sign-in. Needs a reviewed privacy notice.',
              ],
              ['internal', 'Internal only', 'Signed-in members. Editors can send answers.'],
            ] as const
          ).map(([v, t, d]) => (
            <label key={v} className="text-label-13 flex items-start gap-2">
              <input
                type="radio"
                name="form-access"
                className="mt-1"
                checked={access === v}
                disabled={status === 'open'}
                onChange={() =>
                  onChange({
                    access: v,
                    fields:
                      v === 'public'
                        ? form.fields.filter((q) =>
                            formFieldChoices(data.fields, 'public').some((f) => f.key === q.key),
                          )
                        : form.fields,
                  })
                }
              />
              <span>
                <span className="font-semibold">{t}</span>
                <span className="text-muted-foreground block">{d}</span>
              </span>
            </label>
          ))}
          {status === 'open' ? (
            <p className="text-label-12 text-muted-foreground">
              Set the form to draft to change access.
            </p>
          ) : null}
        </fieldset>
      </Section>

      <Section title="Answers">
        <label className={label}>
          New items go to
          <select
            className={field}
            value={form.groupId ?? ''}
            onChange={(e) => onChange({ groupId: e.target.value || null })}
          >
            <option value="">First group ({groups[0]?.name ?? 'none'})</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <label className={label}>
            Opens
            <input
              type="datetime-local"
              className={field}
              value={toLocal(form.opensAt)}
              onChange={(e) => onChange({ opensAt: fromLocal(e.target.value) })}
            />
          </label>
          <label className={label}>
            Closes
            <input
              type="datetime-local"
              className={field}
              value={toLocal(form.closesAt)}
              onChange={(e) => onChange({ closesAt: fromLocal(e.target.value) })}
            />
          </label>
        </div>
        <label className={label}>
          Most answers
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className={field}
            placeholder="No limit"
            value={form.maxResponses ?? ''}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              onChange({ maxResponses: Number.isFinite(n) && n > 0 ? n : null });
            }}
          />
        </label>
        <label className={label}>
          Message after sending
          <textarea
            className={area}
            maxLength={1000}
            placeholder="Thank you. Your answers were sent."
            value={form.confirmation ?? ''}
            onChange={(e) => onChange({ confirmation: e.target.value })}
          />
          <span className="text-label-12 text-muted-foreground font-normal">
            The answers are never shown back.
          </span>
        </label>
      </Section>

      <Section title="Notify">
        {people.length === 0 ? (
          <p className="text-copy-13 text-muted-foreground">No people in this workspace yet.</p>
        ) : (
          <fieldset className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            <legend className="text-copy-13 text-muted-foreground mb-1">
              Tell these people about each new answer.
            </legend>
            {people.map((p) => (
              <label key={p.id} className="text-label-13 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={(form.notify ?? []).includes(p.id)}
                  onChange={(e) =>
                    onChange({
                      notify: e.target.checked
                        ? [...(form.notify ?? []), p.id]
                        : (form.notify ?? []).filter((x) => x !== p.id),
                    })
                  }
                />
                {p.name}
              </label>
            ))}
          </fieldset>
        )}
      </Section>

      <Section title="Hidden values">
        <p className="text-copy-13 text-muted-foreground">
          Set on every answer by the server. People filling in the form never see or change them.
        </p>
        {prefill.map((p) => {
          const f = data.fields.find((x) => x.key === p.key);
          if (!f) return null;
          return (
            <div key={p.key} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Question
                  q={{ field: f, label: f.name, help: '', required: false }}
                  ctx={ctx}
                  raw={p.value}
                  answers={{}}
                  onAnswer={(v) =>
                    onChange({
                      prefill: prefill.map((x) =>
                        x.key === p.key ? { ...x, value: (v ?? null) as never } : x,
                      ),
                    })
                  }
                />
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove hidden value ${f.name}`}
                onClick={() => onChange({ prefill: prefill.filter((x) => x.key !== p.key) })}
              >
                <X aria-hidden />
              </Button>
            </div>
          );
        })}
        {hideable.length ? (
          <div className="flex gap-2">
            <select
              aria-label="Field for a hidden value"
              className={cn(field, 'flex-1')}
              value={addKey}
              onChange={(e) => setAddKey(e.target.value)}
            >
              <option value="">Choose a field</option>
              {hideable.map((f) => (
                <option key={f.id} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={!addKey}
              onClick={() => {
                onChange({ prefill: [...prefill, { key: addKey, value: null }] });
                setAddKey('');
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title="Privacy notice">
        <p className="text-copy-13 text-muted-foreground">
          Shown on the public form. The controller is this workspace.
          {access === 'internal' ? ' Optional for internal forms.' : ''}
        </p>
        <div
          className={cn(
            'text-label-13 flex items-start gap-1.5 rounded-md border p-2',
            reviewed ? 'border-good/40 bg-good-soft' : 'border-warn/40 bg-warn-soft',
          )}
        >
          {reviewed ? (
            <ShieldCheck className="text-good mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span>
            {reviewed
              ? `Reviewed${reviewer ? ` by ${reviewer}` : ''}${
                  notice.reviewedAt ? ` on ${formatDateTime(notice.reviewedAt, ctx.timeZone)}` : ''
                } · version ${notice.version ?? 1}`
              : `Not reviewed · version ${expected.version ?? 1}`}
          </span>
        </div>
        {noticeLocked ? (
          <p className="text-label-12 text-muted-foreground">
            Close the form or set it to draft to change the notice. A changed notice needs a new
            review.
          </p>
        ) : null}
        <fieldset disabled={noticeLocked} className="flex flex-col gap-3">
          <legend className="sr-only">Privacy notice</legend>
          <label className={label}>
            Purpose
            <textarea
              className={area}
              maxLength={2000}
              value={notice.purpose ?? ''}
              placeholder="Why you collect these answers"
              onChange={(e) => setNotice({ purpose: e.target.value })}
            />
          </label>
          <label className={label}>
            Legal basis
            <select
              className={field}
              value={notice.legalBasis ?? ''}
              onChange={(e) =>
                setNotice({
                  legalBasis: (e.target.value || undefined) as PrivacyNotice['legalBasis'],
                })
              }
            >
              <option value="">Choose a legal basis</option>
              {LEGAL_BASES.map((b) => (
                <option key={b} value={b}>
                  {LEGAL_BASIS_LABEL[b]}
                </option>
              ))}
            </select>
            {notice.legalBasis === 'consent' ? (
              <span className="text-label-12 text-muted-foreground font-normal">
                People tick a consent box before sending. The time is kept with the answer.
              </span>
            ) : null}
          </label>
          <label className={label}>
            Who receives the answers
            <textarea
              className={area}
              maxLength={2000}
              value={notice.recipients ?? ''}
              onChange={(e) => setNotice({ recipients: e.target.value })}
            />
          </label>
          <label className={label}>
            How long answers are kept
            <textarea
              className={area}
              maxLength={2000}
              value={notice.retention ?? ''}
              onChange={(e) => setNotice({ retention: e.target.value })}
            />
          </label>
          <label className={label}>
            Rights and contact
            <textarea
              className={area}
              maxLength={2000}
              value={notice.rights ?? ''}
              onChange={(e) => setNotice({ rights: e.target.value })}
            />
          </label>
          <label className={label}>
            Full notice (web address, optional)
            <input
              className={field}
              type="url"
              maxLength={500}
              placeholder="https://"
              value={notice.url ?? ''}
              onChange={(e) => setNotice({ url: e.target.value })}
            />
          </label>
        </fieldset>
        {!reviewed && !noticeLocked ? (
          <Button
            type="button"
            variant="outline"
            disabled={noticeProblems(notice).length > 0}
            onClick={() =>
              onChange({ notice: { ...notice, reviewedVersion: expected.version ?? 1 } }, true)
            }
          >
            <ShieldCheck aria-hidden /> Mark as reviewed
          </Button>
        ) : null}
        {!reviewed && noticeProblems(notice).length ? (
          <p className="text-label-12 text-muted-foreground">{noticeProblems(notice)[0]}</p>
        ) : null}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="border-line bg-background-100 flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id={id} className="text-heading-16">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ───────────────────────── fill in (internal) ─────────────────────────

/** The form as people fill it in inside the app: answers go to submit_internal_form as the signed-in person. */
export function FillForm({
  org,
  viewId,
  ctx,
  form,
  fields,
  title,
  nameLabel,
  canSend,
  onSent,
}: {
  org: string;
  viewId: string;
  ctx: Ctx;
  form: FormLayout;
  fields: Field[];
  title: string;
  nameLabel: string;
  canSend: boolean;
  onSent?(displayId: string): void;
}) {
  const questions = useMemo(
    () => formQuestions({ ...form, access: 'internal' }, fields),
    [form, fields],
  );
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      noValidate
      aria-label={title}
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canSend) return;
        const check = checkFormAnswers(questions, name, answers, ctx, nameLabel);
        setErrors(check.errors);
        if (Object.keys(check.errors).length) return;
        setSending(true);
        setMessage(null);
        const r = await submitInternalFormAction({ org, viewId, name, answers });
        setSending(false);
        if (!r.ok) {
          setErrors(r.error.fieldErrors ?? {});
          setMessage(r.error.message);
          return;
        }
        toast(`Sent. ${r.data.displayId} was added.`);
        setName('');
        setAnswers({});
        onSent?.(r.data.displayId);
      }}
    >
      <header className="flex flex-col gap-1">
        <p className="text-copy-16 font-semibold">{title}</p>
        {form.description?.trim() ? (
          <p className="text-copy-13 text-muted-foreground whitespace-pre-line">
            {form.description}
          </p>
        ) : null}
      </header>
      <FormFill
        questions={questions}
        ctx={ctx}
        nameLabel={nameLabel}
        name={name}
        onName={setName}
        answers={answers}
        onAnswer={(fid, v) => setAnswers((a) => ({ ...a, [fid]: v }))}
        errors={errors}
        disabled={sending || !canSend}
      />
      {message ? (
        <p role="alert" className="text-crit text-copy-13">
          {message}
        </p>
      ) : null}
      {canSend ? (
        <div>
          <Button type="submit" disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
