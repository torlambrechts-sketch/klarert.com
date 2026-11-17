import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PrintButton } from '@/app/poster/[viewId]/print-button';
import { HealthLine, PackChip } from '@/components/design/flow-bits';
import { LeavesTable } from '@/components/design/leaves-lane';
import { canSeeLeaves, designParams, filterQuery } from '@/components/design/params';
import { ListCrumb } from '@/components/shell/data-list';
import { PageHeader } from '@/components/shell/page-header';
import {
  connectionRows,
  deriveSheetFlow,
  filterGraph,
  flowCounts,
  leavesRows,
  workspaceGraph,
  type FlowViewer,
} from '@/engine/flow';
import { formatDateTime } from '@/engine/fields/helpers';
import { requireMember } from '@/server/auth';
import { logDataFlowExport } from '@/server/commands/design';
import { readDesignWorld } from '@/server/design/read';
import { BRAND } from '@/lib/brand';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Design export · ${BRAND.product}` };

// The export for auditors (docs/05 §4, owner decision 15 Nov 2026): a printable page of one sheet's flow
// (?sheet=<id>), of the workspace's design with the page's filters, or of the "Leaves the system" record (?part=leaves),
// server-rendered from the same derivation. It prints to PDF from the browser (the shell is hidden in print), as the
// statement of applicability does: there is no server-side PDF path to reuse. Exporting the data-flow record is logged
// as the audit exports are (`audit.exported`, kind data_flow_record, with the filters used); the plain flow print and
// the workspace print are not.

const th = 'px-2 py-1.5 font-medium';
const td = 'px-2 py-1.5 align-top';

export default async function DesignPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org } = await params;
  const sp = await searchParams;
  const { supabase, workspace, user, role, profile } = await requireMember(org);
  const sheetId = typeof sp.sheet === 'string' ? sp.sheet : null;
  const part = sp.part === 'leaves' ? 'leaves' : 'all';
  const filter = designParams(sp);
  const { world } = await readDesignWorld(supabase, workspace.id, { userId: user.id, role });
  const now = new Date();
  const viewer: FlowViewer = { userId: user.id, role, now, timeZone: workspace.time_zone };
  const flow = sheetId ? deriveSheetFlow(world, sheetId, viewer) : null;
  const graph = filterGraph(workspaceGraph(world, viewer), filter, world);
  const kept = graph.nodes.filter((n) => !n.context);
  const leaves = canSeeLeaves(role)
    ? leavesRows(world, viewer, flow ? [flow.sheet.id] : kept.map((n) => n.id))
    : null;
  const back = flow
    ? `/${org}/s/${flow.sheet.id}?view=design`
    : `/${org}/design${filterQuery(filter).toString() ? `?${filterQuery(filter)}` : ''}`;
  const app = world.apps.find((a) => a.key === filter.app);
  const title = flow
    ? `Design of ${flow.sheet.name}`
    : part === 'leaves'
      ? 'Data-flow record: leaves the system'
      : app
        ? `Design of ${app.title}`
        : 'Workspace design';
  const scope = [
    filter.app ? `App: ${app?.title ?? filter.app}` : null,
    filter.pack
      ? `Pack: ${world.packs.find((p) => p.key === filter.pack)?.title ?? filter.pack}`
      : null,
    filter.group
      ? `Folder: ${world.folders.find((f) => f.id === filter.group)?.name ?? 'No folder'}`
      : null,
    filter.domain ? `Registers domain: ${filter.domain}` : null,
    filter.differs ? 'Only sheets that differ from their pack' : null,
  ].filter(Boolean);

  if (sheetId && !flow)
    return (
      <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
        <PageHeader crumb={<ListCrumb section="Design" page="Export" />} title="Design export" />
        <p role="alert" className="border-line rounded-lg border p-5">
          This sheet no longer exists or you cannot open it.
        </p>
      </main>
    );

  // the data-flow record is an export for auditors: who exported it, when and with which filters goes in the log
  if (!flow && part === 'leaves' && leaves) {
    const logged = await logDataFlowExport({
      org,
      app: filter.app,
      pack: filter.pack,
      group: filter.group,
      domain: filter.domain,
      differs: filter.differs,
      sheets: kept.length,
      destinations: leaves.length,
    });
    if (!logged.ok)
      return (
        <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
          <PageHeader crumb={<ListCrumb section="Design" page="Export" />} title="Design export" />
          <div
            role="alert"
            className="border-line flex flex-col items-start gap-3 rounded-lg border p-5"
          >
            <p className="m-0">
              The export could not be recorded in the activity log, so it was not made.{' '}
              {logged.error.message}
            </p>
            <Link
              href={`/${org}/design/print?${new URLSearchParams([...filterQuery(filter), ['part', 'leaves']]).toString()}`}
              className="border-line hover:bg-soft text-label-14 inline-flex h-[40px] items-center rounded-md border px-3.5 font-medium"
              prefetch={false}
            >
              Retry
            </Link>
          </div>
        </main>
      );
  }

  return (
    <main
      className="text-copy-13 flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px] print:gap-3 print:p-0"
      data-testid="design-print"
    >
      <style>{'@media print { @page { size: A4; margin: 12mm } }'}</style>
      <PageHeader
        crumb={
          <Link href={back} className="hover:text-ink flex items-center gap-1">
            <ArrowLeft className="size-3.5" aria-hidden /> Back to the design
          </Link>
        }
        title={title}
        description={`${workspace.name} · exported ${formatDateTime(now.toISOString(), workspace.time_zone)} by ${profile.display_name}. Derived from the configuration as it is now; addresses show their host only.`}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <PrintButton />
          </div>
        }
      />
      {scope.length ? <p className="m-0">Scope: {scope.join(' · ')}</p> : null}
      <p className="text-muted-foreground m-0 print:hidden">
        Print saves a PDF from the browser: choose “Save as PDF” as the printer.
      </p>

      {flow ? (
        <section aria-labelledby="print-flow" className="flex flex-col gap-2">
          <h2 id="print-flow" className="text-heading-16 m-0">
            Flow · {flowCounts(flow.counts)}
          </h2>
          <table className="w-full border-collapse" data-testid="print-flow">
            <thead className="bg-head text-muted-foreground text-label-12 text-left">
              <tr>
                <th scope="col" className={th}>
                  Step
                </th>
                <th scope="col" className={th}>
                  What
                </th>
                <th scope="col" className={th}>
                  Health
                </th>
                <th scope="col" className={th}>
                  Source
                </th>
              </tr>
            </thead>
            {flow.groups.map((g) => (
              <tbody key={g.id}>
                <tr className="border-line border-t">
                  <th
                    scope="rowgroup"
                    colSpan={4}
                    className="text-label-11-mono text-muted-foreground px-2 pt-2 pb-1 text-left tracking-[0.08em] uppercase"
                  >
                    {g.number} · {g.title}
                  </th>
                </tr>
                {g.steps.map((s) => (
                  <tr key={s.id} className="border-line break-inside-avoid border-t">
                    <td className={`${td} font-medium`}>{s.name}</td>
                    <td className={td}>
                      {s.subline}
                      {s.comingLater ? ' · Coming later' : ''}
                    </td>
                    <td className={td}>{s.health ? <HealthLine health={s.health} /> : '—'}</td>
                    <td className={td}>{s.pack ? <PackChip pack={s.pack} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </section>
      ) : part === 'all' ? (
        <>
          <section aria-labelledby="print-sheets" className="flex flex-col gap-2">
            <h2 id="print-sheets" className="text-heading-16 m-0">
              Sheets · {kept.length}
            </h2>
            <table className="w-full border-collapse" data-testid="print-sheets">
              <thead className="bg-head text-muted-foreground text-label-12 text-left">
                <tr>
                  <th scope="col" className={th}>
                    Sheet
                  </th>
                  <th scope="col" className={th}>
                    Folder
                  </th>
                  <th scope="col" className={th}>
                    Flow
                  </th>
                  <th scope="col" className={th}>
                    Pack
                  </th>
                </tr>
              </thead>
              <tbody>
                {kept.map((n) => (
                  <tr key={n.id} className="border-line break-inside-avoid border-t">
                    <td className={`${td} font-medium`}>
                      {n.name}
                      {n.differs ? ' · differs from pack' : ''}
                    </td>
                    <td className={td}>{n.folderName ?? 'No folder'}</td>
                    <td className={td}>
                      {flowCounts(n)}
                      {n.outside.length
                        ? ` · leaves to ${n.outside.map((o) => o.label).join(', ')}`
                        : ''}
                    </td>
                    <td className={td}>{n.packTitle ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section aria-labelledby="print-connections" className="flex flex-col gap-2">
            <h2 id="print-connections" className="text-heading-16 m-0">
              Connections · {graph.edges.length}
            </h2>
            <table className="w-full border-collapse" data-testid="print-connections">
              <thead className="bg-head text-muted-foreground text-label-12 text-left">
                <tr>
                  <th scope="col" className={th}>
                    From
                  </th>
                  <th scope="col" className={th}>
                    To
                  </th>
                  <th scope="col" className={th}>
                    Kind
                  </th>
                  <th scope="col" className={th}>
                    Health
                  </th>
                </tr>
              </thead>
              <tbody>
                {connectionRows(graph).map((r) => (
                  <tr key={r.id} className="border-line break-inside-avoid border-t">
                    <td className={td}>{r.from.name}</td>
                    <td className={td}>{r.to.name}</td>
                    <td className={td}>
                      {r.kindWords} · {r.via}
                    </td>
                    <td className={td}>{r.health ? <HealthLine health={r.health} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      <section aria-labelledby="print-leaves" className="flex flex-col gap-2">
        <h2 id="print-leaves" className="text-heading-16 m-0">
          Leaves the system
        </h2>
        {leaves ? (
          <LeavesTable org={org} rows={leaves} />
        ) : (
          <p className="text-muted-foreground m-0">
            Owners, admins and auditors see where data leaves the workspace.
          </p>
        )}
      </section>
    </main>
  );
}
