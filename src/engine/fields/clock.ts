import { z } from 'zod';
import type { Ctx, Field, Item, Json } from '../types';
import {
  cmpNumber,
  emptyLast,
  isoDateInZone,
  nullProjection,
  noIssues,
  parseJson,
} from './helpers';
import { resolveFieldType } from './resolve';
import type { FieldTypeDef } from './types';

export type ClockStateId = 'not_started' | 'running' | 'warning' | 'overdue' | 'met' | 'missed';

export interface ClockValue {
  state: ClockStateId;
  /** ISO instants. */
  start: string | null;
  deadline: string | null;
  stoppedAt: string | null;
  /** Hours to the deadline at ctx.now (negative when overdue); null once stopped or not started. */
  hoursLeft: number | null;
}

export interface ClockConfig {
  startFieldKey: string | null;
  hours: number;
  stopFieldKey: string | null;
}

const HOUR = 3_600_000;

const valueSchema = z.object({
  state: z.enum(['not_started', 'running', 'warning', 'overdue', 'met', 'missed']),
  start: z.string().nullable(),
  deadline: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  hoursLeft: z.number().nullable(),
});

/** Offset of a time zone from UTC at an instant, in ms. */
function zoneOffset(t: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Midnight at the start of an ISO date in a time zone, as epoch ms. */
export function zonedMidnight(iso: string, timeZone: string): number {
  const guess = Date.parse(`${iso}T00:00:00Z`);
  const t = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(t, timeZone);
}

/** The moment a date/datetime field's value stands for: an ISO instant as is, a date at local midnight. */
function instantOf(field: Field, raw: Json | undefined, ctx: Ctx): number | null {
  if (raw === undefined || raw === null) return null;
  if (
    typeof raw === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(raw) &&
    !Number.isNaN(Date.parse(raw))
  ) {
    return Date.parse(raw);
  }
  const d = resolveFieldType(field.type)?.toDate(raw, field.config, ctx) ?? null;
  return d ? zonedMidnight(d, ctx.timeZone) : null;
}

function filled(field: Field, raw: Json | undefined): boolean {
  if (raw === undefined || raw === null || raw === false) return false;
  const def = resolveFieldType(field.type);
  return def ? !def.isEmpty(raw) : true;
}

const iso = (t: number) => new Date(t).toISOString();

/** The clock at ctx.now: deadline = start + hours; a filled stop field ends it (met or missed). */
export function clockState(item: Item, field: Field<ClockConfig>, ctx: Ctx): ClockValue {
  const cfg = field.config;
  const sf = cfg.startFieldKey ? ctx.fieldsByKey.get(cfg.startFieldKey) : undefined;
  const start = sf ? instantOf(sf, item.values[sf.id], ctx) : null;
  if (start === null)
    return { state: 'not_started', start: null, deadline: null, stoppedAt: null, hoursLeft: null };
  const deadline = start + cfg.hours * HOUR;
  const base = { start: iso(start), deadline: iso(deadline) };
  const stf = cfg.stopFieldKey ? ctx.fieldsByKey.get(cfg.stopFieldKey) : undefined;
  if (stf && filled(stf, item.values[stf.id])) {
    const stop = instantOf(stf, item.values[stf.id], ctx);
    // A stop field without a time (e.g. a checkbox) counts as met.
    const missed = stop !== null && stop > deadline;
    return {
      ...base,
      state: missed ? 'missed' : 'met',
      stoppedAt: stop === null ? null : iso(stop),
      hoursLeft: null,
    };
  }
  const left = deadline - ctx.now.getTime();
  const state: ClockStateId =
    left < 0 ? 'overdue' : left < (cfg.hours * HOUR) / 3 ? 'warning' : 'running';
  return { ...base, state, stoppedAt: null, hoursLeft: left / HOUR };
}

/** "36 h", "3 days" (48 h and more in days). */
export function formatHours(h: number): string {
  const a = Math.abs(h);
  return a >= 48 ? `${Math.round(a / 24)} days` : `${Math.round(a)} h`;
}

const isEmpty = (v: ClockValue | null) => !v || v.deadline === null;
const deadlineMs = (v: ClockValue) => Date.parse(v.deadline!);

function normalizeClock(input: unknown): ClockValue | null {
  const r = valueSchema.safeParse(input);
  return r.success ? r.data : null;
}

export const clock: FieldTypeDef<ClockValue, ClockConfig> = {
  id: 'clock',
  label: 'Statutory clock',
  family: 'compliance',
  description: 'Counts down to a legal deadline a number of hours after a start date.',
  storage: 'computed',
  kind: 'date',
  valueSchema,
  configSchema: z.object({
    startFieldKey: z.string().min(1).nullable(),
    hours: z.number().positive(),
    stopFieldKey: z.string().min(1).nullable(),
  }),
  defaultConfig: () => ({ startFieldKey: null, hours: 72, stopFieldKey: null }),
  defaultWidth: 150,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: true,
  triggers: ['date_arrives', 'clock_warning'],
  normalize: (input) => normalizeClock(input),
  parseText: (t) => normalizeClock(parseJson(t.trim())),
  validate: noIssues,
  compute: clockState,
  isEmpty,
  toText: (v) => {
    if (!v) return '';
    switch (v.state) {
      case 'not_started':
        return 'Not started';
      case 'met':
        return 'Met';
      case 'missed':
        return v.stoppedAt && v.deadline
          ? `Missed by ${formatHours((Date.parse(v.stoppedAt) - Date.parse(v.deadline)) / HOUR)}`
          : 'Missed';
      case 'overdue':
        return `Overdue ${formatHours(v.hoursLeft ?? 0)}`;
      default:
        return `${formatHours(v.hoursLeft ?? 0)} left`;
    }
  },
  toNumber: nullProjection,
  toDate: (v, _cfg, ctx) => (isEmpty(v) ? null : isoDateInZone(v!.deadline!, ctx.timeZone)),
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpNumber(deadlineMs(x), deadlineMs(y))),
};
