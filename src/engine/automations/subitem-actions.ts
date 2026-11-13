// Sub-item actions (docs/04 §5): create sub-items from a list or the sheet's template set, set a field on the parent
// of a sub-item, update the sub-items of an item. Pure planners; the runner executes their effects as the automation.
// Chains through sub-items stay bounded by the loop guard: effects are one level deeper, projections are not.
import {
  childSheetIdOf,
  isSubitemDone,
  MAX_SUBITEMS_AT_ONCE,
  MAX_SUBITEMS_UPDATED,
  subitemLabel,
  subitemsOf,
} from '../subitems';
import type { Ctx, Item, Json } from '../types';
import { defOf, valueOf } from '../values';
import type { PlanEnv } from './actions';
import { renderTemplate } from './template';
import type { ActionJson, AutomationEvent, PlannedStep } from './types';
import { resolveValueToken, valueLabel } from './value-tokens';

type Planner = (
  action: ActionJson,
  item: Item,
  ctx: Ctx,
  env: PlanEnv,
  event: AutomationEvent | null,
) => PlannedStep;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const obj = (v: unknown): Record<string, Json> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Json>) : {};

const not = (
  action: string,
  summary: string,
  outcome: 'failed' | 'skipped' | 'no_change',
  message: string,
): PlannedStep => ({ action, summary, effects: [], outcome, message });

/** The sub-items an action lists, or the sheet's template set when it says `fromTemplate`. */
export function subitemRows(
  action: ActionJson,
  ctx: Ctx,
): { name: string; values: Record<string, Json> }[] {
  if (action.fromTemplate === true) return ctx.sheet.subitems?.template ?? [];
  const list = Array.isArray(action.items) ? action.items : [];
  return list.flatMap((r) => {
    const o = obj(r);
    const name = str(o.name);
    return name ? [{ name, values: obj(o.values) }] : [];
  });
}

export const SUBITEM_ACTIONS: Record<
  'create_subitems' | 'set_parent_field' | 'update_subitems',
  Planner
> = {
  create_subitems: (action, item, ctx, env) => {
    const label = subitemLabel(ctx.sheet).toLowerCase();
    const summary = `Add ${label}`;
    if (item.parentId)
      return not('create_subitems', summary, 'failed', 'Sub-items cannot have sub-items.');
    const childId = childSheetIdOf(ctx);
    if (!childId)
      return not('create_subitems', summary, 'failed', 'Sub-items are off for this sheet.');
    const rows = subitemRows(action, ctx).slice(0, MAX_SUBITEMS_AT_ONCE);
    if (rows.length === 0)
      return not('create_subitems', summary, 'skipped', 'There are no sub-items to add.');
    const keys = new Set(ctx.fieldsOf(childId).map((f) => f.key));
    const items = rows.map((r) => {
      const values: Record<string, Json | null> = {};
      for (const [k, v] of Object.entries(r.values)) {
        if (!keys.has(k)) continue;
        const t = resolveValueToken(v, ctx, env.actor);
        if (t.ok)
          values[k] =
            typeof t.value === 'string' ? renderTemplate(t.value, item, ctx, env) : t.value;
      }
      const name = renderTemplate(r.name, item, ctx, env).trim().slice(0, 500) || r.name;
      return { name, values };
    });
    return {
      action: 'create_subitems',
      summary: `Add ${items.length} ${subitemLabel(ctx.sheet, items.length).toLowerCase()}`,
      effects: [{ kind: 'create_subitems', parentId: item.id, items }],
    };
  },

  set_parent_field: (action, item, ctx, env) => {
    const parentSheetId = ctx.sheet.parentSheetId;
    const key = str(action.fieldKey);
    if (!item.parentId || !parentSheetId)
      return not(
        'set_parent_field',
        'Set a field on the parent',
        'failed',
        'This item has no parent.',
      );
    const field = ctx.fieldsOf(parentSheetId).find((f) => f.key === key);
    if (!field)
      return not(
        'set_parent_field',
        'Set a field on the parent',
        'failed',
        key ? `The field "${key}" no longer exists.` : 'Choose a field.',
      );
    const summary = `Set ${field.name} on the parent`;
    if (defOf(field).storage !== 'values')
      return not(
        'set_parent_field',
        summary,
        'failed',
        `${field.name} cannot be set by automations.`,
      );
    const v = resolveValueToken(action.value, ctx, env.actor);
    if (!v.ok) return not('set_parent_field', summary, 'skipped', v.message);
    return {
      action: 'set_parent_field',
      summary: `Set ${field.name} on the parent to ${valueLabel(field, v.value, ctx)}`,
      effects: [
        {
          kind: 'set_values',
          sheetId: parentSheetId,
          itemId: item.parentId,
          values: { [field.id]: v.value },
        },
      ],
    };
  },

  update_subitems: (action, item, ctx, env) => {
    const childId = childSheetIdOf(ctx);
    const key = str(action.fieldKey);
    const field = childId ? ctx.fieldsOf(childId).find((f) => f.key === key) : undefined;
    const label = subitemLabel(ctx.sheet).toLowerCase();
    if (!childId)
      return not(
        'update_subitems',
        `Update ${label}`,
        'failed',
        'Sub-items are off for this sheet.',
      );
    if (!field)
      return not(
        'update_subitems',
        `Update ${label}`,
        'failed',
        key ? `The field "${key}" no longer exists.` : 'Choose a field.',
      );
    const summary = `Set ${field.name} on ${label}`;
    if (defOf(field).storage !== 'values')
      return not(
        'update_subitems',
        summary,
        'failed',
        `${field.name} cannot be set by automations.`,
      );
    const v = resolveValueToken(action.value, ctx, env.actor);
    if (!v.ok) return not('update_subitems', summary, 'skipped', v.message);
    const wanted = v.value === null ? null : defOf(field).normalize(v.value, field.config, ctx);
    const targets = subitemsOf(item, ctx)
      .filter((c) => action.onlyOpen !== true || !isSubitemDone(c, ctx))
      .filter((c) => JSON.stringify(valueOf(c, field, ctx) ?? null) !== JSON.stringify(wanted))
      .slice(0, MAX_SUBITEMS_UPDATED);
    const text = `Set ${field.name} to ${valueLabel(field, v.value, ctx)} on ${label}`;
    if (targets.length === 0) return not('update_subitems', text, 'no_change', '');
    return {
      action: 'update_subitems',
      summary: text,
      effects: [
        {
          kind: 'update_linked',
          itemId: item.id,
          direction: 'out',
          targetIds: targets.map((t) => t.id),
          fromSheetId: null,
          linkFieldKey: '',
          fieldKey: field.key,
          value: v.value,
        },
      ],
    };
  },
};
