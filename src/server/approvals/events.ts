// The automation events an approval write emits (docs/04 §2, §13), from what workflow_submit, workflow_decide and
// workflow_withdraw return: one value.changed per field the move changed (the step field, the status it sets) and,
// for a decision, `workflow.event`s for the step decided and for the workflow ending approved or rejected.
// No database here: unit-tested.
import type { Actor, AutomationEvent } from '@/engine/automations';

interface Change {
  field_id: string;
  before: unknown;
  after: unknown;
}

interface ApprovalResult {
  instance_id?: string;
  workflow_id?: string;
  status?: string;
  outcome?: string | null;
  step_index?: number | null;
  step_id?: string | null;
  changes?: Change[];
}

const asResult = (data: unknown): ApprovalResult =>
  data && typeof data === 'object' && !Array.isArray(data) ? (data as ApprovalResult) : {};

/** value.changed for each field the approval move changed. */
export function approvalChangeEvents(
  data: unknown,
  sheetId: string,
  itemId: string,
  actor: Actor,
): AutomationEvent[] {
  const r = asResult(data);
  return (Array.isArray(r.changes) ? r.changes : [])
    .filter((c) => c && typeof c.field_id === 'string')
    .map((c) => ({
      type: 'value.changed' as const,
      sheetId,
      itemId,
      fieldId: c.field_id,
      before: c.before ?? null,
      after: c.after ?? null,
      actor,
    }));
}

/** The events of one decision: the step decided, the field changes, then approved or rejected when it ended. */
export function decisionEvents(
  data: unknown,
  decision: 'approved' | 'rejected',
  sheetId: string,
  itemId: string,
  actor: Actor,
): AutomationEvent[] {
  const r = asResult(data);
  const base = {
    type: 'workflow.event' as const,
    sheetId,
    itemId,
    workflowId: String(r.workflow_id ?? ''),
    instanceId: String(r.instance_id ?? ''),
    stepIndex: typeof r.step_index === 'number' ? r.step_index : 0,
    stepId: String(r.step_id ?? ''),
    decision,
    actor,
  };
  const out: AutomationEvent[] = [{ ...base, kind: 'decided' }];
  out.push(...approvalChangeEvents(data, sheetId, itemId, actor));
  if (r.outcome === 'approved') out.push({ ...base, kind: 'approved' });
  if (r.outcome === 'rejected') out.push({ ...base, kind: 'rejected' });
  return out;
}
