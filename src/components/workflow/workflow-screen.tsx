'use client';

import { useEffect, useId, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, MessageSquareText, ShieldCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { setValuesAction } from '@/app/[org]/s/grid-actions';
import type { Json } from '@/engine/types';
import type { Stage } from '@/engine/workflow';
import { Chip, inputClass } from '@/components/fields/shared';
import { CommentDialog } from '@/components/grid/comment-dialog';
import { ToneBadge } from '@/components/insights/tone';
import { itemHref } from '@/components/my-work/work-row';
import { cn } from '@/lib/utils';
import type { WorkflowData } from '@/server/repositories/workflow';

// The workflow screen (docs/05 §4): sheet and field pickers (remembered per browser), the stages as a flow of steps
// in the mockup's "CAPA lifecycle" layout, and the chosen stage's rules, automations and items. Moving an item to
// another stage goes through setValues, so status rules, the audit log and automations apply as anywhere else.

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

export function WorkflowScreen({
  org,
  orgId,
  data,
  explicit,
  canEdit,
}: {
  org: string;
  orgId: string;
  data: WorkflowData;
  /** The URL names the sheet; otherwise the remembered choice is restored. */
  explicit: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const sheetSelect = useId();
  const fieldSelect = useId();
  const l = data.lifecycle;
  const go = (sheetId: string, fieldKey: string | null) => {
    writeChoice(orgId, sheetId, fieldKey);
    const q = new URLSearchParams({ sheet: sheetId });
    if (fieldKey) q.set('field', fieldKey);
    router.push(`/${org}/workflow?${q.toString()}`);
  };

  // restore the last choice, or remember the one in the URL
  useEffect(() => {
    if (!data.sheet) return;
    if (explicit) return writeChoice(orgId, data.sheet.id, l?.field.key ?? null);
    const saved = readChoice(orgId);
    if (!saved || !data.sheets.some((s) => s.id === saved.sheetId)) return;
    if (saved.sheetId === data.sheet.id && (saved.fieldKey ?? null) === (l?.field.key ?? null))
      return;
    const q = new URLSearchParams({ sheet: saved.sheetId });
    if (saved.fieldKey) q.set('field', saved.fieldKey);
    router.replace(`/${org}/workflow?${q.toString()}`);
  }, [data.sheet, data.sheets, explicit, l?.field.key, org, orgId, router]);

  if (data.sheets.length === 0)
    return (
      <div className="border-line flex flex-col items-start gap-2 rounded-xl border border-dashed bg-white p-6">
        <p className="text-muted-foreground m-0">
          No sheets yet. Create a sheet with a status field to see its workflow.
        </p>
        {canEdit ? (
          <Link
            href={`/${org}/s/new`}
            className="text-ink font-medium underline underline-offset-4"
          >
            New sheet
          </Link>
        ) : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label
          htmlFor={sheetSelect}
          className="flex flex-[0_1_260px] flex-col gap-1 text-[13px] font-medium"
        >
          Sheet
          <select
            id={sheetSelect}
            className={cn(inputClass, 'h-9')}
            value={data.sheet?.id ?? ''}
            onChange={(e) => go(e.target.value, null)}
          >
            {data.sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label
          htmlFor={fieldSelect}
          className="flex flex-[0_1_220px] flex-col gap-1 text-[13px] font-medium"
        >
          Stages from
          <select
            id={fieldSelect}
            className={cn(inputClass, 'h-9')}
            value={l?.field.key ?? ''}
            disabled={data.fields.length === 0}
            onChange={(e) => data.sheet && go(data.sheet.id, e.target.value)}
          >
            {data.fields.length === 0 ? <option value="">No status or label field</option> : null}
            {data.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {l ? (
          <p className="text-muted-foreground m-0 flex h-9 items-center gap-2 text-[13px]">
            <span className="border-line text-ink rounded-full border bg-white px-2 py-0.5 font-medium">
              {plural(l.total, data.sheet!.itemLabel.toLowerCase())}
            </span>
            {l.overdue > 0 ? (
              <ToneBadge tone="crit" icon={AlertTriangle}>
                {l.overdue} overdue
              </ToneBadge>
            ) : null}
          </p>
        ) : null}
      </div>

      {!l || !data.sheet ? (
        <div className="border-line flex flex-col items-start gap-2 rounded-xl border border-dashed bg-white p-6">
          <p className="text-muted-foreground m-0">
            This sheet has no status or label field. Add one to see its stages.
          </p>
          {data.sheet ? (
            <Link
              href={`/${org}/s/${data.sheet.id}`}
              className="text-ink font-medium underline underline-offset-4"
            >
              Open {data.sheet.name}
            </Link>
          ) : null}
        </div>
      ) : (
        <Lifecycle org={org} data={data} canEdit={canEdit} />
      )}
    </div>
  );
}

function Lifecycle({ org, data, canEdit }: { org: string; data: WorkflowData; canEdit: boolean }) {
  const l = data.lifecycle!;
  const sheet = data.sheet!;
  const firstBusy = l.stages.find((s) => s.items.length > 0) ?? l.stages[0];
  const [selected, setSelected] = useState<string>(firstBusy ? stageId(firstBusy) : '');
  const stage = l.stages.find((s) => stageId(s) === selected) ?? l.stages[0] ?? null;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section
        aria-label="Stages"
        className="border-line rounded-xl border bg-white px-4 py-5 shadow-xs"
      >
        <ol className="m-0 flex list-none flex-col items-center p-0">
          <li className="border-info bg-info-soft w-full max-w-[380px] rounded-lg border px-3 py-2.5 text-[13px]">
            <b className="block text-[13.5px]">
              {l.field.name} on {sheet.name}
            </b>
            <span className="text-muted-foreground">
              {l.onChange.length > 0
                ? `On any change: ${l.onChange.map((a) => a.name).join(', ')}`
                : 'Each option is a stage, in the order of the field.'}
            </span>
          </li>
          {l.stages.map((s) => {
            const id = stageId(s);
            const active = stage && stageId(stage) === id;
            const done = !!s.option?.done;
            return (
              <li key={id} className="flex w-full flex-col items-center">
                <span aria-hidden className="bg-line block h-5 w-0.5" />
                <button
                  type="button"
                  aria-pressed={!!active}
                  onClick={() => setSelected(id)}
                  className={cn(
                    'border-line hover:border-line-strong flex w-full max-w-[380px] flex-col gap-1.5 rounded-lg border bg-white px-3 py-2.5 text-left text-[13px] outline-offset-2',
                    done ? 'border-good bg-good-soft' : 'border-l-info border-l-4',
                    active && 'ring-brand ring-2',
                  )}
                >
                  <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    {s.option ? (
                      <Chip option={s.option} />
                    ) : (
                      <span className="text-muted-foreground font-medium">{s.label}</span>
                    )}
                    <span className="text-ink font-mono text-[12px] tabular-nums">
                      {plural(s.items.length, 'item')}
                    </span>
                  </span>
                  {s.overdue > 0 || s.rules.length > 0 || s.automations.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {s.overdue > 0 ? (
                        <ToneBadge tone="crit" icon={AlertTriangle}>
                          {s.overdue} overdue
                        </ToneBadge>
                      ) : null}
                      {s.rules.some((r) => r.requires) ? (
                        <ToneBadge tone="neutral" icon={ShieldCheck}>
                          Has requirements
                        </ToneBadge>
                      ) : null}
                      {s.rules.some((r) => r.comment) ? (
                        <ToneBadge tone="neutral" icon={MessageSquareText}>
                          Comment required
                        </ToneBadge>
                      ) : null}
                      {s.automations.length > 0 ? (
                        <ToneBadge tone="neutral" icon={Zap}>
                          {plural(s.automations.length, 'automation')}
                        </ToneBadge>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </section>
      {stage ? <StagePanel org={org} data={data} stage={stage} canEdit={canEdit} /> : null}
    </div>
  );
}

function StagePanel({
  org,
  data,
  stage,
  canEdit,
}: {
  org: string;
  data: WorkflowData;
  stage: Stage;
  canEdit: boolean;
}) {
  const l = data.lifecycle!;
  const sheet = data.sheet!;
  const headingId = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState<{
    itemId: string;
    value: Json;
    message: string;
  } | null>(null);
  const targets = useMemo(() => l.stages.filter((s) => s.key !== null), [l.stages]);

  const move = async (itemId: string, value: Json, note?: string) => {
    const r = await setValuesAction({
      org,
      sheetId: sheet.id,
      itemId,
      values: { [l.field.id]: value },
      ...(note ? { note } : {}),
    });
    if (!r.ok) {
      if (r.error.code === 'comment_required')
        return setComment({ itemId, value, message: r.error.message });
      return void toast.error(r.error.message);
    }
    for (const m of r.data.messages) toast(m);
    startTransition(() => router.refresh());
  };

  const requirements = stage.rules.filter((r) => r.requires || r.message);
  return (
    <section
      aria-labelledby={headingId}
      className="border-line flex min-w-0 flex-col rounded-xl border bg-white shadow-xs"
    >
      <header className="border-line border-b px-4 py-3.5">
        <h2 id={headingId} className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
          Stage: {stage.label}
        </h2>
      </header>
      <div className="flex flex-col gap-4 px-4 py-3.5">
        <dl className="m-0 grid grid-cols-[130px_1fr] gap-x-2.5 gap-y-1.5 text-[13px]">
          <dt className="text-muted-foreground">Items</dt>
          <dd className="m-0">
            {stage.items.length}
            {stage.overdue > 0 ? (
              <span className="text-crit">, {stage.overdue} overdue</span>
            ) : null}
          </dd>
          {stage.key !== null ? (
            <>
              <dt className="text-muted-foreground">To enter</dt>
              <dd className="m-0">
                {requirements.length === 0 ? (
                  'No requirements'
                ) : (
                  <ul className="m-0 list-none p-0">
                    {requirements.map((r) => (
                      <li key={r.id}>{[r.requires, r.message].filter(Boolean).join('. ')}</li>
                    ))}
                  </ul>
                )}
              </dd>
              <dt className="text-muted-foreground">Comment</dt>
              <dd className="m-0">
                {stage.rules.some((r) => r.comment)
                  ? 'Required when an item enters'
                  : 'Not required'}
              </dd>
              <dt className="text-muted-foreground">When an item enters</dt>
              <dd className="m-0">
                {stage.automations.length === 0 ? (
                  'No automations'
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {stage.automations.map((a) => (
                      <li key={a.id}>
                        <span className="font-medium">{a.name}</span>
                        {a.enabled ? null : <span className="text-muted-foreground"> (off)</span>}
                        <span className="text-muted-foreground block text-[12px]">
                          {a.when} → {a.then}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">Note</dt>
              <dd className="m-0">
                These items have no {l.field.name.toLowerCase()}, or one that is no longer an
                option.
              </dd>
            </>
          )}
        </dl>

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[13.5px] font-semibold">Items in this stage</h3>
          {stage.items.length === 0 ? (
            <p className="text-muted-foreground m-0 text-[13px]">No items in this stage.</p>
          ) : (
            <ul
              aria-busy={pending}
              className="border-line m-0 flex max-h-[480px] list-none flex-col overflow-y-auto rounded-lg border p-0"
            >
              {stage.items.map((it) => (
                <li
                  key={it.id}
                  className="border-line-2 flex flex-wrap items-center gap-2 border-t px-3 py-2 first:border-t-0"
                >
                  <Link
                    href={itemHref(org, { sheetId: sheet.id, displayId: it.displayId })}
                    className="flex min-w-0 flex-[1_1_160px] flex-col underline-offset-4 hover:underline"
                  >
                    <span className="text-muted-foreground font-mono text-[11.5px]">
                      {it.displayId}
                    </span>
                    <span className="truncate text-[13.5px] font-medium">{it.name}</span>
                  </Link>
                  {it.overdue ? (
                    <ToneBadge tone="crit" icon={AlertTriangle}>
                      Overdue
                    </ToneBadge>
                  ) : null}
                  {canEdit ? (
                    <select
                      aria-label={`Move ${it.displayId} to stage`}
                      className={cn(inputClass, 'h-8 w-auto max-w-[180px]')}
                      value={stage.key ?? ''}
                      disabled={pending}
                      onChange={(e) => {
                        const key = e.target.value;
                        void move(it.id, data.inputs[key] ?? null);
                      }}
                    >
                      {stage.key === null ? <option value="">No stage</option> : null}
                      {targets.map((t) => (
                        <option key={t.key!} value={t.key!}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-muted-foreground m-0 text-[12px]">
          Stages, requirements and comments are set in the field&apos;s settings on{' '}
          <Link href={`/${org}/s/${sheet.id}/settings`} className="text-ink underline">
            {sheet.name}
          </Link>
          ; what happens on entering a stage in{' '}
          <Link href={`/${org}/automations`} className="text-ink underline">
            Automations
          </Link>
          . Every move is kept in the activity log.
        </p>
      </div>
      <CommentDialog
        open={!!comment}
        message={comment?.message ?? ''}
        onCancel={() => setComment(null)}
        onSubmit={async (note) => {
          if (!comment) return;
          const c = comment;
          setComment(null);
          await move(c.itemId, c.value, note);
        }}
      />
    </section>
  );
}
