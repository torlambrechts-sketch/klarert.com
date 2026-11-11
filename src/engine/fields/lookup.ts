import { z } from 'zod';
import type { Ctx, Field, Json } from '../types';
import { base, cmpText, emptyLast, isBlank, splitList } from './helpers';
import { fieldByKey, linkedItems, readValue } from './link';
import { resolveFieldType } from './resolve';
import type { AnyFieldType, FieldTypeDef, ValueKind } from './types';

export interface LookupConfig {
  linkFieldKey: string;
  targetFieldKey: string;
}

/** The link field and the target field a lookup reads through, as seen from `sheetId`. */
function target(sheetId: string, cfg: LookupConfig, ctx: Ctx): { field: Field; def: AnyFieldType } | undefined {
  const linkField = fieldByKey(sheetId, cfg.linkFieldKey, ctx);
  const targetSheetId = (linkField?.config as { targetSheetId?: unknown } | undefined)?.targetSheetId;
  if (typeof targetSheetId !== 'string') return undefined;
  const field = fieldByKey(targetSheetId, cfg.targetFieldKey, ctx);
  const def = field && resolveFieldType(field.type);
  return field && def ? { field, def } : undefined;
}

/** A lookup filters and sorts like the field it looks up. */
export function lookupKind(field: Field<LookupConfig>, ctx: Ctx): ValueKind {
  return target(field.sheetId, field.config, ctx)?.def.kind ?? 'text';
}

const isJson = (x: unknown): x is Json => x !== undefined;

const toList = (input: unknown): Json[] | null => {
  if (input === null || input === undefined) return null;
  const arr = (Array.isArray(input) ? input : [input]).filter((x) => isJson(x) && !isBlank(x));
  return arr.length ? (arr as Json[]) : null;
};

const text = (v: Json[] | null, cfg: LookupConfig, ctx: Ctx) => {
  const t = target(ctx.sheet.id, cfg, ctx);
  return (v ?? [])
    .map((x) =>
      t ? t.def.toText(x, t.field.config, ctx) : typeof x === 'object' && x !== null ? '' : String(x),
    )
    .filter(Boolean)
    .join(', ');
};

// toNumber/toDate project the first looked-up value; aggregating many values is the rollup's job.
const first = <R>(v: Json[] | null, cfg: LookupConfig, ctx: Ctx, pick: (d: AnyFieldType, f: Field) => R | null) => {
  const t = target(ctx.sheet.id, cfg, ctx);
  return t && v && v.length ? pick(t.def, t.field) : null;
};

export const lookup: FieldTypeDef<Json[], LookupConfig> = base<Json[], LookupConfig>({
  id: 'lookup',
  label: 'Lookup',
  family: 'computed',
  description: 'Shows a field from the linked items.',
  storage: 'computed',
  kind: 'text',
  valueSchema: z.array(z.custom<Json>(isJson)),
  configSchema: z.object({ linkFieldKey: z.string(), targetFieldKey: z.string() }),
  defaultConfig: () => ({ linkFieldKey: '', targetFieldKey: '' }),
  defaultWidth: 160,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: [],
  normalize: (input) => toList(input),
  parseText: (t) => toList(splitList(t)),
  compute: (item, field, ctx) => {
    const linkField = fieldByKey(field.sheetId, field.config.linkFieldKey, ctx);
    if (!linkField) return null;
    const values = linkedItems(item, linkField, ctx).flatMap((t) => {
      const tf = fieldByKey(t.sheetId, field.config.targetFieldKey, ctx);
      const def = tf && resolveFieldType(tf.type);
      if (!tf || !def) return [];
      const v = readValue(t, tf, ctx);
      return def.isEmpty(v) || !isJson(v) ? [] : [v];
    });
    return values.length ? values : null;
  },
  isEmpty: isBlank,
  toText: (v, cfg, ctx) => text(v, cfg, ctx),
  toNumber: (v, cfg, ctx) => first(v, cfg, ctx, (d, f) => d.toNumber(v![0], f.config, ctx)),
  toDate: (v, cfg, ctx) => first(v, cfg, ctx, (d, f) => d.toDate(v![0], f.config, ctx)),
  compare: (a, b, cfg, ctx) => emptyLast(a, b, isBlank, (x, y) => cmpText(text(x, cfg, ctx), text(y, cfg, ctx))),
});
