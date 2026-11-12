'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Group } from '@/engine/types';
import { solidVar } from '@/components/fields/shared';

/**
 * A group's title (Table rows and phone cards): a heading with a button that collapses the group, a dot in the group
 * colour, the name and the item count, so colour is never the only signal.
 */
export function GroupTitle({
  group,
  count,
  donePct = null,
  collapsed,
  onToggle,
}: {
  group: Group;
  count: number;
  /** Share of the group's items that are done; null when the sheet has no done-capable field. */
  donePct?: number | null;
  collapsed: boolean;
  onToggle(): void;
}) {
  return (
    <h2 className="m-0 min-w-0">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="focus-visible:outline-focus group/title flex h-[32px] max-w-full items-center gap-2 rounded-md text-left focus-visible:outline-2"
      >
        <span className="group-hover/title:bg-soft grid size-6 shrink-0 place-items-center rounded-md">
          {collapsed ? (
            <ChevronRight className="text-muted-foreground size-4" strokeWidth={2.25} aria-hidden />
          ) : (
            <ChevronDown className="text-muted-foreground size-4" strokeWidth={2.25} aria-hidden />
          )}
        </span>
        <span className="text-ink text-label-14 flex min-w-0 items-center gap-2 px-1 py-0.5 font-semibold">
          <span
            aria-hidden
            className="size-[8px] shrink-0 rounded-full"
            style={{ background: solidVar(group.color) }}
          />
          <span className="truncate">{group.name}</span>
        </span>
        <span className="bg-soft text-muted-foreground text-label-12-mono shrink-0 rounded-full px-[8px] py-px leading-[17px] font-semibold tabular-nums">
          {count === 1 ? '1 item' : `${count.toLocaleString('en-GB')} items`}
        </span>
        {donePct === null ? null : (
          <span className="text-muted-foreground text-label-13 shrink-0 tabular-nums">
            {donePct}% done
          </span>
        )}
      </button>
    </h2>
  );
}
