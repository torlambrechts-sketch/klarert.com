import { z } from 'zod';
import type { Ctx } from '../types';
import { base, cmpText, emptyLast, findByName, parseJson } from './helpers';

export interface LocationValue {
  siteId: string;
  note?: string;
}

const isEmpty = (v: LocationValue | null) => !v || !v.siteId;
const siteName = (v: LocationValue, ctx: Ctx) => ctx.sites.get(v.siteId)?.name ?? '';

function make(site: unknown, note: unknown, ctx: Ctx): LocationValue | null {
  const s = findByName(ctx.sites, site);
  if (!s) return null;
  const n = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
  return n ? { siteId: s.id, note: n } : { siteId: s.id };
}

/** Site id or name, "Leeds · Press shop line 3", "Leeds - Press shop", or {siteId|site, note}. */
function normalize(input: unknown, ctx: Ctx): LocationValue | null {
  if (typeof input === 'string') {
    const t = input.trim();
    if (!t) return null;
    if (t.startsWith('{')) return normalize(parseJson(t), ctx);
    const whole = make(t, '', ctx);
    if (whole) return whole;
    const m = t.match(/^(.+?)\s*(?:·|\s-\s|,|:)\s*(.+)$/);
    return m ? make(m[1], m[2], ctx) : null;
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    return make(o.siteId ?? o.site, o.note, ctx);
  }
  return null;
}

export const location = base<LocationValue, Record<string, never>>({
  id: 'location',
  label: 'Location',
  family: 'basic',
  description: 'A workspace site, with an optional note such as a room or line.',
  storage: 'values',
  kind: 'option',
  valueSchema: z.object({ siteId: z.string().min(1), note: z.string().min(1).optional() }),
  configSchema: z.object({}) as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 170,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input, _cfg, ctx) => normalize(input, ctx),
  parseText: (t, _cfg, ctx) => normalize(t, ctx),
  isEmpty,
  toText: (v, _cfg, ctx) =>
    isEmpty(v) ? '' : [siteName(v!, ctx), v!.note].filter(Boolean).join(' · '),
  compare: (a, b, _cfg, ctx) =>
    emptyLast(
      a,
      b,
      isEmpty,
      (x, y) => cmpText(siteName(x, ctx), siteName(y, ctx)) || cmpText(x.note ?? '', y.note ?? ''),
    ),
  keyOf: (v) => v?.siteId ?? null,
  options: (_cfg, ctx) =>
    [...ctx.sites.values()].map((s) => ({ id: s.id, label: s.name, color: 'grey' })),
});
