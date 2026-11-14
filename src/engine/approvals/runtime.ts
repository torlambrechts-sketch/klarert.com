// Approval workflow runtime (docs/04 §13): who approves a step, what a decision does, when a step is overdue. Pure and
// the same rules as the database (0040 workflow_submit / workflow_decide), which holds the truth; the engine gives the
// app its previews, the inbox and the timeline, and the unit tests pin the rules down.
import { resolveFieldType } from '../fields/resolve';
import type { Ctx, Field, Item } from '../types';
import { valueOf } from '../values';
import type { ApprovalStep, ApprovalWorkflow, ApproverRule, Sla } from './definition';

export type InstanceStatus = 'in_progress' | 'approved' | 'rejected' | 'withdrawn';
export type EndReason = 'approved' | 'draft' | 'closed' | 'withdrawn';
export type Decision = 'approved' | 'rejected';

/** One run of a workflow on one item (workflow_instances). The definition is a copy taken at submit. */
export interface ApprovalInstance {
  id: string;
  sheetId: string;
  itemId: string;
  workflowId: string;
  definition: ApprovalWorkflow;
  status: InstanceStatus;
  /** The step the item waits at (0-based); null once ended. */
  stepIndex: number | null;
  /** Goes up each time a rejection sends the item back to a step: decisions count per round. */
  round: number;
  stepStartedAt: string | null;
  stepDueAt: string | null;
  /** Approvers per step, fixed when the item was submitted (user ids). */
  approvers: string[][];
  submittedBy: string | null;
  submittedAt: string;
  endedAt: string | null;
  endedBy: string | null;
  endReason: EndReason | null;
  submitComment?: string | null;
}

/** One decision (workflow_decisions, insert-only). */
export interface ApprovalDecision {
  id: string;
  instanceId: string;
  stepIndex: number;
  stepId: string;
  stepName: string;
  round: number;
  userId: string;
  decision: Decision;
  comment: string | null;
  decidedAt: string;
}

const HOUR = 60 * 60 * 1000;

/** When a step started now is due, as an ISO instant (calendar hours and days). Null without an SLA. */
export function slaDue(startedAt: string, sla: Sla | null | undefined): string | null {
  if (!sla) return null;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return null;
  return new Date(start + sla.amount * (sla.unit === 'days' ? 24 : 1) * HOUR).toISOString();
}

export function isApprovalOverdue(
  inst: Pick<ApprovalInstance, 'status' | 'stepDueAt'>,
  now: Date,
): boolean {
  return (
    inst.status === 'in_progress' && !!inst.stepDueAt && Date.parse(inst.stepDueAt) <= now.getTime()
  );
}

/** "2 days", "36 hours" */
export function slaWords(sla: Sla | null | undefined): string {
  if (!sla) return 'No time limit';
  const unit = sla.unit === 'days' ? 'day' : 'hour';
  return `${sla.amount} ${unit}${sla.amount === 1 ? '' : 's'}`;
}

/** People ids in a value (people fields hold arrays of ids), members only. */
function peopleIn(v: unknown, ctx: Ctx, out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (ctx.people.has(v) && !out.includes(v)) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) peopleIn(x, ctx, out);
  return out;
}

/** Members holding a job role: whose job title is the role's name (as automations, docs/04 §5 notify). */
export type RoleHolders = (roleName: string) => string[];

/** The role's current name: by id when the workspace has it, else the name the rule keeps. */
export function roleNameOf(rule: Extract<ApproverRule, { kind: 'jobRole' }>, ctx: Ctx): string {
  return (rule.roleId ? ctx.jobRoles.get(rule.roleId)?.name : undefined) ?? rule.roleName;
}

export function teamOf(rule: Extract<ApproverRule, { kind: 'team' }>, ctx: Ctx) {
  if (rule.teamId && ctx.teams.has(rule.teamId)) return ctx.teams.get(rule.teamId)!;
  const name = rule.teamName.trim().toLowerCase();
  return [...ctx.teams.values()].find((t) => t.name.trim().toLowerCase() === name);
}

/** Everyone a rule names on this item now (members only, no duplicates, in the rule's order). */
export function resolveApprovers(
  rule: ApproverRule,
  item: Item,
  ctx: Ctx,
  holders: RoleHolders,
): string[] {
  switch (rule.kind) {
    case 'people':
      return peopleIn(rule.userIds, ctx);
    case 'field': {
      const f = ctx.fieldsOf(item.sheetId).find((x) => x.key === rule.fieldKey);
      return f ? peopleIn(valueOf(item, f, ctx), ctx) : [];
    }
    case 'jobRole':
      return peopleIn(holders(roleNameOf(rule, ctx)), ctx);
    case 'team':
      return peopleIn(teamOf(rule, ctx)?.memberIds ?? [], ctx);
  }
}

/** "Owner", "Maria Pereira and James Okafor", "Compliance manager (job role)", "Quality (team)" */
export function describeApprovers(rule: ApproverRule, ctx: Ctx): string {
  switch (rule.kind) {
    case 'people': {
      const names = rule.userIds.map((id) => ctx.people.get(id)?.name ?? 'a former member');
      return names.length <= 2
        ? names.join(' and ')
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    }
    case 'field': {
      const f = ctx.fieldsByKey.get(rule.fieldKey);
      return f ? `the people in ${f.name}` : `the people in ${rule.fieldKey}`;
    }
    case 'jobRole':
      return `${roleNameOf(rule, ctx)} (job role)`;
    case 'team':
      return `${teamOf(rule, ctx)?.name ?? rule.teamName} (team)`;
  }
}

export const modeWords = (step: Pick<ApprovalStep, 'mode'>) =>
  step.mode === 'all' ? 'all must approve' : 'any one approves';

/**
 * The approvers of a step for a submission: who the rule names, without the person who submitted unless the
 * workflow allows self-approval (the self-approval block, docs/04 §13).
 */
export function stepApprovers(
  w: ApprovalWorkflow,
  stepIndex: number,
  item: Item,
  ctx: Ctx,
  opts: { submitter: string | null; holders: RoleHolders },
): { ids: string[]; withoutSubmitter: boolean } {
  const step = w.steps[stepIndex];
  if (!step) return { ids: [], withoutSubmitter: false };
  const all = resolveApprovers(step.approvers, item, ctx, opts.holders);
  if (w.allowSelfApproval || !opts.submitter || !all.includes(opts.submitter))
    return { ids: all, withoutSubmitter: false };
  return { ids: all.filter((id) => id !== opts.submitter), withoutSubmitter: true };
}

/** Whether a field has a value for "required before submit": stored values, links and files. */
export function isFilled(item: Item, field: Field, ctx: Ctx): boolean {
  const def = resolveFieldType(field.type);
  if (!def) return false;
  if (def.storage === 'links') return ctx.links(item.id, field.id).length > 0;
  if (def.storage === 'files') return ctx.files(item.id, field.id).length > 0;
  return !def.isEmpty(valueOf(item, field, ctx) as never);
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export type SubmitCheck =
  { ok: true; approvers: string[][] } | { ok: false; problems: string[]; approvers: string[][] };

/**
 * Can this item be submitted, and who will approve each step? Approvers are fixed now, for every step. An approver
 * who cannot read the item is reported, never skipped silently; a step left with nobody is reported.
 */
export function submitCheck(
  w: ApprovalWorkflow,
  item: Item,
  ctx: Ctx,
  opts: {
    submitter: string | null;
    holders: RoleHolders;
    /** Can this member read the item's sheet? */
    canRead(userId: string): boolean;
    /** The item already has a workflow in progress. */
    inProgress?: boolean;
  },
): SubmitCheck {
  const problems: string[] = [];
  if (!w.enabled) problems.push(`${w.name} is turned off.`);
  if (opts.inProgress) problems.push('This item is already waiting for approval.');
  const fields = ctx.fieldsOf(item.sheetId);
  const empty = w.requiredFields
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is Field => !!f && !isFilled(item, f, ctx))
    .map((f) => f.name);
  if (empty.length) problems.push(`Fill in ${joinNames(empty)} before submitting.`);
  const approvers: string[][] = [];
  w.steps.forEach((step, i) => {
    const { ids, withoutSubmitter } = stepApprovers(w, i, item, ctx, opts);
    approvers.push(ids);
    const label = `Step ${i + 1}, ${step.name}`;
    if (ids.length === 0) {
      problems.push(
        withoutSubmitter
          ? `${label}: you are the only approver and cannot approve your own submission.`
          : `${label}: no one can approve it. ${approverHint(step.approvers, ctx)}`,
      );
      return;
    }
    const blocked = ids.filter((id) => !opts.canRead(id));
    if (blocked.length)
      problems.push(
        `${label}: ${joinNames(blocked.map((id) => ctx.people.get(id)?.name ?? 'a member'))} cannot open this sheet. Give them access or change the approvers.`,
      );
  });
  return problems.length ? { ok: false, problems, approvers } : { ok: true, approvers };
}

function approverHint(rule: ApproverRule, ctx: Ctx): string {
  switch (rule.kind) {
    case 'field':
      return `Fill in ${ctx.fieldsByKey.get(rule.fieldKey)?.name ?? rule.fieldKey}.`;
    case 'jobRole':
      return `Give a member the job title ${roleNameOf(rule, ctx)}.`;
    case 'team':
      return `Add members to the team ${teamOf(rule, ctx)?.name ?? rule.teamName}.`;
    case 'people':
      return 'Choose approvers who are still members.';
  }
}

/** Decisions of the current step in the current round. */
export const currentDecisions = (
  inst: Pick<ApprovalInstance, 'stepIndex' | 'round'>,
  decisions: ApprovalDecision[],
) => decisions.filter((d) => d.stepIndex === inst.stepIndex && d.round === inst.round);

/** The approvers of the current step who have not decided yet. */
export function waitingOn(inst: ApprovalInstance, decisions: ApprovalDecision[]): string[] {
  if (inst.status !== 'in_progress' || inst.stepIndex === null) return [];
  const decided = new Set(currentDecisions(inst, decisions).map((d) => d.userId));
  return (inst.approvers[inst.stepIndex] ?? []).filter((id) => !decided.has(id));
}

/** Why this person cannot make this decision now, in words; null when they can. */
export function decisionProblem(
  inst: ApprovalInstance,
  decisions: ApprovalDecision[],
  userId: string,
  decision: Decision,
  comment: string | null | undefined,
): string | null {
  if (inst.status !== 'in_progress' || inst.stepIndex === null)
    return 'This approval has already ended.';
  if (!inst.definition.allowSelfApproval && inst.submittedBy === userId)
    return 'You submitted this item and cannot approve your own submission.';
  if (!(inst.approvers[inst.stepIndex] ?? []).includes(userId))
    return 'You are not an approver of this step.';
  if (currentDecisions(inst, decisions).some((d) => d.userId === userId))
    return 'You have already decided on this step.';
  if (decision === 'rejected' && !comment?.trim()) return 'Say why you reject it.';
  return null;
}

export type DecisionOutcome =
  /** All must approve and others still have to. */
  | { kind: 'waiting' }
  | { kind: 'next'; stepIndex: number }
  | { kind: 'approved' }
  /** Back to a step: a new round starts there. */
  | { kind: 'returned'; stepIndex: number }
  | { kind: 'rejected'; to: 'draft' | 'closed' };

/** What a decision does to the instance (the database applies the same). */
export function decide(
  inst: Pick<ApprovalInstance, 'definition' | 'stepIndex' | 'round' | 'approvers'>,
  decisions: ApprovalDecision[],
  d: { userId: string; decision: Decision },
): DecisionOutcome {
  const i = inst.stepIndex ?? 0;
  const step = inst.definition.steps[i];
  if (!step) return { kind: 'approved' };
  if (d.decision === 'rejected') {
    const r = step.onReject;
    if (r.to === 'step') {
      const back = inst.definition.steps.findIndex((s) => s.id === r.stepId);
      return { kind: 'returned', stepIndex: back >= 0 && back <= i ? back : i };
    }
    return { kind: 'rejected', to: r.to === 'draft' ? 'draft' : 'closed' };
  }
  if (step.mode === 'all') {
    const approved = new Set(
      currentDecisions({ stepIndex: i, round: inst.round }, decisions)
        .filter((x) => x.decision === 'approved')
        .map((x) => x.userId),
    );
    approved.add(d.userId);
    if ((inst.approvers[i] ?? []).some((id) => !approved.has(id))) return { kind: 'waiting' };
  }
  return i + 1 < inst.definition.steps.length
    ? { kind: 'next', stepIndex: i + 1 }
    : { kind: 'approved' };
}

/** The step field's option for where an instance is (null: leave the field as it is). */
export function stepOption(
  w: ApprovalWorkflow,
  at: { status: InstanceStatus; stepIndex: number | null; endReason?: EndReason | null },
): string | null {
  const sf = w.stepField;
  if (!sf) return null;
  if (at.status === 'in_progress') return w.steps[at.stepIndex ?? 0]?.optionId ?? null;
  if (at.status === 'approved') return sf.approved ?? null;
  if (at.status === 'rejected' && at.endReason === 'closed') return sf.rejected ?? sf.draft ?? null;
  return sf.draft ?? null;
}
