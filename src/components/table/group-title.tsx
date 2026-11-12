'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Group } from '@/engine/types';
import { colorVar, solidVar } from '@/components/fields/shared';

/** Background of a group's title row: its label colour, lightly. */
export const groupTint = (color: string) => `color-mix(in srgb, ${colorVar(color)} 9%, white)`;

/**
 * A group's title (Table rows and phone cards): a heading with a button that collapses the group, its name in the
 * group colour and the item count, so colour is never the only signal.
 */
export function GroupTitle({
  group,
  count,
  collapsed,
  onToggle,
}: {
  group: Group;
  count: number;
  collapsed: boolean;
  onToggle(): void;
}) {
  return (
    <h2 className="m-0 min-w-0">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="focus-visible:outline-focus flex h-9 max-w-full items-center gap-2 rounded-md px-2 text-left hover:bg-white/70 focus-visible:outline-2"
      >
        {collapsed ? (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        )}
        <span className="text-cell truncate font-bold" style={{ color: solidVar(group.color) }}>
          {group.name}
        </span>
        <span className="text-muted-foreground text-meta shrink-0 font-semibold tabular-nums">
          {count === 1 ? '1 item' : `${count.toLocaleString('en-GB')} items`}
        </span>
      </button>
    </h2>
  );
}
