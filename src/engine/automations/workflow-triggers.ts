// Approval workflow triggers (docs/04 §3, §13): a step was decided, the workflow ended approved, it ended rejected,
// and (scheduled) the current step passed its SLA. `workflowId` null = any workflow of the sheet. Pure.
import type { Automation, Ctx } from '../types';
import type { AutomationEvent } from './types';

type Trigger = Automation['trigger'];

const wanted = (trigger: Trigger) =>
  typeof trigger.workflowId === 'string' && trigger.workflowId ? trigger.workflowId : null;

const workflowEvent = (trigger: Trigger, event: AutomationEvent) => {
  if (event.type !== 'workflow.event') return null;
  const w = wanted(trigger);
  return w && w !== event.workflowId ? null : event;
};

export const WORKFLOW_TRIGGERS = {
  /** Every decision on a step; `decision` narrows it to approvals or rejections. */
  workflow_step_decided: (trigger: Trigger, event: AutomationEvent) => {
    const e = workflowEvent(trigger, event);
    if (!e || e.kind !== 'decided') return false;
    const d =
      trigger.decision === 'approved' || trigger.decision === 'rejected' ? trigger.decision : null;
    return d === null || d === e.decision;
  },
  workflow_approved: (trigger: Trigger, event: AutomationEvent) =>
    workflowEvent(trigger, event)?.kind === 'approved',
  workflow_rejected: (trigger: Trigger, event: AutomationEvent) =>
    workflowEvent(trigger, event)?.kind === 'rejected',
  /** Scheduled: the scheduler decides the moment (approvals/schedule.ts) and fires for this automation only. */
  approval_overdue: (
    _t: Trigger,
    event: AutomationEvent,
    _ctx: Ctx,
    automationId: string | undefined,
  ) =>
    event.type === 'schedule' && automationId !== undefined && event.automationId === automationId,
};
