import { z } from 'zod';
import type { Ctx, Field, Item } from '../types';
import { base, cmpText, emptyLast, isBlank, issue, splitList } from './helpers';
import { resolveFieldType } from './resolve';
import type { FieldTypeDef } from './types';

export interface LinkConfig {
  targetSheetId: string;
  multiple: boolean;
  inverseFieldId: string | null;
}

// ───────────── reading other fields (shared by lookup, rollup, progress) ─────────────

/** A field of the sheet an item or field belongs to, by its stable key. */
export function fieldByKey(sheetId: string, key: string | null | undefined, ctx: Ctx): Field | undefined {
  if (!key) return undefined;
  return ctx.fieldsOf(sheetId).find((f) => f.key === key);
}

// Computed fields may read computed fields on linked items; a two-way link can make that a cycle.
const reading = new Set<string>();

/** The value of any field on any item, wherever the type stores it. */
export function readValue(item: Item, field: Field, ctx: Ctx): unknown {
  const def = resolveFieldType(field.type);
  if (!def) return item.values[field.id] ?? null;
  switch (def.storage) {
    case 'values':
      return item.values[field.id] ?? null;
    case 'links':
      return ctx.links(item.id, field.id);
    case 'files':
      return ctx.files(item.id, field.id);
    case 'protected':
      return ctx.protectedValue(item.id, field.id) ?? null;
    default: {
      if (!def.compute) return null;
      const guard = `${item.id}:${field.id}`;
      if (reading.has(guard)) return null;
      reading.add(guard);
      try {
        return def.compute(item, field, ctx);
      } finally {
        reading.delete(guard);
      }
    }
  }
}

/** Items a link-kind field (link, requirement, controllink) on `item` points to, skipping ids not in the cache. */
export function linkedItems(item: Item, linkField: Field, ctx: Ctx): Item[] {
  return ctx.links(item.id, linkField.id).flatMap((id) => {
    const t = ctx.item(id);
    return t ? [t] : [];
  });
}

// ───────────── the link type ─────────────

const toIds = (input: unknown): string[] | null => {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? splitList(input) : null;
  if (!raw || !raw.every((x) => typeof x === 'string')) return null;
  const ids = [...new Set((raw as string[]).map((s) => s.trim()).filter(Boolean))];
  return ids.length ? ids : null;
};

const text = (v: string[] | null, ctx: Ctx) =>
  (v ?? [])
    .map((id) => ctx.item(id)?.displayId)
    .filter(Boolean)
    .join(', ');

export const link: FieldTypeDef<string[], LinkConfig> = base<string[], LinkConfig>({
  id: 'link',
  label: 'Link to items',
  family: 'computed',
  description: 'Links this item to items on another sheet.',
  storage: 'links',
  kind: 'link',
  valueSchema: z.array(z.string().min(1)),
  configSchema: z.object({
    targetSheetId: z.string(),
    multiple: z.boolean(),
    inverseFieldId: z.string().min(1).nullable(),
  }),
  defaultConfig: () => ({ targetSheetId: '', multiple: true, inverseFieldId: null }),
  defaultWidth: 180,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input) => toIds(input),
  parseText: (t) => toIds(t),
  validate: (v, field, _item, ctx) => {
    const ids = v ?? [];
    const issues = [];
    if (!field.config.multiple && ids.length > 1) issues.push(issue(field, 'single_only', 'Choose one item.'));
    const wrong = ids.some((id) => {
      const t = ctx.item(id);
      return t !== undefined && t.sheetId !== field.config.targetSheetId;
    });
    if (wrong) issues.push(issue(field, 'wrong_sheet', 'Choose items from the linked sheet.'));
    return issues;
  },
  compute: (item, field, ctx) => {
    const ids = ctx.links(item.id, field.id);
    return ids.length ? [...ids] : null;
  },
  isEmpty: isBlank,
  toText: (v, _cfg, ctx) => text(v, ctx),
  toNumber: (v) => (v ? v.length : null),
  compare: (a, b, _cfg, ctx) => emptyLast(a, b, isBlank, (x, y) => cmpText(text(x, ctx), text(y, ctx))),
});
