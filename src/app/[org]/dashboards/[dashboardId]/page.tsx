import { notFound } from 'next/navigation';
import { DashboardScreen } from '@/components/dashboards/dashboard-screen';
import { toPeriod } from '@/engine/dashboards';
import { isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import {
  computeDashboard,
  fetchSheetMetas,
  listDashboards,
  type DashboardView,
} from '@/server/repositories/dashboards';
import { newId } from '@/server/sheet-context';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Dashboards · ${BRAND.product}` };

// One dashboard (docs/05 §4): tabs for the workspace's dashboards, then its widgets as cards. The engine computes
// every widget on the server from the data it needs; editors add, move, remove and rename through the commands.
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; dashboardId: string }>;
  searchParams: Promise<{ months?: string }>;
}) {
  const { org, dashboardId } = await params;
  const months = toPeriod((await searchParams).months);
  const { workspace, supabase, role, user } = await requireMember(org);
  const list = await listDashboards(supabase, workspace.id);
  const dashboard = list.find((d) => d.id === dashboardId);
  if (!dashboard) notFound();
  const canEdit = isEditorRole(role);
  let view: DashboardView | null = null;
  try {
    view = await computeDashboard(
      supabase,
      workspace.id,
      dashboard.widgets,
      {
        timeZone: workspace.time_zone,
        userId: user.id,
        newId,
        isAdmin: isAdminRole(role),
      },
      months,
    );
  } catch {
    view = null;
  }
  const metas = canEdit ? await fetchSheetMetas(supabase, workspace.id) : null;
  return (
    <DashboardScreen
      org={org}
      dashboards={list.map((d) => ({ id: d.id, name: d.name }))}
      dashboard={dashboard}
      view={view}
      months={months}
      canEdit={canEdit}
      editor={
        metas
          ? {
              sheets: metas.sheets,
              people: metas.people,
              timeZone: workspace.time_zone,
              userId: user.id,
            }
          : null
      }
    />
  );
}
