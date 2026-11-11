import { PanelFrame } from '@/components/shell/panel-frame';
import { PhoneNav } from '@/components/shell/phone-nav';
import { ShellPrefsScript } from '@/components/shell/prefs-script';
import { Rail } from '@/components/shell/rail';
import { ShellProvider } from '@/components/shell/shell-context';
import { TopBar } from '@/components/shell/top-bar';
import { getMyWorkspaces, isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import { getMyWorkCount, getNav } from '@/server/repositories/sheets';

// App shell (docs/05 §2): rail · second panel (the @panel slot, one per page) · top bar and page.
export default async function OrgLayout({
  children,
  panel,
  params,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const { workspace, role, profile, user } = await requireMember(org);
  const [workspaces, nav, myWorkCount] = await Promise.all([
    getMyWorkspaces(),
    getNav(workspace.id),
    getMyWorkCount(workspace.id),
  ]);
  const railProps = {
    org,
    workspaceName: workspace.name,
    nav,
    canEdit: isEditorRole(role),
    canManage: isAdminRole(role),
    myWorkCount,
  };
  return (
    <ShellProvider>
      <ShellPrefsScript />
      <div className="app-shell">
        <div className="rail-col">
          <Rail {...railProps} />
        </div>
        <PanelFrame>{panel}</PanelFrame>
        <div className="flex min-w-0 flex-col">
          <TopBar
            current={workspace}
            workspaces={workspaces}
            canManage={isAdminRole(role)}
            me={{
              displayName: profile.display_name,
              initials: profile.initials,
              color: profile.color,
              email: user.email ?? '',
            }}
          />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
      <PhoneNav {...railProps} />
    </ShellProvider>
  );
}
