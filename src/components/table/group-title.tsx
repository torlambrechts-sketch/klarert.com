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
        className="focus-visible:outline-focus hover:bg-soft flex h-[32px] max-w-full items-center gap-[8px] rounded-md px-[4px] text-left focus-visible:outline-2"
      >
        {collapsed ? (
          <ChevronRight className="text-muted-foreground mr-1 size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="text-muted-foreground mr-1 size-4 shrink-0" aria-hidden />
        )}
        <span
          aria-hidden
          className="size-[8px] shrink-0 rounded-full"
          style={{ background: solidVar(group.color) }}
        />
        <span className="text-ink truncate text-[14px] font-semibold">{group.name}</span>
        <span className="bg-soft text-muted-foreground shrink-0 rounded-full px-[8px] py-px font-mono text-[12px] leading-[17px] font-semibold tabular-nums">
          {count === 1 ? '1 item' : `${count.toLocaleString('en-GB')} items`}
        </span>
        {donePct === null ? null : (
          <span className="text-muted-foreground shrink-0 text-[12.5px] tabular-nums">
            {donePct}% done
          </span>
        )}
      </button>
    </h2>
  );
}
