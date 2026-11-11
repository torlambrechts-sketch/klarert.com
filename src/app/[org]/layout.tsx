import { TopBar } from '@/components/shell/top-bar';
import { getMyWorkspaces, isAdminRole, requireMember } from '@/server/auth';

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const { workspace, role, profile, user } = await requireMember(org);
  const workspaces = await getMyWorkspaces();
  return (
    <div className="flex min-h-dvh flex-col">
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
      <div className="flex-1">{children}</div>
    </div>
  );
}
