'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Check, ChevronsUpDown, Layers, X } from 'lucide-react';
import type { SheetData } from '@/engine/sheet-data';
import { NewGroupForm } from '@/components/sheets/new-group-form';
import { GroupSwatch } from '@/components/sheets/group-swatch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// "Show one group" (docs/05 §2.2, §3): All groups or one group with its item count, kept in ?group=; editors add a
// group from the same menu. Replaces the former groups panel.

export function GroupSelect({
  org,
  data,
  onlyGroup,
  canEdit,
  archived,
}: {
  org: string;
  data: SheetData;
  onlyGroup: string | null;
  canEdit: boolean;
  archived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const params = useSearchParams();
  const groups = [...data.groups].sort((a, b) => (a.position < b.position ? -1 : 1));
  const count = (id: string | null) =>
    id ? data.items.filter((i) => i.groupId === id).length : data.items.length;
  const current = groups.find((g) => g.id === onlyGroup) ?? null;
  const href = (id: string | null) => {
    const q = new URLSearchParams(params.toString());
    q.delete('item');
    if (id) q.set('group', id);
    else q.delete('group');
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const row = (id: string | null, label: string, mark: React.ReactNode) => {
    const on = (id ?? null) === (current?.id ?? null);
    return (
      <li key={id ?? 'all'}>
        <Link
          href={href(id)}
          aria-current={on ? 'page' : undefined}
          onClick={() => setOpen(false)}
          className="hover:bg-soft text-label-14 flex h-[34px] items-center gap-2 rounded-sm px-2 aria-[current=page]:font-medium"
        >
          {mark}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="bg-soft text-ink text-label-12-mono rounded px-1.5 leading-[18px] tabular-nums">
            {count(id)}
          </span>
          {on ? (
            <Check className="size-4 shrink-0" aria-label="current" />
          ) : (
            <span className="w-4" />
          )}
        </Link>
      </li>
    );
  };
  return (
    // 1 px under the control, as the design's chips row has: the toolbar's first row is 39 px tall
    <div className="flex items-center pb-px">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            'border-line hover:bg-subtle bg-background-100 text-label-14 flex h-[38px] max-w-[260px] min-w-[170px] items-center gap-2 rounded-md border pr-2.5 pl-3',
            current && 'border-faint',
          )}
        >
          {current ? (
            <GroupSwatch color={current.color} className="size-2 rounded-full" />
          ) : (
            <Layers className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {current ? current.name : 'All groups'}
          </span>
          <span className="bg-soft text-muted-foreground text-label-11.5-mono rounded-[4px] px-[5px] leading-[18px] tabular-nums">
            {count(current?.id ?? null)}
          </span>
          <span className="sr-only">, show one group</span>
          <ChevronsUpDown className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px] p-1">
          <p className="text-muted-foreground text-label-12 m-0 px-2 pt-1.5 pb-1 font-medium">
            Groups
          </p>
          <nav aria-label="Groups">
            <ul className="m-0 flex list-none flex-col gap-px p-0">
              {row(
                null,
                'All groups',
                <Layers className="text-muted-foreground size-[15px] shrink-0" aria-hidden />,
              )}
              {groups.map((g) =>
                row(g.id, g.name, <GroupSwatch color={g.color} className="size-2 rounded-full" />),
              )}
            </ul>
          </nav>
          {canEdit && !archived ? (
            <div className="border-line mt-1 border-t px-1 pt-1">
              <NewGroupForm org={org} sheetId={data.sheet.id} compact />
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {current ? (
        <Link
          href={href(null)}
          aria-label="Show all groups"
          className="border-line hover:bg-soft text-muted-foreground hover:text-ink bg-background-100 ml-1 flex size-[38px] items-center justify-center rounded-md border"
        >
          <X className="size-3.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
