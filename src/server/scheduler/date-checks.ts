import 'server-only';
import {
  planFirings,
  SCHEDULED_TRIGGERS,
  type AutomationEvent,
  type ScheduledAutomation,
} from '@/engine/automations';
import { planApprovalFirings, type ApprovalInstance } from '@/engine/approvals';
import { sheetCtx } from '@/engine/sheet-data';
import type { Condition } from '@/engine/types';
import { fetchSheetData, type Db } from '@/lib/sheet-query';
import { INSTANCE_COLUMNS, toInstance } from '@/server/approvals/rows';
import { runAutomations } from '@/server/automations';
import { newId } from '@/server/sheet-context';

// Date checks (docs/04 §8): for one workspace, every enabled automation with a date, clock or evidence trigger, the
// items whose moment has passed within the last 7 days and whose conditions hold; each (automation, item, occurrence)
// is claimed once in scheduler_fired, then run through the M7 runner as a `schedule` event started by `system`.
//
// One code path, two callers (CLAUDE.md rule 6):
// - the cron route passes its service-role client and loops over workspaces;
// - "Run date checks now" passes the admin's own client: reads go through RLS and claim_schedule_occurrence checks
//   that they are an owner or admin of the automation's workspace.
// The actions themselves are written by the runner's effects, as for every other automation.

export interface DateCheckSummary {
  automations: number;
  /** Items looked at across the sheets with scheduled automations. */
  items: number;
  /** Due now (passed, within 7 days, conditions true, not paused). */
  due: number;
  /** Claimed now and run: the rest were claimed by an earlier run. */
  fired: number;
  /** Runs that executed (some fire without a run row, e.g. when a later condition check fails). */
  runs: number;
}

export const emptySummary = (): DateCheckSummary => ({
  automations: 0,
  items: 0,
  due: 0,
  fired: 0,
  runs: 0,
});

const SYSTEM = { kind: 'system' as const, id: null };

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Workspaces that have at least one enabled scheduled automation (cron route, service role). */
export async function workspacesWithDateChecks(db: Db): Promise<string[]> {
  const rows = must(
    await db
      .from('automations')
      .select('org_id')
      .eq('enabled', true)
      .in('trigger->>type', SCHEDULED_TRIGGERS),
  );
  return [...new Set(rows.map((r) => r.org_id))];
}

export async function runDateChecks(
  db: Db,
  orgId: string,
  opts: { now: Date; workspace?: string },
): Promise<DateCheckSummary> {
  const summary = emptySummary();
  const [autoRows, org, sheets] = await Promise.all([
    db
      .from('automations')
      .select('id, sheet_id, trigger, conditions, mode')
      .eq('org_id', orgId)
      .eq('enabled', true)
      .in('trigger->>type', SCHEDULED_TRIGGERS)
      .order('created_at')
      .order('id')
      .then(must),
    db.from('orgs').select('slug, time_zone').eq('id', orgId).maybeSingle().then(must),
    db.from('sheets').select('id').eq('org_id', orgId).is('archived_at', null).then(must),
  ]);
  if (!org) return summary;
  const live = new Set(sheets.map((s) => s.id));
  const automations: ScheduledAutomation[] = autoRows
    .filter((a) => live.has(a.sheet_id))
    .map((a) => ({
      id: a.id,
      sheetId: a.sheet_id,
      trigger: a.trigger as ScheduledAutomation['trigger'],
      conditions: (Array.isArray(a.conditions) ? a.conditions : []) as unknown as Condition[],
    }));
  summary.automations = automations.length;
  // test mode (docs/04 §14) claims its own occurrences: turning an automation live lets a date fire for real once
  const testMode = new Set(autoRows.filter((a) => a.mode === 'test').map((a) => a.id));
  if (automations.length === 0) return summary;

  const pauses = must(
    await db
      .from('automation_pauses')
      .select('automation_id, item_id')
      .eq('org_id', orgId)
      .in(
        'automation_id',
        automations.map((a) => a.id),
      ),
  );
  const paused = new Set(pauses.map((p) => `${p.automation_id}:${p.item_id}`));

  const bySheet = new Map<string, ScheduledAutomation[]>();
  for (const a of automations) bySheet.set(a.sheetId, [...(bySheet.get(a.sheetId) ?? []), a]);

  for (const [sheetId, list] of bySheet) {
    const data = await fetchSheetData(db, sheetId);
    if (!data || data.sheet.orgId !== orgId) continue;
    summary.items += data.items.length;
    const ctx = sheetCtx(data, {
      now: opts.now,
      timeZone: org.time_zone,
      userId: '',
      newId,
      isAdmin: true,
    });
    const isPaused = (a: string, i: string) => paused.has(`${a}:${i}`);
    const firings = planFirings(list, data.items, ctx, isPaused);
    // approval overdue (docs/04 §13): the current step of an item's approval passed its SLA
    if (list.some((a) => a.trigger.type === 'approval_overdue')) {
      const live = must(
        await db
          .from('workflow_instances')
          .select(INSTANCE_COLUMNS)
          .eq('sheet_id', sheetId)
          .eq('status', 'in_progress')
          .not('step_due_at', 'is', null)
          .lte('step_due_at', opts.now.toISOString()),
      )
        .map(toInstance)
        .filter((x): x is ApprovalInstance => !!x);
      firings.push(...planApprovalFirings(list, live, data.items, ctx, isPaused));
    }
    summary.due += firings.length;
    for (const f of firings) {
      const { data: claimed, error } = await db.rpc('claim_schedule_occurrence', {
        p_automation: f.automationId,
        p_item: f.itemId,
        p_occurrence: testMode.has(f.automationId) ? `test:${f.occurrence}` : f.occurrence,
      });
      if (error) throw new Error(error.message);
      if (!claimed) continue;
      summary.fired += 1;
      const event: AutomationEvent = {
        type: 'schedule',
        sheetId: f.sheetId,
        itemId: f.itemId,
        automationId: f.automationId,
        occurrence: f.occurrence,
        actor: SYSTEM,
      };
      // one chain per firing: its own depth, once-per-chain and time budget
      const outcome = await runAutomations([event], {
        orgId,
        userId: null,
        starter: SYSTEM,
        workspace: opts.workspace ?? org.slug,
      });
      summary.runs += outcome.runs.length;
    }
  }
  return summary;
}

/** The toast after "Run date checks now". */
export function dateCheckMessage(s: DateCheckSummary): string {
  if (s.automations === 0) return 'No automation in this workspace waits for a date.';
  if (s.fired === 0)
    return s.due === 0
      ? 'Date checks ran. Nothing is due.'
      : 'Date checks ran. Everything due has already fired.';
  return `Date checks ran. ${s.fired} ${s.fired === 1 ? 'automation fired' : 'automations fired'}.`;
}
