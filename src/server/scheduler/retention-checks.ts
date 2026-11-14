import 'server-only';
import { readRetention, retentionDue, type RetentionDue } from '@/engine/retention';
import { sheetCtx, todayIn } from '@/engine/sheet-data';
import { fetchSheetData, type Db } from '@/lib/sheet-query';
import { ITEM_COLUMNS, toItem } from '@/lib/sheet-rows';
import { newId } from '@/server/sheet-context';

// Retention checks (docs/02 §18): for one workspace, every sheet with retention rules, the items whose period has
// ended. They go to the review queue through retention_enqueue (once per item, rule and due date); nothing is erased
// here. One code path, two callers (CLAUDE.md rule 6):
// - the cron route (service role) once a day per workspace (retention_claim_day);
// - "Check now" on Workspace admin › Retention with the owner's or admin's own client (RLS reads, the RPC checks
//   the role).

export interface RetentionCheckSummary {
  sheets: number;
  items: number;
  due: number;
  /** New queue entries (the rest were queued before). */
  queued: number;
}

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Workspaces with at least one sheet that has retention rules (cron route, service role). */
export async function workspacesWithRetention(db: Db): Promise<string[]> {
  const rows = must(
    await db
      .from('sheets')
      .select('org_id, settings')
      .is('archived_at', null)
      .not('settings->retention->rules', 'is', null),
  );
  return [
    ...new Set(rows.filter((r) => readRetention(r.settings).rules.length).map((r) => r.org_id)),
  ];
}

/** The scheduler checks a workspace once a day (service role only). */
export async function claimRetentionDay(db: Db, orgId: string, day: string): Promise<boolean> {
  const { data, error } = await db.rpc('retention_claim_day', { p_org: orgId, p_day: day });
  if (error) throw new Error(error.message);
  return !!data;
}

export async function runRetentionChecks(
  db: Db,
  orgId: string,
  opts: { now: Date },
): Promise<RetentionCheckSummary> {
  const summary: RetentionCheckSummary = { sheets: 0, items: 0, due: 0, queued: 0 };
  const [org, sheets] = await Promise.all([
    db.from('orgs').select('time_zone').eq('id', orgId).maybeSingle().then(must),
    db.from('sheets').select('id, settings').eq('org_id', orgId).is('archived_at', null).then(must),
  ]);
  if (!org) return summary;
  const due: RetentionDue[] = [];
  for (const s of sheets) {
    const { rules } = readRetention(s.settings);
    if (!rules.length) continue;
    const data = await fetchSheetData(db, s.id);
    if (!data || data.sheet.orgId !== orgId) continue;
    // archived items still hold the data: erase and anonymise rules look at them too
    const archived = rules.some((r) => r.action !== 'archive')
      ? must(
          await db
            .from('items')
            .select(ITEM_COLUMNS)
            .eq('sheet_id', s.id)
            .not('archived_at', 'is', null)
            .limit(5000),
        ).map(toItem)
      : [];
    summary.sheets += 1;
    const items = [...data.items, ...archived];
    summary.items += items.length;
    const ctx = sheetCtx(
      { ...data, items },
      { now: opts.now, timeZone: org.time_zone, userId: '', newId, isAdmin: true },
    );
    due.push(...retentionDue(rules, items, { ...ctx, today: todayIn(opts.now, org.time_zone) }));
  }
  summary.due = due.length;
  for (let i = 0; i < due.length; i += 500) {
    const rows = due.slice(i, i + 500).map((d) => ({
      sheet_id: d.sheetId,
      item_id: d.itemId,
      rule_id: d.ruleId,
      due_on: d.dueOn,
    }));
    const { data, error } = await db.rpc('retention_enqueue', { p_org: orgId, p_rows: rows });
    if (error) throw new Error(error.message);
    summary.queued += data ?? 0;
  }
  return summary;
}

/** The toast after "Check now". */
export function retentionCheckMessage(s: RetentionCheckSummary): string {
  if (s.sheets === 0) return 'No sheet in this workspace has a retention rule yet.';
  if (s.due === 0) return 'Retention checked. Nothing is due.';
  if (s.queued === 0) return 'Retention checked. Everything due is already in the queue.';
  return `Retention checked. ${s.queued} ${s.queued === 1 ? 'record was' : 'records were'} added to the queue.`;
}
