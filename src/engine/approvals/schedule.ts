// "Approval overdue" (docs/04 §3, §8): the scheduler fires an automation once when the current step of an item's
// approval passes its SLA. The occurrence names the instance, the round and the step, so the same step fires once,
// and again only when a rejection sends the item back to it (a new round). Pure.
import { matchesAll } from '../conditions';
import { isDue, type Firing, type ScheduledAutomation } from '../automations/schedule';
import type { Ctx, Item } from '../types';
import type { ApprovalInstance } from './runtime';

export const overdueOccurrence = (inst: Pick<ApprovalInstance, 'id' | 'round' | 'stepIndex'>) =>
  `approval:${inst.id}:${inst.round}:${inst.stepIndex ?? 0}`;

export function planApprovalFirings(
  automations: ScheduledAutomation[],
  instances: ApprovalInstance[],
  items: Item[],
  ctx: Ctx,
  paused: (automationId: string, itemId: string) => boolean,
): Firing[] {
  const now = ctx.now.getTime();
  const byItem = new Map(items.map((i) => [i.id, i]));
  const out: Firing[] = [];
  for (const a of automations) {
    if (a.trigger.type !== 'approval_overdue') continue;
    const wanted = typeof a.trigger.workflowId === 'string' ? a.trigger.workflowId : null;
    for (const inst of instances) {
      if (inst.status !== 'in_progress' || !inst.stepDueAt || inst.sheetId !== a.sheetId) continue;
      if (wanted && inst.workflowId !== wanted) continue;
      const item = byItem.get(inst.itemId);
      if (!item || item.archivedAt) continue;
      const at = Date.parse(inst.stepDueAt);
      if (Number.isNaN(at) || !isDue(at, now)) continue;
      if (paused(a.id, item.id)) continue;
      if (!matchesAll(a.conditions ?? [], item, ctx)) continue;
      out.push({
        automationId: a.id,
        sheetId: a.sheetId,
        itemId: item.id,
        occurrence: overdueOccurrence(inst),
        at: new Date(at).toISOString(),
      });
    }
  }
  return out;
}
