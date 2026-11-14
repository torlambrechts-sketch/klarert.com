// Chain rules (docs/04 §7): depth, once per chain, time budget, run status and toast lines. Pure: the clock is injected.
import type { RunStatus, Step } from './types';

/** Events caused by actions are depth + 1; deeper than this the runner stops (loop guard). */
export const MAX_DEPTH = 3;
/** Milliseconds a chain may take inside a request. */
export const TIME_BUDGET_MS = 5000;

export const LOOP_GUARD = 'Loop guard: chain deeper than 3';
export const TIME_BUDGET = 'Time budget reached';

/** Tracks one chain: which automation ran on which item, and the time spent. */
export class ChainGuard {
  private readonly seen = new Set<string>();
  private readonly started: number;

  constructor(
    private readonly clock: () => number,
    private readonly budgetMs = TIME_BUDGET_MS,
  ) {
    this.started = clock();
  }

  /** Depth beyond the loop guard. */
  tooDeep(depth: number): boolean {
    return depth > MAX_DEPTH;
  }

  /** Once per chain: true the first time this automation runs on this item, false after. */
  enter(automationId: string, itemId: string): boolean {
    const key = `${automationId}:${itemId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  overBudget(): boolean {
    return this.clock() - this.started > this.budgetMs;
  }

  elapsed(): number {
    return this.clock() - this.started;
  }
}

/** done: nothing failed. partial: something failed or was blocked after something was done. failed: nothing done. */
export function runStatus(steps: Step[]): RunStatus {
  const bad = steps.some((s) => s.outcome === 'failed' || s.outcome === 'blocked');
  if (!bad) return 'done';
  return steps.some((s) => s.outcome === 'done') ? 'partial' : 'failed';
}

const OUTCOME_WORDS: Record<Step['outcome'], string> = {
  done: '',
  no_change: 'no change',
  skipped: 'skipped',
  blocked: 'blocked',
  failed: 'failed',
  test: 'test mode',
};

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** "Set Status to Done", "Create "Follow-up" (FU-003)", "Notify (skipped: No one to notify)". */
export function stepLine(step: Step): string {
  // test mode (docs/04 §14): what the step would have done
  if (step.outcome === 'test') return `Would ${lowerFirst(step.summary)}`;
  if (step.outcome === 'done')
    return step.message ? `${step.summary} (${step.message})` : step.summary;
  const why = step.message ? `: ${step.message.replace(/\.$/, '')}` : '';
  return `${step.summary} (${OUTCOME_WORDS[step.outcome]}${why})`;
}

/** The toast for one run: the automation's name and its steps. */
export function runMessage(name: string, status: RunStatus, steps: Step[], detail = ''): string {
  if (status === 'stopped' && steps.length === 0) return `${name} stopped. ${detail}.`;
  const lines = steps.map(stepLine).join(' · ');
  const head =
    status === 'stopped'
      ? `${name} stopped (${detail})`
      : status === 'test'
        ? `${name} (test mode)`
        : name;
  return lines ? `${head}: ${lines}` : head;
}

/** Bulk edits (docs/04 §7.9): one line instead of a toast per run. */
export function bulkSummary(runs: { automationId: string }[]): string | null {
  if (runs.length === 0) return null;
  const automations = new Set(runs.map((r) => r.automationId)).size;
  const a = automations === 1 ? '1 automation' : `${automations} automations`;
  const t = runs.length === 1 ? 'once' : `${runs.length} times`;
  return `${a} ran ${t}`;
}
