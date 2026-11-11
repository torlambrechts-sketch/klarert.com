import { z } from 'zod';
import type { Ctx, Field, Item } from '../types';
import { base, cmpNumber, emptyLast, parseNumber } from './helpers';
import { fieldByKey, linkedItems, readValue } from './link';
import { resolveFieldType } from './resolve';
import type { FieldTypeDef } from './types';

export interface ProgressConfig {
  sourceFieldKey: string;
}

const LINK_TYPES = new Set(['link', 'requirement', 'controllink']);

const isEmpty = (v: number | null) => v === null || v === undefined || Number.isNaN(v);
const clamp = (n: number | null) => (n === null ? null : Math.min(100, Math.max(0, n)));
const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

/** Answered lines / lines of a checklist, read from its stored value and config (docs/03 §3.3). */
function checklistProgress(item: Item, source: Field, ctx: Ctx): number | null {
  const lines = (source.config as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines) || !lines.length) return null;
  const answers =
    (readValue(item, source, ctx) as { answers?: Record<string, { a?: unknown }> } | null)
      ?.answers ?? {};
  const answered = lines.filter((l) => {
    const id = (l as { id?: unknown }).id;
    return typeof id === 'string' && ['yes', 'no', 'na'].includes(String(answers[id]?.a));
  }).length;
  return pct(answered, lines.length);
}

function isStatusDone(t: Item, ctx: Ctx): boolean {
  const status = ctx.fieldsOf(t.sheetId).find((f) => f.type === 'status');
  if (!status) return false;
  const v = t.values[status.id] ?? null;
  const def = resolveFieldType('status');
  if (def?.isDone) return def.isDone(v, status.config);
  const options = (status.config as { options?: { id: string; done?: boolean }[] }).options ?? [];
  return !!options.find((o) => o.id === v)?.done;
}

export function computeProgress(item: Item, field: Field<ProgressConfig>, ctx: Ctx): number | null {
  const source = fieldByKey(field.sheetId, field.config.sourceFieldKey, ctx);
  if (!source) return null;
  if (source.type === 'checklist') return checklistProgress(item, source, ctx);
  if (LINK_TYPES.has(source.type) || resolveFieldType(source.type)?.kind === 'link') {
    const targets = linkedItems(item, source, ctx);
    return targets.length
      ? pct(targets.filter((t) => isStatusDone(t, ctx)).length, targets.length)
      : null;
  }
  return null;
}

export const progress: FieldTypeDef<number, ProgressConfig> = base<number, ProgressConfig>({
  id: 'progress',
  label: 'Progress',
  family: 'computed',
  description: 'How far a checklist or the linked items have got, as a percentage.',
  storage: 'computed',
  kind: 'number',
  valueSchema: z.number().min(0).max(100),
  configSchema: z.object({ sourceFieldKey: z.string() }),
  defaultConfig: () => ({ sourceFieldKey: '' }),
  defaultWidth: 130,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['number_above', 'number_below'],
  normalize: (input) => clamp(parseNumber(input)),
  parseText: (t) => clamp(parseNumber(t)),
  compute: computeProgress,
  isEmpty,
  toText: (v) => (isEmpty(v) ? '' : `${Math.round(v!)}%`),
  toNumber: (v) => (isEmpty(v) ? null : v),
  compare: (a, b) => emptyLast(a, b, isEmpty, cmpNumber),
});
