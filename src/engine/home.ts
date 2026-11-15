// Home (docs/05 §4): the one-line summary, the Getting started checklist, Needs you and Next 30 days. Pure: every
// number is computed from the workspace's data passed in.
import { addDays, formatDate } from './fields/helpers';
import type { MyWork, WorkRow } from './my-work';
import type { SetupProgress, SetupStepProgress } from './packs/setup';

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

/** The Getting started steps in order, each done or not. When Home shows them: `showGettingStarted`. */
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

/** A live pack install as Home reads it: the shared registers are a system pack, every other pack is a standard. */
export interface InstalledPack {
  key: string;
  system: boolean;
}

/** Standards are the packs that build on the shared registers (docs/05 §6.5); the shared registers are not one. */
export const standardsInstalled = (packs: readonly InstalledPack[]) =>
  packs.filter((p) => !p.system).length;

/**
 * Whether Home shows the Getting started checklist (docs/05 §4, owner decision 15 Nov 2026): only until the first
 * standard is installed (its Next step cards take over), only while a step is still to do, and never to auditors
 * (they get their own Start here panel).
 */
export function showGettingStarted(f: {
  auditor: boolean;
  packs: readonly InstalledPack[];
  steps: ChecklistStep[];
}): boolean {
  return !f.auditor && standardsInstalled(f.packs) === 0 && !checklistDone(f.steps);
}

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

/** A standard's setup as Home reads it (docs/11 Setup): its install, title, installed level and computed progress. */
export interface StandardSetup {
  installId: string;
  title: string;
  level: { name: string } | null;
  progress: SetupProgress;
}

/** One "Next step" card on Home: the first unfinished setup step of one installed standard. */
export interface NextStep {
  installId: string;
  /** The standard's name ("GDPR privacy"), and its level when it has levels. */
  standard: string;
  level: string | null;
  step: SetupStepProgress;
  /** "Step 3 of 8 · 25% done" */
  line: string;
  /** Steps in the standard's setup: "See all 8 steps". */
  total: number;
  percent: number;
}

/**
 * Home's first run (docs/05 §4, owner decision 15 Nov 2026): one Next step per installed standard, in install order,
 * each the first step of its setup that is not done. A standard whose setup is done shows none.
 */
export function nextSteps(setups: readonly StandardSetup[]): NextStep[] {
  return setups.flatMap((s) => {
    const step = s.progress.steps.find((x) => !x.done);
    if (!step) return [];
    return [
      {
        installId: s.installId,
        standard: s.title,
        level: s.level?.name ?? null,
        step,
        line: `Step ${step.number} of ${s.progress.total} · ${s.progress.percent}% done`,
        total: s.progress.total,
        percent: s.progress.percent,
      },
    ];
  });
}

/**
 * The one test-mode banner (docs/04 §14, owner decision 15 Nov 2026): "74 automations are in test mode." over every
 * pack whose automations wait; null when none wait.
 */
export function testModeLine(packs: readonly { count: number }[]): string | null {
  const n = packs.reduce((t, p) => t + Math.max(0, p.count), 0);
  if (n === 0) return null;
  return n === 1 ? '1 automation is in test mode.' : `${n} automations are in test mode.`;
}
