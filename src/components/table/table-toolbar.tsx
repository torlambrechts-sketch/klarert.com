'use client';

import { useMemo } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ownerField } from '@/engine/item-panel';
import type { Ctx, Item } from '@/engine/types';
import { groupableFields } from '@/engine/views/group-by';
import { keysOf } from '@/engine/values';
import { Avatar } from '@/components/fields/shared';
import { useGrid, useGridStore } from '@/components/grid/grid-store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// The Table's toolbar row (docs/05 §3.1), under the header actions (New item, search, filters, sort): a person
// filter as avatar toggles, the live item count and "Group by". The person filter and Group by are UI state.

const MAX_CHIPS = 5;

/** People who own at least one item (first people field), most items first. */
export function ownersOf(items: Item[], ctx: Ctx): string[] {
  const field = ownerField(ctx);
  if (!field) return [];
  const n = new Map<string, number>();
  for (const it of items) for (const id of keysOf(it, field, ctx)) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        (ctx.people.get(a[0])?.name ?? '').localeCompare(ctx.people.get(b[0])?.name ?? ''),
    )
    .map(([id]) => id);
}

/** Items owned by any of `people` (the first people field); everything when none is chosen. */
export function filterByPeople(items: Item[], people: ReadonlySet<string>, ctx: Ctx): Item[] {
  const field = ownerField(ctx);
  if (!field || people.size === 0) return items;
  return items.filter((it) => keysOf(it, field, ctx).some((id) => people.has(id)));
}

function PersonToggle({ id, ctx }: { id: string; ctx: Ctx }) {
  const store = useGridStore();
  const on = useGrid((s) => s.people.has(id));
  const name = ctx.people.get(id)?.name ?? 'Former member';
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={name}
      title={name}
      onClick={() => store.getState().togglePerson(id)}
      className={cn(
        'focus-visible:outline-focus relative rounded-full focus-visible:outline-2',
        on ? 'ring-ink ring-2 ring-offset-1' : 'opacity-80 hover:opacity-100',
      )}
    >
      <Avatar id={id} ctx={ctx} size={28} decorative />
      {on ? (
        <span
          aria-hidden
          className="bg-ink absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full text-white"
        >
          <Check className="size-2.5" />
        </span>
      ) : null}
    </button>
  );
}

function PeopleFilter({ ids, ctx }: { ids: string[]; ctx: Ctx }) {
  const store = useGridStore();
  const chosen = useGrid((s) => s.people);
  if (ids.length === 0) return null;
  const shown = ids.slice(0, MAX_CHIPS);
  const rest = ids.slice(MAX_CHIPS);
  return (
    <div role="group" aria-label="Filter by person" className="flex items-center gap-1.5">
      {shown.map((id) => (
        <PersonToggle key={id} id={id} ctx={ctx} />
      ))}
      {rest.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={`${rest.length} more ${rest.length === 1 ? 'person' : 'people'}`}
            >
              +{rest.length}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56">
            <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
              {rest.map((id) => {
                const on = chosen.has(id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => store.getState().togglePerson(id)}
                      className="hover:bg-soft focus-visible:outline-focus flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm focus-visible:outline-2"
                    >
                      <Avatar id={id} ctx={ctx} size={24} decorative />
                      <span className="min-w-0 flex-1 truncate">
                        {ctx.people.get(id)?.name ?? 'Former member'}
                      </span>
                      {on ? <Check className="size-4" aria-label="selected" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
      {chosen.size > 0 ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto p-0"
          onClick={() => store.getState().clearPeople()}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function GroupBy({ ctx }: { ctx: Ctx }) {
  const store = useGridStore();
  const groupBy = useGrid((s) => s.groupBy);
  const options = useMemo(
    () => [
      { id: null as string | null, name: 'Group' },
      ...groupableFields(ctx).map((f) => ({ id: f.id as string | null, name: f.name })),
    ],
    [ctx],
  );
  if (options.length < 2) return null;
  const current = options.find((o) => o.id === groupBy) ?? options[0]!;
  const set = (id: string | null) => store.getState().setGroupBy(id);
  return (
    <div className="flex items-center gap-2">
      <span id="group-by-label" className="text-muted-foreground text-meta font-semibold">
        Group by
      </span>
      {options.length <= 4 ? (
        <div
          role="group"
          aria-labelledby="group-by-label"
          className="border-line flex overflow-hidden rounded-md border"
        >
          {options.map((o) => {
            const on = o.id === current.id;
            return (
              <button
                key={o.id ?? 'group'}
                type="button"
                aria-pressed={on}
                onClick={() => set(o.id)}
                className={cn(
                  'focus-visible:outline-focus text-meta flex h-7 items-center gap-1 px-2.5 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2',
                  on ? 'bg-ink text-white' : 'hover:bg-soft',
                )}
              >
                {on ? <Check className="size-3" aria-hidden /> : null}
                {o.name}
              </button>
            );
          })}
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-labelledby="group-by-label group-by-current"
            >
              <span id="group-by-current">{current.name}</span> <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72">
            <DropdownMenuRadioGroup
              value={current.id ?? 'group'}
              onValueChange={(v) => set(v === 'group' ? null : v)}
            >
              {options.map((o) => (
                <DropdownMenuRadioItem key={o.id ?? 'group'} value={o.id ?? 'group'}>
                  {o.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function TableToolbar({
  ctx,
  people,
  shown,
  total,
}: {
  ctx: Ctx;
  people: string[];
  shown: number;
  total: number;
}) {
  const fmt = (n: number) => n.toLocaleString('en-GB');
  const noun = total === 1 ? 'item' : 'items';
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PeopleFilter ids={people} ctx={ctx} />
        <p className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
          {shown === total ? `${fmt(total)} ${noun}` : `${fmt(shown)} of ${fmt(total)} ${noun}`}
        </p>
      </div>
      <GroupBy ctx={ctx} />
    </div>
  );
}
