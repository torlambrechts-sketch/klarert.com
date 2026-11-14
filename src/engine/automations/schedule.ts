// The scheduler's planning (docs/04 §8): when a date, clock or evidence trigger is due for an item, and which
// (automation, item, occurrence) triples the scheduler should try to fire. Pure: the clock (ctx.now) and the
// workspace time zone come in through the Ctx; the server claims each occurrence once (scheduler_fired) and runs it.
import { zonedMidnight, type ClockValue } from '../fields/clock';
import { earliestValidUntil } from '../fields/evidence';
import { addDays } from '../fields/helpers';
import { matchesAll } from '../conditions';
import { dateOf, valueOf } from '../values';
import type { Automation, Condition, Ctx, Item, TriggerId } from '../types';

type Trigger = Automation['trigger'];

/** Moments older than this are history, not news: a new automation does not fire for every past date. */
export const SCHEDULE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

export const SCHEDULED_TRIGGERS: TriggerId[] = [
  'date_arrives',
  'clock_warning',
  'evidence_expiring',
  'approval_overdue',
];

export const isScheduledTrigger = (type: string): boolean =>
  (SCHEDULED_TRIGGERS as string[]).includes(type);

/** evidence_expiring on the item's Files tab rather than a file field (docs/04 §8). */
export const isItemFilesSource = (trigger: Trigger) =>
  trigger.type === 'evidence_expiring' && trigger.source === 'item_files';

export interface Moment {
  /** When the trigger fires, epoch ms. */
  at: number;
  /** What fires: the dedupe key, so a changed date fires again and the same date never twice. */
  occurrence: string;
}

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * The trigger's moment for this item (docs/04 §8), or null when the item has nothing to fire on.
 * - date_arrives: the date + offsetDays at 00:00 in the workspace time zone; occurrence = the date.
 * - clock_warning: the deadline − hoursLeft; occurrence = the deadline (ISO). Stopped clocks never warn.
 * - evidence_expiring: the earliest valid_until − days at 00:00; occurrence = that valid_until. The files are the
 *   field's (source 'field', the default) or those of the item's Files tab (source 'item_files', no field).
 */
export function scheduledMoment(trigger: Trigger, item: Item, ctx: Ctx): Moment | null {
  if (isItemFilesSource(trigger)) {
    const until = earliestValidUntil(ctx.files(item.id, null));
    if (!until) return null;
    return {
      at: zonedMidnight(addDays(until, -Math.trunc(num(trigger.days, 0))), ctx.timeZone),
      occurrence: until,
    };
  }
  const key = typeof trigger.fieldKey === 'string' ? trigger.fieldKey : null;
  const field = key ? ctx.fieldsByKey.get(key) : undefined;
  if (!field) return null;
  switch (trigger.type) {
    case 'date_arrives': {
      const date = dateOf(item, field, ctx);
      if (!date) return null;
      return {
        at: zonedMidnight(addDays(date, Math.trunc(num(trigger.offsetDays, 0))), ctx.timeZone),
        occurrence: date,
      };
    }
    case 'clock_warning': {
      const clock = valueOf(item, field, ctx) as ClockValue | null;
      if (!clock || !clock.deadline || clock.stoppedAt !== null) return null;
      if (clock.state !== 'running' && clock.state !== 'warning' && clock.state !== 'overdue')
        return null;
      const deadline = Date.parse(clock.deadline);
      if (Number.isNaN(deadline)) return null;
      return {
        at: deadline - num(trigger.hoursLeft, 0) * HOUR_MS,
        occurrence: new Date(deadline).toISOString(),
      };
    }
    case 'evidence_expiring': {
      const until = earliestValidUntil(ctx.files(item.id, field.id));
      if (!until) return null;
      return {
        at: zonedMidnight(addDays(until, -Math.trunc(num(trigger.days, 0))), ctx.timeZone),
        occurrence: until,
      };
    }
    default:
      return null;
  }
}

/** Has the moment passed, and recently enough to act on (within the last 7 days)? */
export function isDue(at: number, now: number): boolean {
  return at <= now && now - at <= SCHEDULE_WINDOW_MS;
}

export interface ScheduledAutomation {
  id: string;
  sheetId: string;
  trigger: Trigger;
  conditions: Condition[];
}

export interface Firing {
  automationId: string;
  sheetId: string;
  itemId: string;
  occurrence: string;
  /** ISO instant of the moment. */
  at: string;
}

/**
 * What the scheduler should try to fire on one sheet now: per enabled scheduled automation, the items (not archived,
 * not paused) whose moment is due and whose conditions hold. Dedupe happens when the server claims each firing.
 */
export function planFirings(
  automations: ScheduledAutomation[],
  items: Item[],
  ctx: Ctx,
  paused: (automationId: string, itemId: string) => boolean,
): Firing[] {
  const now = ctx.now.getTime();
  const out: Firing[] = [];
  for (const a of automations) {
    if (!isScheduledTrigger(a.trigger.type)) continue;
    for (const item of items) {
      if (item.archivedAt || item.sheetId !== a.sheetId) continue;
      const m = scheduledMoment(a.trigger, item, ctx);
      if (!m || !isDue(m.at, now)) continue;
      if (paused(a.id, item.id)) continue;
      if (!matchesAll(a.conditions ?? [], item, ctx)) continue;
      out.push({
        automationId: a.id,
        sheetId: a.sheetId,
        itemId: item.id,
        occurrence: m.occurrence,
        at: new Date(m.at).toISOString(),
      });
    }
  }
  return out;
}
