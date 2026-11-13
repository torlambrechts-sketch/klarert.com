// An item screen's rows (docs/13): the items that match every filter, sorted, each with the fields the screen shows
// as text (the field types decide the words). Pure: the server passes the items the person's session could read.
import { matchesAll } from '../conditions';
import type { Ctx, Item } from '../types';
import { compareItems, isItemDone, isOverdueOf, visibleTextOf } from '../values';
import { screenConditions } from './resolve';
import type { AppFilter, AppSort } from './types';

export interface AppRowField {
  key: string;
  name: string;
  text: string;
  overdue: boolean;
}

export interface AppRow {
  id: string;
  displayId: string;
  name: string;
  parentId: string | null;
  done: boolean;
  overdue: boolean;
  fields: AppRowField[];
}

export function appRows(
  items: readonly Item[],
  ctx: Ctx,
  screen: { filters: readonly AppFilter[]; sort?: readonly AppSort[]; show?: readonly string[] },
): AppRow[] {
  const conds = screenConditions(screen.filters);
  const kept = items.filter((i) => matchesAll(conds, i, ctx));
  const comparators = (screen.sort ?? []).flatMap((s) => {
    const f = ctx.fieldsByKey.get(s.fieldKey);
    return f ? [compareItems(f, ctx, s.direction ?? 'asc')] : [];
  });
  const sorted = [...kept].sort((a, b) => {
    for (const c of comparators) {
      const r = c(a, b);
      if (r !== 0) return r;
    }
    return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
  });
  const shown = (screen.show ?? []).flatMap((k) => {
    const f = ctx.fieldsByKey.get(k);
    return f ? [f] : [];
  });
  return sorted.map((i) => {
    const fields = shown.map((f) => ({
      key: f.key,
      name: f.name,
      text: visibleTextOf(i, f, ctx),
      overdue: isOverdueOf(i, f, ctx),
    }));
    return {
      id: i.id,
      displayId: i.displayId,
      name: i.name,
      parentId: i.parentId ?? null,
      done: isItemDone(i, ctx),
      overdue: fields.some((f) => f.overdue),
      fields,
    };
  });
}
