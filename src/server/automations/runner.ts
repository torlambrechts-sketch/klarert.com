// The automation runner (docs/04 §1, §7): an event loop over the events a write emitted. For each event, the enabled
// automations of the sheet in creation order; trigger → pause → conditions (item after the change) → loop guard →
// once per chain → plan → execute each effect on its own. Effects emit new events one level deeper. An automation in
// test mode (docs/04 §14) plans its steps and logs them as `test` ("Would notify Maria"); it executes nothing.
// Kept free of `server-only` and of Supabase: the store (src/server/automations/effects.ts) does the reads and writes,
// the clock is injected, so depth, once-per-chain, isolation and the time budget are unit-tested.
import {
  bulkSummary,
  ChainGuard,
  checkConditions,
  computedChanges,
  computedTriggerFields,
  ctxBefore,
  itemBefore,
  LOOP_GUARD,
  matchTrigger,
  planActions,
  projectToParent,
  runMessage,
  runStatus,
  TIME_BUDGET,
  TIME_BUDGET_MS,
  TRIGGER_EVENTS,
  type Actor,
  type AutomationEvent,
  type Effect,
  type RunStatus,
  type Step,
  type StepOutcome,
} from '@/engine/automations';
import type { Automation, Condition, Ctx, Item } from '@/engine/types';

export interface AutomationRow {
  id: string;
  sheetId: string;
  name: string;
  trigger: Automation['trigger'];
  conditions: Condition[];
  actions: Automation['actions'];
  createdBy: string | null;
  /** Test mode (docs/04 §14): runs and logs what it would do, performs no effect. Live when not given. */
  mode?: 'live' | 'test';
  /**
   * Why it must not run now, in words (0052): the person it acts as left the workspace, is no longer an editor, or
   * can no longer edit its sheet or a sheet it writes to. The run is recorded as stopped and nothing is done.
   */
  stopReason?: string | null;
}

/** The item an event is about, with the Ctx of its sheet, as stored now. */
export interface World {
  ctx: Ctx;
  item: Item;
  /** People holding a job role (members whose job title is the role's name). */
  roleHolders(roleId: string): string[];
}

export interface EffectResult {
  outcome: StepOutcome;
  /** Why it was not done, or a detail of what was done ("FU-003"). */
  message: string;
  /** Events the write emitted (the runner puts them one level deeper). */
  events: AutomationEvent[];
  /** Items whose stored state changed (their cached World is dropped). */
  touched: string[];
}

export interface RunRecord {
  automationId: string;
  itemId: string;
  event: AutomationEvent & { depth: number };
  status: RunStatus;
  detail: string;
  steps: Step[];
  depth: number;
  chainId: string;
  startedAt: Date;
}

export interface RunnerStore {
  /** Enabled automations of a sheet of the authorised workspace, oldest first. */
  automations(sheetId: string): Promise<AutomationRow[]>;
  /** Which of these automations are paused for the item. */
  paused(automationIds: string[], itemId: string): Promise<Set<string>>;
  /** Null when the item is gone, archived or not in the authorised workspace. */
  world(sheetId: string, itemId: string): Promise<World | null>;
  execute(effect: Effect, run: { automation: AutomationRow; world: World }): Promise<EffectResult>;
  saveRun(run: RunRecord): Promise<void>;
  /** Sub-items: the parent sheet of a child sheet, null for other sheets. Optional (no projection without it). */
  parentSheetOf?(sheetId: string): Promise<string | null>;
  /** Tell the automation's creator it failed (the store sends at most one notice per hour per automation). */
  reportFailure(automation: AutomationRow, item: Item, message: string): Promise<void>;
}

export interface ChainOptions {
  starter: Actor;
  chainId: string;
  /** Milliseconds; injected for tests. */
  clock: () => number;
  budgetMs?: number;
  appUrl: string;
  workspace: string;
  /** Bulk edits: one summary line instead of a toast per run (docs/04 §7.9). */
  summarise?: boolean;
}

export interface ChainRun {
  automationId: string;
  itemId: string;
  status: RunStatus;
  steps: Step[];
}

export interface ChainOutcome {
  runs: ChainRun[];
  messages: string[];
}

type Queued = { event: AutomationEvent; depth: number };

const CHANGE_EVENTS = new Set<AutomationEvent['type']>(['value.changed', 'links.changed']);

export async function runChain(
  events: AutomationEvent[],
  store: RunnerStore,
  opts: ChainOptions,
): Promise<ChainOutcome> {
  const guard = new ChainGuard(opts.clock, opts.budgetMs ?? TIME_BUDGET_MS);
  const runs: ChainRun[] = [];
  const messages: string[] = [];
  /** Toasts of runs that did not simply finish, kept when bulk edits summarise. */
  const problems: string[] = [];
  const worlds = new Map<string, Promise<World | null>>();
  const world = (sheetId: string, itemId: string) => {
    let w = worlds.get(itemId);
    if (!w) {
      w = store.world(sheetId, itemId);
      worlds.set(itemId, w);
    }
    return w;
  };
  const forget = (ids: string[]) => ids.forEach((id) => worlds.delete(id));

  /** Add value.changed events for computed number fields that number triggers watch (formula, rollup …). */
  async function withComputed(list: AutomationEvent[]): Promise<AutomationEvent[]> {
    const out: AutomationEvent[] = [];
    const byItem = new Map<string, AutomationEvent[]>();
    for (const e of list) {
      out.push(e);
      if (!CHANGE_EVENTS.has(e.type)) continue;
      byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
    }
    for (const [itemId, changes] of byItem) {
      const first = changes[0]!;
      const autos = await store.automations(first.sheetId);
      if (
        !autos.some((a) => a.trigger.type === 'number_above' || a.trigger.type === 'number_below')
      )
        continue;
      const w = await world(first.sheetId, itemId);
      if (!w) continue;
      const fields = computedTriggerFields(
        autos.map((a) => a.trigger),
        w.ctx,
      );
      if (fields.length === 0) continue;
      const before = itemBefore(
        w.item,
        changes.flatMap((c) =>
          c.type === 'value.changed' ? [{ fieldId: c.fieldId, before: c.before }] : [],
        ),
      );
      const links = changes.flatMap((c) =>
        c.type === 'links.changed' ? [{ fieldId: c.fieldId, ids: c.before }] : [],
      );
      for (const c of computedChanges(
        fields,
        { item: before, ctx: ctxBefore(w.ctx, before, links) },
        { item: w.item, ctx: w.ctx },
      )) {
        out.push({
          type: 'value.changed',
          sheetId: first.sheetId,
          itemId,
          fieldId: c.fieldId,
          before: c.before,
          after: c.after,
          actor: first.actor,
        });
      }
    }
    return out;
  }

  const queue: Queued[] = (await withComputed(events)).map((event) => ({ event, depth: 0 }));
  let stopped = false;

  while (queue.length > 0 && !stopped) {
    if (guard.overBudget()) {
      messages.push(`${TIME_BUDGET}. Automations did not check ${queue.length} more changes.`);
      problems.push(messages.at(-1)!);
      break;
    }
    const { event, depth } = queue.shift()!;
    // a sub-item's created or changed event is seen by its parent's sheet too, at the same depth: sub-item triggers
    // match it there, and the loop guard counts only the writes (docs/04 §7.4)
    if ((event.type === 'item.created' || event.type === 'value.changed') && store.parentSheetOf) {
      const parentSheet = await store.parentSheetOf(event.sheetId);
      const child = parentSheet ? await world(event.sheetId, event.itemId) : null;
      const p = child ? projectToParent(event, child.item, parentSheet) : null;
      if (p) {
        // the parent's world read the sub-item before this change
        forget([p.itemId]);
        queue.push({ event: p, depth });
      }
    }
    const autos = (await store.automations(event.sheetId)).filter((a) =>
      TRIGGER_EVENTS[a.trigger.type]?.includes(event.type),
    );
    if (autos.length === 0) continue;
    if (!(await world(event.sheetId, event.itemId))) continue;
    const paused = await store.paused(
      autos.map((a) => a.id),
      event.itemId,
    );

    for (const automation of autos) {
      const w = await world(event.sheetId, event.itemId);
      if (!w) break;
      if (!matchTrigger(automation.trigger, event, w.ctx, automation.id)) continue;
      if (paused.has(automation.id)) continue;
      if (!checkConditions(automation.conditions, w.item, w.ctx)) continue;

      const startedAt = new Date();
      if (guard.tooDeep(depth)) {
        await store.saveRun({
          automationId: automation.id,
          itemId: w.item.id,
          event: { ...event, depth },
          status: 'stopped',
          detail: LOOP_GUARD,
          steps: [],
          depth,
          chainId: opts.chainId,
          startedAt,
        });
        runs.push({ automationId: automation.id, itemId: w.item.id, status: 'stopped', steps: [] });
        messages.push(runMessage(automation.name, 'stopped', [], LOOP_GUARD));
        problems.push(messages.at(-1)!);
        continue;
      }
      if (!guard.enter(automation.id, w.item.id)) continue;
      if (automation.stopReason) {
        await store.saveRun({
          automationId: automation.id,
          itemId: w.item.id,
          event: { ...event, depth },
          status: 'stopped',
          detail: automation.stopReason,
          steps: [],
          depth,
          chainId: opts.chainId,
          startedAt,
        });
        runs.push({ automationId: automation.id, itemId: w.item.id, status: 'stopped', steps: [] });
        messages.push(runMessage(automation.name, 'stopped', [], automation.stopReason));
        problems.push(messages.at(-1)!);
        continue;
      }

      const steps: Step[] = [];
      for (const action of automation.actions) {
        // actions run in array order: each is planned on the item as the earlier ones left it
        const now = (await world(event.sheetId, event.itemId)) ?? w;
        const [p] = planActions([action], now.item, event, now.ctx, {
          appUrl: opts.appUrl,
          workspace: opts.workspace,
          actor: opts.starter,
          automation,
          roleHolders: now.roleHolders,
        });
        if (!p) continue;
        const base = { action: p.action, summary: p.summary };
        if (stopped || guard.overBudget()) {
          stopped = true;
          steps.push({ ...base, outcome: 'skipped', message: TIME_BUDGET });
          continue;
        }
        if (p.outcome) {
          steps.push({ ...base, outcome: p.outcome, message: p.message ?? '' });
          continue;
        }
        // test mode: no write, notification, email or webhook; the run log says what it would have done
        if (automation.mode === 'test') {
          steps.push({ ...base, outcome: 'test', message: '' });
          continue;
        }
        let result: Pick<EffectResult, 'outcome' | 'message'> = { outcome: 'done', message: '' };
        for (const effect of p.effects) {
          let r: EffectResult;
          try {
            r = await store.execute(effect, { automation, world: now });
          } catch (e) {
            r = {
              outcome: 'failed',
              message: e instanceof Error ? e.message : 'The action failed.',
              events: [],
              touched: [],
            };
          }
          forget(r.touched);
          const next = await withComputed(r.events);
          queue.push(...next.map((ev) => ({ event: ev, depth: depth + 1 })));
          result = r;
          // the rest of a step (assign's notice) only follows a write that happened
          if (r.outcome !== 'done') break;
        }
        steps.push({ ...base, outcome: result.outcome, message: result.message });
      }

      const status: RunStatus = stopped
        ? 'stopped'
        : automation.mode === 'test'
          ? 'test'
          : runStatus(steps);
      const problem = steps.find((s) => s.outcome === 'failed' || s.outcome === 'blocked');
      const detail = stopped ? TIME_BUDGET : (problem?.message ?? '');
      await store.saveRun({
        automationId: automation.id,
        itemId: w.item.id,
        event: { ...event, depth },
        status,
        detail,
        steps,
        depth,
        chainId: opts.chainId,
        startedAt,
      });
      runs.push({ automationId: automation.id, itemId: w.item.id, status, steps });
      messages.push(runMessage(automation.name, status, steps, detail));
      if (status !== 'done') problems.push(messages.at(-1)!);
      const failedStep = steps.find((s) => s.outcome === 'failed');
      if (failedStep) await store.reportFailure(automation, w.item, failedStep.message);
      if (stopped) break;
    }
  }
  if (stopped) queue.length = 0;

  if (opts.summarise && runs.length > 1)
    return { runs, messages: [bulkSummary(runs)!, ...problems] };
  return { runs, messages };
}
