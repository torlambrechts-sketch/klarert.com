// Home (docs/05 §4): the one-line summary, the Getting started checklist, Needs you and Next 30 days. Pure: every
// number is computed from the workspace's data passed in.
import { addDays, formatDate } from './fields/helpers';
import type { MyWork, WorkRow } from './my-work';

export const NEEDS_YOU_MAX = 6;
export const NEXT_DAYS = 30;

export type ChecklistStepId = 'sheet' | 'items' | 'status' | 'invite' | 'automation' | 'activity';

export interface ChecklistFacts {
  sheets: number;
  items: number;
  statusFields: number;
  /** Members other than me plus open invites. */
  colleagues: number;
  automations: number;
  /** Has the person opened an item's activity log? */
  openedActivityLog: boolean;
}

export interface ChecklistStep {
  id: ChecklistStepId;
  label: string;
  done: boolean;
}

export const ITEMS_TO_ADD = 5;

/** The Getting started steps in order, each done or not. Hidden on Home once every step is done. */
export function checklist(f: ChecklistFacts): ChecklistStep[] {
  return [
    { id: 'sheet', label: 'Create a sheet', done: f.sheets > 0 },
    { id: 'items', label: `Add ${ITEMS_TO_ADD} items`, done: f.items >= ITEMS_TO_ADD },
    { id: 'status', label: 'Add a status field', done: f.statusFields > 0 },
    { id: 'invite', label: 'Invite a colleague', done: f.colleagues > 0 },
    { id: 'automation', label: 'Create an automation', done: f.automations > 0 },
    { id: 'activity', label: 'Open the activity log of an item', done: f.openedActivityLog },
  ];
}

export const checklistDone = (steps: ChecklistStep[]) => steps.every((s) => s.done);

/** Overdue, requested of me or due within 14 days: the rows Home lists under "Needs you". */
export const needsYou = (r: WorkRow) => r.overdue || r.requests.length > 0 || r.dueSoon;

export interface HomeSummary {
  needsYou: WorkRow[];
  needsYouCount: number;
  next30: WorkRow[];
  /** "3 items need you · next due 14 Nov" */
  line: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function homeSummary(work: MyWork, today: string): HomeSummary {
  const needs = work.rows.filter(needsYou);
  const horizon = addDays(today, NEXT_DAYS);
  const next30 = work.rows.filter(
    (r) => !r.done && r.due && r.due.date >= today && r.due.date <= horizon,
  );
  const nextDue = next30[0]?.due?.date ?? null;
  const parts = [
    needs.length === 0
      ? 'Nothing needs you right now'
      : `${plural(needs.length, 'item needs', 'items need')} you`,
  ];
  if (nextDue) parts.push(`next due ${formatDate(nextDue).replace(/ \d{4}$/, '')}`);
  return {
    needsYou: needs.slice(0, NEEDS_YOU_MAX),
    needsYouCount: needs.length,
    next30,
    line: parts.join(' · '),
  };
}

/** The Home greeting for an hour of the day (0–23) in the person's time zone. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The hour (0–23) of `now` in an IANA time zone; UTC when the zone is unknown. */
export function hourIn(now: Date, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone })
      .formatToParts(now)
      .find((p) => p.type === 'hour')?.value;
    return h ? Number(h) % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}
