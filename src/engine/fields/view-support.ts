// What views need to know about field types (docs/05 §3.3, docs/03 §4): Kanban lanes, Calendar spans, form
// eligibility and how a stored value is shaped for server-side SQL. Lives here because only src/engine/fields may
// branch on a type id.
import type { Ctx, Field, Item } from '../types';
import { valueOf } from '../values';
import { retentionDate, type RetentionConfig } from './retention';
import { resolveFieldType } from './resolve';
import type { TimelineValue } from './timeline';
import type { LabelOption } from './types';

// ───────────────────────── Kanban ─────────────────────────

/** Lanes for a Kanban grouped by this field, or null when it cannot be the lane field. */
export function laneOptions(field: Field, ctx: Ctx): LabelOption[] | null {
  const def = resolveFieldType(field.type);
  if (!def?.kanbanCapable || def.storage !== 'values') return null;
  if (field.type === 'people') {
    // a lane per person only works when an item has one person
    if ((field.config as { multiple?: boolean }).multiple !== false) return null;
    return [...ctx.people.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'))
      .map((p) => ({ id: p.id, label: p.name, color: p.color }));
  }
  return def.options?.(field.config, ctx) ?? null;
}

/** The raw input that puts an item into a lane (null clears the value). */
export function laneInput(field: Field, ctx: Ctx, laneKey: string | null): unknown {
  if (laneKey === null) return null;
  if (field.type === 'people') return [laneKey];
  const def = resolveFieldType(field.type)!;
  if (def.normalize(laneKey, field.config, ctx) !== null) return laneKey;
  const o = def.options?.(field.config, ctx).find((x) => x.id === laneKey);
  return o ? o.label : laneKey;
}

// ───────────────────────── Calendar ─────────────────────────

export interface CalendarSpan {
  start: string;
  end: string;
}

/**
 * Days an item occupies on a calendar by this field: timelines span start → end, retention uses its computed
 * delete-after date, every other calendar-capable type its date projection (date, datetime, recurrence next,
 * evidence expiry, clock deadline).
 */
export function calendarSpan(item: Item, field: Field, ctx: Ctx): CalendarSpan | null {
  const def = resolveFieldType(field.type);
  if (!def?.calendarCapable) return null;
  if (field.type === 'timeline') {
    const v = item.values[field.id] as unknown as TimelineValue | undefined;
    return v && v.start && v.end ? { start: v.start, end: v.end } : null;
  }
  if (field.type === 'retention') {
    const d = retentionDate(item, field as Field<RetentionConfig>, ctx);
    return d ? { start: d, end: d } : null;
  }
  const d = def.toDate(valueOf(item, field, ctx), field.config, ctx);
  return d ? { start: d, end: d } : null;
}

/** The raw input that sets this field to a day (click a day to add), or undefined when the type is not settable. */
export function dayInput(field: Field, day: string): unknown {
  const def = resolveFieldType(field.type);
  if (!def || def.storage !== 'values' || !def.calendarCapable) return undefined;
  if (field.type === 'timeline') return { start: day, end: day };
  if (field.type === 'date') return day;
  if (field.type === 'datetime') return `${day}T09:00`;
  return undefined;
}

// ───────────────────────── Forms ─────────────────────────

/** Fields a form may show: allowed on forms and filled in through the item's values. */
export function formEligible(field: Field): boolean {
  const def = resolveFieldType(field.type);
  return !!def && def.formAllowed && def.storage === 'values';
}

// ───────────────────────── server-side SQL ─────────────────────────

/**
 * How the value of this field sits in the database, for server-side filters (src/server/query/filters.ts).
 * null = only the engine can read it (computed, objects); such conditions apply to loaded items.
 */
export type SqlShape =
  | 'string' // a JSON string: text, option id
  | 'number' // a JSON number
  | 'date' // a JSON string YYYY-MM-DD
  | 'range' // { start, end } of YYYY-MM-DD
  | 'ids' // a JSON array of strings (multi-select, people)
  | 'bool' // true / false
  | 'links' // rows in item_links
  | 'files'; // rows in files

const SHAPES: Record<string, SqlShape> = {
  text: 'string',
  longtext: 'string',
  comment: 'string',
  email: 'string',
  url: 'string',
  phone: 'string',
  status: 'string',
  dropdown: 'string',
  severity: 'string',
  classification: 'string',
  finding: 'string',
  workflowstep: 'string',
  role: 'string',
  team: 'string',
  country: 'string',
  yesno: 'string',
  number: 'number',
  percent: 'number',
  rating: 'number',
  maturity: 'number',
  date: 'date',
  timeline: 'range',
  multiselect: 'ids',
  people: 'ids',
  check: 'bool',
  link: 'links',
  requirement: 'links',
  controllink: 'links',
  evidence: 'files',
  attachment: 'files',
};

export function sqlShape(field: Field): SqlShape | null {
  return SHAPES[field.type] ?? null;
}
