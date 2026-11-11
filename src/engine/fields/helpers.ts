// Shared building blocks for field type definitions. Pure; dates are ISO strings, never Date.now().
import { z } from 'zod';
import type { Ctx, Field, Issue, Item, Json } from '../types';
import type { FieldTypeDef, LabelOption } from './types';

// ───────────── emptiness and comparison ─────────────

export const isBlank = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/** Compare with empties last, regardless of direction of the inner comparison. */
export function emptyLast<V>(
  a: V | null,
  b: V | null,
  isEmpty: (v: V | null) => boolean,
  cmp: (a: V, b: V) => number,
) {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  return cmp(a as V, b as V);
}

export const cmpNumber = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
export const cmpText = (a: string, b: string) =>
  a.localeCompare(b, 'en-GB', { sensitivity: 'base', numeric: true });

// ───────────── numbers ─────────────

/** Parses "1,234.5", "1 234,5" is not supported (en-GB workspace locale), "12%", "€1,200". */
export function parseNumber(text: unknown): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  if (typeof text !== 'string') return null;
  const t = text
    .trim()
    .replace(/^[^\d+\-.]+/, '')
    .replace(/[%\s]+$/g, '')
    .replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function formatNumber(n: number, decimals = 2): string {
  return new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(n);
}

// ───────────── dates (ISO strings, UTC arithmetic) ─────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function isIsoDate(s: unknown): boolean {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const ymd = (y: number, m: number, d: number): string | null => {
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(s) ? s : null;
};

/** ISO, ISO datetime, dd/mm/yyyy (en-GB), "11 Nov 2026", Excel serial numbers (1900 system). */
export function parseDate(input: unknown): string | null {
  if (typeof input === 'number') return excelSerialToIso(input);
  if (typeof input !== 'string') return null;
  const t = input.trim();
  if (!t) return null;
  if (isIsoDate(t)) return t;
  let m = t.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (m && isIsoDate(m[1])) return m[1]!;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return ymd(y, Number(m[2]), Number(m[1]));
  }
  m = t.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/i);
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.toLowerCase());
    return mi < 0 ? null : ymd(Number(m[3]), mi + 1, Number(m[1]));
  }
  if (/^\d{4,6}(\.\d+)?$/.test(t)) return excelSerialToIso(Number(t));
  return null;
}

/** Excel serial date (1900 date system, with its 1900-02-29 bug). */
export function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const days = Math.floor(n) - (n >= 61 ? 1 : 0); // serial 60 is the fictitious 29 Feb 1900
  const base = Date.UTC(1899, 11, 31);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** a − b in whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

/** "11 Nov 2026" (docs/01: dates as 11 Nov 2026). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]!.replace(/^./, (c) => c.toUpperCase())} ${y}`;
}

/** ISO instant → ISO date in a time zone. */
export function isoDateInZone(instant: string | Date, timeZone: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts;
}

/** "11 Nov 2026, 14:20" in the given zone (24 h). */
export function formatDateTime(instant: string, timeZone: string): string {
  const d = new Date(instant);
  const date = formatDate(isoDateInZone(d, timeZone));
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${date}, ${time}`;
}

// ───────────── options ─────────────

export const COLORS = [
  'grey',
  'blue',
  'navy',
  'teal',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'dark',
] as const;

export const optionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  color: z.string().default('grey'),
  done: z.boolean().optional(),
});

/** Match an option by id, then by label (case-insensitive) — used by normalise and parseText. */
export function findOption(options: LabelOption[], input: unknown): LabelOption | undefined {
  if (typeof input !== 'string') return undefined;
  const t = input.trim();
  return (
    options.find((o) => o.id === t) ??
    options.find((o) => o.label.toLowerCase() === t.toLowerCase())
  );
}

// ───────────── people and lookups ─────────────

/** Accepts an id, an email, a display name or the token "me". */
export function findPersonId(input: unknown, ctx: Ctx): string | undefined {
  if (typeof input !== 'string') return undefined;
  const t = input.trim();
  if (!t) return undefined;
  if (t.toLowerCase() === 'me') return ctx.userId;
  if (ctx.people.has(t)) return t;
  const lower = t.toLowerCase();
  for (const p of ctx.people.values()) {
    if (p.email?.toLowerCase() === lower || p.name.toLowerCase() === lower) return p.id;
  }
  return undefined;
}

export function findByName<T extends { id: string; name: string }>(
  map: Map<string, T>,
  input: unknown,
): T | undefined {
  if (typeof input !== 'string') return undefined;
  const t = input.trim();
  return map.get(t) ?? [...map.values()].find((x) => x.name.toLowerCase() === t.toLowerCase());
}

/** Split a pasted cell into parts: "a, b; c" or a JSON array. */
export function splitList(text: string): string[] {
  const t = text.trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (Array.isArray(arr)) return arr.map(String);
    } catch {
      // fall through to plain splitting
    }
  }
  return t
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ───────────── def builders ─────────────

export const noIssues = (): Issue[] => [];
export const nullProjection = (): null => null;

export function issue(
  field: Field,
  code: string,
  message: string,
  level: Issue['level'] = 'error',
): Issue {
  return { fieldKey: field.key, level, code, message };
}

/** Parse JSON text for object-valued types pasted from our own CSV export. */
export function parseJson(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

/** Defaults shared by most stored types; a def spreads this and overrides what differs. */
export function base<V, C>(
  partial: Omit<FieldTypeDef<V, C>, 'validate' | 'isEmpty' | 'toNumber' | 'toDate'> &
    Partial<Pick<FieldTypeDef<V, C>, 'validate' | 'isEmpty' | 'toNumber' | 'toDate'>>,
): FieldTypeDef<V, C> {
  return {
    validate: noIssues,
    isEmpty: (v: V | null) => isBlank(v),
    toNumber: nullProjection,
    toDate: nullProjection,
    ...partial,
  };
}

export type { Ctx, Field, Item };
