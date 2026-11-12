import { PhoneNav } from '@/components/shell/phone-nav';
import { ShellProvider } from '@/components/shell/shell-context';
import { SideMenu } from '@/components/shell/side-menu';
import { TopBar } from '@/components/shell/top-bar';
import { getMyWorkspaces, isAdminRole, isEditorRole, requireMember } from '@/server/auth';
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
  const [workspaces, nav, myWorkCount] = await Promise.all([
    getMyWorkspaces(),
    getNav(workspace.id),
    getMyWorkBadge(workspace.id, workspace.time_zone),
  ]);
  const menuProps = {
    org,
    current: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    workspaces,
    nav,
    canEdit: isEditorRole(role),
    canManage: isAdminRole(role),
    myWorkCount,
  };
  return (
    <ShellProvider>
      <div className="app-shell">
        <aside className="side-col" aria-label="Workspace">
          <SideMenu {...menuProps} />
        </aside>
        <div className="flex min-w-0 flex-col">
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
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
      <PhoneNav {...menuProps} />
    </ShellProvider>
  );
}
