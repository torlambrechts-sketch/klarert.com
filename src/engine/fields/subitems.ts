import { z } from 'zod';
import { isSubitemDone, progressText } from '../subitems';
import type { Ctx } from '../types';
import { base, cmpNumber, emptyLast, isBlank } from './helpers';
import type { FieldTypeDef } from './types';

// The sub-items column (docs/03 §3.4): the parent's live sub-items, shown as "done/total". Read-only: the rows live on
// the hidden child sheet; roll-ups, lookups and progress read them through `relatedIds` like a link's targets.
// "Turn on sub-items" in the sheet settings creates it; the add-field picker does not offer it.

export type SubitemsConfig = Record<string, never>;

const ratio = (ids: string[] | null, ctx: Ctx) => {
  const list = (ids ?? []).flatMap((id) => {
    const it = ctx.item(id);
    return it ? [it] : [];
  });
  return { total: list.length, done: list.filter((c) => isSubitemDone(c, ctx)).length };
};

export const subitems: FieldTypeDef<string[], SubitemsConfig> = base<string[], SubitemsConfig>({
  id: 'subitems',
  label: 'Sub-items',
  family: 'computed',
  description: 'The sub-items of each item and how many are done.',
  storage: 'computed',
  kind: 'link',
  valueSchema: z.array(z.string().min(1)),
  configSchema: z.object({}).strict() as unknown as z.ZodType<SubitemsConfig>,
  defaultConfig: () => ({}) as SubitemsConfig,
  defaultWidth: 110,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: [],
  addable: false,
  normalize: () => null,
  parseText: () => null,
  compute: (item, _field, ctx) => {
    const ids = ctx.children(item.id);
    return ids.length ? [...ids] : null;
  },
  relatedIds: (item, _field, ctx) => ctx.children(item.id),
  isEmpty: isBlank,
  toText: (v, _cfg, ctx) => {
    const r = ratio(v, ctx);
    return r.total ? progressText(r) : '';
  },
  toNumber: (v) => (v ? v.length : null),
  compare: (a, b, _cfg, ctx) =>
    emptyLast(a, b, isBlank, (x, y) => {
      const rx = ratio(x, ctx);
      const ry = ratio(y, ctx);
      return cmpNumber(rx.done / rx.total, ry.done / ry.total) || cmpNumber(rx.total, ry.total);
    }),
});
