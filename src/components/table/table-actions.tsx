'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ChevronDown,
  CircleDot,
  Columns3,
  FolderInput,
  Layers3,
  Lock,
  LockOpen,
  PenSquare,
  Rows3,
  Rows4,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { Ctx, Field, Item } from '@/engine/types';
import { groupableFields } from '@/engine/views/group-by';
import { ownersOf, statusChoices } from '@/engine/views/quick-filters';
import { fieldUI } from '@/components/fields/registry';
import { Avatar, solidVar } from '@/components/fields/shared';
import type { ConfigEnv } from '@/components/fields/types';
import { useGrid, useGridStore } from '@/components/grid/grid-store';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { LockDialog } from './lock-dialog';
import { positionsAtEnd } from './table-model';

// The Table's toolbar controls (docs/05 §3.1), one row under the view tabs: "Actions" (bulk actions on the selected
// rows and Group by), the status and owner filters, Columns and the row density. Filters and density are UI state;
// density is kept per browser.

/** A select-like trigger of the toolbar (38 px, muted while nothing is chosen). */
export const toolbarSelectClass =
  'border-line hover:bg-subtle focus-visible:outline-focus flex h-[40px] max-w-[240px] min-w-[150px] items-center gap-2 rounded-md border bg-background-100 pr-2.5 pl-3 text-label-14 focus-visible:outline-2';

// ───────────────────────── density ─────────────────────────

const DENSITY_KEY = 'table-density';

/** Reads the browser's row density into the grid store once, then keeps it in localStorage. */
export function useDensityPreference() {
  const store = useGridStore();
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DENSITY_KEY);
      if (saved === 'compact' || saved === 'comfortable') store.getState().setDensity(saved);
    } catch {
      // blocked storage: the default for this visit
    }
    return store.subscribe((s, prev) => {
      if (s.density === prev.density) return;
      try {
        localStorage.setItem(DENSITY_KEY, s.density);
      } catch {
        // blocked storage: kept for this visit
      }
    });
  }, [store]);
}

export function DensityToggle() {
  const store = useGridStore();
  const density = useGrid((s) => s.density);
  const options = [
    { id: 'comfortable' as const, label: 'Comfortable rows', Icon: Rows3 },
    { id: 'compact' as const, label: 'Compact rows', Icon: Rows4 },
  ];
  return (
    <div
      role="group"
      aria-label="Row height"
      className="border-line bg-background-100 flex h-[40px] items-center gap-0.5 rounded-md border p-0.5"
    >
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={density === id}
          aria-label={label}
          title={label}
          onClick={() => store.getState().setDensity(id)}
          className={cn(
            'focus-visible:outline-focus grid size-8 place-items-center rounded text-[var(--muted)] focus-visible:outline-2 focus-visible:-outline-offset-2',
            density === id ? 'bg-soft text-ink' : 'hover:text-ink',
          )}
        >
          <Icon className="size-[15px]" aria-hidden />
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── status and owner filters ─────────────────────────

export function StatusFilter({ items, ctx }: { items: Item[]; ctx: Ctx }) {
  const store = useGridStore();
  const chosen = useGrid((s) => s.statuses);
  const choices = useMemo(() => statusChoices(items, ctx), [items, ctx]);
  if (choices.length === 0) return null;
  const picked = choices.filter((c) => chosen.has(c.option.id));
  const label =
    picked.length === 0
      ? 'All statuses'
      : picked.length === 1
        ? picked[0]!.option.label
        : `${picked.length} statuses`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(toolbarSelectClass, picked.length > 0 && 'border-faint')}
        aria-label={`Filter by status: ${label}`}
      >
        {picked.length === 1 ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: solidVar(picked[0]!.option.color) }}
          />
        ) : (
          <CircleDot className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            picked.length === 0 && 'text-muted-foreground',
          )}
        >
          {label}
        </span>
        <ChevronDown className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-60">
        <DropdownMenuLabel className="text-muted-foreground text-label-12 font-medium">
          Status
        </DropdownMenuLabel>
        {choices.map(({ option, count }) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={chosen.has(option.id)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => store.getState().toggleStatus(option.id)}
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: solidVar(option.color) }}
            />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <span className="text-muted-foreground text-label-12-mono tabular-nums">{count}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {picked.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => store.getState().clearStatuses()}>
              <X aria-hidden /> All statuses
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OwnerFilter({ items, ctx }: { items: Item[]; ctx: Ctx }) {
  const store = useGridStore();
  const chosen = useGrid((s) => s.people);
  const ids = useMemo(() => ownersOf(items, ctx), [items, ctx]);
  if (ids.length === 0) return null;
  const nameOf = (id: string) => ctx.people.get(id)?.name ?? 'Former member';
  const picked = ids.filter((id) => chosen.has(id));
  const label =
    picked.length === 0
      ? 'All owners'
      : picked.length === 1
        ? nameOf(picked[0]!)
        : `${picked.length} owners`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(toolbarSelectClass, picked.length > 0 && 'border-faint')}
        aria-label={`Filter by owner: ${label}`}
      >
        {picked.length === 1 ? (
          <Avatar id={picked[0]!} ctx={ctx} size={20} decorative />
        ) : (
          <UserRound className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            picked.length === 0 && 'text-muted-foreground',
          )}
        >
          {label}
        </span>
        <ChevronDown className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64">
        <DropdownMenuLabel className="text-muted-foreground text-label-12 font-medium">
          Owner
        </DropdownMenuLabel>
        {ids.map((id) => (
          <DropdownMenuCheckboxItem
            key={id}
            checked={chosen.has(id)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => store.getState().togglePerson(id)}
          >
            <Avatar id={id} ctx={ctx} size={22} decorative />
            <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {picked.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => store.getState().clearPeople()}>
              <X aria-hidden /> All owners
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ───────────────────────── columns ─────────────────────────

export function ColumnsMenu({ fields, hiddenCount }: { fields: Field[]; hiddenCount: number }) {
  const store = useGridStore();
  const hidden = useGrid((s) => s.hidden);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-[40px] font-normal shadow-none">
          <Columns3 aria-hidden /> Columns
          {hiddenCount ? (
            <span className="bg-soft text-ink text-label-12-mono rounded px-1.5 leading-[18px] font-normal tabular-nums">
              +{hiddenCount}
              <span className="sr-only"> hidden</span>
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label-13 mb-1 font-semibold">Show columns</legend>
          {fields.length === 0 ? (
            <p className="text-muted-foreground text-copy-13">No fields yet.</p>
          ) : null}
          <div className="flex max-h-72 flex-col gap-0.5 overflow-auto">
            {fields.map((f) => {
              const Icon = fieldUI(f.type).icon;
              return (
                <label
                  key={f.id}
                  className="hover:bg-soft text-label-13 flex items-center gap-2 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(f.id)}
                    onChange={(e) => store.getState().setHidden(f.id, !e.target.checked)}
                  />
                  <Icon className="text-muted-foreground size-3.5" aria-hidden />
                  {f.name}
                </label>
              );
            })}
          </div>
          <p className="text-muted-foreground text-label-12 pt-1">
            Hidden columns belong to this view.
          </p>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

// ───────────────────────── actions (bulk and group by) ─────────────────────────

/**
 * "Actions": with rows selected, "N selected", the menu of bulk actions (set a field, move to group, archive, lock)
 * and "Clear"; always "Group by" (the sheet's groups or a field's values).
 */
export function TableActions({
  actions,
  fields,
  env,
  allItems,
  canEdit,
  isAdmin,
}: {
  actions: SheetActions;
  fields: Field[];
  env: ConfigEnv;
  allItems: Item[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const store = useGridStore();
  const selected = useGrid((s) => s.selected);
  const groupBy = useGrid((s) => s.groupBy);
  const [field, setField] = useState<Field | null>(null);
  const [lockFor, setLockFor] = useState<Item[] | null>(null);
  const ctx = env.ctx;
  const ids = [...selected];
  const items = allItems.filter((i) => selected.has(i.id));
  const groups = [...ctx.groups.values()].sort((a, b) => (a.position < b.position ? -1 : 1));
  const valueFields = fields.filter(
    (f) => resolveFieldType(f.type)?.storage === 'values' && !fieldUI(f.type).automationOnly,
  );
  const groupOptions = useMemo(
    () => [
      { id: 'group', name: 'Groups' },
      ...groupableFields(ctx).map((f) => ({ id: f.id, name: f.name })),
    ],
    [ctx],
  );
  const n = canEdit ? selected.size : 0;

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="h-[40px] font-normal shadow-none">
          <Layers3 aria-hidden /> Actions <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {n > 0 ? (
          <>
            <DropdownMenuLabel className="text-muted-foreground text-label-12 font-medium">
              {n === 1 ? '1 selected item' : `${n} selected items`}
            </DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PenSquare aria-hidden className="text-muted-foreground size-4" /> Set a field
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-auto">
                {valueFields.length === 0 ? (
                  <DropdownMenuItem disabled>No fields to set</DropdownMenuItem>
                ) : null}
                {valueFields.map((f) => (
                  <DropdownMenuItem key={f.id} onSelect={() => setField(f)}>
                    {f.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput aria-hidden className="text-muted-foreground size-4" /> Move to group
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {groups.map((g) => (
                  <DropdownMenuItem
                    key={g.id}
                    onSelect={() => {
                      const target = items.filter((i) => i.groupId !== g.id);
                      const existing = allItems
                        .filter((i) => i.groupId === g.id && !selected.has(i.id))
                        .sort((a, b) =>
                          a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
                        );
                      const keys = positionsAtEnd(existing, target.length);
                      void actions.moveItems(
                        target.map((it, i) => ({
                          itemId: it.id,
                          groupId: g.id,
                          position: keys[i]!,
                        })),
                        `${target.length} ${target.length === 1 ? 'item' : 'items'} moved to ${g.name}.`,
                      );
                    }}
                  >
                    {g.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => {
                store.getState().setSelected([]);
                void actions.setArchived(ids, true);
              }}
            >
              <Archive aria-hidden /> Archive
            </DropdownMenuItem>
            {isAdmin ? (
              items.every((i) => i.locked) ? (
                <DropdownMenuItem
                  onSelect={() => items.forEach((it) => void actions.lockItem(it, false))}
                >
                  <LockOpen aria-hidden /> Unlock
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setLockFor(items)}>
                  <Lock aria-hidden /> Lock
                </DropdownMenuItem>
              )
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : canEdit ? (
          <>
            <DropdownMenuItem disabled>Select rows to change them together</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-muted-foreground text-label-12 font-medium">
          Group by
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={groupBy ?? 'group'}
          onValueChange={(v) => store.getState().setGroupBy(v === 'group' ? null : v)}
        >
          {groupOptions.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id}>
              {o.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {n > 0 ? (
        <div role="region" aria-label="Selected items" className="flex items-center gap-2">
          {menu}
          <span className="text-label-14 font-medium tabular-nums" aria-live="polite">
            {n === 1 ? '1 selected' : `${n} selected`}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="h-[40px] px-2.5"
            onClick={() => store.getState().setSelected([])}
          >
            Clear
          </Button>
        </div>
      ) : (
        menu
      )}
      <LockDialog items={lockFor} actions={actions} onClose={() => setLockFor(null)} />
      <BulkEditor
        field={field}
        env={env}
        onClose={() => setField(null)}
        onCommit={(f, raw) => {
          setField(null);
          const def = resolveFieldType(f.type)!;
          const value =
            raw === null || raw === undefined ? null : def.normalize(raw, f.config, env.ctx);
          if (raw !== null && raw !== undefined && value === null)
            return toast.error(`This is not a valid ${f.name.toLowerCase()}.`);
          void actions.bulkSet(
            ids.map((itemId) => ({ itemId, values: { [f.id]: value as never } })),
            { message: `${f.name} set on ${ids.length} ${ids.length === 1 ? 'item' : 'items'}.` },
          );
        }}
      />
    </>
  );
}

function BulkEditor({
  field,
  env,
  onClose,
  onCommit,
}: {
  field: Field | null;
  env: ConfigEnv;
  onClose(): void;
  onCommit(f: Field, raw: unknown): void;
}) {
  if (!field) return null;
  const ui = fieldUI(field.type);
  const blank = {
    id: 'bulk',
    sheetId: env.sheet.id,
    groupId: '',
    seq: 0,
    displayId: '',
    name: '',
    values: {},
    position: 'a0',
    locked: false,
    createdAt: env.ctx.now.toISOString(),
    updatedAt: env.ctx.now.toISOString(),
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogTitle className="text-heading-16">Set {field.name}</DialogTitle>
        <DialogDescription className="text-muted-foreground text-label-13">
          The value is set on every selected item.
        </DialogDescription>
        <ui.Editor
          value={null}
          field={field}
          item={blank}
          ctx={env.ctx}
          onCommit={(v) => onCommit(field, v)}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
