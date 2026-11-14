// What people read about approvals (docs/05 §3.4, §4): the item's current state as words and a symbol, the
// timeline of steps (who decided, when, with what comment) and the rows of "Needs my approval". Pure.
import { formatDateTime } from '../fields/helpers';
import type { Ctx } from '../types';
import type { ApprovalWorkflow } from './definition';
import {
  currentDecisions,
  isApprovalOverdue,
  modeWords,
  slaWords,
  waitingOn,
  type ApprovalDecision,
  type ApprovalInstance,
  type Decision,
} from './runtime';

/** The symbol next to the words: colour is never the only signal (CLAUDE.md, UI definition of done). */
export type ApprovalSymbol =
  'waiting' | 'overdue' | 'approved' | 'rejected' | 'withdrawn' | 'draft';

export interface ApprovalState {
  symbol: ApprovalSymbol;
  /** "Waiting for approval: step 2 of 3, Approval" */
  text: string;
  /** "Due 14 Nov 2026 16:00 · overdue" */
  detail: string | null;
}

const nameOf = (id: string | null | undefined, ctx: Pick<Ctx, 'people'>) =>
  (id && ctx.people.get(id)?.name) || 'A former member';

const when = (iso: string | null | undefined, tz: string) => (iso ? formatDateTime(iso, tz) : '');

/** The item's approval state in words. */
export function approvalState(
  inst: ApprovalInstance | null,
  ctx: Pick<Ctx, 'people' | 'timeZone' | 'now'>,
): ApprovalState {
  if (!inst) return { symbol: 'draft', text: 'Not submitted for approval', detail: null };
  const w = inst.definition;
  switch (inst.status) {
    case 'in_progress': {
      const i = inst.stepIndex ?? 0;
      const step = w.steps[i];
      const overdue = isApprovalOverdue(inst, ctx.now);
      return {
        symbol: overdue ? 'overdue' : 'waiting',
        text: `Waiting for approval: step ${i + 1} of ${w.steps.length}, ${step?.name ?? ''}`.trim(),
        detail: inst.stepDueAt
          ? `Due ${when(inst.stepDueAt, ctx.timeZone)}${overdue ? ' · overdue' : ''}`
          : null,
      };
    }
    case 'approved':
      return {
        symbol: 'approved',
        text: `Approved (${w.name})`,
        detail: inst.endedAt ? when(inst.endedAt, ctx.timeZone) : null,
      };
    case 'rejected':
      return {
        symbol: 'rejected',
        text:
          inst.endReason === 'draft'
            ? `Rejected and back to draft (${w.name})`
            : `Rejected and closed (${w.name})`,
        detail: inst.endedAt
          ? `${when(inst.endedAt, ctx.timeZone)} by ${nameOf(inst.endedBy, ctx)}`
          : null,
      };
    case 'withdrawn':
      return {
        symbol: 'withdrawn',
        text: `Withdrawn (${w.name})`,
        detail: inst.endedAt
          ? `${when(inst.endedAt, ctx.timeZone)} by ${nameOf(inst.endedBy, ctx)}`
          : null,
      };
  }
}

export type StepState = 'done' | 'current' | 'rejected' | 'upcoming' | 'not_reached';

export interface TimelinePerson {
  id: string;
  name: string;
  decision: Decision | null;
  at: string | null;
  comment: string | null;
}

export interface TimelineStep {
  index: number;
  id: string;
  name: string;
  state: StepState;
  /** "any one approves" / "all must approve" · "2 days" */
  rule: string;
  people: TimelinePerson[];
  /** Earlier rounds of this step (after a rejection sent the item back), oldest first. */
  earlier: { round: number; decisions: TimelinePerson[] }[];
}

export interface TimelineEvent {
  at: string;
  text: string;
  comment: string | null;
}

export interface ApprovalTimeline {
  instanceId: string;
  workflowName: string;
  state: ApprovalState;
  submittedBy: string;
  submittedAt: string;
  steps: TimelineStep[];
  /** Every decision and the start and end, oldest first: the history in words. */
  events: TimelineEvent[];
}

const decisionWords = (d: Decision) => (d === 'approved' ? 'approved' : 'rejected');

/** The timeline of one instance. */
export function approvalTimeline(
  inst: ApprovalInstance,
  decisions: ApprovalDecision[],
  ctx: Pick<Ctx, 'people' | 'timeZone' | 'now'>,
): ApprovalTimeline {
  const w: ApprovalWorkflow = inst.definition;
  const mine = decisions
    .filter((d) => d.instanceId === inst.id)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  const person = (d: ApprovalDecision): TimelinePerson => ({
    id: d.userId,
    name: nameOf(d.userId, ctx),
    decision: d.decision,
    at: d.decidedAt,
    comment: d.comment,
  });
  const lastRejected =
    inst.status === 'rejected' ? mine.filter((d) => d.decision === 'rejected').at(-1) : undefined;
  const steps: TimelineStep[] = w.steps.map((s, index) => {
    const ofStep = mine.filter((d) => d.stepIndex === index);
    const rounds = [...new Set(ofStep.map((d) => d.round))].sort((a, b) => a - b);
    // the round shown: the current one for the current step, else this step's latest
    const shownRound =
      inst.status === 'in_progress' && inst.stepIndex === index
        ? inst.round
        : (rounds.at(-1) ?? inst.round);
    const shown = ofStep.filter((d) => d.round === shownRound);
    const decided = new Map(shown.map((d) => [d.userId, d]));
    const people: TimelinePerson[] = (inst.approvers[index] ?? []).map(
      (id) =>
        (decided.get(id) && person(decided.get(id)!)) ?? {
          id,
          name: nameOf(id, ctx),
          decision: null,
          at: null,
          comment: null,
        },
    );
    // a decision by someone no longer listed (cannot happen today, kept readable)
    for (const d of shown) if (!people.some((p) => p.id === d.userId)) people.push(person(d));
    let state: StepState;
    if (inst.status === 'in_progress') {
      const at = inst.stepIndex ?? 0;
      state = index < at ? 'done' : index === at ? 'current' : 'upcoming';
    } else if (inst.status === 'approved') state = 'done';
    else if (lastRejected && lastRejected.stepIndex === index) state = 'rejected';
    else
      state =
        shown.some((d) => d.decision === 'approved') && shown.length > 0 ? 'done' : 'not_reached';
    if (inst.status === 'rejected' && lastRejected && index > lastRejected.stepIndex)
      state = 'not_reached';
    return {
      index,
      id: s.id,
      name: s.name,
      state,
      rule: `${modeWords(s)} · ${slaWords(s.sla)}`,
      people,
      earlier: rounds
        .filter((r) => r !== shownRound)
        .map((round) => ({
          round,
          decisions: ofStep.filter((d) => d.round === round).map(person),
        })),
    };
  });

  const events: TimelineEvent[] = [
    {
      at: inst.submittedAt,
      text: `${nameOf(inst.submittedBy, ctx)} submitted it for approval`,
      comment: inst.submitComment ?? null,
    },
    ...mine.map((d) => ({
      at: d.decidedAt,
      text: `${nameOf(d.userId, ctx)} ${decisionWords(d.decision)} step ${d.stepIndex + 1}, ${d.stepName}`,
      comment: d.comment,
    })),
  ];
  if (inst.status === 'withdrawn' && inst.endedAt)
    events.push({
      at: inst.endedAt,
      text: `${nameOf(inst.endedBy, ctx)} withdrew it`,
      comment: null,
    });
  if (inst.status === 'approved' && inst.endedAt)
    events.push({
      at: inst.endedAt,
      text: w.lockOnApproval
        ? 'Approved: every step is done. The item is locked.'
        : 'Approved: every step is done.',
      comment: null,
    });
  return {
    instanceId: inst.id,
    workflowName: w.name,
    state: approvalState(inst, ctx),
    submittedBy: nameOf(inst.submittedBy, ctx),
    submittedAt: inst.submittedAt,
    steps,
    events,
  };
}

/** One row of "Needs my approval" (docs/05 §4 My work). */
export interface InboxRow {
  instanceId: string;
  itemId: string;
  sheetId: string;
  sheetName: string;
  displayId: string;
  name: string;
  workflowName: string;
  stepIndex: number;
  stepCount: number;
  stepName: string;
  submittedBy: string;
  waitingSince: string;
  dueAt: string | null;
  overdue: boolean;
  /** Approving this step needs a comment (a documents register's version note). */
  commentToApprove: boolean;
}

/**
 * The instances waiting for this person now: in progress, they approve the current step and have not decided in this
 * round, and they did not submit it (unless the workflow allows self-approval). Overdue first, then the oldest.
 */
export function inboxRows(
  instances: ApprovalInstance[],
  decisions: ApprovalDecision[],
  userId: string,
  look: {
    item(id: string): { displayId: string; name: string; sheetId: string } | undefined;
    sheetName(id: string): string;
    /** Documents registers: approving the last step needs a version note. */
    isRegister?(sheetId: string): boolean;
  },
  ctx: Pick<Ctx, 'people' | 'now'>,
): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const inst of instances) {
    if (inst.status !== 'in_progress' || inst.stepIndex === null) continue;
    if (!inst.definition.allowSelfApproval && inst.submittedBy === userId) continue;
    const mine = decisions.filter((d) => d.instanceId === inst.id);
    if (!waitingOn(inst, mine).includes(userId)) continue;
    if (currentDecisions(inst, mine).some((d) => d.userId === userId)) continue;
    const it = look.item(inst.itemId);
    if (!it) continue;
    const step = inst.definition.steps[inst.stepIndex];
    const last = inst.stepIndex === inst.definition.steps.length - 1;
    rows.push({
      instanceId: inst.id,
      itemId: inst.itemId,
      sheetId: it.sheetId,
      sheetName: look.sheetName(it.sheetId),
      displayId: it.displayId,
      name: it.name,
      workflowName: inst.definition.name,
      stepIndex: inst.stepIndex,
      stepCount: inst.definition.steps.length,
      stepName: step?.name ?? '',
      submittedBy: nameOf(inst.submittedBy, ctx),
      waitingSince: inst.stepStartedAt ?? inst.submittedAt,
      dueAt: inst.stepDueAt,
      overdue: isApprovalOverdue(inst, ctx.now),
      commentToApprove:
        last && !!inst.definition.statusField?.onApproved && !!look.isRegister?.(it.sheetId),
    });
  }
  return rows.sort(
    (a, b) => Number(b.overdue) - Number(a.overdue) || a.waitingSince.localeCompare(b.waitingSince),
  );
}
