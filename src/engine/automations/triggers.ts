// Trigger matching (docs/04 §3). Pure: everything about the world comes in through the Ctx of the event's sheet.
import { resolveFieldType } from '../fields/resolve';
import type { Automation, Ctx, Field, Item, TriggerId } from '../types';
import { defOf, keysOfValue, valueOf } from '../values';
import { SUBITEM_TRIGGERS } from './subitem-triggers';
import { ctxBefore, itemBefore } from './triggers-base';
import { TRIGGER_EVENTS, type AutomationEvent } from './types';

export { ctxBefore, itemBefore };

type Trigger = Automation['trigger'];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The trigger's field on this sheet, if the trigger names one and the field type supports the trigger. */
export function triggerField(trigger: Trigger, ctx: Ctx): Field | undefined {
  const key = str(trigger.fieldKey);
  const field = key ? ctx.fieldsByKey.get(key) : undefined;
  if (!field) return undefined;
  const def = resolveFieldType(field.type);
  return def?.triggers.includes(trigger.type) ? field : undefined;
}

/** A number projection of a before/after value. */
function numberOfValue(field: Field, v: unknown, ctx: Ctx): number | null {
  const def = defOf(field);
  return v === null || v === undefined ? null : def.toNumber(v, field.config, ctx);
}

/** field_becomes: the trigger's value is in the new keys and was not in the old ones (multi/people: was added). */
function becomes(field: Field, before: unknown, after: unknown, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const wanted = String(value);
  return keysOfValue(field, after).includes(wanted) && !keysOfValue(field, before).includes(wanted);
}

type Matcher = (
  trigger: Trigger,
  event: AutomationEvent,
  ctx: Ctx,
  automationId: string | undefined,
) => boolean;

/** A stored or computed value of the trigger's field changed: the field and the before/after values. */
function changeOf(trigger: Trigger, event: AutomationEvent, ctx: Ctx) {
  if (event.type !== 'value.changed') return null;
  const field = triggerField(trigger, ctx);
  return field && field.id === event.fieldId
    ? { field, before: event.before, after: event.after }
    : null;
}

function crosses(direction: 'above' | 'below'): Matcher {
  return (trigger, event, ctx) => {
    const c = changeOf(trigger, event, ctx);
    const t = num(trigger.threshold);
    if (!c || t === null) return false;
    const nb = numberOfValue(c.field, c.before, ctx);
    const na = numberOfValue(c.field, c.after, ctx);
    if (na === null) return false;
    return direction === 'above'
      ? na > t && (nb === null || nb <= t)
      : na < t && (nb === null || nb >= t);
  };
}

const scheduled: Matcher = (_t, event, _ctx, automationId) =>
  event.type === 'schedule' && automationId !== undefined && event.automationId === automationId;

/**
 * The triggers (docs/04 §3), keyed by id: 11 on the item and 3 on its sub-items (subitem-triggers.ts). A new trigger is one entry here plus its events in TRIGGER_EVENTS.
 * Scheduled triggers match the scheduler's events for their own automation; the scheduler (M9) decides the moment.
 */
export const TRIGGERS: Record<TriggerId, Matcher> = {
  item_created: (_t, event) => event.type === 'item.created',
  form_submitted: (trigger, event) => {
    if (event.type !== 'form.submitted') return false;
    const formId = str(trigger.formId);
    return formId === null || formId === event.formId;
  },
  field_changed: (trigger, event, ctx) => {
    if (event.type === 'links.changed') {
      const field = triggerField(trigger, ctx);
      return field?.id === event.fieldId && !same(event.before, event.after);
    }
    const c = changeOf(trigger, event, ctx);
    return !!c && !same(c.before, c.after);
  },
  field_becomes: (trigger, event, ctx) => {
    const c = changeOf(trigger, event, ctx);
    return !!c && becomes(c.field, c.before, c.after, trigger.value);
  },
  number_above: crosses('above'),
  number_below: crosses('below'),
  date_arrives: scheduled,
  clock_warning: scheduled,
  evidence_expiring: scheduled,
  button_clicked: (trigger, event, ctx) =>
    event.type === 'button.clicked' && triggerField(trigger, ctx)?.id === event.fieldId,
  checklist_no: (trigger, event, ctx) => {
    const c = changeOf(trigger, event, ctx);
    const count = c && defOf(c.field).countNo;
    if (!c || !count) return false;
    return (
      count((c.after ?? null) as never, c.field.config) >
      count((c.before ?? null) as never, c.field.config)
    );
  },
  ...SUBITEM_TRIGGERS,
};

/** Does this event fire the trigger? `automationId` is needed for scheduled triggers only. */
export function matchTrigger(
  trigger: Trigger,
  event: AutomationEvent,
  ctx: Ctx,
  automationId?: string,
): boolean {
  if (!TRIGGER_EVENTS[trigger.type]?.includes(event.type)) return false;
  const match = TRIGGERS[trigger.type];
  return match ? match(trigger, event, ctx, automationId) : false;
}

/** Field keys of number triggers on fields that are not stored (formula, rollup, progress …): the runner computes them. */
export function computedTriggerFields(triggers: Trigger[], ctx: Ctx): Field[] {
  const out = new Map<string, Field>();
  for (const t of triggers) {
    if (t.type !== 'number_above' && t.type !== 'number_below') continue;
    const field = triggerField(t, ctx);
    if (field && defOf(field).storage !== 'values') out.set(field.id, field);
  }
  return [...out.values()];
}

/**
 * Before/after values of computed fields whose number changed (docs/04 §2: "Residual score goes above 12" works even
 * though the score is not stored). The caller emits a `value.changed` event for each.
 */
export function computedChanges(
  fields: Field[],
  before: { item: Item; ctx: Ctx },
  after: { item: Item; ctx: Ctx },
): { fieldId: string; before: unknown; after: unknown }[] {
  const out: { fieldId: string; before: unknown; after: unknown }[] = [];
  for (const field of fields) {
    const vb = valueOf(before.item, field, before.ctx);
    const va = valueOf(after.item, field, after.ctx);
    if (numberOfValue(field, vb, before.ctx) === numberOfValue(field, va, after.ctx)) continue;
    out.push({ fieldId: field.id, before: vb, after: va });
  }
  return out;
}
