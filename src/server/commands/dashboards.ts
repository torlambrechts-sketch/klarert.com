import 'server-only';
import {
  DEFAULT_DASHBOARD_NAME,
  defaultWidgets,
  widgetProblem,
  type WidgetConfig,
} from '@/engine/dashboards';
import { keyBetween } from '@/engine/ordering';
import type { Json } from '@/engine/types';
import {
  createDashboardInput,
  deleteDashboardInput,
  seedDashboardInput,
  updateDashboardInput,
} from '@/lib/schemas/dashboards';
import type { Db } from '@/lib/sheet-query';
import { toDashboard, type Dashboard } from '@/lib/sheet-rows';
import { isAdminRole } from '@/server/auth';
import { fetchSheetMetas, metaCtx } from '@/server/repositories/dashboards';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { newId } from '@/server/sheet-context';
import { withOrg } from './context';

// Dashboards (docs/05 §4, docs/02 §1): dashboards are data, so these commands are structure writes made with the
// person's own client under RLS (members read, editors write; 0016 audits every change on the workspace chain).
// Widgets are checked against the widget registry and the workspace's sheets before they are saved.

const COLUMNS = 'id, name, position, config, updated_at';
const notFound = () => fail('not_found', 'This dashboard no longer exists.');

type Env = { orgId: string; userId: string; isAdmin: boolean; timeZone: string };

async function lastPosition(db: Db, orgId: string) {
  const { data } = await db
    .from('dashboards')
    .select('position')
    .eq('org_id', orgId)
    .order('position', { ascending: false })
    .limit(1);
  return data?.[0]?.position ?? null;
}

async function timeZoneOf(db: Db, orgId: string) {
  const { data } = await db.from('orgs').select('time_zone').eq('id', orgId).maybeSingle();
  return data?.time_zone ?? 'Europe/London';
}

/** The first problem of a list of widgets against the workspace's sheets, or null. */
async function widgetsProblem(db: Db, env: Env, widgets: WidgetConfig[]): Promise<string | null> {
  if (new Set(widgets.map((w) => w.id)).size !== widgets.length)
    return 'Widget ids must be unique.';
  if (widgets.length === 0) return null;
  const { sheets, people } = await fetchSheetMetas(db, env.orgId);
  const ctxEnv = { now: new Date(), timeZone: env.timeZone, userId: env.userId, newId };
  const cache = new Map<string, ReturnType<typeof metaCtx>>();
  const lookup = (id: string) => {
    const meta = sheets.find((s) => s.sheet.id === id);
    if (!meta) return undefined;
    if (!cache.has(id)) cache.set(id, metaCtx(meta, people, { ...ctxEnv, isAdmin: env.isAdmin }));
    return { fields: meta.fields, ctx: cache.get(id)! };
  };
  for (const w of widgets) {
    const problem = widgetProblem(w, lookup);
    if (problem) return `${w.title}: ${problem}`;
  }
  return null;
}

async function insertDashboard(
  db: Db,
  env: Env,
  name: string,
  widgets: WidgetConfig[],
): Promise<Result<{ dashboard: Dashboard }>> {
  const { data, error } = await db
    .from('dashboards')
    .insert({
      org_id: env.orgId,
      name,
      position: keyBetween(await lastPosition(db, env.orgId), null),
      config: { widgets } as unknown as NonNullable<Json>,
      created_by: env.userId,
    })
    .select(COLUMNS)
    .single();
  if (error) return fromDbError(error);
  return ok({ dashboard: toDashboard(data) });
}

export async function createDashboard(input: unknown): Promise<Result<{ dashboard: Dashboard }>> {
  const p = createDashboardInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, user, role }) =>
      insertDashboard(
        supabase,
        { orgId, userId: user.id, isAdmin: isAdminRole(role), timeZone: '' },
        v.name,
        [],
      ),
    'createDashboard',
  );
}

export async function updateDashboard(input: unknown): Promise<Result<{ dashboard: Dashboard }>> {
  const p = updateDashboardInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, user, role }) => {
      const { data: row } = await supabase
        .from('dashboards')
        .select('id')
        .eq('id', v.dashboardId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!row) return notFound();
      const widgets = v.widgets as WidgetConfig[] | undefined;
      if (widgets) {
        const env = {
          orgId,
          userId: user.id,
          isAdmin: isAdminRole(role),
          timeZone: await timeZoneOf(supabase, orgId),
        };
        const problem = await widgetsProblem(supabase, env, widgets);
        if (problem) return fail('invalid', problem);
      }
      if (v.name === undefined && !widgets) return fail('invalid', 'Nothing to change.');
      const { data, error } = await supabase
        .from('dashboards')
        .update({
          ...(v.name !== undefined ? { name: v.name } : {}),
          ...(widgets ? { config: { widgets } as unknown as NonNullable<Json> } : {}),
        })
        .eq('id', row.id)
        .select(COLUMNS)
        .single();
      if (error) return fromDbError(error);
      return ok({ dashboard: toDashboard(data) });
    },
    'updateDashboard',
  );
}

export async function deleteDashboard(input: unknown): Promise<Result<{ id: string }>> {
  const p = deleteDashboardInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('dashboards')
        .delete()
        .eq('id', v.dashboardId)
        .eq('org_id', orgId)
        .select('id');
      if (error) return fromDbError(error);
      if (!data?.length) return notFound();
      return ok({ id: v.dashboardId });
    },
    'deleteDashboard',
  );
}

/**
 * The first dashboard of a workspace, made on first open when it has none: "Compliance overview" with widgets built
 * from the sheets that exist (engine/dashboards/default.ts). Returns the existing first dashboard when there is one.
 */
export async function seedDashboard(
  input: unknown,
): Promise<Result<{ dashboard: Dashboard; created: boolean }>> {
  const p = seedDashboardInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'editor',
    async ({ supabase, orgId, user, role }) => {
      const { data: existing, error: readError } = await supabase
        .from('dashboards')
        .select(COLUMNS)
        .eq('org_id', orgId)
        .order('position')
        .limit(1);
      if (readError) return fromDbError(readError);
      if (existing?.[0])
        return ok({ dashboard: toDashboard(existing[0]), created: false as boolean });
      const env = {
        orgId,
        userId: user.id,
        isAdmin: isAdminRole(role),
        timeZone: await timeZoneOf(supabase, orgId),
      };
      const { sheets, people } = await fetchSheetMetas(supabase, orgId);
      const ctxEnv = { now: new Date(), timeZone: env.timeZone, userId: env.userId, newId };
      const widgets = defaultWidgets(
        sheets.map((s) => ({ ...s, ctx: metaCtx(s, people, ctxEnv) })),
        newId,
      );
      const r = await insertDashboard(supabase, env, DEFAULT_DASHBOARD_NAME, widgets);
      return r.ok ? ok({ dashboard: r.data.dashboard, created: true }) : r;
    },
    'seedDashboard',
  );
}
