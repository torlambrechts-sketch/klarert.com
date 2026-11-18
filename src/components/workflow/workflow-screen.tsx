'use client';

import { useEffect, useId, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { CreateSheetLink } from '@/components/create/create-provider';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  Workflow,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { setValuesAction } from '@/app/[org]/s/grid-actions';
import type { Json } from '@/engine/types';
import { runningItems, type Stage } from '@/engine/workflow';
import { Chip, inputClass } from '@/components/fields/shared';
import { CommentDialog } from '@/components/grid/comment-dialog';
import { ToneBadge } from '@/components/insights/tone';
import { itemHref } from '@/components/my-work/work-row';
import {
  ListFrame,
  ListHeader,
  ListSearch,
  PanelCard,
  RowCaret,
  RowDrawer,
  RowIcon,
} from '@/components/shell/data-list';
import { WindowList } from '@/components/shell/window-list';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkflowData, WorkflowRow } from '@/server/repositories/workflow';
import { countItems } from '@/engine/nouns';

// The workflow screen (docs/05 §4) in the board design's "Workflows" list: one row per sheet with the field its
// stages come from (remembered per browser), the number of stages, items and running items. A row opens in place to
// its steps (the stages in order) with what each needs, what runs when an item enters it and its items. "Running now"
// lists the items that are not done. Moving an item goes through setValues, so status rules, the audit log and
// automations apply as anywhere else.

const STORE_KEY = (orgId: string) => `cos.workflow.${orgId}`;

function readChoice(orgId: string): { sheetId: string; fieldKey: string | null } | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY(orgId));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (v && typeof v === 'object' && typeof (v as { sheetId?: unknown }).sheetId === 'string') {
      const fk = (v as { fieldKey?: unknown }).fieldKey;
      return {
        sheetId: (v as { sheetId: string }).sheetId,
        fieldKey: typeof fk === 'string' ? fk : null,
      };
    }
  } catch {
    // not remembered
  }
  return null;
}

function writeChoice(orgId: string, sheetId: string, fieldKey: string | null) {
  try {
    window.localStorage.setItem(STORE_KEY(orgId), JSON.stringify({ sheetId, fieldKey }));
  } catch {
    // not remembered; the URL still carries the choice
  }
}

const stageId = (s: Stage) => s.key ?? '';
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const GRID =
  'grid-cols-[36px_minmax(0,1fr)_64px] md:grid-cols-[40px_minmax(200px,2fr)_minmax(160px,1.3fr)_64px_64px_80px_96px]';
const selectClass = cn(inputClass, 'select-chevron h-8 w-full text-14 shadow-none');

/** One move of an item to a stage; asks for a comment when a status rule wants one. */
function useMove(org: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState<{
    sheetId: string;
    fieldId: string;
    itemId: string;
    value: Json;
    message: string;
  } | null>(null);
  const move = async (
    to: { sheetId: string; fieldId: string; itemId: string; value: Json },
    note?: string,
  ) => {
    const r = await setValuesAction({
      org,
      sheetId: to.sheetId,
      itemId: to.itemId,
      values: { [to.fieldId]: to.value },
      ...(note ? { note } : {}),
    });
    if (!r.ok) {
      if (r.error.code === 'comment_required')
        return setComment({ ...to, message: r.error.message });
      return void toast.error(r.error.message);
    }
    for (const m of r.data.messages) toast(m);
    startTransition(() => router.refresh());
  };
  const dialog = (
    <CommentDialog
      open={!!comment}
      message={comment?.message ?? ''}
      onCancel={() => setComment(null)}
      onSubmit={async (note) => {
        if (!comment) return;
        const c = comment;
        setComment(null);
        await move(c, note);
      }}
    />
  );
  return { move, pending, dialog };
}

type Move = ReturnType<typeof useMove>;

export function WorkflowScreen({
  org,
  orgId,
  data,
  explicit,
  canEdit,
  canManage = false,
}: {
  org: string;
  orgId: string;
  data: WorkflowData;
  /** The URL names the sheet; otherwise the remembered choice is restored. */
  explicit: boolean;
  canEdit: boolean;
  /** Owners and admins set up approval workflows. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(data.chosen);
  const mover = useMove(org);
  const go = (sheetId: string, fieldKey: string | null) => {
    writeChoice(orgId, sheetId, fieldKey);
    setOpen(sheetId);
    const p = new URLSearchParams({ sheet: sheetId });
    if (fieldKey) p.set('field', fieldKey);
    router.push(`/${org}/workflow?${p.toString()}`, { scroll: false });
  };

  // restore the last choice, or remember the one in the URL
  useEffect(() => {
    const row = data.rows.find((r) => r.sheet.id === data.chosen);
    if (explicit) {
      if (row) writeChoice(orgId, row.sheet.id, row.lifecycle?.field.key ?? null);
      return;
    }
    const saved = readChoice(orgId);
    const savedRow = saved && data.rows.find((r) => r.sheet.id === saved.sheetId);
    if (!saved || !savedRow) return;
    if (!saved.fieldKey || savedRow.lifecycle?.field.key === saved.fieldKey) {
      setOpen(saved.sheetId);
      return;
    }
    const p = new URLSearchParams({ sheet: saved.sheetId, field: saved.fieldKey });
    router.replace(`/${org}/workflow?${p.toString()}`, { scroll: false });
  }, [data.chosen, data.rows, explicit, org, orgId, router]);

  const needle = q.trim().toLowerCase();
  const rows = data.rows.filter(
    (r) =>
      !needle || `${r.sheet.name} ${r.lifecycle?.field.name ?? ''}`.toLowerCase().includes(needle),
  );

  if (data.rows.length === 0)
    return (
      <div className="border-line bg-surface flex flex-col items-start gap-2 rounded-lg border border-dashed p-6">
        <p className="text-muted-foreground m-0">
          No sheets yet. Create a sheet with a status field to see its workflow.
        </p>
        {canEdit ? (
          <CreateSheetLink org={org} className="text-ink font-medium underline underline-offset-4">
            New sheet
          </CreateSheetLink>
        ) : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListSearch
          value={q}
          onChange={setQ}
          label="Search workflows"
          placeholder="Search workflows…"
        />
      </div>
      <ListFrame
        label="Workflows"
        busy={mover.pending}
        header={
          <ListHeader className={GRID}>
            <span />
            <span>Name</span>
            <span className="hidden md:block">Stages from</span>
            <span className="hidden md:block">Stages</span>
            <span className="hidden md:block">Items</span>
            <span>Running</span>
            <span className="hidden md:block">Overdue</span>
          </ListHeader>
        }
      >
        {rows.map((r) => (
          <WorkflowListRow
            key={r.sheet.id}
            org={org}
            row={r}
            open={open === r.sheet.id}
            onToggle={() => {
              const next = open === r.sheet.id ? null : r.sheet.id;
              setOpen(next);
              if (next) writeChoice(orgId, r.sheet.id, r.lifecycle?.field.key ?? null);
            }}
            onField={(key) => go(r.sheet.id, key)}
            canEdit={canEdit}
            canManage={canManage}
            mover={mover}
          />
        ))}
        {rows.length === 0 ? (
          <li className="text-muted-foreground text-14 p-6 text-center">
            No workflows match “{q.trim()}”.
          </li>
        ) : null}
      </ListFrame>
      <RunningNow org={org} rows={rows} query={q.trim()} canEdit={canEdit} mover={mover} />
      {mover.dialog}
    </div>
  );
}

function FieldPicker({
  row,
  onField,
  className,
  id,
}: {
  row: WorkflowRow;
  onField(key: string): void;
  className?: string;
  /** Labelled by a visible label (the phone layout) instead of its own name. */
  id?: string;
}) {
  return (
    <select
      id={id}
      aria-label={id ? undefined : `Stages of ${row.sheet.name} from`}
      className={cn(selectClass, className)}
      value={row.lifecycle?.field.key ?? ''}
      disabled={row.fields.length === 0}
      onChange={(e) => onField(e.target.value)}
    >
      {row.fields.length === 0 ? <option value="">No status or label field</option> : null}
      {row.fields.map((f) => (
        <option key={f.key} value={f.key}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

/** The sheet's approval workflows (docs/04 §13), with the way to set them up (owners and admins). */
function Approvals({ org, row, canManage }: { org: string; row: WorkflowRow; canManage: boolean }) {
  const href = `/${org}/s/${row.sheet.id}/settings#approvals`;
  return (
    <div
      className="border-soft flex flex-col gap-1.5 border-b py-2.5"
      data-testid="workflow-approvals"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-12 font-medium">Approval workflows</span>
        {canManage ? (
          <Link href={href} className="text-ink text-13 font-medium underline underline-offset-4">
            {row.approvals.length ? 'Edit approval workflows' : 'Set up an approval workflow'}
          </Link>
        ) : null}
      </div>
      {row.approvals.length === 0 ? (
        <p className="text-muted-foreground text-13 m-0">
          None yet. An approval workflow sends items through review and approval steps, with every
          decision in the activity log.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {row.approvals.map((a) => (
            <li key={a.id} className="text-13 flex flex-wrap items-center gap-x-2">
              <ShieldCheck className="text-muted-foreground size-3.5" aria-hidden />
              <span className="font-medium">{a.name}</span>
              <span className="text-muted-foreground">
                {a.steps.map((st, i) => `${i + 1}. ${st}`).join(' → ')}
              </span>
              <span className={a.enabled ? 'text-good' : 'text-muted-foreground'}>
                {a.enabled ? 'On' : 'Off'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkflowListRow({
  org,
  row,
  open,
  onToggle,
  onField,
  canEdit,
  canManage,
  mover,
}: {
  org: string;
  row: WorkflowRow;
  open: boolean;
  onToggle(): void;
  onField(key: string): void;
  canEdit: boolean;
  canManage: boolean;
  mover: Move;
}) {
  const l = row.lifecycle;
  const drawer = useId();
  const running = l ? runningItems(l).length : 0;
  return (
    <li className="border-line border-b last:border-b-0" data-testid="workflow-row">
      <div
        className={cn(
          'hover:bg-subtle grid min-h-14 items-center gap-x-3 pr-3 pl-1.5',
          GRID,
          open && 'bg-subtle',
        )}
      >
        <RowCaret
          open={open}
          onClick={onToggle}
          controls={open ? drawer : undefined}
          label={`Steps of ${row.sheet.name}`}
        />
        <span className="flex min-w-0 items-center gap-3">
          <RowIcon icon={Workflow} dim={!l} />
          <span className="flex min-w-0 flex-col">
            <span className="text-14 truncate font-medium">{row.sheet.name}</span>
            <span className="text-muted-foreground text-12 truncate font-mono">
              {l ? `${l.field.key} · ${countItems(l.total, row.sheet.itemLabel)}` : 'no stages'}
              {row.approvals.length
                ? ` · ${plural(row.approvals.length, 'approval workflow')}`
                : ''}
            </span>
          </span>
        </span>
        <span className="hidden min-w-0 md:block">
          <FieldPicker row={row} onField={onField} />
        </span>
        <span className="text-ink text-13 hidden font-mono md:block">
          {l ? l.stages.filter((s) => s.key !== null).length : '–'}
        </span>
        <span className="text-ink text-13 hidden font-mono md:block">{l ? l.total : '–'}</span>
        <span className="text-13 font-mono">
          {running > 0 ? (
            <b className="text-ink inline-flex items-center gap-1.5 font-medium">
              <span
                aria-hidden
                className="bg-good size-[7px] rounded-full shadow-[0_0_0_3px_var(--good-soft)]"
              />
              {running}
              <span className="sr-only"> running</span>
            </b>
          ) : (
            <span className="text-muted-foreground">0</span>
          )}
        </span>
        <span className="hidden md:block">
          {l && l.overdue > 0 ? (
            <ToneBadge tone="crit" icon={AlertTriangle}>
              {l.overdue} overdue
            </ToneBadge>
          ) : (
            <span className="text-muted-foreground text-13 font-mono">0</span>
          )}
        </span>
      </div>
      {open ? (
        <RowDrawer id={drawer}>
          <Approvals org={org} row={row} canManage={canManage} />
          <div className="flex flex-col gap-1.5 py-2.5 md:hidden">
            <label
              htmlFor={`${drawer}-field`}
              className="text-muted-foreground text-12 font-medium"
            >
              Stages from
            </label>
            <FieldPicker row={row} onField={onField} id={`${drawer}-field`} />
          </div>
          {l ? (
            <Steps org={org} row={row} canEdit={canEdit} mover={mover} />
          ) : (
            <div className="flex flex-col items-start gap-2 py-3">
              <p className="text-muted-foreground text-14 m-0">
                This sheet has no status or label field. Add one to see its stages.
              </p>
              <Link
                href={`/${org}/s/${row.sheet.id}`}
                className="text-ink text-14 font-medium underline underline-offset-4"
              >
                Open {row.sheet.name}
              </Link>
            </div>
          )}
        </RowDrawer>
      ) : null}
    </li>
  );
}

function Steps({
  org,
  row,
  canEdit,
  mover,
}: {
  org: string;
  row: WorkflowRow;
  canEdit: boolean;
  mover: Move;
}) {
  const l = row.lifecycle!;
  const [shown, setShown] = useState<string | null>(null);
  const label = `${row.sheet.name} steps`;
  return (
    <div className="flex flex-col">
      <div className="text-muted-foreground text-12 flex flex-wrap justify-between gap-2.5 pt-2.5 pb-2 font-medium">
        <span>Steps</span>
        <span className="font-normal">
          The options of {l.field.name}, in order. Every move is kept in the activity log.
        </span>
      </div>
      <ol
        aria-label={label}
        className="border-line bg-surface m-0 flex list-none flex-col overflow-hidden rounded-lg border p-0"
      >
        {l.stages.map((s, i) => {
          const id = stageId(s);
          const isOpen = shown === id;
          const requirement = s.rules
            .map((r) => r.requires ?? r.message)
            .filter((x): x is string => !!x);
          const messages = s.rules
            .map((r) => r.message)
            .filter(Boolean)
            .join(' ');
          return (
            <li key={id} className="border-soft border-b last:border-b-0">
              <div className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 px-2.5 py-2 md:grid-cols-[28px_minmax(140px,1fr)_auto_150px_minmax(150px,220px)_80px]">
                <span
                  aria-hidden
                  className="bg-soft text-muted-foreground text-12 grid size-[22px] place-items-center rounded-full font-mono font-medium"
                >
                  {i + 1}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  {s.option ? (
                    <Chip option={s.option} />
                  ) : (
                    <span className="text-muted-foreground text-14 font-medium">{s.label}</span>
                  )}
                </span>
                <span className="col-start-2 flex flex-wrap items-center gap-1.5 md:col-start-auto md:justify-end">
                  {requirement.length > 0 ? (
                    <span
                      className="bg-soft text-muted-foreground text-12 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap md:max-w-[280px]"
                      title={[requirement.join('; '), messages].filter(Boolean).join('. ')}
                    >
                      <ShieldCheck className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{requirement.join('; ')}</span>
                    </span>
                  ) : null}
                  {s.rules.some((r) => r.comment) ? (
                    <span className="bg-soft text-muted-foreground text-12 inline-flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap">
                      <MessageSquareText className="size-3" aria-hidden />
                      Comment required
                    </span>
                  ) : null}
                </span>
                <span className="text-13 col-start-2 flex items-center gap-2 whitespace-nowrap md:col-start-auto">
                  <span className="text-ink font-mono">{plural(s.items.length, 'item')}</span>
                  {s.overdue > 0 ? (
                    <ToneBadge tone="crit" icon={AlertTriangle}>
                      {s.overdue} overdue
                    </ToneBadge>
                  ) : null}
                </span>
                <span className="text-13 col-start-2 min-w-0 md:col-start-auto">
                  {s.automations.length > 0 ? (
                    <span
                      className="text-ink inline-flex max-w-full items-center gap-1.5"
                      title={s.automations
                        .map((a) => `${a.name}: ${a.when} → ${a.then}`)
                        .join('\n')}
                    >
                      <Zap className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">
                        {s.automations.length === 1
                          ? s.automations[0]!.name
                          : `${s.automations.length} automations on entering`}
                        {s.automations.every((a) => !a.enabled) ? ' (off)' : ''}
                      </span>
                    </span>
                  ) : s.key !== null ? (
                    <span className="text-muted-foreground">No automations</span>
                  ) : (
                    <span className="text-muted-foreground">Not an option of {l.field.name}</span>
                  )}
                </span>
                <span className="col-start-3 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`Items in ${s.label}`}
                    onClick={() => setShown(isOpen ? null : id)}
                    className="text-muted-foreground hover:bg-soft hover:text-ink focus-visible:outline-focus text-13 inline-flex h-[30px] items-center gap-1 rounded-md px-2 font-medium focus-visible:outline-2"
                  >
                    {isOpen ? (
                      <ChevronDown className="size-3.5" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3.5" aria-hidden />
                    )}
                    Items
                  </button>
                </span>
              </div>
              {isOpen ? (
                <StageItems org={org} row={row} stage={s} canEdit={canEdit} mover={mover} />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2 pt-2.5">
        {canEdit ? (
          <Link
            href={`/${org}/s/${row.sheet.id}/settings`}
            className="border-line-strong text-muted-foreground hover:border-faint hover:text-ink bg-surface text-14 inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed px-2.5"
          >
            <Settings2 className="size-3.5" aria-hidden />
            Edit stages and rules
          </Link>
        ) : null}
        <Link
          href={`/${org}/automations?sheet=${row.sheet.id}`}
          className="border-line-strong text-muted-foreground hover:border-faint hover:text-ink bg-surface text-14 inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed px-2.5"
        >
          <Zap className="size-3.5" aria-hidden />
          Automations
        </Link>
        <span className="flex-1" />
        <span className="text-muted-foreground text-13">
          {l.onChange.length > 0
            ? `On any change: ${l.onChange.map((a) => a.name).join(', ')}`
            : countItems(l.total, row.sheet.itemLabel)}
        </span>
      </div>
    </div>
  );
}

function MoveSelect({
  row,
  item,
  stageKey,
  mover,
}: {
  row: WorkflowRow;
  item: { id: string; displayId: string };
  stageKey: string | null;
  mover: Move;
}) {
  const l = row.lifecycle!;
  const targets = l.stages.filter((s) => s.key !== null);
  return (
    <select
      aria-label={`Move ${item.displayId} to stage`}
      className={cn(selectClass, 'w-auto max-w-[180px]')}
      value={stageKey ?? ''}
      disabled={mover.pending}
      onChange={(e) =>
        void mover.move({
          sheetId: row.sheet.id,
          fieldId: l.field.id,
          itemId: item.id,
          value: row.inputs[e.target.value] ?? null,
        })
      }
    >
      {stageKey === null ? <option value="">No stage</option> : null}
      {targets.map((t) => (
        <option key={t.key!} value={t.key!}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

function StageItems({
  org,
  row,
  stage,
  canEdit,
  mover,
}: {
  org: string;
  row: WorkflowRow;
  stage: Stage;
  canEdit: boolean;
  mover: Move;
}) {
  if (stage.items.length === 0)
    return (
      <p className="text-muted-foreground border-soft text-13 m-0 border-t px-3 py-2.5 md:pl-[48px]">
        No items in this stage.
      </p>
    );
  return (
    <div className="border-soft bg-subtle border-t md:pl-[38px]">
      <WindowList
        aria-label={`Items in ${stage.label}`}
        itemClassName={(_, last) => cn('border-soft', !last && 'border-b')}
        items={stage.items}
        getKey={(it) => it.id}
        estimateSize={45}
        renderItem={(it) => (
          <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
            <Link
              href={itemHref(org, { sheetId: row.sheet.id, displayId: it.displayId })}
              className="flex min-w-0 flex-[1_1_180px] items-baseline gap-2 underline-offset-4 hover:underline"
            >
              <span className="text-muted-foreground text-12 font-mono">{it.displayId}</span>
              <span className="text-14 truncate">{it.name}</span>
            </Link>
            {it.overdue ? (
              <ToneBadge tone="crit" icon={AlertTriangle}>
                Overdue
              </ToneBadge>
            ) : null}
            {canEdit ? <MoveSelect row={row} item={it} stageKey={stage.key} mover={mover} /> : null}
          </div>
        )}
      />
    </div>
  );
}

function RunningNow({
  org,
  rows,
  query,
  canEdit,
  mover,
}: {
  org: string;
  /** The workflows the search keeps (all of them without a search). */
  rows: WorkflowRow[];
  query: string;
  canEdit: boolean;
  mover: Move;
}) {
  const heading = useId();
  const running = useMemo(
    () =>
      rows.flatMap((r) =>
        r.lifecycle ? runningItems(r.lifecycle).map((it) => ({ row: r, it })) : [],
      ),
    [rows],
  );
  const scope = query ? `Workflows matching “${query}”` : 'All workflows';
  return (
    <PanelCard
      title="Running now"
      aside={`${scope} · ${plural(running.length, 'item')} not done`}
      headingId={heading}
    >
      {running.length === 0 ? (
        <p className="text-muted-foreground text-14 m-0 px-4 py-6">
          {query
            ? `Nothing is running in the workflows matching “${query}”.`
            : 'Nothing is running. Items that are not done show here with their stage.'}
        </p>
      ) : (
        // a workspace can have tens of thousands of open items: only the rows near the viewport are in the page
        <div className="p-2">
          <WindowList
            aria-labelledby={heading}
            items={running}
            getKey={({ it }) => it.id}
            estimateSize={54}
            itemClassName="pb-0.5"
            renderItem={({ row, it }) => (
              <div className="hover:bg-soft flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md px-2.5 py-2">
                <span className="text-ink text-13 w-[72px] shrink-0 font-mono">{it.displayId}</span>
                <span className="flex min-w-0 flex-[1_1_200px] flex-col">
                  <span className="text-14 truncate">{it.name}</span>
                  <span className="text-muted-foreground text-12 truncate">
                    {row.sheet.name} · {it.stageLabel}
                  </span>
                </span>
                {it.overdue ? (
                  <ToneBadge tone="crit" icon={AlertTriangle}>
                    Overdue
                  </ToneBadge>
                ) : null}
                {canEdit ? (
                  <MoveSelect row={row} item={it} stageKey={it.stageKey} mover={mover} />
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={itemHref(org, { sheetId: row.sheet.id, displayId: it.displayId })}
                    aria-label={`Open ${it.displayId} ${it.name}`}
                  >
                    Open
                  </Link>
                </Button>
              </div>
            )}
          />
        </div>
      )}
    </PanelCard>
  );
}
