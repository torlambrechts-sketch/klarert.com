'use client';

import Link from 'next/link';
import { Package, Send, TriangleAlert } from 'lucide-react';
import {
  EDGE_KIND_LABEL,
  flowCounts,
  layoutWorkspace,
  type EdgeKind,
  type FlowFolder,
  type WorkspaceGraph,
} from '@/engine/flow';
import { cn } from '@/lib/utils';
import { ToneSymbol } from './flow-bits';
import { mapCanvas } from './sheet-map';

// Build › Design, the map (docs/05 §4): one box per sheet in columns by folder (Registers domains first), lines for
// link fields, items created or updated on another sheet and buttons, outside destinations as badges. Laid out
// automatically, never dragged. A box is a link to the sheet's Design tab; the Connections table is the same content
// in words and the accessible default.

const DASH: Record<EdgeKind, string | undefined> = {
  link: undefined,
  create: '6 4',
  button: '2 3',
  update: '8 3 2 3',
  sync: '6 4',
};

export function WorkspaceMap({
  org,
  graph,
  folders,
  focus,
}: {
  org: string;
  graph: WorkspaceGraph;
  folders: FlowFolder[];
  focus?: string | null;
}) {
  const l = layoutWorkspace(graph.nodes, graph.edges, folders);
  const kinds = [...new Set(graph.edges.map((e) => e.kind))];
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className={cn(mapCanvas, 'max-h-[70dvh]')} data-testid="workspace-map">
        <div className="relative" style={{ width: l.width, height: l.height }}>
          <svg
            aria-hidden
            width={l.width}
            height={l.height}
            className="absolute inset-0 overflow-visible"
          >
            {l.paths.map((p) => {
              const e = graph.edges.find((x) => x.id === p.ref)!;
              const problem = e.health?.tone === 'crit' || e.health?.tone === 'warn';
              return (
                <path
                  key={p.id}
                  d={p.d}
                  fill="none"
                  stroke={problem ? 'var(--warn)' : 'var(--line-strong)'}
                  strokeWidth={1.5}
                  strokeDasharray={DASH[e.kind]}
                />
              );
            })}
          </svg>
          {l.columns.map((c) => (
            <span
              key={c.id}
              aria-hidden
              className="text-muted-foreground text-label-11-mono absolute truncate tracking-[0.08em] uppercase"
              style={{ left: c.x, top: 18, width: c.w }}
            >
              {c.title}
            </span>
          ))}
          <ul className="m-0 list-none p-0" aria-label="Sheets on the map">
            {l.boxes.map((b) => {
              const n = graph.nodes.find((x) => x.id === b.id)!;
              return (
                <li
                  key={b.id}
                  className="absolute"
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                >
                  <Link
                    href={`/${org}/s/${n.id}?view=design`}
                    data-testid="map-sheet"
                    className={cn(
                      'focus-visible:outline-focus bg-background-100 hover:border-line-strong flex h-full flex-col justify-between gap-1 rounded-lg border px-3 py-2 transition-colors duration-150 focus-visible:outline-2',
                      n.context ? 'border-line border-dashed opacity-70' : 'border-line',
                      focus === n.id && 'ring-focus ring-2',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-label-13 min-w-0 flex-1 truncate font-semibold">
                        {n.name}
                      </span>
                      {n.tone && n.tone !== 'ok' && n.tone !== 'idle' ? (
                        <ToneSymbol tone={n.tone} />
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-label-12">
                      <span aria-hidden>
                        {n.inputs} in · {n.logic} rules · {n.outputs} out
                      </span>
                      <span className="sr-only">{flowCounts(n)}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                      {n.packTitle ? (
                        <span className="text-muted-foreground text-label-11 flex min-w-0 items-center gap-1">
                          <Package className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">{n.packTitle}</span>
                        </span>
                      ) : null}
                      {n.differs ? (
                        <span className="text-warn text-label-11 flex shrink-0 items-center gap-0.5">
                          <TriangleAlert className="size-3" aria-hidden /> Differs
                        </span>
                      ) : null}
                      {n.outside.map((o) => (
                        <span
                          key={o.destination}
                          className="border-line text-label-11 flex shrink-0 items-center gap-0.5 rounded-full border px-1.5"
                        >
                          <Send className="size-3" aria-hidden /> {o.label}
                          {o.count > 1 ? ` · ${o.count}` : ''}
                        </span>
                      ))}
                      {n.context ? (
                        <span className="sr-only">(connected, outside the filter)</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <figcaption className="text-muted-foreground text-copy-13 flex flex-wrap gap-x-4 gap-y-1">
        {kinds.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <svg aria-hidden width="28" height="6">
              <path
                d="M0 3 H28"
                stroke="var(--line-strong)"
                strokeWidth="1.5"
                strokeDasharray={DASH[k]}
              />
            </svg>
            {EDGE_KIND_LABEL[k]}
          </span>
        ))}
        <span>Dashed boxes: connected sheets outside the filter. Laid out automatically.</span>
      </figcaption>
    </figure>
  );
}
