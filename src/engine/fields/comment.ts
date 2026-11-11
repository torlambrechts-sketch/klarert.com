import { z } from 'zod';
import type { Ctx } from '../types';
import { base, cmpText, emptyLast, isoDateInZone, parseJson } from './helpers';

export interface CommentValue {
  text: string;
  by: string;
  at: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isInstant = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));

const isEmpty = (v: CommentValue | null) =>
  !v || typeof v.text !== 'string' || v.text.trim() === '';

function normalize(input: unknown, _cfg: unknown, ctx: Ctx): CommentValue | null {
  const stamp = (text: string): CommentValue => ({
    text,
    by: ctx.userId,
    at: ctx.now.toISOString(),
  });
  if (typeof input === 'string' || typeof input === 'number') {
    const t = String(input).replace(/\r\n?/g, '\n').trim();
    return t ? stamp(t) : null;
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    if (typeof o.text !== 'string' || !o.text.trim()) return null;
    const text = o.text.replace(/\r\n?/g, '\n').trim();
    if (typeof o.by === 'string' && o.by && isInstant(o.at)) return { text, by: o.by, at: o.at };
    return stamp(text);
  }
  return null;
}

export const comment = base<CommentValue, Record<string, never>>({
  id: 'comment',
  label: 'Comment',
  family: 'basic',
  description: 'A short note stamped with who wrote it and when.',
  storage: 'values',
  kind: 'text',
  valueSchema: z.object({
    text: z.string().min(1),
    by: z.string().min(1),
    at: z.string().refine(isInstant),
  }),
  configSchema: z.object({}) as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 200,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize,
  parseText: (text, cfg, ctx) => {
    const t = text.trim();
    if (t.startsWith('{')) {
      const j = parseJson(t);
      if (j && typeof j === 'object') return normalize(j, cfg, ctx);
    }
    return normalize(t, cfg, ctx);
  },
  isEmpty,
  // "text — Maria, 11 Nov": first name and day + month in the viewer's time zone.
  toText: (v, _cfg, ctx) => {
    if (isEmpty(v)) return '';
    const first = ctx.people.get(v!.by)?.name.split(/\s+/)[0];
    const [, m, d] = isoDateInZone(v!.at, ctx.timeZone).split('-').map(Number) as [
      number,
      number,
      number,
    ];
    const when = `${d} ${MONTHS[m - 1]}`;
    return `${v!.text} — ${first ? `${first}, ` : ''}${when}`;
  },
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpText(x.text, y.text)),
});
