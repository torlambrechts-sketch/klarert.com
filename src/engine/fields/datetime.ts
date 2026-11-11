import { z } from 'zod';
import type { Ctx } from '../types';
import {
  base,
  emptyLast,
  excelSerialToIso,
  formatDateTime,
  isBlank,
  isIsoDate,
  isoDateInZone,
} from './helpers';

const STORED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const isStored = (s: unknown): s is string =>
  typeof s === 'string' && STORED.test(s) && !Number.isNaN(Date.parse(s));
const toStored = (ms: number) =>
  new Date(Math.round(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Offset of `timeZone` from UTC at instant `ms`, in ms. */
function zoneOffset(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock time in `timeZone` → UTC ms; two passes settle DST transitions. */
export function wallTimeToUtc(
  isoDate: string,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number | null {
  if (!isIsoDate(isoDate) || h > 23 || mi > 59 || s > 59) return null;
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let ms = guess - zoneOffset(guess, timeZone);
  const second = guess - zoneOffset(ms, timeZone);
  if (second !== ms) ms = second;
  return ms;
}

const pad = (n: number | string) => String(n).padStart(2, '0');

function parseInstant(input: unknown, ctx: Ctx): string | null {
  if (input instanceof Date)
    return Number.isNaN(input.getTime()) ? null : toStored(input.getTime());
  if (typeof input === 'number') return fromSerial(input, ctx);
  if (typeof input !== 'string') return null;
  const t = input.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t))
    return /^\d{4,6}(\.\d+)?$/.test(t) ? fromSerial(Number(t), ctx) : null;

  // ISO, with or without a zone; without one it is wall time in the user's zone.
  let m = t.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i,
  );
  if (m) {
    const [, date, h = '0', mi = '0', s = '0', zone] = m;
    if (zone) {
      const ms = Date.parse(
        `${date}T${pad(h)}:${mi}:${s}${zone.toUpperCase() === 'Z' ? 'Z' : zone}`,
      );
      return Number.isNaN(ms) || !isIsoDate(date) ? null : toStored(ms);
    }
    return wall(date!, h, mi, s, ctx);
  }
  // en-GB: 11/11/2026 14:20
  m = t.match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return wall(`${y}-${pad(m[2]!)}-${pad(m[1]!)}`, m[4] ?? '0', m[5] ?? '0', m[6] ?? '0', ctx);
  }
  // Our own display: 11 Nov 2026, 14:20
  m = t.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?$/i);
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.toLowerCase());
    if (mi < 0) return null;
    return wall(`${m[3]}-${pad(mi + 1)}-${pad(m[1]!)}`, m[4] ?? '0', m[5] ?? '0', '0', ctx);
  }
  return null;
}

function wall(date: string, h: string, mi: string, s: string, ctx: Ctx): string | null {
  const ms = wallTimeToUtc(date, Number(h), Number(mi), Number(s), ctx.timeZone);
  return ms === null ? null : toStored(ms);
}

/** Excel serial with a time fraction, read as wall time in the user's zone. */
function fromSerial(n: number, ctx: Ctx): string | null {
  const date = excelSerialToIso(n);
  if (!date) return null;
  const secs = Math.round((n - Math.floor(n)) * 86400);
  const ms = wallTimeToUtc(date, 0, 0, 0, ctx.timeZone);
  return ms === null ? null : toStored(ms + secs * 1000);
}

export const datetime = base<string, Record<string, never>>({
  id: 'datetime',
  label: 'Date and time',
  family: 'basic',
  description: 'A date with a time of day, shown in your time zone.',
  storage: 'values',
  kind: 'date',
  valueSchema: z
    .string()
    .refine(isStored, 'Use an ISO instant in UTC, such as 2026-11-11T14:20:00Z'),
  configSchema: z.object({}) as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 150,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: true,
  triggers: ['field_changed', 'date_arrives'],
  normalize: (input, _cfg, ctx) => parseInstant(input, ctx),
  parseText: (t, _cfg, ctx) => parseInstant(t, ctx),
  isEmpty: isBlank,
  toText: (v, _cfg, ctx) => (v ? formatDateTime(v, ctx.timeZone) : ''),
  toDate: (v, _cfg, ctx) => (v ? isoDateInZone(v, ctx.timeZone) : null),
  compare: (a, b) => emptyLast(a, b, isBlank, (x, y) => (x < y ? -1 : x > y ? 1 : 0)),
});
