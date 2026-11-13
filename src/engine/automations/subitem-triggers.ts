// Sub-item triggers (docs/04 §3): a sub-item is created, a sub-item's field becomes a value, every sub-item is done.
// They live on the parent sheet and match `subitem.event`, a sub-item's event projected onto its parent at the same
// depth (projectToParent, used by the runner). Pure.
import { allSubitemsDone, isSubitemDone, subitemsOf } from '../subitems';
import type { Automation, Ctx, Field, Item } from '../types';
import { defOf, keysOfValue } from '../values';
import { itemBefore, ctxBefore } from './triggers-base';
import type { Actor, AutomationEvent } from './types';

type Trigger = Automation['trigger'];
type Projected = Extract<AutomationEvent, { type: 'subitem.event' }>;

/** A sub-item's created or changed event, seen from its parent. Null for other events and for items without one. */
export function projectToParent(
  event: AutomationEvent,
  item: Pick<Item, 'id' | 'parentId'>,
  parentSheetId: string | null | undefined,
): Projected | null {
  if (!item.parentId || !parentSheetId || event.itemId !== item.id) return null;
  if (event.type !== 'item.created' && event.type !== 'value.changed') return null;
  return {
    type: 'subitem.event',
    sheetId: parentSheetId,
    itemId: item.parentId,
    subitemId: item.id,
    event,
    actor: event.actor as Actor,
  };
}

/** The child sheet field a sub-item trigger names (by key), if it supports field_becomes. */
export function subitemTriggerField(trigger: Trigger, ctx: Ctx): Field | undefined {
  const childId = ctx.sheet.childSheetId;
  const key = typeof trigger.fieldKey === 'string' ? trigger.fieldKey : null;
  if (!childId || !key) return undefined;
  const field = ctx.fieldsOf(childId).find((f) => f.key === key);
  return field && defOf(field).triggers.includes('field_becomes') ? field : undefined;
}

const projected = (event: AutomationEvent): Projected | null =>
  event.type === 'subitem.event' ? event : null;

/** The parent as it was before the sub-item's change: every sub-item done then? */
function allDoneBefore(p: Projected, ctx: Ctx): boolean {
  const child = ctx.item(p.subitemId);
  if (!child) return false;
  if (p.event.type === 'item.created') {
    // before the new sub-item there were the others
    const others = subitemsOf({ id: p.itemId }, ctx).filter((c) => c.id !== child.id);
    return others.length > 0 && others.every((c) => isSubitemDone(c, ctx));
  }
  const before = itemBefore(child, [{ fieldId: p.event.fieldId, before: p.event.before }]);
  return allSubitemsDone({ id: p.itemId }, ctxBefore(ctx, before));
}

export const SUBITEM_TRIGGERS = {
  subitem_created: (_t: Trigger, event: AutomationEvent) =>
    projected(event)?.event.type === 'item.created',
  subitem_field_becomes: (trigger: Trigger, event: AutomationEvent, ctx: Ctx) => {
    const p = projected(event);
    if (!p || p.event.type !== 'value.changed') return false;
    const field = subitemTriggerField(trigger, ctx);
    if (!field || field.id !== p.event.fieldId) return false;
    const value = trigger.value;
    if (value === null || value === undefined) return false;
    const wanted = String(value);
    return (
      keysOfValue(field, p.event.after).includes(wanted) &&
      !keysOfValue(field, p.event.before).includes(wanted)
    );
  },
  /** Fires once, on the change that makes every sub-item done. */
  all_subitems_done: (_t: Trigger, event: AutomationEvent, ctx: Ctx) => {
    const p = projected(event);
    if (!p) return false;
    return allSubitemsDone({ id: p.itemId }, ctx) && !allDoneBefore(p, ctx);
  },
};
