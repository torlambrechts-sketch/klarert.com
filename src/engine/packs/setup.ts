// A pack's guided setup (docs/11 Setup): the checklist a pack ships in its manifest (`setup`), with each step's
// progress computed from the workspace's data. Pure: the steps, the installed level and the sheets the steps read
// in; the steps with their progress out. Nothing here knows a pack: the rules are data (conditions by field key).
import { matchesAll } from '../conditions';
import type { Condition, Ctx, Item, Sheet } from '../types';
import { stepAt } from './levels';
import type { PackSetup, SetupRule, SetupTarget } from './types';

/** A sheet a step reads: its live items and the Ctx to evaluate conditions; `viewId` finds a saved view by name. */
export interface SetupSource {
  sheet: Pick<Sheet, 'id' | 'name' | 'itemLabel'>;
  items: Item[];
  ctx: Ctx;
  viewId?: (name: string) => string | null;
}

export interface SetupStepProgress {
  ref: string;
  /** 1-based, in manifest order. */
  number: number;
  title: string;
  body: string;
  /** Where "Open" goes: a sheet (and a view of it), or null when the sheet cannot be read. */
  link: { sheetId: string; viewId: string | null; sheetName: string } | null;
  /** 0 … 1 */
  progress: number;
  done: boolean;
  /** "3 of 5", per rule, joined: what the progress counts. */
  detail: string;
}

export interface SetupProgress {
  title: string;
  description: string;
  steps: SetupStepProgress[];
  done: number;
  total: number;
  /** 0 … 100, the average of the steps' progress, rounded down (100 only when every step is done). */
  percent: number;
}

/** The progress of one rule: matched / max(counted, min). A sheet that cannot be read counts as not started. */
export function ruleProgress(
  rule: SetupRule,
  source: SetupSource | undefined,
): { progress: number; matched: number; of: number } {
  const min = Math.max(1, rule.min ?? 1);
  if (!source) return { progress: 0, matched: 0, of: min };
  const where = (rule.where ?? []) as Condition[];
  const all = (rule.all ?? []) as Condition[];
  const counted = where.length
    ? source.items.filter((i) => matchesAll(where, i, source.ctx))
    : source.items;
  const matched = all.length
    ? counted.filter((i) => matchesAll(all, i, source.ctx)).length
    : counted.length;
  const of = Math.max(counted.length, min);
  return { progress: Math.min(1, matched / of), matched, of };
}

/** The setup checklist at a level, with every step's progress. `resolve` finds the sheet a target names. */
export function setupProgress(
  setup: PackSetup,
  level: string | null,
  resolve: (t: SetupTarget) => SetupSource | undefined,
): SetupProgress {
  const steps = setup.steps.map((raw, i): SetupStepProgress => {
    const step = stepAt(raw, level);
    const parts = step.rules.map((r) => ruleProgress(r, resolve(r)));
    const progress = parts.length ? parts.reduce((n, p) => n + p.progress, 0) / parts.length : 0;
    const target = resolve(step.target);
    return {
      ref: step.ref,
      number: i + 1,
      title: step.title,
      body: step.body,
      link: target
        ? {
            sheetId: target.sheet.id,
            sheetName: target.sheet.name,
            viewId: step.target.view ? (target.viewId?.(step.target.view) ?? null) : null,
          }
        : null,
      progress,
      done: progress >= 1,
      detail: parts.map((p) => `${p.matched} of ${p.of}`).join(' · '),
    };
  });
  const done = steps.filter((s) => s.done).length;
  const avg = steps.length ? steps.reduce((n, s) => n + s.progress, 0) / steps.length : 0;
  return {
    title: setup.title,
    description: setup.description,
    steps,
    done,
    total: steps.length,
    percent: done === steps.length && steps.length > 0 ? 100 : Math.min(99, Math.floor(avg * 100)),
  };
}
