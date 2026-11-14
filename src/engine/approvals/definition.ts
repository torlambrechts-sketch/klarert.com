// Approval workflows (docs/04 §13, docs/02 §19): ordered approval steps defined as data per sheet in
// sheets.settings.workflows. Nothing here knows a document or a CAPA: a step names who approves (people, a people
// field of the item, a job role or a team), whether any one or all must approve, an SLA and what a rejection does.
// Pure: schemas, lenient reading and the checks the editor and the commands share.
import { z } from 'zod';
import { resolveFieldType } from '../fields/resolve';
import type { Field, Json } from '../types';

export const APPROVAL_MODES = ['any', 'all'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export const SLA_UNITS = ['hours', 'days'] as const;
export type SlaUnit = (typeof SLA_UNITS)[number];

/** At most this many workflows per sheet and steps per workflow. */
export const MAX_WORKFLOWS = 10;
export const MAX_STEPS = 10;

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Use lowercase letters, digits, - and _.');
const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const optionId = z.string().min(1).max(64).nullable().optional();

/**
 * Who approves a step. Values are stored by id (CLAUDE.md rule 4): people by user id, a team by id. A job role is
 * held by the members whose job title is the role's name; the name is kept too, so a pack can name a role the
 * workspace adds later.
 */
export const approverRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('people'),
    userIds: z.array(z.string().min(1).max(64)).min(1).max(50),
  }),
  z.object({ kind: z.literal('field'), fieldKey }),
  z.object({
    kind: z.literal('jobRole'),
    roleId: z.string().min(1).max(64).nullable().optional(),
    roleName: z.string().trim().min(1).max(80),
  }),
  z.object({
    kind: z.literal('team'),
    teamId: z.string().min(1).max(64).nullable().optional(),
    teamName: z.string().trim().min(1).max(80),
  }),
]);
export type ApproverRule = z.infer<typeof approverRuleSchema>;

export const slaSchema = z.object({
  amount: z.number().int().min(1).max(8760),
  unit: z.enum(SLA_UNITS),
});
export type Sla = z.infer<typeof slaSchema>;

/** What a rejection at this step does: back to a step (this one or an earlier one), back to draft, or close. */
export const onRejectSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('step'), stepId: id }),
  z.object({ to: z.literal('draft') }),
  z.object({ to: z.literal('close') }),
]);
export type OnReject = z.infer<typeof onRejectSchema>;

export const approvalStepSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  approvers: approverRuleSchema,
  mode: z.enum(APPROVAL_MODES),
  sla: slaSchema.nullable().optional(),
  onReject: onRejectSchema,
  /** The option of the workflow's step field shown while the item waits at this step. */
  optionId,
});
export type ApprovalStep = z.infer<typeof approvalStepSchema>;

export const approvalWorkflowSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  steps: z.array(approvalStepSchema).min(1).max(MAX_STEPS),
  /** Field keys that must be filled before the item can be submitted. */
  requiredFields: z.array(fieldKey).max(30).default([]),
  /** Off (the default): the person who submitted cannot approve any step of their own submission. */
  allowSelfApproval: z.boolean().default(false),
  /** Lock the item when the last step approves (people need an owner or admin to change it afterwards). */
  lockOnApproval: z.boolean().default(false),
  /** A workflow step field (read-only to people) that shows where the item is: options by id. */
  stepField: z
    .object({ fieldKey, draft: optionId, approved: optionId, rejected: optionId })
    .nullable()
    .optional(),
  /** An option field (usually Status) set as the person acts: on submit, on final approval, on rejection. */
  statusField: z
    .object({ fieldKey, onSubmit: optionId, onApproved: optionId, onRejected: optionId })
    .nullable()
    .optional(),
});
export type ApprovalWorkflow = z.infer<typeof approvalWorkflowSchema>;

export const workflowsSchema = z.array(approvalWorkflowSchema).max(MAX_WORKFLOWS);

/**
 * A workflow in a pack manifest or template: the same, but approvers by field, job role or team name only (people
 * and ids belong to a workspace, not a pack). Job role and team ids are left out; the name is resolved when it runs.
 */
export const templateWorkflowSchema = approvalWorkflowSchema.superRefine((w, ctx) => {
  w.steps.forEach((s, i) => {
    if (s.approvers.kind === 'people')
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'approvers'],
        message:
          'Name approvers by a people field, a job role or a team: people belong to a workspace.',
      });
    if (
      (s.approvers.kind === 'jobRole' && s.approvers.roleId) ||
      (s.approvers.kind === 'team' && s.approvers.teamId)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'approvers'],
        message: 'Name job roles and teams by name in a template.',
      });
  });
});

/** sheets.settings.workflows, read leniently: a broken entry is dropped, never thrown. */
export function readWorkflows(settings: unknown): ApprovalWorkflow[] {
  const raw = (settings as { workflows?: unknown } | null | undefined)?.workflows;
  if (!Array.isArray(raw)) return [];
  const out: ApprovalWorkflow[] = [];
  for (const w of raw.slice(0, MAX_WORKFLOWS)) {
    const p = approvalWorkflowSchema.safeParse(w);
    if (p.success && !out.some((x) => x.id === p.data.id)) out.push(p.data);
  }
  return out;
}

export const enabledWorkflows = (list: ApprovalWorkflow[] | undefined | null) =>
  (list ?? []).filter((w) => w.enabled);

const LABEL_TYPES = new Set([
  'status',
  'dropdown',
  'severity',
  'classification',
  'finding',
  'priority',
]);
const optionsOf = (f: Field | undefined): { id: string; label: string; done?: boolean }[] => {
  const o = (f?.config as { options?: unknown } | undefined)?.options;
  return Array.isArray(o) ? (o as { id: string; label: string; done?: boolean }[]) : [];
};
const hasOption = (f: Field | undefined, id: string | null | undefined) =>
  !id || optionsOf(f).some((o) => o.id === id);

/** Fields a step can take its approvers from: people fields stored on the item. */
export const approverFields = (fields: Field[]) =>
  fields.filter((f) => f.type === 'people' && !f.restrictedTo);
/** Fields that can show the step: workflow step fields. */
export const stepFields = (fields: Field[]) => fields.filter((f) => f.type === 'workflowstep');
/** Fields the workflow can set as it moves: single-choice option fields that are not restricted. */
export const statusFields = (fields: Field[]) =>
  fields.filter((f) => LABEL_TYPES.has(f.type) && !f.restrictedTo);
/** Fields that can be required before submitting: stored values, links and files. */
export const requirableFields = (fields: Field[]) =>
  fields.filter((f) => {
    const s = resolveFieldType(f.type)?.storage;
    return (s === 'values' || s === 'links' || s === 'files') && f.type !== 'workflowstep';
  });

const stepWords = (i: number, name: string) => `Step ${i + 1}, ${name}`;

/**
 * What is wrong with a workflow on a sheet with these fields, in words (empty when it can be saved). The database
 * checks the same shape again when an item is submitted.
 */
export function workflowProblems(
  w: ApprovalWorkflow,
  fields: Field[],
  others: ApprovalWorkflow[] = [],
): string[] {
  const out: string[] = [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  if (
    others.some((o) => o.id !== w.id && o.name.trim().toLowerCase() === w.name.trim().toLowerCase())
  )
    out.push(`Another approval workflow is called ${w.name}.`);
  const ids = new Set<string>();
  w.steps.forEach((s, i) => {
    if (ids.has(s.id)) out.push(`${stepWords(i, s.name)}: two steps have the same id.`);
    ids.add(s.id);
    if (s.approvers.kind === 'field') {
      const f = byKey.get(s.approvers.fieldKey);
      if (!f || !approverFields(fields).includes(f))
        out.push(`${stepWords(i, s.name)}: choose a people field for the approvers.`);
    }
    if (s.onReject.to === 'step') {
      const target = s.onReject.stepId;
      const at = w.steps.findIndex((x) => x.id === target);
      if (at < 0 || at > i)
        out.push(
          `${stepWords(i, s.name)}: a rejection can go back to this step or an earlier one.`,
        );
    }
  });
  for (const k of w.requiredFields) {
    const f = byKey.get(k);
    if (!f || !requirableFields(fields).includes(f))
      out.push(`The field ${k} cannot be required before submitting.`);
  }
  if (w.stepField) {
    const f = byKey.get(w.stepField.fieldKey);
    if (!f || f.type !== 'workflowstep') out.push('Choose a workflow step field to show the step.');
    else {
      const sf = w.stepField;
      const missing =
        !hasOption(f, sf.draft) ||
        !hasOption(f, sf.approved) ||
        !hasOption(f, sf.rejected) ||
        w.steps.some((s) => !hasOption(f, s.optionId));
      if (missing) out.push(`${f.name} no longer has every option the workflow shows.`);
    }
  }
  if (w.statusField) {
    const f = byKey.get(w.statusField.fieldKey);
    if (!f || !statusFields(fields).includes(f))
      out.push('Choose a status or dropdown field to set.');
    else if (
      !hasOption(f, w.statusField.onSubmit) ||
      !hasOption(f, w.statusField.onApproved) ||
      !hasOption(f, w.statusField.onRejected)
    )
      out.push(`${f.name} no longer has every option the workflow sets.`);
  }
  return out;
}

/** A new workflow id from a name, unique among the sheet's workflows. */
export function workflowIdFor(name: string, taken: string[]): string {
  const stem =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'approval';
  let out = stem;
  for (let n = 2; taken.includes(out); n += 1) out = `${stem}-${n}`;
  return out;
}

/** The step field's options for a workflow, matched by label and added when missing (the command saves them). */
export function stepFieldOptions(
  w: Pick<ApprovalWorkflow, 'steps'>,
  field: Field,
  newId: () => string,
): {
  options: { id: string; label: string; color: string; done?: boolean }[];
  mapping: { draft: string; approved: string; rejected: string; steps: string[] };
} {
  const options = optionsOf(field).map((o) => ({
    ...(o as { id: string; label: string; color: string; done?: boolean }),
  }));
  const find = (label: string) =>
    options.find((o) => o.label.trim().toLowerCase() === label.trim().toLowerCase());
  const ensure = (label: string, color: string, done = false) => {
    const hit = find(label);
    if (hit) return hit.id;
    const o = { id: newId(), label, color, ...(done ? { done: true } : {}) };
    // before the done option(s), so the order reads like the flow
    const at = options.findIndex((x) => x.done);
    if (done || at < 0) options.push(o);
    else options.splice(at, 0, o);
    return o.id;
  };
  const draft = ensure('Draft', 'grey');
  const steps = w.steps.map((s) => ensure(s.name, 'blue'));
  const doneOpt = options.find((o) => o.done);
  const approved = doneOpt?.id ?? ensure('Approved', 'green', true);
  const rejected = ensure('Rejected', 'red');
  return { options, mapping: { draft, approved, rejected, steps } };
}

export type { Json };
