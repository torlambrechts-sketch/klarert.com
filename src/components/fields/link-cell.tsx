'use client';

import { useEffect, useRef, useState } from 'react';
import { Tooltip } from 'radix-ui';
import type { Ctx, Item } from '@/engine/types';
import { Empty } from './kit';
import type { CellProps } from './types';

// The cell of link, requirement and control link fields (docs/03 §3.3, §3.4): the first linked item as a chip and
// "+N" for the rest, on one line in the row's height. Hovering the cell, or the cell being the grid's active cell
// while the grid has keyboard focus, shows every linked item in a tooltip; the cell's accessible name lists them all.

type Linked = { id: string; item: Item | undefined };

/** "CA-014 Supplier audit", or what an archived or hidden target reads as. */
export const linkedLabel = (t: Item | undefined) =>
  t ? `${t.displayId} ${t.name}` : 'Archived or hidden item';

/** What the cell shows: the first linked item, how many more, and the full list for the tooltip and screen readers. */
export function linkSummary(ids: string[], ctx: Pick<Ctx, 'item'>) {
  const all: Linked[] = ids.map((id) => ({ id, item: ctx.item(id) }));
  return {
    first: all[0],
    more: Math.max(0, all.length - 1),
    all,
    label: all.map((l) => linkedLabel(l.item)).join(', '),
  };
}

/** True while the grid around `el` has keyboard focus; checked only for the active cell. */
function useGridFocused(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const grid = active ? ref.current?.closest<HTMLElement>('[role="grid"]') : null;
    if (!grid) {
      setFocused(false);
      return;
    }
    const sync = () => setFocused(grid.contains(document.activeElement));
    sync();
    grid.addEventListener('focusin', sync);
    grid.addEventListener('focusout', sync);
    return () => {
      grid.removeEventListener('focusin', sync);
      grid.removeEventListener('focusout', sync);
    };
  }, [ref, active]);
  return focused;
}

function LinkChip({ target }: { target: Item | undefined }) {
  return (
    <span className="border-line bg-soft text-label-12 inline-flex max-w-[11rem] min-w-0 items-center gap-1 rounded-full border px-2 py-0.5">
      <span className="text-label-12-mono shrink-0 font-medium whitespace-nowrap">
        {target?.displayId ?? '—'}
      </span>
      {target ? <span className="truncate">{target.name}</span> : null}
    </span>
  );
}

export function LinkCell({ item, field, ctx, active = false }: CellProps) {
  const ids = ctx.links(item.id, field.id);
  const ref = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const focused = useGridFocused(ref, active && ids.length > 1);
  if (ids.length === 0) return <Empty />;
  const s = linkSummary(ids, ctx);
  const shown = (
    <span ref={ref} className="flex min-w-0 items-center gap-1 overflow-hidden">
      <span aria-hidden className="flex min-w-0 items-center gap-1">
        <LinkChip target={s.first!.item} />
        {s.more ? (
          <span
            data-testid="link-more"
            className="border-line bg-soft text-label-11-mono shrink-0 rounded-full border px-1.5 py-0.5 font-semibold"
          >
            +{s.more}
          </span>
        ) : null}
      </span>
      <span className="sr-only">
        {ids.length === 1 ? s.label : `${ids.length} linked items: ${s.label}`}
      </span>
    </span>
  );
  // one link: the chip says it all; a native title covers a truncated name
  if (!s.more)
    return (
      <span title={s.label} className="flex min-w-0">
        {shown}
      </span>
    );
  return (
    // information only: the tooltip closes as the pointer leaves the cell (no hoverable content to reach)
    <Tooltip.Provider delayDuration={300} skipDelayDuration={150} disableHoverableContent>
      <Tooltip.Root open={hovered || focused} onOpenChange={setHovered}>
        <Tooltip.Trigger asChild>
          {/* not a control: the grid keeps focus and points at the cell; the tooltip only repeats the sr-only list */}
          <span className="flex min-w-0">{shown}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={16}
            className="bg-popover text-popover-foreground border-line shadow-tooltip z-50 max-w-[min(20rem,calc(100vw-32px))] rounded-md border px-3 py-2"
          >
            <p className="text-label-12 text-muted-foreground mb-1">{ids.length} linked items</p>
            <ul className="flex flex-col gap-1">
              {s.all.map((l) => (
                <li key={l.id} className="text-label-13 flex min-w-0 items-baseline gap-2">
                  <span className="text-label-12-mono shrink-0 font-medium">
                    {l.item?.displayId ?? '—'}
                  </span>
                  <span className="truncate">{l.item?.name ?? 'Archived or hidden item'}</span>
                </li>
              ))}
            </ul>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
