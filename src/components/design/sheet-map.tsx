'use client';

import { layoutSheetMap, type FlowStep, type SheetFlow } from '@/engine/flow';
import { cn } from '@/lib/utils';
import { STEP_ICON, ToneSymbol } from './flow-bits';

// The Map toggle of the Design tab (docs/05 §3.8; the board's option 1e): the same steps as the list, drawn as a hub and
// spoke around the sheet, laid out automatically and read-only. The list is its text twin, so the drawing is one image
// for assistive technology with a summary; nothing here can be dragged or edited.

const CREATES = new Set<FlowStep['kind']>([
  'create_out',
  'update_out',
  'automation_in',
  'button_in',
]);

export const mapCanvas =
  'border-line bg-page relative overflow-auto rounded-lg border [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:16px_16px]';

export function SheetMap({ flow }: { flow: SheetFlow }) {
  const l = layoutSheetMap(flow);
  const summary = `Map of ${flow.sheet.name}: ${flow.counts.inputs} inputs on the left, ${flow.counts.outputs} outputs on the right, ${flow.counts.relations} relations above and ${flow.counts.logic} logic steps below. The list shows the same steps as text.`;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className={mapCanvas} data-testid="sheet-map">
        <div
          role="img"
          aria-label={summary}
          className="relative"
          style={{ width: l.width, height: l.height }}
        >
          <svg
            aria-hidden
            width={l.width}
            height={l.height}
            className="absolute inset-0 overflow-visible"
          >
            {l.paths.map((p) => {
              const node = l.nodes.find((n) => n.id === p.ref);
              return (
                <path
                  key={p.id}
                  d={p.d}
                  fill="none"
                  stroke="var(--line-strong)"
                  strokeWidth={1.5}
                  strokeDasharray={node && CREATES.has(node.step.kind) ? '5 4' : undefined}
                />
              );
            })}
          </svg>
          {l.labels.map((lab) => (
            <span
              key={lab.side}
              aria-hidden
              className="text-muted-foreground text-12 absolute font-mono tracking-[0.08em] uppercase"
              style={{ left: lab.x, top: lab.y - 12 }}
            >
              {lab.title}
            </span>
          ))}
          <div
            aria-hidden
            className="bg-ink absolute flex flex-col items-center justify-center gap-1 rounded-xl px-4 text-center text-white"
            style={{ left: l.hub.x, top: l.hub.y, width: l.hub.w, height: l.hub.h }}
          >
            <span className="text-14 w-full truncate font-semibold">{flow.sheet.name}</span>
            <span className="text-12 text-faint">
              {flow.counts.columns} columns · {flow.counts.relations} relations
            </span>
          </div>
          {l.nodes.map((n) => {
            const Icon = STEP_ICON[n.step.kind];
            const tone = n.step.health?.tone;
            return (
              <div
                key={n.id}
                aria-hidden
                data-testid="map-node"
                className={cn(
                  'border-line bg-surface absolute flex items-center gap-2 rounded-full border px-3',
                  n.step.pack?.state === 'changed' && 'border-warn/50',
                )}
                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              >
                <Icon className="text-muted-foreground size-3.5 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-13 truncate font-medium">{n.step.name}</span>
                  <span className="text-muted-foreground text-12 truncate">{n.step.subline}</span>
                </span>
                {tone === 'warn' || tone === 'crit' || tone === 'off' || tone === 'test' ? (
                  <ToneSymbol tone={tone} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <figcaption className="text-muted-foreground text-13 flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <svg aria-hidden width="24" height="6">
            <path d="M0 3 H24" stroke="var(--line-strong)" strokeWidth="1.5" />
          </svg>
          Feeds, links or runs on the sheet
        </span>
        <span className="flex items-center gap-1.5">
          <svg aria-hidden width="24" height="6">
            <path
              d="M0 3 H24"
              stroke="var(--line-strong)"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          </svg>
          Creates or updates items on another sheet
        </span>
        <span>Laid out automatically. Use the list to open a step.</span>
      </figcaption>
    </figure>
  );
}
