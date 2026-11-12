// Trend lines (docs/05 §3.1): a number's recent history, read from the activity log's value.changed entries, as
// points oldest → current with a direction and whether that direction is good. Pure: the rows and the current value
// come in, points come out.
import { formatNumber } from '../fields/helpers';
import { resolveFieldType } from '../fields/resolve';
import type { Ctx, Field, Json } from '../types';

/** One value.changed entry of the activity log. */
export interface TrendChange {
  itemId: string;
  fieldId: string;
  /** ISO timestamp. */
  at: string;
  oldValue: Json | null;
  newValue: Json | null;
}

export type TrendDirection = 'up' | 'down' | 'flat';
export type TrendTone = 'good' | 'bad' | 'neutral';

export interface Trend {
  /** Oldest → current, at most `max`. */
  points: number[];
  direction: TrendDirection;
  tone: TrendTone;
}

/** The most points a trend line shows, and the most changes read per item and field. */
export const TREND_MAX_POINTS = 12;
/** How far back the history goes. */
export const TREND_MONTHS = 12;

export const trendKey = (itemId: string, fieldId: string) => `${itemId}|${fieldId}`;

/** Whether the field gets a trend line, and which way is good. null: no trend. */
export function trendPolarity(field: Field): 'better' | 'worse' | 'neutral' | null {
  return resolveFieldType(field.type)?.trend?.(field.config)?.higherIs ?? null;
}

/** The fields of a sheet that get a trend line. */
export const trendFields = (fields: readonly Field[]) =>
  fields.filter((f) => trendPolarity(f) !== null);

/** The start of the history window: `months` before `now`, as an ISO timestamp. */
export function trendSince(now: Date, months = TREND_MONTHS): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

/** Changes grouped per item and field (trendKey), each list oldest first, keeping the newest `max` of each. */
export function groupChanges(
  rows: readonly TrendChange[],
  max = TREND_MAX_POINTS,
): Map<string, TrendChange[]> {
  const out = new Map<string, TrendChange[]>();
  for (const r of rows) {
    const k = trendKey(r.itemId, r.fieldId);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  for (const [k, list] of out) {
    list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (list.length > max) out.set(k, list.slice(-max));
  }
  return out;
}

/**
 * The trend of one value: the value before the first change, each change's new value, then the current value when
 * it differs from the last one logged (a change not yet read back). Values that are empty or not numbers are skipped.
 * Direction compares the first point with the last; tone says whether that is good for the field's polarity.
 */
export function buildTrend(
  changes: readonly TrendChange[],
  current: number | null,
  toNumber: (v: Json | null) => number | null,
  higherIs: 'better' | 'worse' | 'neutral',
  max = TREND_MAX_POINTS,
): Trend {
  const num = (v: Json | null) => {
    const n = v === null || v === undefined ? null : toNumber(v);
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const points: number[] = [];
  const first = changes[0];
  if (first) {
    const before = num(first.oldValue);
    if (before !== null) points.push(before);
  }
  for (const c of changes) {
    const n = num(c.newValue);
    if (n !== null) points.push(n);
  }
  if (current !== null && Number.isFinite(current) && points[points.length - 1] !== current)
    points.push(current);
  const shown = points.slice(-max);
  const a = shown[0];
  const b = shown[shown.length - 1];
  const direction: TrendDirection =
    a === undefined || b === undefined || a === b ? 'flat' : b > a ? 'up' : 'down';
  const tone: TrendTone =
    direction === 'flat' || higherIs === 'neutral'
      ? 'neutral'
      : (direction === 'up') === (higherIs === 'better')
        ? 'good'
        : 'bad';
  return { points: shown, direction, tone };
}

/** The trend of a field's value on an item, from grouped changes (groupChanges). */
export function trendOf(
  history: ReadonlyMap<string, TrendChange[]>,
  itemId: string,
  field: Field,
  current: unknown,
  ctx: Ctx,
): Trend | null {
  const def = resolveFieldType(field.type);
  const higherIs = def?.trend?.(field.config)?.higherIs;
  if (!def || !higherIs) return null;
  const toNumber = (v: unknown) => {
    try {
      return def.toNumber(v, field.config, ctx);
    } catch {
      return null;
    }
  };
  return buildTrend(
    history.get(trendKey(itemId, field.id)) ?? [],
    toNumber(current ?? null),
    toNumber,
    higherIs,
  );
}

const WORDS: Record<TrendDirection, string> = { up: 'rising', down: 'falling', flat: 'level' };

/** Words for a trend line, so colour is never the only signal: "Trend: 12 → 20, rising". */
export const trendLabel = (t: Trend) =>
  `Trend: ${formatNumber(t.points[0] ?? 0)} → ${formatNumber(t.points[t.points.length - 1] ?? 0)}, ${WORDS[t.direction]}`;
