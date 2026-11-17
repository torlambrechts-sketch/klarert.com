import { Eye } from 'lucide-react';
import { PhoneNav } from '@/components/shell/phone-nav';
import { auditorBanner } from '@/engine/access';
import { ShellProvider } from '@/components/shell/shell-context';
import { CreateProvider } from '@/components/create/create-provider';
import { SideMenu } from '@/components/shell/side-menu';
import { TopBar } from '@/components/shell/top-bar';
import { getMyWorkspaces, isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import { getAppsForMenu } from '@/server/apps/read';
import { getMyWorkBadge } from '@/server/repositories/my-work';
import { getNav } from '@/server/repositories/sheets';

// App shell (docs/05 §2): the side menu, then the top bar and the page.
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const { workspace, role, profile, user } = await requireMember(org);
  const [workspaces, nav, myWorkCount, apps] = await Promise.all([
    getMyWorkspaces(),
    getNav(workspace.id),
    getMyWorkBadge(workspace.id, workspace.time_zone),
    getAppsForMenu(workspace.id, role),
  ]);
  const menuProps = {
    org,
    current: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    workspaces,
    nav,
    canEdit: isEditorRole(role),
    canManage: isAdminRole(role),
    myWorkCount,
    apps,
  };
  return (
    <ShellProvider>
      <CreateProvider org={org} canEdit={isEditorRole(role)}>
        <div className="app-shell">
          <aside className="side-col" aria-label="Workspace">
            <SideMenu {...menuProps} />
          </aside>
          <div className="bg-page flex min-w-0 flex-col">
            <TopBar
              current={workspace}
              canManage={isAdminRole(role)}
              timeZone={workspace.time_zone}
              me={{
                id: user.id,
                displayName: profile.display_name,
                initials: profile.initials,
                color: profile.color,
                email: user.email ?? '',
              }}
            />
            {role === 'auditor' && workspace.expiresAt ? (
              <p
                role="status"
                data-testid="auditor-banner"
                className="border-line bg-subtle text-copy-13 flex items-center gap-2 border-b px-4 py-2 sm:px-[28px]"
              >
                <Eye className="size-4 shrink-0" aria-hidden />
                {auditorBanner(workspace.expiresAt, workspace.time_zone)}.
              </p>
            ) : null}
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </div>
        <PhoneNav {...menuProps} />
      </CreateProvider>
    </ShellProvider>
  );
}
