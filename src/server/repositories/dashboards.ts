import 'server-only';
import {
  computeWidget,
  widgetType,
  type DashboardData,
  type SheetSource,
  type WidgetConfig,
  type WidgetResult,
} from '@/engine/dashboards';
import { isoDateInZone } from '@/engine/fields/helpers';
import { emptySheetData, sheetCtx, todayIn, type CtxEnv } from '@/engine/sheet-data';
import type { Ctx, Field, Group, Person, Sheet } from '@/engine/types';
import { fetchDirectory, fetchSheetData, type Db } from '@/lib/sheet-query';
import { toDashboard, toField, toGroup, toSheet, type Dashboard } from '@/lib/sheet-rows';
import { fetchEvidence } from './evidence';

// Reads for dashboards (docs/05 §4): the workspace's dashboards, the sheets and fields the widget editor offers, and
// the data each dashboard's widgets compute from (only what they need). Run under the person's session and RLS.

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

const DASHBOARD_COLUMNS = 'id, name, position, config, updated_at';
/** Runs read at most per dashboard (the newest first). */
const MAX_RUNS = 5000;
const PAGE = 1000;

export async function listDashboards(db: Db, orgId: string): Promise<Dashboard[]> {
  const rows = must(
    await db
      .from('dashboards')
      .select(DASHBOARD_COLUMNS)
      .eq('org_id', orgId)
      .order('position')
      .order('id'),
  );
  return rows.map(toDashboard);
}

/** One sheet with its fields and groups, as the widget editor and the command checks need it. */
export interface SheetMeta {
  sheet: Sheet;
  fields: Field[];
  groups: Group[];
}

/** Every sheet of the workspace that is not archived, in menu order, with its live fields and groups. */
export async function fetchSheetMetas(
  db: Db,
  orgId: string,
): Promise<{ sheets: SheetMeta[]; people: Person[] }> {
  const [sheets, fields, groups, directory] = await Promise.all([
    db
      .from('sheets')
      .select('id, org_id, name, item_label, id_prefix, is_library')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('position')
      .then(must),
    db
      .from('fields')
      .select(
        'id, sheet_id, key, name, type, position, width, required, locked, description, config, validation, rules, visibility, archived_at',
      )
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('position')
      .then(must),
    db
      .from('groups')
      .select('id, sheet_id, name, color, position')
      .eq('org_id', orgId)
      .order('position')
      .then(must),
    fetchDirectory(db, orgId),
  ]);
  const allFields = fields.map(toField);
  const allGroups = groups.map(toGroup);
  return {
    sheets: sheets.map((s) => ({
      sheet: toSheet(s),
      fields: allFields.filter((f) => f.sheetId === s.id),
      groups: allGroups.filter((g) => g.sheetId === s.id),
    })),
    people: directory.people,
  };
}

/** A Ctx without items for a sheet's fields (field choices and condition checks). */
export function metaCtx(meta: SheetMeta, people: Person[], env: CtxEnv): Ctx {
  return sheetCtx(
    { ...emptySheetData(meta.sheet), fields: meta.fields, groups: meta.groups, people },
    env,
  );
}

export interface DashboardView {
  results: Record<string, WidgetResult>;
  /** The sheet name of each widget that has one (or null when it is gone). */
  sheetNames: Record<string, string | null>;
  today: string;
}

/** The results of a dashboard's widgets, computed by the engine from the data they need. */
export async function computeDashboard(
  db: Db,
  orgId: string,
  widgets: WidgetConfig[],
  env: Omit<CtxEnv, 'now'>,
): Promise<DashboardView> {
  const now = new Date();
  const today = todayIn(now, env.timeZone);
  const defs = widgets.map((w) => widgetType(w.type));
  const sheetIds = [...new Set(widgets.map((w) => w.sheetId).filter((s): s is string => !!s))];
  const needsEvidence = defs.some((d) => d?.data.evidence);
  const runDays = Math.max(0, ...widgets.map((w, i) => (defs[i]?.data.runs ? (w.days ?? 30) : 0)));
  const [sheetData, evidence, runs] = await Promise.all([
    Promise.all(sheetIds.map((id) => fetchSheetData(db, id).catch(() => null))),
    needsEvidence ? fetchEvidence(db, orgId) : Promise.resolve([]),
    runDays > 0 ? fetchRuns(db, orgId, now, runDays + 1) : Promise.resolve([]),
  ]);
  const sources = new Map<string, SheetSource>();
  for (const d of sheetData) {
    if (!d || d.sheet.orgId !== orgId) continue;
    const ctx = sheetCtx(d, { ...env, now });
    sources.set(d.sheet.id, { sheet: d.sheet, fields: d.fields, items: d.items, ctx });
  }
  const data: DashboardData = {
    today,
    sheet: (id) => sources.get(id),
    evidence: evidence.map((e) => ({ sheetId: e.sheet.id, validUntil: e.validUntil })),
    runs: runs.map((r) => ({
      sheetId: r.sheet_id,
      status: r.status,
      date: isoDateInZone(r.started_at, env.timeZone),
    })),
  };
  const results: Record<string, WidgetResult> = {};
  const sheetNames: Record<string, string | null> = {};
  for (const w of widgets) {
    results[w.id] = computeWidget(w, data);
    if (w.sheetId) sheetNames[w.id] = sources.get(w.sheetId)?.sheet.name ?? null;
  }
  return { results, sheetNames, today };
}

async function fetchRuns(db: Db, orgId: string, now: Date, days: number) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const out: { sheet_id: string | null; status: string; started_at: string }[] = [];
  for (let from = 0; from < MAX_RUNS; from += PAGE) {
    const rows = must(
      await db
        .from('automation_runs')
        .select('sheet_id, status, started_at')
        .eq('org_id', orgId)
        .gte('started_at', since)
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1),
    );
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
