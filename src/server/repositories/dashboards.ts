import 'server-only';
import {
  DEFAULT_DAYS,
  computeWidget,
  widgetType,
  type DashboardData,
  type SheetSource,
  type WidgetConfig,
  type WidgetResult,
} from '@/engine/dashboards';
import { isoDateInZone } from '@/engine/fields/helpers';
import { emptySheetData, sheetCtx, todayIn, type CtxEnv } from '@/engine/sheet-data';
import { itemStatusField } from '@/engine/fields/item-status';
import type { Ctx, Field, Group, Json, Person, Sheet } from '@/engine/types';
import { monthPoints } from '@/engine/dashboards/history';
import { fetchDirectory, fetchItemsOfSheets, fetchSheetData, type Db } from '@/lib/sheet-query';
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
/** Earlier values (activity log) read at most per dashboard for trends (the newest first). */
const MAX_CHANGES = 20000;
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
  /** The period trends show, in months. */
  months: number;
}

/** The results of a dashboard's widgets, computed by the engine from the data they need. */
export async function computeDashboard(
  db: Db,
  orgId: string,
  widgets: WidgetConfig[],
  env: Omit<CtxEnv, 'now'>,
  months: number,
): Promise<DashboardView> {
  const now = new Date();
  const today = todayIn(now, env.timeZone);
  const defs = widgets.map((w) => widgetType(w.type));
  const sheetIds = [...new Set(widgets.map((w) => w.sheetId).filter((s): s is string => !!s))];
  const needsEvidence = defs.some((d) => d?.data.evidence);
  const needsAll = defs.some((d) => d?.data.allSheets);
  const needsHistory = defs.some((d) => d?.data.history);
  const runDays = Math.max(
    0,
    ...widgets.map((w, i) => (defs[i]?.data.runs ? (w.days ?? DEFAULT_DAYS) : 0)),
  );
  const [sheetData, all, evidence, runs] = await Promise.all([
    Promise.all(sheetIds.map((id) => fetchSheetData(db, id).catch(() => null))),
    needsAll ? fetchAllSources(db, orgId, { ...env, now }) : Promise.resolve([]),
    needsEvidence ? fetchEvidence(db, orgId) : Promise.resolve([]),
    runDays > 0 ? fetchRuns(db, orgId, now, runDays + 1) : Promise.resolve([]),
  ]);
  const sources = new Map<string, SheetSource>(all.map((s) => [s.sheet.id, s]));
  for (const d of sheetData) {
    if (!d || d.sheet.orgId !== orgId) continue;
    const ctx = sheetCtx(d, { ...env, now });
    sources.set(d.sheet.id, { sheet: d.sheet, fields: d.fields, items: d.items, ctx });
  }
  // the fields that decide done, of every sheet a trend reads, and their earlier values since the period began
  const deciding = needsHistory
    ? [...sources.values()]
        .map((s) => itemStatusField(s.ctx, s.fields)?.id)
        .filter((id): id is string => !!id)
    : [];
  const start = `${monthPoints(today, months)[0]?.date.slice(0, 8) ?? today.slice(0, 8)}01`;
  const changes = deciding.length
    ? await fetchChanges(db, orgId, deciding, start, env.timeZone)
    : [];
  const data: DashboardData = {
    today,
    timeZone: env.timeZone,
    months,
    sheet: (id) => sources.get(id),
    sheets: () => all.map((s) => sources.get(s.sheet.id) ?? s),
    changes,
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
  return { results, sheetNames, today, months };
}

/** Every sheet of the workspace with its fields and live items (no links or files), in menu order. */
async function fetchAllSources(db: Db, orgId: string, env: CtxEnv): Promise<SheetSource[]> {
  const metas = await fetchSheetMetas(db, orgId);
  const itemsOf = await fetchItemsOfSheets(
    db,
    orgId,
    metas.sheets.map((m) => m.sheet.id),
  );
  return metas.sheets.map((m) => {
    const items = itemsOf.get(m.sheet.id) ?? [];
    const ctx = sheetCtx(
      {
        ...emptySheetData(m.sheet),
        fields: m.fields,
        groups: m.groups,
        people: metas.people,
        items,
      },
      env,
    );
    return { sheet: m.sheet, fields: m.fields, items, ctx };
  });
}

/** Earlier values of the given fields since `since` (value.changed entries of the activity log). */
async function fetchChanges(
  db: Db,
  orgId: string,
  fieldIds: string[],
  since: string,
  timeZone: string,
): Promise<DashboardData['changes']> {
  const out: DashboardData['changes'] = [];
  const from = new Date(`${since}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  for (let at = 0; at < MAX_CHANGES; at += PAGE) {
    const rows = must(
      await db
        .from('activity_log')
        .select('item_id, field_id, old_value, at')
        .eq('org_id', orgId)
        .eq('action', 'value.changed')
        .in('field_id', fieldIds)
        .gte('at', from.toISOString())
        .order('id', { ascending: false })
        .range(at, at + PAGE - 1),
    );
    for (const r of rows)
      if (r.item_id && r.field_id)
        out.push({
          itemId: r.item_id,
          fieldId: r.field_id,
          old: (r.old_value ?? null) as Json,
          date: isoDateInZone(r.at, timeZone),
        });
    if (rows.length < PAGE) break;
  }
  return out;
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
