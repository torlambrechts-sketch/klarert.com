import { notFound } from 'next/navigation';
import { NoAccess } from '@/components/access/no-access';
import { AppDashboard } from '@/components/apps/app-dashboard';
import { AppForm } from '@/components/apps/app-form';
import { AppFrame } from '@/components/apps/app-frame';
import { AppItemList } from '@/components/apps/app-item-list';
import { SheetView } from '@/components/grid/sheet-view';
import { WorkflowScreen } from '@/components/workflow/workflow-screen';
import { canEdit, toLevel } from '@/engine/access';
import { appScreens, type ResolvedApp, type ResolvedScreen } from '@/engine/apps/resolve';
import { appRows } from '@/engine/apps/list';
import { sheetCtx } from '@/engine/sheet-data';
import { parseViewConfig } from '@/engine/views/config';
import { readTabSettings } from '@/engine/views/tabs';
import { fetchItemsById, fetchSheetData } from '@/lib/sheet-query';
import { getApps } from '@/server/apps/read';
import { isAdminRole, isEditorRole, requireMember, type Role } from '@/server/auth';
import { computeDashboard, listDashboards } from '@/server/repositories/dashboards';
import { getSheet, getSheetAccess } from '@/server/repositories/sheets';
import { getWorkflow } from '@/server/repositories/workflow';
import { newId } from '@/server/sheet-context';
import { BRAND } from '@/lib/brand';

// One screen of an installed app (docs/13): /[org]/apps/[app]/[screen]. Every screen renders an existing part of the
// product over the ids the install resolved: the sheet (Table and its views), an item list, a form, a dashboard or
// Workflow. Everything is read with the person's own session, so RLS and sheet access decide what shows; an app never
// widens access, it only hides screens a role does not need.

type Params = Promise<{ org: string; app: string; screen: string }>;

async function find(org: string, appKey: string, screenKey: string) {
  const member = await requireMember(org);
  const apps = await getApps(member.workspace.id, member.role);
  const app = apps.find((a) => a.key === appKey);
  const screen = app ? appScreens(app).find((s) => s.key === screenKey) : undefined;
  return { member, app, screen };
}

export async function generateMetadata({ params }: { params: Params }) {
  const { org, app: appKey, screen: screenKey } = await params;
  const { app, screen } = await find(org, appKey, screenKey);
  return { title: `${screen?.title ?? 'App'} · ${app?.title ?? 'Apps'} · ${BRAND.product}` };
}

export default async function AppScreenPage({ params }: { params: Params }) {
  const { org, app: appKey, screen: screenKey } = await params;
  const { member, app, screen } = await find(org, appKey, screenKey);
  if (!app || !screen) notFound();
  return (
    <AppFrame org={org} app={app} active={screen.key} crumb={screen.kind !== 'view'}>
      <Screen org={org} app={app} screen={screen} member={member} />
    </AppFrame>
  );
}

type Member = Awaited<ReturnType<typeof requireMember>>;

async function Screen({
  org,
  app,
  screen,
  member,
}: {
  org: string;
  app: ResolvedApp;
  screen: ResolvedScreen;
  member: Member;
}) {
  const { workspace, role, user, supabase } = member;
  const env = { timeZone: workspace.time_zone, userId: user.id, isAdmin: isAdminRole(role) };
  switch (screen.kind) {
    case 'view':
      return <ViewScreen org={org} screen={screen} member={member} />;

    case 'item': {
      const data = await fetchSheetData(supabase, screen.sheetId!).catch(() => null);
      if (!data) return <ScreenNoAccess org={org} screen={screen} />;
      const ctx = sheetCtx(data, { ...env, now: new Date(), newId });
      const rows = appRows(data.items, ctx, {
        filters: screen.filters ?? [],
        sort: screen.sort,
        show: screen.show,
      });
      const parentIds = [...new Set(rows.map((r) => r.parentId).filter((x): x is string => !!x))];
      const parents = parentIds.length ? await fetchItemsById(supabase, parentIds) : [];
      const base = `/${org}/s/${screen.parentSheetId ?? screen.sheetId}`;
      return (
        <AppItemList
          title={screen.title}
          description={screen.description}
          empty={screen.empty ?? 'Nothing here.'}
          rows={rows.map((r) => {
            const parent = r.parentId ? parents.find((p) => p.id === r.parentId) : undefined;
            return {
              ...r,
              href: `${base}?item=${encodeURIComponent(r.displayId)}`,
              parent: parent ? `${parent.displayId} ${parent.name}` : null,
            };
          })}
        />
      );
    }

    case 'form': {
      const [data, access, view] = await Promise.all([
        fetchSheetData(supabase, screen.sheetId!).catch(() => null),
        getSheetAccess(workspace.id, screen.sheetId!),
        supabase
          .from('views')
          .select('id, name, config')
          .eq('id', screen.viewId!)
          .maybeSingle()
          .then((r) => r.data),
      ]);
      if (!data || !view) return <ScreenNoAccess org={org} screen={screen} />;
      const form = parseViewConfig(view.config).form ?? { fields: [] };
      return (
        <AppForm
          org={org}
          title={screen.title}
          description={screen.description}
          data={data}
          viewId={view.id}
          viewName={view.name}
          form={form}
          canSend={isEditorRole(role) && canEdit(toLevel(access?.level ?? 'none'))}
          isAdmin={isAdminRole(role)}
          timeZone={workspace.time_zone}
          userId={user.id}
          next={nextHref(org, app, 'item')}
        />
      );
    }

    case 'dashboard': {
      const list = await listDashboards(supabase, workspace.id);
      const dashboard = list.find((d) => d.id === screen.dashboardId);
      if (!dashboard) return <ScreenNoAccess org={org} screen={screen} />;
      const view = await computeDashboard(
        supabase,
        workspace.id,
        dashboard.widgets,
        { ...env, newId },
        12,
      ).catch(() => null);
      return (
        <AppDashboard
          org={org}
          title={screen.title}
          description={screen.description}
          widgets={dashboard.widgets}
          view={view}
          retryHref={`/${org}/apps/${app.key}/${screen.key}`}
          fullHref={`/${org}/dashboards/${dashboard.id}`}
        />
      );
    }

    case 'workflow': {
      const data = await getWorkflow(supabase, workspace.id, env, {
        sheetId: screen.sheetId!,
        fieldKey: screen.fieldKey ?? null,
      }).catch(() => null);
      if (!data) return <ScreenNoAccess org={org} screen={screen} />;
      return (
        <main className="flex w-full flex-col px-4 pt-5 pb-8 sm:px-[28px]">
          <WorkflowScreen
            org={org}
            orgId={workspace.id}
            data={data}
            explicit
            canEdit={isEditorRole(role)}
          />
        </main>
      );
    }
  }
}

/** The first item screen of the app (where a sent form points next), if any. */
function nextHref(org: string, app: ResolvedApp, kind: 'item') {
  const s = appScreens(app).find((x) => x.kind === kind);
  return s ? { href: `/${org}/apps/${app.key}/${s.key}`, label: s.title } : null;
}

async function ViewScreen({
  org,
  screen,
  member,
}: {
  org: string;
  screen: ResolvedScreen;
  member: Member;
}) {
  const { workspace, role, user } = member;
  const sheetId = screen.parentSheetId ?? screen.sheetId!;
  const [sheet, access] = await Promise.all([
    getSheet(workspace.id, sheetId),
    getSheetAccess(workspace.id, sheetId),
  ]);
  if (!sheet) return <NoAccess org={org} name={access?.name ?? screen.title} />;
  const settings = readTabSettings(sheet.settings);
  return (
    <SheetView
      org={org}
      sheetId={sheet.id}
      sheetName={sheet.name}
      description={sheet.description}
      folderName={sheet.folderName}
      archived={!!sheet.archived_at}
      userId={user.id}
      timeZone={workspace.time_zone}
      role={role as Role}
      access={toLevel(access?.level ?? 'none')}
      restricted={!!access?.restricted}
      onlyGroup={null}
      defaultViewId={screen.viewId ?? defaultViewOf(sheet.settings)}
      tabSet={settings}
    />
  );
}

function defaultViewOf(settings: unknown): string | null {
  const id =
    settings && typeof settings === 'object' && 'defaultViewId' in settings
      ? (settings as { defaultViewId?: unknown }).defaultViewId
      : null;
  return typeof id === 'string' && /^[0-9a-z-]{4,36}$/.test(id) ? id : null;
}

function ScreenNoAccess({ org, screen }: { org: string; screen: ResolvedScreen }) {
  return <NoAccess org={org} name={screen.title} />;
}
