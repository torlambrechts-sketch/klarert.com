import { WorkflowScreen } from '@/components/workflow/workflow-screen';
import { PageHeader } from '@/components/shell/page-header';
import { isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import { getWorkflow, type WorkflowData } from '@/server/repositories/workflow';

export const metadata = { title: 'Workflow · Compliance OS' };

// Workflow (docs/05 §4): the lifecycle of any sheet by one of its status or label fields (?sheet, ?field; the last
// choice is remembered per browser). Stages are the field's options; each shows its items, the overdue ones, the
// status rules that guard it and the automations that run when an item enters it. Moving an item uses setValues.
export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ sheet?: string; field?: string }>;
}) {
  const { org } = await params;
  const sp = await searchParams;
  const { workspace, supabase, user, role } = await requireMember(org);
  const chosen = {
    sheetId: typeof sp.sheet === 'string' && sp.sheet ? sp.sheet : null,
    fieldKey: typeof sp.field === 'string' && sp.field ? sp.field : null,
  };
  let data: WorkflowData | null = null;
  try {
    data = await getWorkflow(
      supabase,
      workspace.id,
      { timeZone: workspace.time_zone, userId: user.id, isAdmin: isAdminRole(role) },
      chosen,
    );
  } catch {
    data = null;
  }
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        crumb="Build"
        title={data?.sheet && data.lifecycle ? `${data.sheet.name} lifecycle` : 'Workflow'}
        description="The stages an item moves through, read from a status or label field of any sheet: what each stage holds, what it needs and what happens when an item enters it."
      />
      {data ? (
        <WorkflowScreen
          org={org}
          orgId={workspace.id}
          data={data}
          explicit={!!chosen.sheetId}
          canEdit={isEditorRole(role)}
        />
      ) : (
        <div
          role="alert"
          className="border-line flex flex-col items-start gap-2 rounded-xl border bg-white p-5 shadow-xs"
        >
          <p className="m-0">The workflow could not be loaded.</p>
          <a
            href={`/${org}/workflow`}
            className="border-line hover:bg-soft inline-flex h-9 items-center rounded-md border bg-white px-3.5 text-[13.5px] font-medium shadow-xs"
          >
            Retry
          </a>
        </div>
      )}
    </main>
  );
}
