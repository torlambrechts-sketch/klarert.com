'use client';

import { ChevronDown } from 'lucide-react';
import type { Group } from '@/engine/types';
import { solidVar } from '@/components/fields/shared';
import { cn } from '@/lib/utils';

/**
 * A group's title (Table rows and phone cards, docs/18 §5): a heading whose button collapses the group
 * (`aria-expanded`): a 32 px chevron and the name in the group colour, then "n items" and "· m shown" while a
 * filter hides some, and the share done. A collapsed group can show a status battery after it. Colour is never the
 * only signal: the name and the counts are words.
 */
export function GroupTitle({
  group,
  count,
  shown,
  donePct = null,
  collapsed,
  onToggle,
  after,
}: {
  group: Group;
  /** Items of the group. */
  count: number;
  /** Items shown (filters, search); "· m shown" when it differs from `count`. */
  shown?: number;
  /** Share of the group's items that are done; null when the sheet has no done-capable field. */
  donePct?: number | null;
  collapsed: boolean;
  onToggle(): void;
  /** Shown after the title (a collapsed group's battery). */
  after?: React.ReactNode;
}) {
  const color = solidVar(group.color);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="m-0 min-w-0">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="focus-visible:outline-focus group/title flex h-8 max-w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-2"
        >
          <span
            className="group-hover/title:bg-panel grid size-8 shrink-0 place-items-center rounded-md"
            style={{ color }}
          >
            <ChevronDown
              className={cn('size-5 transition-transform', collapsed && '-rotate-90')}
              strokeWidth={2.25}
              aria-hidden
            />
          </span>
          <span className="text-18 min-w-0 truncate font-semibold" style={{ color }}>
            {group.name}
          </span>
          <span className="text-muted-foreground text-13 shrink-0 pl-1 tabular-nums">
            {count === 1 ? '1 item' : `${count.toLocaleString('en-GB')} items`}
            {shown !== undefined && shown !== count
              ? ` · ${shown.toLocaleString('en-GB')} shown`
              : ''}
          </span>
          {donePct === null ? null : (
            <span className="text-muted-foreground text-13 shrink-0 tabular-nums">
              · {donePct}% done
            </span>
          )}
        </button>
      </h2>
      {after}
    </div>
  );
}
