import { z } from 'zod';
import type { Ctx, Field, Item } from '../types';
import {
  addMonths,
  base,
  cmpNumber,
  emptyLast,
  formatDate,
  isoDateInZone,
  parseJson,
} from './helpers';
import { resolveFieldType } from './resolve';

export interface RetentionValue {
  hold: boolean;
  holdReason: string;
}

export interface RetentionConfig {
  years: number;
  fromFieldKey: string | null;
}

function normalizeRetention(input: unknown): RetentionValue | null {
  if (typeof input === 'boolean') return { hold: input, holdReason: '' };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    if (typeof o.hold !== 'boolean') return null;
    return {
      hold: o.hold,
      holdReason: typeof o.holdReason === 'string' ? o.holdReason.trim() : '',
    };
  }
  if (typeof input !== 'string') return null;
  const t = input.trim();
  if (t.startsWith('{')) return normalizeRetention(parseJson(t));
  // "Legal hold" or "Legal hold: litigation"; our own "Delete after …" export means no hold.
  const m = t.match(/^(?:legal\s+)?hold\s*(?:[:—–-]\s*(.*))?$/i);
  if (m) return { hold: true, holdReason: (m[1] ?? '').trim() };
  if (/^(delete after\b.*|no hold|released?)$/i.test(t)) return { hold: false, holdReason: '' };
  return null;
}

/** The date the item may be deleted: from (fromFieldKey's date, else created) + years; null on hold. */
export function retentionDate(item: Item, field: Field<RetentionConfig>, ctx: Ctx): string | null {
  const v = item.values[field.id];
  if (v && typeof v === 'object' && !Array.isArray(v) && v.hold === true) return null;
  const ff = field.config.fromFieldKey ? ctx.fieldsByKey.get(field.config.fromFieldKey) : undefined;
  const from = ff
    ? (resolveFieldType(ff.type)?.toDate(item.values[ff.id] ?? null, ff.config, ctx) ?? null)
    : isoDateInZone(item.createdAt, ctx.timeZone);
  return from ? addMonths(from, Math.round(field.config.years * 12)) : null;
}

/** "Delete after 3 Jan 2032" / "Legal hold" — the cell text, which needs the item. */
export function retentionText(item: Item, field: Field<RetentionConfig>, ctx: Ctx): string {
  const v = item.values[field.id];
  if (v && typeof v === 'object' && !Array.isArray(v) && v.hold === true) return 'Legal hold';
  const d = retentionDate(item, field, ctx);
  return d ? `Delete after ${formatDate(d)}` : '';
}

const isEmpty = (v: RetentionValue | null) => !v || typeof v.hold !== 'boolean';

// The deletion date depends on the item, so toDate/toText on the value alone cannot give it: callers with
// the item use retentionDate / retentionText.
export const retention = base<RetentionValue, RetentionConfig>({
  id: 'retention',
  label: 'Retention',
  family: 'compliance',
  description: 'When the item may be deleted, with a legal hold that stops the clock.',
  storage: 'values',
  kind: 'date',
  valueSchema: z.object({ hold: z.boolean(), holdReason: z.string() }),
  configSchema: z.object({
    years: z.number().nonnegative(),
    fromFieldKey: z.string().min(1).nullable(),
  }),
  defaultConfig: () => ({ years: 6, fromFieldKey: null }),
  defaultWidth: 160,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: true,
  triggers: ['field_changed', 'date_arrives'],
  normalize: (input) => normalizeRetention(input),
  parseText: (t) => normalizeRetention(t),
  isEmpty,
  toText: (v) => (v?.hold ? (v.holdReason ? `Legal hold — ${v.holdReason}` : 'Legal hold') : ''),
  toDate: () => null,
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpNumber(x.hold ? 1 : 0, y.hold ? 1 : 0)),
});
