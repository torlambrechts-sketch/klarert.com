import { redirect } from 'next/navigation';
import { FirstDashboard } from '@/components/dashboards/first-dashboard';
import { PageHeader } from '@/components/shell/page-header';
import { isEditorRole, requireMember } from '@/server/auth';
import { listDashboards } from '@/server/repositories/dashboards';

export const metadata = { title: 'Dashboards · Compliance OS' };

// Dashboards (docs/05 §4): opens the first dashboard. A workspace without one gets "Compliance overview", built from
// its sheets by the seedDashboard command, the first time an editor opens the page.
export default async function DashboardsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { workspace, supabase, role } = await requireMember(org);
  const list = await listDashboards(supabase, workspace.id);
  if (list[0]) redirect(`/${org}/dashboards/${list[0].id}`);
  return (
    <main className="mx-auto flex w-full max-w-[1184px] flex-col gap-4 px-4 pt-6 pb-8 sm:px-7 sm:pt-[42px]">
      <PageHeader
        crumb="Insights"
        title="Dashboards"
        description="Widgets read live from your sheets, the evidence library and the run log."
      />
      <FirstDashboard org={org} canEdit={isEditorRole(role)} />
    </main>
  );
}
