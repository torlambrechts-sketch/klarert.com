'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { GroupSwatch } from './group-swatch';

export type GroupBlock = {
  id: string;
  name: string;
  color: string;
  count: number;
  items: { id: string; display_id: string; name: string }[];
};

/** Groups of a sheet as collapsible blocks with a read-only preview of their first items. */
export function GroupBlocks({ groups, itemLabel }: { groups: GroupBlock[]; itemLabel: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const open = !collapsed.has(g.id);
        return (
          <section
            key={g.id}
            aria-labelledby={`group-${g.id}`}
            className="border-line rounded-[var(--radius-card)] border border-l-4 bg-white"
            style={{ borderLeftColor: `var(--label-${g.color}, var(--label-grey))` }}
          >
            <h2 id={`group-${g.id}`} className="text-[15px] font-bold">
              <button
                type="button"
                onClick={() => toggle(g.id)}
                aria-expanded={open}
                aria-controls={`group-body-${g.id}`}
                className="hover:bg-soft flex w-full items-center gap-2 rounded-[var(--radius-card)] px-3 py-2.5 text-left"
              >
                {open ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
                <GroupSwatch color={g.color} />
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className="text-muted-foreground text-sm font-semibold tabular-nums">
                  {g.count === 1 ? '1 item' : `${g.count.toLocaleString('en-GB')} items`}
                </span>
              </button>
            </h2>
            <div
              id={`group-body-${g.id}`}
              hidden={!open}
              className="border-line border-t px-3 py-2"
            >
              {g.count === 0 ? (
                <p className="text-muted-foreground py-2 text-sm">No items yet.</p>
              ) : (
                <>
                  <ul className="divide-line divide-y" aria-label={`${itemLabel}s in ${g.name}`}>
                    {g.items.map((it) => (
                      <li key={it.id} className="flex items-baseline gap-3 py-1.5">
                        <span className="text-muted-foreground w-20 shrink-0 font-mono text-xs">
                          {it.display_id}
                        </span>
                        <span className="min-w-0 break-words">{it.name}</span>
                      </li>
                    ))}
                  </ul>
                  {g.count > g.items.length ? (
                    <p className="text-muted-foreground pt-2 text-sm">
                      Showing the first {g.items.length} of {g.count.toLocaleString('en-GB')}.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
