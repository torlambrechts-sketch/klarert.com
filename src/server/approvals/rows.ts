// Database rows of workflow_instances and workflow_decisions as the engine's types (docs/02 §19). The copy of the
// definition each instance keeps is read leniently: an instance whose copy no longer parses is left out.
import { approvalWorkflowSchema } from '@/engine/approvals/definition';
import type {
  ApprovalDecision,
  ApprovalInstance,
  EndReason,
  InstanceStatus,
} from '@/engine/approvals/runtime';
import type { Database } from '@/lib/database.types';

type InstanceRow = Database['public']['Tables']['workflow_instances']['Row'];
type DecisionRow = Database['public']['Tables']['workflow_decisions']['Row'];

export const INSTANCE_COLUMNS =
  'id, org_id, sheet_id, item_id, workflow_id, definition, status, step_index, round, step_started_at, step_due_at, approvers, step_approvers, submitted_by, submitted_at, submit_comment, automation_id, ended_at, ended_by, end_reason';
export const DECISION_COLUMNS =
  'id, org_id, instance_id, item_id, step_index, step_id, step_name, round, user_id, decision, comment, decided_at';

const STATUSES: InstanceStatus[] = ['in_progress', 'approved', 'rejected', 'withdrawn'];

export function toInstance(
  r: Partial<InstanceRow> & Pick<InstanceRow, 'id'>,
): ApprovalInstance | null {
  const def = approvalWorkflowSchema.safeParse(r.definition);
  if (!def.success) return null;
  const approvers = Array.isArray(r.approvers)
    ? (r.approvers as unknown[]).map((s) => (Array.isArray(s) ? s.map(String) : []))
    : [];
  return {
    id: r.id,
    sheetId: r.sheet_id ?? '',
    itemId: r.item_id ?? '',
    workflowId: r.workflow_id ?? def.data.id,
    definition: def.data,
    status: STATUSES.includes(r.status as InstanceStatus)
      ? (r.status as InstanceStatus)
      : 'withdrawn',
    stepIndex: r.step_index ?? null,
    round: r.round ?? 1,
    stepStartedAt: r.step_started_at ?? null,
    stepDueAt: r.step_due_at ?? null,
    approvers,
    submittedBy: r.submitted_by ?? null,
    submittedAt: r.submitted_at ?? '',
    endedAt: r.ended_at ?? null,
    endedBy: r.ended_by ?? null,
    endReason: (r.end_reason as EndReason | null) ?? null,
    submitComment: r.submit_comment ?? null,
  };
}

export function toDecision(r: DecisionRow): ApprovalDecision {
  return {
    id: r.id,
    instanceId: r.instance_id,
    stepIndex: r.step_index,
    stepId: r.step_id,
    stepName: r.step_name,
    round: r.round,
    userId: r.user_id,
    decision: r.decision === 'rejected' ? 'rejected' : 'approved',
    comment: r.comment,
    decidedAt: r.decided_at,
  };
}
