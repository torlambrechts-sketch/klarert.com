'use client';

import { useMemo, useState } from 'react';
import { CircleDot, Copy, Download, LayoutGrid, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { resolveFieldType } from '@/engine/fields/resolve';
import { ownerField } from '@/engine/item-panel';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, Item } from '@/engine/types';
import { statusFilterField } from '@/engine/views/quick-filters';
import { fieldUI } from '@/components/fields/registry';
import { editorPopoverClass } from '@/components/fields/shared';
import { useGrid, useGridStore } from '@/components/grid/grid-store';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useExportCsv } from './table-actions';

// The bulk bar (docs/18 §5): with rows selected, a 60 px bar at the bottom centre: the count, "items selected", the
// Status and the people field (the same pickers as the cells, changing every selected row through bulkSetValues),
// More (Duplicate, Export to CSV, Delete…) and ×. The "Delete…" confirm lives here too, for the row ⋯ menu as well:
// items move to Archived items (archiveItems), where they can be restored; the activity log keeps one entry each.

const barButton =
  'hover:bg-panel focus-visible:outline-focus text-12 text-ink flex h-[60px] shrink-0 flex-col items-center justify-center gap-0.5 px-3.5 focus-visible:outline-2 focus-visible:-outline-offset-2 data-[state=open]:bg-panel';

export function BulkBar({
  data,
  ctx,
  actions,
  canEdit,
}: {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  canEdit: boolean;
}) {
  const store = useGridStore();
  const selected = useGrid((s) => s.selected);
  const exportCsv = useExportCsv(data, ctx);
  const items = useMemo(() => data.items.filter((i) => selected.has(i.id)), [data, selected]);
  const status = useMemo(() => statusFilterField(ctx), [ctx]);
  const owner = useMemo(() => ownerField(ctx), [ctx]);
  const n = items.length;
  return (
    <>
      {n > 0 ? (
        <div
          role="region"
          aria-label="Selected items"
          data-keep-selection
          className="bg-surface shadow-menu fixed bottom-6 left-1/2 z-40 flex h-[60px] max-w-[calc(100vw-24px)] -translate-x-1/2 items-stretch overflow-x-auto rounded-lg max-[759px]:bottom-[80px]"
        >
          <span
            className="bg-brand text-kpi flex min-w-[60px] shrink-0 items-center justify-center rounded-l-lg px-2 text-white tabular-nums"
            aria-hidden
          >
            {n}
          </span>
          <span
            className="text-ink text-16 flex shrink-0 items-center px-4 font-medium max-sm:sr-only"
            aria-live="polite"
          >
            {n === 1 ? '1 item selected' : `${n} items selected`}
          </span>
          {canEdit && status ? (
            <BulkPicker field={status} items={items} ctx={ctx} actions={actions} icon={CircleDot} />
          ) : null}
          {canEdit && owner ? (
            <BulkPicker field={owner} items={items} ctx={ctx} actions={actions} icon={Users} />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className={barButton}>
              <LayoutGrid className="size-[18px]" aria-hidden />
              More
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-56">
              {canEdit ? (
                <DropdownMenuItem onSelect={() => void actions.duplicateItems(items)}>
                  <Copy aria-hidden /> Duplicate
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => exportCsv(items)}>
                <Download aria-hidden /> Export to CSV
              </DropdownMenuItem>
              {canEdit ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => store.setState({ deleting: items.map((i) => i.id) })}
                  >
                    <Trash2 aria-hidden /> Delete…
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => store.getState().setSelected([])}
            className="border-line text-muted-foreground hover:text-ink focus-visible:outline-focus grid w-14 shrink-0 place-items-center rounded-r-lg border-l focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      ) : null}
      <DeleteItemsDialog data={data} actions={actions} />
    </>
  );
}

/** Status or the people field for every selected row: the cell's own picker, one bulkSetValues for them all. */
function BulkPicker({
  field,
  items,
  ctx,
  actions,
  icon: Icon,
}: {
  field: Field;
  items: Item[];
  ctx: Ctx;
  actions: SheetActions;
  icon: typeof Users;
}) {
  const [open, setOpen] = useState(false);
  const ui = fieldUI(field.type);
  const first = items[0]!;
  const blank: Item = { ...first, id: 'bulk', values: {} };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(barButton, 'max-w-[140px]')}>
        <Icon className="size-[18px]" aria-hidden />
        <span className="max-w-full truncate">{field.name}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className={editorPopoverClass}
        style={{ width: Math.min(ui.editorWidth ?? 280, 420) }}
        aria-label={`${field.name} for ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      >
        <ui.Editor
          value={null}
          field={field}
          item={blank}
          ctx={ctx}
          onCancel={() => setOpen(false)}
          onCommit={(raw) => {
            setOpen(false);
            const def = resolveFieldType(field.type)!;
            const value =
              raw === null || raw === undefined ? null : def.normalize(raw, field.config, ctx);
            if (raw !== null && raw !== undefined && value === null)
              return void toast.error(`This is not a valid ${field.name.toLowerCase()}.`);
            void actions.bulkSet(
              items.map((it) => ({ itemId: it.id, values: { [field.id]: value as never } })),
              {
                message: `${field.name} changed on ${items.length} ${items.length === 1 ? 'item' : 'items'}.`,
              },
            );
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Delete…" (row ⋯ menu and bulk bar): a confirm that lists the items and says where they go. The items move to
 * Archived items (archiveItems, one activity log entry each) and can be restored there.
 */
function DeleteItemsDialog({ data, actions }: { data: SheetData; actions: SheetActions }) {
  const store = useGridStore();
  const ids = useGrid((s) => s.deleting);
  const items = useMemo(
    () => (ids ? data.items.filter((i) => ids.includes(i.id)) : []),
    [data.items, ids],
  );
  const close = () => store.setState({ deleting: null });
  const n = items.length;
  return (
    <Dialog open={!!ids} onOpenChange={(o) => !o && close()}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]" role="alertdialog">
        <DialogTitle className="text-card-title">
          Delete {n === 1 ? '1 item' : `${n} items`}?
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-13">
          {n === 1 ? 'It moves' : 'They move'} to Archived items in the sheet settings, where{' '}
          {n === 1 ? 'it' : 'they'} can be restored. The activity log keeps the record.
        </DialogDescription>
        <ul
          aria-label="Items to delete"
          className="border-line m-0 flex max-h-56 list-none flex-col overflow-y-auto rounded-md border p-0"
        >
          {items.map((it) => (
            <li
              key={it.id}
              className="border-b-row-line text-13 flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
            >
              <span className="text-muted-foreground text-12 shrink-0 font-mono">
                {it.displayId}
              </span>
              <span className="min-w-0 truncate">{it.name}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              const del = items.map((i) => i.id);
              close();
              const s = store.getState();
              s.setSelected([...s.selected].filter((id) => !del.includes(id)));
              void actions.setArchived(del, true);
            }}
          >
            Delete {n === 1 ? 'item' : `${n} items`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
