'use client';

import { useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Minus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  itemApprovalsAction,
  previewSubmissionAction,
  submitForApprovalAction,
  withdrawApprovalAction,
} from '@/app/[org]/approval-actions';
import {
  approvalState,
  approvalTimeline,
  enabledWorkflows,
  waitingOn,
  type StepState,
  type TimelineStep,
} from '@/engine/approvals';
import { formatDateTime } from '@/engine/fields/helpers';
import type { Ctx, Item } from '@/engine/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { inputClass } from '@/components/fields/shared';
import { cn } from '@/lib/utils';
import { ApprovalStateLine, DecisionDialog } from './decision-dialog';

// Approval in the item panel (docs/05 §3.4): the current state in words and a symbol, Submit for approval, Approve /
// Reject for the approvers of the current step, Withdraw for the person who submitted (and owners and admins), and
// the timeline of steps: who decided, when, with what comment. The truth is the database's; this reads it under the
// person's access and refreshes after every action.

export const approvalKeys = { item: (itemId: string) => ['item-approvals', itemId] as const };

const STEP_WORDS: Record<StepState, string> = {
  done: 'Approved',
  current: 'Waiting',
  rejected: 'Rejected',
  upcoming: 'Up next',
  not_reached: 'Not reached',
};

function StepMark({ state }: { state: StepState }) {
  const Icon = state === 'done' ? Check : state === 'rejected' ? X : Minus;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full border',
        state === 'done' && 'border-good text-good',
        state === 'rejected' && 'border-crit text-crit',
        state === 'current' && 'border-info text-info',
        (state === 'upcoming' || state === 'not_reached') && 'border-line text-muted-foreground',
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function Steps({ steps, ctx }: { steps: TimelineStep[]; ctx: Ctx }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Approval steps">
      {steps.map((s) => (
        <li key={s.id} className="flex gap-2.5" data-testid="approval-step">
          <StepMark state={s.state} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-label-14 font-semibold">
                {s.index + 1}. {s.name}
              </span>
              <span
                className={cn(
                  'text-label-12 font-medium',
                  s.state === 'rejected' ? 'text-crit' : 'text-muted-foreground',
                )}
              >
                {STEP_WORDS[s.state]}
              </span>
            </div>
            <span className="text-label-12 text-muted-foreground">{s.rule}</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {s.people.map((p) => (
                <li key={p.id} className="text-copy-13 flex flex-col">
                  <span>
                    <span className="font-medium">{p.name}</span>
                    {p.decision ? (
                      <>
                        {' '}
                        <span className={p.decision === 'rejected' ? 'text-crit' : 'text-good'}>
                          {p.decision === 'approved' ? '✓ approved' : '✕ rejected'}
                        </span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {p.at ? formatDateTime(p.at, ctx.timeZone) : ''}
                        </span>
                      </>
                    ) : s.state === 'current' ? (
                      <span className="text-muted-foreground"> · not decided yet</span>
                    ) : null}
                  </span>
                  {p.comment ? (
                    <span className="text-muted-foreground border-line ml-0.5 border-l-2 pl-2">
                      {p.comment}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {s.earlier.map((r) => (
              <details key={r.round} className="text-copy-13">
                <summary className="text-muted-foreground cursor-pointer">
                  Round {r.round}: {r.decisions.length}{' '}
                  {r.decisions.length === 1 ? 'decision' : 'decisions'}
                </summary>
                <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                  {r.decisions.map((p, i) => (
                    <li key={i}>
                      {p.name} {p.decision === 'approved' ? '✓ approved' : '✕ rejected'}
                      {p.at ? ` · ${formatDateTime(p.at, ctx.timeZone)}` : ''}
                      {p.comment ? ` · “${p.comment}”` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ItemApprovals({
  org,
  item,
  ctx,
  canSubmit,
}: {
  org: string;
  item: Item;
  ctx: Ctx;
  /** The person can edit the item (submitting is an edit). */
  canSubmit: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: approvalKeys.item(item.id),
    queryFn: async () => {
      const r = await itemApprovalsAction({ org, itemId: item.id });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    staleTime: 15_000,
  });
  const [dialog, setDialog] = useState<null | 'submit' | 'approved' | 'rejected' | 'withdraw'>(
    null,
  );
  const workflows = enabledWorkflows(ctx.sheet.workflows);
  const refresh = () => void qc.invalidateQueries({ queryKey: approvalKeys.item(item.id) });

  const data = q.data;
  const current = data?.instances[0] ?? null;
  const timeline = useMemo(
    () => (current && data ? approvalTimeline(current, data.decisions, ctx) : null),
    [current, data, ctx],
  );
  if (workflows.length === 0 && !(ctx.sheet.workflows ?? []).length && !current) return null;

  const live = current?.status === 'in_progress' ? current : null;
  const mine = live && data ? waitingOn(live, data.decisions).includes(data.me) : false;
  const selfBlocked = !!live && !live.definition.allowSelfApproval && live.submittedBy === data?.me;
  const canWithdraw = !!live && !!data && (live.submittedBy === data.me || data.isAdmin);
  const state = approvalState(current, ctx);
  const isLast = !!live && live.stepIndex === live.definition.steps.length - 1;
  const title = `${item.displayId} ${item.name}`;

  return (
    <section
      aria-labelledby={`approval-${item.id}`}
      className="flex flex-col gap-3"
      data-testid="item-approvals"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`approval-${item.id}`} className="text-heading-14 m-0">
          Approval
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {mine && !selfBlocked ? (
            <>
              <Button type="button" size="sm" onClick={() => setDialog('approved')}>
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDialog('rejected')}
              >
                Reject
              </Button>
            </>
          ) : null}
          {canWithdraw ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setDialog('withdraw')}>
              Withdraw
            </Button>
          ) : null}
          {!live && canSubmit && workflows.length > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setDialog('submit')}>
              Submit for approval
            </Button>
          ) : null}
        </div>
      </div>
      {q.isPending ? (
        <div className="bg-soft h-16 animate-pulse rounded-lg" aria-label="Loading the approval" />
      ) : q.isError ? (
        <div
          role="alert"
          className="border-line flex items-center justify-between gap-2 rounded-lg border p-3"
        >
          <span className="text-copy-13">The approval could not be loaded.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="border-line bg-background-100 flex flex-col gap-3 rounded-lg border p-3">
          <ApprovalStateLine {...state} />
          {live && mine && selfBlocked ? (
            <p className="text-copy-13 text-muted-foreground m-0">
              You submitted it, so someone else approves it.
            </p>
          ) : null}
          {timeline ? (
            <>
              <p className="text-copy-13 text-muted-foreground m-0">
                {timeline.workflowName} · submitted by {timeline.submittedBy},{' '}
                {formatDateTime(timeline.submittedAt, ctx.timeZone)}
                {current?.submitComment ? ` · “${current.submitComment}”` : ''}
              </p>
              <Steps steps={timeline.steps} ctx={ctx} />
            </>
          ) : (
            <p className="text-copy-13 text-muted-foreground m-0">
              {canSubmit
                ? 'Submit it when it is ready: each step’s approvers are told and every decision is logged.'
                : 'Not submitted yet.'}
            </p>
          )}
          {data && data.instances.length > 1 ? (
            <details className="text-copy-13">
              <summary className="text-muted-foreground cursor-pointer">
                Earlier approvals ({data.instances.length - 1})
              </summary>
              <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                {data.instances.slice(1).map((inst) => {
                  const s = approvalState(inst, ctx);
                  return (
                    <li key={inst.id}>
                      {s.text} · submitted {formatDateTime(inst.submittedAt, ctx.timeZone)}
                      {s.detail ? ` · ${s.detail}` : ''}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      {dialog === 'submit' ? (
        <SubmitDialog
          org={org}
          item={item}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {(dialog === 'approved' || dialog === 'rejected') && live ? (
        <DecisionDialog
          org={org}
          instanceId={live.id}
          decision={dialog}
          title={`${dialog === 'approved' ? 'Approve' : 'Reject'} ${title}`}
          commentRequired={
            dialog === 'approved' &&
            isLast &&
            ctx.sheet.register === 'documents' &&
            !!live.definition.statusField?.onApproved
          }
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {dialog === 'withdraw' && live ? (
        <WithdrawDialog
          org={org}
          instanceId={live.id}
          title={title}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function SubmitDialog({
  org,
  item,
  onClose,
  onDone,
}: {
  org: string;
  item: Item;
  onClose(): void;
  onDone(): void;
}) {
  const id = useId();
  const preview = useQuery({
    queryKey: ['approval-preview', item.id, item.updatedAt],
    queryFn: async () => {
      const r = await previewSubmissionAction({ org, sheetId: item.sheetId, itemId: item.id });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const workflows = preview.data?.workflows ?? [];
  const w = workflows.find((x) => x.id === chosen) ?? workflows[0];

  async function submit() {
    if (!w) return;
    if (w.commentRequired && !comment.trim()) {
      setError(w.commentRequired);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await submitForApprovalAction({
      org,
      sheetId: item.sheetId,
      itemId: item.id,
      workflowId: w.id,
      comment: comment.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    toast(
      `Submitted for approval. ${w.steps[0]?.approvers.join(', ') || 'The approvers'} ${w.steps[0]?.approvers.length === 1 ? 'is' : 'are'} told.`,
    );
    for (const m of r.data.messages) toast(m);
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={`${id}-desc`}>
        <DialogTitle className="text-heading-16 m-0">Submit for approval</DialogTitle>
        <DialogDescription id={`${id}-desc`} className="text-muted-foreground text-copy-13 m-0">
          {item.displayId} {item.name}
        </DialogDescription>
        {preview.isPending ? (
          <div
            className="bg-soft h-24 animate-pulse rounded-lg"
            aria-label="Loading who approves"
          />
        ) : preview.isError || !w ? (
          <div role="alert" className="flex items-center justify-between gap-2">
            <span className="text-copy-13">
              {preview.isError
                ? 'Who approves could not be worked out.'
                : 'This sheet has no approval workflow turned on.'}
            </span>
            {preview.isError ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void preview.refetch()}
              >
                Retry
              </Button>
            ) : null}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {workflows.length > 1 ? (
              <label className="text-label-13 flex flex-col gap-1">
                Approval workflow
                <select
                  className={inputClass}
                  value={w.id}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  {workflows.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-label-14 m-0 font-semibold">{w.name}</p>
            )}
            <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Who approves">
              {w.steps.map((s, i) => (
                <li key={i} className="border-line rounded-md border px-3 py-2">
                  <span className="text-label-13 font-semibold">
                    {i + 1}. {s.name}
                  </span>
                  <span className="text-copy-13 block">
                    {s.approvers.length ? s.approvers.join(', ') : 'Nobody yet'}
                  </span>
                  <span className="text-label-12 text-muted-foreground block">
                    {s.who} · {s.rule}
                  </span>
                </li>
              ))}
            </ol>
            {w.problems.length ? (
              <ul role="alert" className="text-crit text-copy-13 m-0 flex flex-col gap-1 pl-4">
                {w.problems.map((p) => (
                  <li key={p}>⚠ {p}</li>
                ))}
              </ul>
            ) : null}
            <label className="text-label-13 flex flex-col gap-1">
              {w.commentRequired ? 'Comment' : 'Comment (optional)'}
              <textarea
                className={cn(inputClass, 'h-auto min-h-16 py-2')}
                value={comment}
                maxLength={2000}
                placeholder={w.commentRequired ?? 'What should the approvers look at?'}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            {error ? (
              <p role="alert" className="text-crit text-copy-13 m-0">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || w.problems.length > 0}>
                {busy ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({
  org,
  instanceId,
  title,
  onClose,
  onDone,
}: {
  org: string;
  instanceId: string;
  title: string;
  onClose(): void;
  onDone(): void;
}) {
  const id = useId();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={`${id}-desc`}>
        <DialogTitle className="text-heading-16 m-0">Withdraw {title}?</DialogTitle>
        <DialogDescription id={`${id}-desc`} className="text-muted-foreground text-copy-13 m-0">
          The approval stops here. The decisions so far stay in the activity log; submitting again
          starts from step 1.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await withdrawApprovalAction({
              org,
              instanceId,
              comment: comment.trim() || undefined,
            });
            setBusy(false);
            if (!r.ok) return setError(r.error.message);
            toast('Withdrawn.');
            onDone();
          }}
        >
          <label className="text-label-13 flex flex-col gap-1">
            Comment (optional)
            <textarea
              className={cn(inputClass, 'h-auto min-h-16 py-2')}
              value={comment}
              maxLength={2000}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="text-crit text-copy-13 m-0">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? 'Withdrawing…' : 'Withdraw'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
