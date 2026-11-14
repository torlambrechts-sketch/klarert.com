import 'server-only';
import {
  decide,
  describeApprovers,
  enabledWorkflows,
  modeWords,
  slaWords,
  stepFieldOptions,
  submitCheck,
  workflowProblems,
  type ApprovalDecision,
  type ApprovalInstance,
  type ApprovalWorkflow,
} from '@/engine/approvals';
import {
  approvalRecordKeys,
  documentApprovalValues,
  isDocumentsRegister,
} from '@/engine/documents';
import type { Ctx, Field, Item, Json, Sheet } from '@/engine/types';
import { checkWrite, planValues } from '@/engine/writes';
import {
  decideApprovalInput,
  itemApprovalsInput,
  previewSubmissionInput,
  saveWorkflowsInput,
  submitApprovalInput,
  withdrawApprovalInput,
} from '@/lib/schemas/approvals';
import type { Db } from '@/lib/sheet-query';
import { FIELD_COLUMNS, toField } from '@/lib/sheet-rows';
import { approvalChangeEvents, decisionEvents } from '@/server/approvals/events';
import {
  DECISION_COLUMNS,
  INSTANCE_COLUMNS,
  toDecision,
  toInstance,
} from '@/server/approvals/rows';
import { isAdminRole } from '@/server/auth';
import { runAutomations } from '@/server/automations';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { loadWriteContext, newId, sha256 } from '@/server/sheet-context';
import { withOrg } from './context';

// Approval workflows (docs/04 §13, docs/02 §19). Definitions are saved by owners and admins into
// sheets.settings.workflows; submitting, deciding and withdrawing call one RPC each, which writes the instance, the
// decision, the item's own changes and the activity log in one transaction. The automations those changes and
// decisions trigger run after, as for every other command.

const userActor = (id: string) => ({ kind: 'user' as const, id });

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// ───────────────────────── definitions ─────────────────────────

export async function saveApprovalWorkflows(
  input: unknown,
): Promise<Result<{ workflows: ApprovalWorkflow[] }>> {
  const p = saveWorkflowsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data: s } = await supabase
        .from('sheets')
        .select('id, settings, archived_at')
        .eq('id', v.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!s || s.archived_at) return fail('not_found', 'This sheet no longer exists.');
      const fields = (
        must(
          await supabase
            .from('fields')
            .select(FIELD_COLUMNS)
            .eq('sheet_id', s.id)
            .is('archived_at', null)
            .order('position'),
        ) ?? []
      ).map(toField);
      const ids = new Set<string>();
      for (const w of v.workflows) {
        if (ids.has(w.id)) return fail('invalid', `Two approval workflows have the id ${w.id}.`);
        ids.add(w.id);
        const problems = workflowProblems(
          w,
          fields,
          v.workflows,
          approvalRecordKeys(s.settings as Pick<Sheet, 'register'> | null),
        );
        // the step field's options are filled in below; anything else is the person's to fix
        const own = problems.filter(
          (x) => !x.includes('no longer has every option the workflow shows'),
        );
        if (own.length) return fail('invalid', `${w.name}: ${own[0]}`);
      }
      // the step field shows each step: options matched by label, added when missing, ids kept in the definition
      const workflows: ApprovalWorkflow[] = [];
      for (const w of v.workflows) {
        if (!w.stepField) {
          workflows.push({ ...w, steps: w.steps.map((st) => ({ ...st, optionId: null })) });
          continue;
        }
        const field = fields.find((f) => f.key === w.stepField!.fieldKey)!;
        const { options, mapping } = stepFieldOptions(w, field, () => newId('opt_'));
        const before = JSON.stringify((field.config as { options?: unknown }).options ?? []);
        if (JSON.stringify(options) !== before) {
          const config = {
            ...(field.config as Record<string, Json>),
            options: options as unknown as Json,
          };
          const { error } = await supabase
            .from('fields')
            .update({ config: config as NonNullable<Json> })
            .eq('id', field.id);
          if (error) return fromDbError(error);
          field.config = config;
        }
        workflows.push({
          ...w,
          stepField: {
            fieldKey: field.key,
            draft: mapping.draft,
            approved: mapping.approved,
            rejected: mapping.rejected,
          },
          steps: w.steps.map((st, i) => ({ ...st, optionId: mapping.steps[i] ?? null })),
        });
      }
      const settings = {
        ...((s.settings ?? {}) as Record<string, Json>),
        workflows: workflows as unknown as Json,
      };
      const { error } = await supabase
        .from('sheets')
        .update({ settings: settings as NonNullable<Json>, updated_at: new Date().toISOString() })
        .eq('id', s.id)
        .eq('org_id', orgId);
      return error ? fromDbError(error) : ok({ workflows });
    },
    'saveApprovalWorkflows',
  );
}

// ───────────────────────── checks before the database ─────────────────────────

/**
 * The status rules of the option the workflow sets (docs/03 §6): what would block it, and the comment it asks for
 * (the decision's or the submission's comment gives it).
 */
function statusRules(
  item: Item,
  fields: Field[],
  ctx: Ctx,
  w: ApprovalWorkflow,
  optionId: string | null | undefined,
  sheet?: Pick<Sheet, 'register'>,
): { blocking: string | null; comment: string | null } {
  const none = { blocking: null, comment: null };
  if (!w.statusField || !optionId) return none;
  const field = fields.find((f) => f.key === w.statusField!.fieldKey);
  if (!field || field.restrictedTo) return none;
  // approving a document also records who approved it and when (the database's documents register rules), so a
  // status rule that asks for the approver sees the document as it will be saved
  const done = (field.config as { options?: { id: string; done?: boolean }[] }).options?.find(
    (o) => o.id === optionId,
  )?.done;
  const record =
    isDocumentsRegister(sheet) && done ? documentApprovalValues(fields, ctx.userId, ctx.today) : {};
  const plan = planValues(item, fields, { ...record, [field.id]: optionId }, ctx, sha256);
  if (plan.rejected.length > 0 || plan.changedKeys.length === 0) return none;
  const check = checkWrite(item, plan.next, fields, plan.changedKeys, ctx, {
    isUnique: () => true,
  });
  return {
    blocking: check.blocking.length ? check.blocking.map((i) => i.message).join(' ') : null,
    comment: check.commentRequired.length
      ? check.commentRequired[0]!.message?.trim() || 'Add a comment.'
      : null,
  };
}

function statusRuleProblem(
  item: Item,
  fields: Field[],
  ctx: Ctx,
  w: ApprovalWorkflow,
  optionId: string | null | undefined,
  comment: string | undefined,
  sheet?: Pick<Sheet, 'register'>,
): string | null {
  const r = statusRules(item, fields, ctx, w, optionId, sheet);
  return r.blocking ?? (r.comment && !comment?.trim() ? r.comment : null);
}

async function roleHolders(db: Db, orgId: string) {
  const rows = must(
    await db.from('memberships').select('user_id, job_title').eq('org_id', orgId),
  ) as { user_id: string; job_title: string | null }[];
  return (name: string) =>
    rows
      .filter((r) => r.job_title && r.job_title.trim().toLowerCase() === name.trim().toLowerCase())
      .map((r) => r.user_id);
}

// ───────────────────────── submit ─────────────────────────

export interface SubmitPreview {
  workflows: {
    id: string;
    name: string;
    steps: { name: string; who: string; rule: string; approvers: string[] }[];
    problems: string[];
    /** Submitting needs a comment (a status rule of the status it sets), in the rule's words. */
    commentRequired: string | null;
  }[];
  /** The item already waits for approval. */
  inProgress: boolean;
}

/** Who will approve each step if the item is submitted now, and what stops it (access is checked on submit). */
export async function previewSubmission(input: unknown): Promise<Result<SubmitPreview>> {
  const p = previewSubmissionInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, v.sheetId, [
        v.itemId,
      ]);
      const item = w?.items.get(v.itemId);
      if (!w || !item || item.archivedAt) return fail('not_found', 'This item no longer exists.');
      const [holders, live] = await Promise.all([
        roleHolders(supabase, orgId),
        supabase
          .from('workflow_instances')
          .select('id', { count: 'exact', head: true })
          .eq('item_id', item.id)
          .eq('status', 'in_progress'),
      ]);
      const inProgress = (live.count ?? 0) > 0;
      return ok({
        inProgress,
        workflows: enabledWorkflows(w.ctx.sheet.workflows).map((def) => {
          const check = submitCheck(def, item, w.ctx, {
            submitter: user.id,
            holders,
            canRead: () => true,
            inProgress,
          });
          const status = statusRules(item, w.fields, w.ctx, def, def.statusField?.onSubmit);
          return {
            id: def.id,
            name: def.name,
            steps: def.steps.map((s, i) => ({
              name: s.name,
              who: describeApprovers(s.approvers, w.ctx),
              rule: `${modeWords(s)} · ${slaWords(s.sla)}`,
              approvers: (check.approvers[i] ?? []).map(
                (id) => w.ctx.people.get(id)?.name ?? 'A member',
              ),
            })),
            problems: [
              ...(check.ok ? [] : check.problems),
              ...(status.blocking ? [status.blocking] : []),
            ],
            commentRequired: status.comment,
          };
        }),
      });
    },
    'previewSubmission',
  );
}

export async function submitForApproval(
  input: unknown,
): Promise<Result<{ instanceId: string; messages: string[] }>> {
  const p = submitApprovalInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, role, user }) => {
      const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, v.sheetId, [
        v.itemId,
      ]);
      const item = w?.items.get(v.itemId);
      if (!w || !item || item.archivedAt) return fail('not_found', 'This item no longer exists.');
      const def = (w.ctx.sheet.workflows ?? []).find((x) => x.id === v.workflowId);
      if (!def) return fail('not_found', 'This approval workflow no longer exists.');
      const rule = statusRuleProblem(
        item,
        w.fields,
        w.ctx,
        def,
        def.statusField?.onSubmit,
        v.comment,
      );
      if (rule) return fail('blocked', rule);
      const { data, error } = await supabase.rpc('workflow_submit', {
        p_item: item.id,
        p_workflow: def.id,
        ...(v.comment ? { p_comment: v.comment } : {}),
      });
      if (error) return fromDbError(error);
      const events = approvalChangeEvents(data, item.sheetId, item.id, userActor(user.id));
      const out = await runAutomations(events, { orgId, userId: user.id, workspace: v.org });
      const instanceId = String((data as { instance_id?: string } | null)?.instance_id ?? '');
      return ok({ instanceId, messages: out.messages });
    },
    'submitForApproval',
  );
}

// ───────────────────────── decide, withdraw ─────────────────────────

async function loadInstance(db: Db, id: string, orgId: string) {
  const { data } = await db
    .from('workflow_instances')
    .select(INSTANCE_COLUMNS)
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  return data ? toInstance(data) : null;
}

export async function decideApproval(
  input: unknown,
): Promise<Result<{ outcome: string; messages: string[] }>> {
  const p = decideApprovalInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      if (role === 'auditor') return fail('forbidden', 'Auditors have read-only access.');
      const inst = await loadInstance(supabase, v.instanceId, orgId);
      if (!inst) return fail('not_found', 'This approval no longer exists.');
      // the status the end of the workflow sets must pass its rules (a person's change, docs/03 §6)
      const decisions = must(
        await supabase
          .from('workflow_decisions')
          .select(DECISION_COLUMNS)
          .eq('instance_id', inst.id),
      ).map(toDecision);
      const next = decide(inst, decisions, { userId: user.id, decision: v.decision });
      const option =
        next.kind === 'approved'
          ? inst.definition.statusField?.onApproved
          : next.kind === 'rejected'
            ? inst.definition.statusField?.onRejected
            : null;
      if (option) {
        const w = await loadWriteContext(supabase, { orgId, userId: user.id, role }, inst.sheetId, [
          inst.itemId,
        ]);
        const item = w?.items.get(inst.itemId);
        if (w && item) {
          const rule = statusRuleProblem(
            item,
            w.fields,
            w.ctx,
            inst.definition,
            option,
            v.comment,
            w.data.sheet,
          );
          if (rule) return fail('blocked', rule);
        }
      }
      const { data, error } = await supabase.rpc('workflow_decide', {
        p_instance: inst.id,
        p_decision: v.decision,
        ...(v.comment ? { p_comment: v.comment } : {}),
      });
      if (error) return fromDbError(error);
      const events = decisionEvents(
        data,
        v.decision,
        inst.sheetId,
        inst.itemId,
        userActor(user.id),
      );
      const out = await runAutomations(events, { orgId, userId: user.id, workspace: v.org });
      const outcome = String((data as { outcome?: string } | null)?.outcome ?? '');
      return ok({ outcome, messages: out.messages });
    },
    'decideApproval',
  );
}

export async function withdrawApproval(input: unknown): Promise<Result<{ messages: string[] }>> {
  const p = withdrawApprovalInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, user }) => {
      const inst = await loadInstance(supabase, v.instanceId, orgId);
      if (!inst) return fail('not_found', 'This approval no longer exists.');
      const { data, error } = await supabase.rpc('workflow_withdraw', {
        p_instance: inst.id,
        ...(v.comment ? { p_comment: v.comment } : {}),
      });
      if (error) return fromDbError(error);
      const events = approvalChangeEvents(data, inst.sheetId, inst.itemId, userActor(user.id));
      const out = await runAutomations(events, { orgId, userId: user.id, workspace: v.org });
      return ok({ messages: out.messages });
    },
    'withdrawApproval',
  );
}

// ───────────────────────── the item's approvals ─────────────────────────

export interface ItemApprovals {
  instances: ApprovalInstance[];
  decisions: ApprovalDecision[];
  me: string;
  isAdmin: boolean;
}

/** Every approval of an item, newest first (the panel's timeline and actions), under the person's access. */
export async function itemApprovals(input: unknown): Promise<Result<ItemApprovals>> {
  const p = itemApprovalsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      const rows = must(
        await supabase
          .from('workflow_instances')
          .select(INSTANCE_COLUMNS)
          .eq('org_id', orgId)
          .eq('item_id', v.itemId)
          .order('submitted_at', { ascending: false })
          .limit(20),
      );
      const instances = rows.map(toInstance).filter((x): x is ApprovalInstance => !!x);
      const decisions = instances.length
        ? must(
            await supabase
              .from('workflow_decisions')
              .select(DECISION_COLUMNS)
              .in(
                'instance_id',
                instances.map((i) => i.id),
              )
              .order('decided_at'),
          ).map(toDecision)
        : [];
      return ok({ instances, decisions, me: user.id, isAdmin: isAdminRole(role) });
    },
    'itemApprovals',
  );
}
