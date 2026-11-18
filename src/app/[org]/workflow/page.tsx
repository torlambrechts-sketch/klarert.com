import { WorkflowScreen } from '@/components/workflow/workflow-screen';
import { ListCrumb } from '@/components/shell/data-list';
import { PageHeader } from '@/components/shell/page-header';
import { isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import { getWorkflow, type WorkflowData } from '@/server/repositories/workflow';

export const metadata = { title: 'Workflow · Compliance OS' };

// Workflow (docs/05 §4): every sheet's lifecycle by one of its status or label fields, as an expandable list (?sheet
// opens a sheet, ?field picks its field; the last choice is remembered per browser). Stages are the field's options;
// each shows its items, the overdue ones, the status rules that guard it and the automations that run when an item
// enters it. Moving an item uses setValues.
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
  const running = data
    ? data.rows.reduce(
        (n, r) =>
          n +
          (r.lifecycle
            ? r.lifecycle.stages.flatMap((s) => s.items).filter((i) => !i.done).length
            : 0),
        0,
      )
    : 0;
  const lifecycles = data ? data.rows.filter((r) => r.lifecycle).length : 0;
  return (
    <main className="flex w-full flex-col gap-0 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
      <PageHeader
        className="pb-[18px]"
        crumb={
          <ListCrumb
            section="Build"
            page="Workflow"
            badge={
              data
                ? `${lifecycles} ${lifecycles === 1 ? 'lifecycle' : 'lifecycles'} · ${running} running`
                : undefined
            }
          />
        }
        title="Workflow"
        description="The stages items move through, read from a status or label field of each sheet. Open a sheet to see its steps: what each stage needs, what runs when an item enters it and the items in it."
      />
      {data ? (
        <WorkflowScreen
          org={org}
          orgId={workspace.id}
          data={data}
          explicit={!!chosen.sheetId}
          canEdit={isEditorRole(role)}
          canManage={isAdminRole(role)}
        />
      ) : (
        <div
          role="alert"
          className="border-line bg-surface flex flex-col items-start gap-2 rounded-lg border p-5"
        >
          <p className="m-0">The workflow could not be loaded.</p>
          <a
            href={`/${org}/workflow`}
            className="border-line hover:bg-soft bg-surface text-14 inline-flex h-[40px] items-center rounded-md border px-3.5 font-medium transition-colors duration-150"
          >
            Retry
          </a>
        </div>
      )}
    </main>
  );
}
