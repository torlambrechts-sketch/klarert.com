'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FileDown, TriangleAlert } from 'lucide-react';
import {
  connectionRows,
  flowCounts,
  filterChoices,
  filterGraph,
  hasFilter,
  leavesRows,
  workspaceGraph,
  type FlowViewer,
  type FlowWorld,
  type GraphFilter,
} from '@/engine/flow';
import type { Role } from '@/engine/types';
import { Segmented, toolbarSelectClass } from '@/components/shell/data-list';
import { Button } from '@/components/ui/button';
import { HealthLine } from './flow-bits';
import { LeavesLane } from './leaves-lane';
import { WorkspaceMap } from './workspace-map';
import { canSeeLeaves, filterQuery, type DesignParams } from './params';

// Build › Design (docs/05 §4; owner decision 15 Nov 2026): the whole workspace as a map of sheets and as a
// Connections table (the accessible default and the only view under 760 px), from the same derivation as each sheet's
// Design tab. Filters are in the URL, so an app's or a folder's design is a link: ?app=, ?pack=, ?group=, ?domain=,
// ?differs=1; ?show=map draws the map. A sheet opens its Design tab. Below: "Leaves the system".

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 759px)');
    const set = () => setNarrow(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);
  return narrow;
}

export function WorkspaceDesign({
  org,
  world,
  role,
  userId,
  timeZone,
  params,
}: {
  org: string;
  world: FlowWorld;
  role: Role;
  userId: string;
  timeZone: string;
  params: DesignParams;
}) {
  const router = useRouter();
  const path = usePathname();
  const narrow = useNarrow();
  const viewer: FlowViewer = useMemo(
    () => ({ userId, role, now: new Date(), timeZone }),
    [userId, role, timeZone],
  );
  const graph = useMemo(() => workspaceGraph(world, viewer), [world, viewer]);
  const choices = useMemo(() => filterChoices(world, graph), [world, graph]);
  const filter: GraphFilter = {
    app: params.app,
    pack: params.pack,
    group: params.group,
    domain: params.domain,
    differs: params.differs,
  };
  const shown = useMemo(
    () => filterGraph(graph, filter, world),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, world, params.app, params.pack, params.group, params.domain, params.differs],
  );
  const rows = useMemo(() => connectionRows(shown), [shown]);
  const kept = shown.nodes.filter((n) => !n.context);
  const leaves = useMemo(
    () =>
      leavesRows(
        world,
        viewer,
        kept.map((n) => n.id),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, viewer, shown],
  );
  const show = narrow ? 'table' : (params.show ?? 'table');
  const go = (next: DesignParams) => {
    const q = filterQuery(next).toString();
    router.replace(q ? `${path}?${q}` : path, { scroll: false });
  };
  const set = (patch: Partial<DesignParams>) => go({ ...params, ...patch });
  const exportQuery = filterQuery({ ...filter }).toString();
  const app = world.apps.find((a) => a.key === params.app);

  const select = (
    label: string,
    value: string | null | undefined,
    options: { id: string; name: string }[],
    all: string,
    on: (v: string | null) => void,
  ) => (
    <label className="flex min-w-0 flex-col gap-1 sm:w-auto">
      <span className="text-label-12 text-muted-foreground font-medium">{label}</span>
      <select
        className={toolbarSelectClass}
        value={value ?? ''}
        onChange={(e) => on(e.target.value || null)}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">
          {choices.apps.length
            ? select(
                'App',
                params.app,
                choices.apps.map((a) => ({ id: a.key, name: a.title })),
                'All apps',
                (v) => set({ app: v }),
              )
            : null}
          {choices.packs.length
            ? select(
                'Pack',
                params.pack,
                choices.packs.map((p) => ({ id: p.key, name: p.title })),
                'All packs',
                (v) => set({ pack: v }),
              )
            : null}
          {select('Folder', params.group, choices.groups, 'All folders', (v) => set({ group: v }))}
          {choices.domains.length
            ? select(
                'Registers domain',
                params.domain,
                choices.domains.map((d) => ({ id: d, name: d })),
                'All domains',
                (v) => set({ domain: v }),
              )
            : null}
          <label className="text-label-14 flex h-[40px] items-center gap-2 sm:self-end">
            <input
              type="checkbox"
              checked={!!params.differs}
              onChange={(e) => set({ differs: e.target.checked })}
            />
            Differs from pack
          </label>
          {hasFilter(filter) ? (
            <Button
              type="button"
              variant="ghost"
              className="sm:self-end"
              onClick={() => go({ show: params.show })}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-copy-13 m-0" aria-live="polite">
            {app ? `${app.title}: ` : ''}
            {kept.length} {kept.length === 1 ? 'sheet' : 'sheets'} · {rows.length}{' '}
            {rows.length === 1 ? 'connection' : 'connections'}
            {hasFilter(filter) && shown.nodes.length > kept.length
              ? ` · ${shown.nodes.length - kept.length} connected sheets outside the filter`
              : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {narrow ? null : (
              <Segmented
                label="Show the design as"
                value={show}
                options={[
                  { id: 'table', label: 'Connections' },
                  { id: 'map', label: 'Map' },
                ]}
                onChange={(v) => set({ show: v })}
              />
            )}
            <Button asChild variant="outline">
              <Link
                href={`/${org}/design/print${exportQuery ? `?${exportQuery}` : ''}`}
                data-testid="design-export"
              >
                <FileDown aria-hidden /> Export
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {kept.length === 0 ? (
        <div className="border-line flex flex-col items-start gap-2 rounded-lg border border-dashed p-5">
          <p className="m-0">
            {hasFilter(filter) ? 'No sheets match these filters.' : 'No sheets yet.'}
          </p>
          {hasFilter(filter) ? (
            <Button type="button" variant="outline" onClick={() => go({ show: params.show })}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : show === 'map' ? (
        <WorkspaceMap org={org} graph={shown} folders={world.folders} focus={params.focus} />
      ) : (
        <>
          <section aria-labelledby="design-sheets" className="flex flex-col gap-2">
            <h2 id="design-sheets" className="text-heading-16 m-0">
              Sheets
            </h2>
            <div className="border-line relative overflow-x-auto rounded-lg border">
              <table className="text-copy-13 w-full border-collapse" data-testid="design-sheets">
                <thead className="bg-head text-muted-foreground text-label-12 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Sheet
                    </th>
                    <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                      Folder
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Flow
                    </th>
                    <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                      Pack
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {kept.map((n) => (
                    <tr
                      key={n.id}
                      className={`border-line border-t align-top ${params.focus === n.id ? 'bg-sel' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/${org}/s/${n.id}?view=design`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {n.name}
                        </Link>
                        {n.differs ? (
                          <span className="text-warn text-label-12 mt-0.5 flex items-center gap-1">
                            <TriangleAlert className="size-3" aria-hidden /> Differs from pack
                          </span>
                        ) : null}
                      </td>
                      <td className="text-muted-foreground hidden px-3 py-2 sm:table-cell">
                        {n.folderName ?? 'No folder'}
                      </td>
                      <td className="px-3 py-2">
                        {flowCounts(n)}
                        {n.outside.length ? (
                          <span className="text-muted-foreground block">
                            Leaves to {n.outside.map((o) => o.label).join(', ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-muted-foreground hidden px-3 py-2 md:table-cell">
                        {n.packTitle ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="design-connections" className="flex flex-col gap-2">
            <h2 id="design-connections" className="text-heading-16 m-0">
              Connections
            </h2>
            {rows.length === 0 ? (
              <p className="border-line text-muted-foreground text-copy-13 m-0 rounded-lg border border-dashed px-3 py-3">
                No links, created items or buttons between these sheets yet.
              </p>
            ) : (
              <div className="border-line relative overflow-x-auto rounded-lg border">
                <table
                  className="text-copy-13 w-full border-collapse"
                  data-testid="design-connections"
                >
                  <thead className="bg-head text-muted-foreground text-label-12 text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        From
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        To
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Kind
                      </th>
                      <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                        Health
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-line border-t align-top">
                        <td className="px-3 py-2">
                          <Link
                            href={`/${org}/s/${r.from.id}?view=design`}
                            className="underline-offset-2 hover:underline"
                          >
                            {r.from.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/${org}/s/${r.to.id}?view=design`}
                            className="underline-offset-2 hover:underline"
                          >
                            {r.to.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {r.kindWords}
                          <span className="text-muted-foreground block">{r.via}</span>
                          {r.health ? (
                            <HealthLine health={r.health} className="mt-1 md:hidden" />
                          ) : null}
                        </td>
                        <td className="hidden px-3 py-2 md:table-cell">
                          {r.health ? (
                            <HealthLine health={r.health} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {canSeeLeaves(role) ? (
        <LeavesLane
          org={org}
          rows={leaves}
          exportHref={`/${org}/design/print?${new URLSearchParams([...filterQuery(filter), ['part', 'leaves']]).toString()}`}
        />
      ) : (
        <p className="text-muted-foreground text-copy-13 m-0">
          Owners, admins and auditors see where data leaves the workspace.
        </p>
      )}
    </div>
  );
}
