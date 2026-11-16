import { designParams } from '@/components/design/params';
import { WorkspaceDesign } from '@/components/design/workspace-design';
import { ListCrumb } from '@/components/shell/data-list';
import { PageHeader } from '@/components/shell/page-header';
import { requireMember } from '@/server/auth';
import { readDesignWorld, type DesignRead } from '@/server/design/read';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Design · ${BRAND.product}` };
export const dynamic = 'force-dynamic';

// Build › Design (docs/05 §4, owner decision 15 Nov 2026): every sheet the person can read and how they connect,
// derived from configuration (never item rows), as a Connections table or a map. Filters in the URL: ?app=, ?pack=,
// ?group= (a folder, or "none"), ?domain=, ?differs=1, ?show=map; ?focus=<sheet> marks the sheet you came from.

export default async function DesignPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org } = await params;
  const sp = await searchParams;
  const { supabase, workspace, user, role } = await requireMember(org);
  let read: DesignRead | null = null;
  try {
    read = await readDesignWorld(supabase, workspace.id, { userId: user.id, role });
  } catch {
    read = null;
  }
  const sheets = read?.world.sheets.length ?? 0;
  return (
    <main className="flex w-full min-w-0 flex-col gap-0 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
      <PageHeader
        className="pb-[18px]"
        crumb={
          <ListCrumb
            section="Build"
            page="Design"
            badge={read ? `${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}` : undefined}
          />
        }
        title="Design"
        description="How your sheets connect: what feeds each one, the rules that run on it and where its data goes. Open a sheet to see its flow step by step and change a step with its own editor."
      />
      {read ? (
        <WorkspaceDesign
          org={org}
          world={read.world}
          role={role}
          userId={user.id}
          timeZone={workspace.time_zone}
          params={designParams(sp)}
        />
      ) : (
        <div
          role="alert"
          className="border-line bg-background-100 flex flex-col items-start gap-2 rounded-lg border p-5"
        >
          <p className="m-0">The design could not be loaded.</p>
          <a
            href={`/${org}/design`}
            className="border-line hover:bg-soft bg-background-100 text-label-14 inline-flex h-[40px] items-center rounded-md border px-3.5 font-medium transition-colors duration-150"
          >
            Retry
          </a>
        </div>
      )}
    </main>
  );
}
