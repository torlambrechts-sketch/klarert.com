'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, GripVertical, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { copyRange, planClear, planPaste, type GridColumn } from '@/engine/clipboard';
import { resolveFieldType } from '@/engine/fields/resolve';
import { keysBetween } from '@/engine/ordering';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, Group, Item } from '@/engine/types';
import { compareItems } from '@/engine/values';
import { fieldUI } from '@/components/fields/registry';
import { cellValue, colorVar, TextEditor } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ColumnHeader } from './column-header';
import { FieldPicker } from './field-picker';
import { useGrid, useGridStore, type CellRef } from './grid-store';
import {
  buildLayout,
  columnId,
  gridColumns,
  positionsAtEnd,
  rangeOf,
  ROW_HEIGHT,
  step,
  type GridRow,
} from './grid-model';
import { GroupSummary } from './group-summary';
import type { SheetActions } from './use-sheet';
import { useValueCommit } from './use-commit';

// The Grid view (docs/05 §3.2, FR-21): group blocks with a colour bar, a sticky name column, column headers per
// group, "+ Add item" and a summary row, virtualised rows and columns. The grid element keeps keyboard focus and
// points at the active cell with aria-activedescendant, so focus survives virtualisation.

const ADD_COL = 48;
const CHECK_W = 64;
const cellId = (itemId: string, col: string) => `cell-${itemId}-${col}`;

export interface GridProps {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  canEdit: boolean;
  isAdmin: boolean;
  onlyGroup: string | null;
  nameWidth: number;
  /** Focus requests for the first group's "+ Add item" (the header's New item button). */
  addFocusTick: number;
  /** Open the item panel (name click, Space on the name cell, "Open item" in file cells). */
  onOpenItem(item: Item): void;
}

const storageOf = (f: Field) => resolveFieldType(f.type)?.storage;

/** Read-only values whose editor only explains them (computed, files, buttons). */
const explainOnly = (f: Field) => {
  const s = storageOf(f);
  return s === 'computed' || s === 'files' || s === 'none';
};

export function Grid({
  data,
  ctx,
  actions,
  canEdit,
  isAdmin,
  onlyGroup,
  nameWidth,
  addFocusTick,
  onOpenItem,
}: GridProps) {
  const store = useGridStore();
  const collapsed = useGrid((s) => s.collapsed);
  const sort = useGrid((s) => s.sort);
  const hidden = useGrid((s) => s.hidden);
  const widths = useGrid((s) => s.widths);
  const active = useGrid((s) => s.active);
  const anchor = useGrid((s) => s.anchor);
  const editing = useGrid((s) => s.editing);
  const selected = useGrid((s) => s.selected);
  const summaries = useGrid((s) => s.summaries);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const sortField = sort ? data.fields.find((f) => f.id === sort.fieldId) : undefined;
  const compare = useMemo(
    () => (sortField ? compareItems(sortField, ctx, sort!.dir) : null),
    [sortField, ctx, sort],
  );
  const layout = useMemo(
    () =>
      buildLayout({
        groups: data.groups,
        items: data.items,
        collapsed,
        compare,
        canAdd: canEdit,
        onlyGroup,
      }),
    [data.groups, data.items, collapsed, compare, canEdit, onlyGroup],
  );
  const columns = useMemo(() => gridColumns(data.fields, hidden), [data.fields, hidden]);
  const fieldCols = useMemo(
    () => columns.filter((c): c is Extract<GridColumn, { kind: 'field' }> => c.kind === 'field'),
    [columns],
  );
  const colIndex = useMemo(() => new Map(columns.map((c, i) => [columnId(c), i])), [columns]);
  const rowIndexOfItem = useMemo(() => {
    const m = new Map<string, number>();
    layout.rows.forEach((r, i) => r.kind === 'item' && m.set(r.item.id, i));
    return m;
  }, [layout.rows]);
  const widthOf = useCallback(
    (f: Field) => widths[f.id] ?? f.width ?? resolveFieldType(f.type)?.defaultWidth ?? 140,
    [widths],
  );
  const stickyW = CHECK_W + nameWidth;

  const rowV = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_HEIGHT[layout.rows[i]!.kind],
    getItemKey: useCallback((i: number) => layout.rows[i]!.key, [layout.rows]),
    overscan: 10,
  });
  const colV = useVirtualizer({
    horizontal: true,
    count: fieldCols.length + (canEdit ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (i < fieldCols.length ? widthOf(fieldCols[i]!.field) : ADD_COL),
    getItemKey: useCallback(
      (i: number) => (i < fieldCols.length ? fieldCols[i]!.field.id : '__add'),
      [fieldCols],
    ),
    paddingStart: stickyW,
    scrollPaddingStart: stickyW,
    overscan: 3,
  });
  useEffect(() => colV.measure(), [colV, widths, fieldCols, stickyW]);
  useEffect(() => rowV.measure(), [rowV, layout.rows]);

  const canEditItem = useCallback(
    (item: Item) => canEdit && !item.id.startsWith('temp-') && (!item.locked || isAdmin),
    [canEdit, isAdmin],
  );

  // ───────────── selection and keyboard ─────────────

  const pos = (c: CellRef | null) => {
    if (!c) return null;
    const row = layout.index.get(c.itemId);
    const col = colIndex.get(c.col);
    return row === undefined || col === undefined ? null : { row, col };
  };
  const activePos = pos(active);
  const anchorPos = pos(anchor) ?? activePos;
  const range = activePos && anchorPos ? rangeOf(anchorPos, activePos) : null;

  const focusGrid = () => scrollRef.current?.focus({ preventScroll: true });
  const refAt = (p: { row: number; col: number }): CellRef => ({
    itemId: layout.flat[p.row]!.id,
    col: columnId(columns[p.col]!),
  });

  const reveal = useCallback(
    (p: { row: number; col: number }) => {
      const item = layout.flat[p.row];
      const r = item ? rowIndexOfItem.get(item.id) : undefined;
      if (r !== undefined) rowV.scrollToIndex(r, { align: 'auto' });
      if (p.col > 0) colV.scrollToIndex(p.col - 1, { align: 'auto' });
    },
    [colV, layout.flat, rowIndexOfItem, rowV],
  );

  const lockedMessage = (item: Item) =>
    item.lockReason
      ? `This item is locked: ${item.lockReason}. Only owners and admins can change it.`
      : 'This item is locked. Only owners and admins can change it.';

  const startEdit = (cell: CellRef) => {
    const item = layout.flat[layout.index.get(cell.itemId) ?? -1];
    if (!item) return;
    const field = cell.col === 'name' ? null : data.fields.find((f) => f.id === cell.col);
    if (field && explainOnly(field)) return store.getState().edit(cell);
    if (!canEdit) return toast('You can view this sheet. Ask an editor or admin to change it.');
    if (item.id.startsWith('temp-')) return;
    if (!canEditItem(item)) return toast.error(lockedMessage(item));
    store.getState().edit(cell);
  };

  const toggle = (item: Item, field: Field) => {
    const ui = fieldUI(field.type);
    if (!ui.toggle) return false;
    if (!canEditItem(item)) {
      if (canEdit) toast.error(lockedMessage(item));
      return true;
    }
    void commit(item, field.id, ui.toggle(cellValue(item, field, ctx)));
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== scrollRef.current || editing) return;
    const rows = layout.flat.length;
    if (rows === 0) return;
    const at = activePos ?? { row: 0, col: 0 };
    const keys: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    if (keys[e.key]) {
      e.preventDefault();
      const next = activePos ? step(at, keys[e.key]!, rows, columns.length)! : at;
      store.getState().focus(refAt(next), e.shiftKey);
      reveal(next);
      return;
    }
    if (e.key === 'Tab') {
      const next = step(at, e.shiftKey ? 'shifttab' : 'tab', rows, columns.length);
      if (!next) return;
      e.preventDefault();
      store.getState().focus(refAt(next));
      reveal(next);
      return;
    }
    if (!active) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        store.getState().focus(refAt(at));
      }
      return;
    }
    const item = layout.flat[at.row]!;
    const column = columns[at.col]!;
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      if (
        column.kind === 'field' &&
        fieldUI(column.field.type).toggle &&
        toggle(item, column.field)
      )
        return;
      startEdit(active);
    } else if (e.key === ' ') {
      if (column.kind === 'name' && !item.id.startsWith('temp-')) {
        e.preventDefault();
        onOpenItem(item);
      } else if (column.kind === 'field' && toggle(item, column.field)) e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!canEdit || !range) return;
      const plan = planClear(layout.flat, columns, range, { canEdit: canEditItem });
      void applyWrites(plan, 'cleared');
    } else if (e.key === 'Escape') {
      store.getState().focus(active);
    }
  };

  const applyWrites = async (plan: ReturnType<typeof planClear>, verb: 'pasted' | 'cleared') => {
    const ids = new Set([...plan.names.keys(), ...plan.values.keys()]);
    const changes = [...ids].map((itemId) => ({
      itemId,
      values: plan.values.get(itemId),
      name: plan.names.get(itemId),
    }));
    if (changes.length === 0) {
      if (plan.skipped.length) toast(plan.message);
      return;
    }
    await actions.bulkSet(changes, { message: plan.message });
    void verb;
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (e.target !== scrollRef.current || !range) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copyRange(layout.flat, columns, range, ctx));
    const n = (range.bottom - range.top + 1) * (range.right - range.left + 1);
    toast(`${n} ${n === 1 ? 'cell' : 'cells'} copied.`);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (e.target !== scrollRef.current || !range) return;
    e.preventDefault();
    if (!canEdit) return toast('You can view this sheet. Ask an editor or admin to change it.');
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const plan = planPaste(text, layout.flat, columns, range, ctx, { canEdit: canEditItem });
    void applyWrites(plan, 'pasted');
  };

  // ───────────── commits ─────────────

  const valueCommit = useValueCommit(data, ctx, actions);
  const commit = async (item: Item, col: string, raw: unknown, note?: string) => {
    store.getState().edit(null);
    focusGrid();
    await valueCommit.commit(item, col, raw, note);
  };

  // ───────────── pointer ─────────────

  const onMouseDown = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!el) return;
    const [itemId, col] = el.dataset.cell!.split('|') as [string, string];
    const cell = { itemId, col };
    const was = active && active.itemId === itemId && active.col === col;
    e.preventDefault();
    store.getState().focus(cell, e.shiftKey);
    focusGrid();
    if (was && !e.shiftKey) {
      const item = layout.flat[layout.index.get(itemId) ?? -1];
      const field = data.fields.find((f) => f.id === col);
      if (item && field && toggle(item, field)) return;
      startEdit(cell);
    }
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!el) return;
    const [itemId, col] = el.dataset.cell!.split('|') as [string, string];
    const field = data.fields.find((f) => f.id === col);
    if (field && fieldUI(field.type).toggle) return;
    startEdit({ itemId, col });
  };

  // ───────────── row selection ─────────────

  const selectRow = (item: Item, checked: boolean, shift: boolean) => {
    const s = store.getState();
    const next = new Set(s.selected);
    const last = s.lastSelected ? layout.index.get(s.lastSelected) : undefined;
    const here = layout.index.get(item.id)!;
    if (shift && last !== undefined) {
      for (let i = Math.min(last, here); i <= Math.max(last, here); i += 1) {
        if (checked) next.add(layout.flat[i]!.id);
        else next.delete(layout.flat[i]!.id);
      }
    } else if (checked) next.add(item.id);
    else next.delete(item.id);
    s.setSelected(next, item.id);
  };

  // ───────────── add items ─────────────

  const addItem = async (group: Group, name: string) => {
    const list = layout.byGroup.get(group.id) ?? [];
    const [position] = positionsAtEnd(list, 1);
    await actions.createItem(group.id, name, position!, (tempId, saved) => {
      // a cell of the new row may already be active: follow the row to its saved id
      const s = store.getState();
      const swap = (c: CellRef | null) =>
        c && c.itemId === tempId ? { ...c, itemId: saved.id } : c;
      if (s.active?.itemId === tempId || s.anchor?.itemId === tempId)
        store.setState({ active: swap(s.active), anchor: swap(s.anchor) });
    });
  };

  // ───────────── drag and drop ─────────────

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const a = e.active.data.current as
      { type: string; itemId?: string; fieldId?: string } | undefined;
    const o = e.over?.data.current as
      | { type: string; itemId?: string; groupId?: string; fieldId?: string; at?: 'top' | 'end' }
      | undefined;
    if (!a || !o) return;
    if (a.type === 'column' && o.type === 'column' && a.fieldId !== o.fieldId) {
      const field = data.fields.find((f) => f.id === a.fieldId)!;
      const toIndex = data.fields
        .filter((f) => f.id !== a.fieldId)
        .findIndex((f) => f.id === o.fieldId);
      const from = data.fields.findIndex((f) => f.id === a.fieldId);
      const target = data.fields.findIndex((f) => f.id === o.fieldId);
      void actions.moveField(field, target > from ? toIndex + 1 : toIndex);
      return;
    }
    if (a.type !== 'row' || !a.itemId || !o.groupId) return;
    const moving =
      selected.has(a.itemId) && selected.size > 1
        ? layout.flat.filter((i) => selected.has(i.id) && canEditItem(i)).map((i) => i.id)
        : [a.itemId];
    const list = (layout.byGroup.get(o.groupId) ?? []).filter((i) => !moving.includes(i.id));
    let index = o.at === 'top' ? 0 : list.length;
    if (o.type === 'row' && o.itemId) {
      const overIndex = list.findIndex((i) => i.id === o.itemId);
      if (overIndex >= 0) {
        const overRect = e.over!.rect;
        const activeRect = e.active.rect.current.translated;
        const below = activeRect
          ? activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
          : false;
        index = overIndex + (below ? 1 : 0);
      }
    }
    if (o.type === 'row' && moving.includes(o.itemId!)) return;
    const keys = keysBetween(
      list[index - 1]?.position ?? null,
      list[index]?.position ?? null,
      moving.length,
    );
    const group = data.groups.find((g) => g.id === o.groupId);
    const crossing = moving.some(
      (id) => layout.flat.find((i) => i.id === id)?.groupId !== o.groupId,
    );
    void actions.moveItems(
      moving.map((itemId, i) => ({ itemId, groupId: o.groupId!, position: keys[i]! })),
      crossing && group ? `Moved to ${group.name}.` : undefined,
    );
  };

  // ───────────── render ─────────────

  const vRows = rowV.getVirtualItems();
  const vCols = colV.getVirtualItems();
  const totalW = colV.getTotalSize();
  const dragDisabled = !!sort || !canEdit;
  const activeId =
    active && rowIndexOfItem.has(active.itemId) ? cellId(active.itemId, active.col) : undefined;
  const editingItem = editing ? layout.flat[layout.index.get(editing.itemId) ?? -1] : undefined;

  const firstAddRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (addFocusTick === 0) return;
    const first = layout.rows.findIndex((r) => r.kind === 'add');
    if (first >= 0) rowV.scrollToIndex(first, { align: 'auto' });
    requestAnimationFrame(() => firstAddRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFocusTick]);
  const firstAddGroup = layout.rows.find((r) => r.kind === 'add')?.key;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        ref={scrollRef}
        role="grid"
        aria-label={`${ctx.sheet.name} grid`}
        aria-rowcount={layout.flat.length}
        aria-colcount={columns.length}
        aria-multiselectable
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        onFocus={(e) => {
          if (e.target === scrollRef.current && !store.getState().active && layout.flat[0])
            store.getState().focus({ itemId: layout.flat[0].id, col: 'name' });
        }}
        className="grid-scroll relative min-h-0 flex-1 overflow-auto bg-white outline-none"
      >
        <div style={{ height: rowV.getTotalSize(), width: totalW, position: 'relative' }}>
          {vRows.map((vr) => {
            const row = layout.rows[vr.index]!;
            return (
              <div
                key={row.key}
                role={row.kind === 'gap' ? 'presentation' : 'row'}
                aria-rowindex={row.kind === 'item' ? row.index + 1 : undefined}
                className="absolute top-0 left-0 flex"
                style={{ height: vr.size, width: totalW, transform: `translateY(${vr.start}px)` }}
              >
                <RowContent
                  row={row}
                  ctx={ctx}
                  stickyW={stickyW}
                  nameWidth={nameWidth}
                  fieldCols={fieldCols}
                  vCols={vCols}
                  widthOf={widthOf}
                  canEdit={canEdit}
                  isAdmin={isAdmin}
                  canEditItem={canEditItem}
                  active={active}
                  range={range}
                  colIndex={colIndex}
                  selected={selected}
                  editing={editing}
                  sort={sort}
                  summaries={summaries}
                  dragDisabled={dragDisabled}
                  allFields={data.fields}
                  actions={actions}
                  onMouseDown={onMouseDown}
                  onDoubleClick={onDoubleClick}
                  onSelectRow={selectRow}
                  onAdd={addItem}
                  addRef={row.key === firstAddGroup ? firstAddRef : undefined}
                  groupItems={layout.byGroup}
                  onCommit={commit}
                  onOpenItem={onOpenItem}
                  onCancelEdit={() => {
                    store.getState().edit(null);
                    focusGrid();
                  }}
                  editingItem={editingItem}
                />
              </div>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging?.startsWith('row:') ? (
          <div className="bg-ink rounded-md px-3 py-1.5 text-sm font-semibold text-white shadow-lg">
            {selected.has(dragging.slice(4)) && selected.size > 1
              ? `${selected.size} items`
              : (layout.flat.find((i) => i.id === dragging.slice(4))?.name ?? '')}
          </div>
        ) : null}
      </DragOverlay>
      {valueCommit.dialog}
    </DndContext>
  );
}

// ───────────────────────── rows ─────────────────────────

interface RowProps {
  row: GridRow;
  onOpenItem(item: Item): void;
  ctx: Ctx;
  stickyW: number;
  nameWidth: number;
  fieldCols: Extract<GridColumn, { kind: 'field' }>[];
  vCols: { index: number; start: number; size: number; key: React.Key }[];
  widthOf(f: Field): number;
  canEdit: boolean;
  isAdmin: boolean;
  canEditItem(item: Item): boolean;
  active: CellRef | null;
  range: { top: number; left: number; bottom: number; right: number } | null;
  colIndex: Map<string, number>;
  selected: ReadonlySet<string>;
  editing: CellRef | null;
  editingItem: Item | undefined;
  sort: { fieldId: string; dir: 'asc' | 'desc' } | null;
  summaries: Readonly<Record<string, import('@/engine/summaries').SummaryFn>>;
  dragDisabled: boolean;
  allFields: Field[];
  actions: SheetActions;
  onMouseDown(e: React.MouseEvent): void;
  onDoubleClick(e: React.MouseEvent): void;
  onSelectRow(item: Item, checked: boolean, shift: boolean): void;
  onAdd(group: Group, name: string): Promise<void>;
  addRef?: React.RefObject<HTMLInputElement | null>;
  groupItems: Map<string, Item[]>;
  onCommit(item: Item, col: string, raw: unknown): void;
  onCancelEdit(): void;
}

function Sticky({
  width,
  color,
  children,
  className,
}: {
  width: number;
  color: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-line sticky left-0 z-[2] flex shrink-0 items-center border-r border-b bg-white',
        className,
      )}
      style={{ width, borderLeft: `4px solid ${colorVar(color)}` }}
    >
      {children}
    </div>
  );
}

function RowContent(p: RowProps) {
  const { row } = p;
  switch (row.kind) {
    case 'gap':
      return null;
    case 'group':
      return <GroupRow {...p} row={row} />;
    case 'header':
      return <HeaderRow {...p} row={row} />;
    case 'item':
      return <ItemRow {...p} row={row} />;
    case 'add':
      return <AddRow {...p} row={row} />;
    case 'summary':
      return <SummaryRow {...p} row={row} />;
  }
}

function GroupRow({ row, stickyW }: RowProps & { row: Extract<GridRow, { kind: 'group' }> }) {
  const store = useGridStore();
  const drop = useDroppable({
    id: `group:${row.group.id}`,
    data: { type: 'group', groupId: row.group.id, at: 'top' },
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={cn('sticky left-0 flex items-end', drop.isOver && 'bg-sel')}
      style={{ width: `min(100%, ${stickyW + 400}px)` }}
    >
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={!row.collapsed}
          onClick={() => store.getState().toggleCollapsed(row.group.id)}
          className="hover:bg-soft flex h-9 items-center gap-2 rounded-md px-2 text-left"
        >
          {row.collapsed ? (
            <ChevronRight className="size-4" aria-hidden />
          ) : (
            <ChevronDown className="size-4" aria-hidden />
          )}
          <span className="text-[15px] font-bold" style={{ color: colorVar(row.group.color) }}>
            {row.group.name}
          </span>
          <span className="text-muted-foreground text-xs font-semibold tabular-nums">
            {row.count === 1 ? '1 item' : `${row.count.toLocaleString('en-GB')} items`}
          </span>
        </button>
      </h2>
    </div>
  );
}

function HeaderRow(p: RowProps & { row: Extract<GridRow, { kind: 'header' }> }) {
  const { row, ctx, fieldCols, vCols, widthOf } = p;
  const store = useGridStore();
  const items = p.groupItems.get(row.group.id) ?? [];
  const allSelected = items.length > 0 && items.every((i) => p.selected.has(i.id));
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      <Sticky width={p.stickyW} color={row.group.color} className="bg-soft">
        {p.canEdit ? (
          <span className="flex w-8 shrink-0 justify-center">
            <input
              type="checkbox"
              aria-label={`Select all items in ${row.group.name}`}
              checked={allSelected}
              disabled={items.length === 0}
              onChange={(e) => {
                const next = new Set(p.selected);
                for (const it of items) {
                  if (e.target.checked) next.add(it.id);
                  else next.delete(it.id);
                }
                store.getState().setSelected(next);
              }}
            />
          </span>
        ) : null}
        <span
          role="columnheader"
          className="flex-1 truncate px-2 text-xs font-semibold"
          style={{ paddingLeft: p.canEdit ? 28 : 8 }}
        >
          {ctx.sheet.itemLabel}
        </span>
      </Sticky>
      {vCols.map((vc) => {
        if (vc.index >= fieldCols.length)
          return (
            <div
              key="__add"
              className="border-line bg-soft absolute top-0 flex h-full items-center justify-center border-b"
              style={{ left: vc.start, width: vc.size }}
            >
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Add a field">
                    <Plus aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                  <FieldPicker
                    onPick={(type) => {
                      setPickerOpen(false);
                      void p.actions.addField(type);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          );
        const field = fieldCols[vc.index]!.field;
        const index = p.allFields.findIndex((f) => f.id === field.id);
        return (
          <div
            key={field.id}
            className="bg-soft absolute top-0 h-full"
            style={{ left: vc.start, width: vc.size }}
          >
            <ColumnHeader
              field={field}
              groupId={row.group.id}
              width={widthOf(field)}
              ctx={ctx}
              canEdit={p.canEdit}
              isAdmin={p.isAdmin}
              sorted={p.sort?.fieldId === field.id ? p.sort.dir : null}
              summary={p.summaries[field.id]}
              first={index === 0}
              last={index === p.allFields.length - 1}
              dragDisabled={!p.canEdit}
              actions={{
                sort: (dir) => store.getState().setSort(dir ? { fieldId: field.id, dir } : null),
                hide: () => {
                  store.getState().setHidden(field.id, true);
                  toast(`${field.name} hidden. Show it again from Columns.`);
                },
                settings: () => store.getState().openSettings(field.id),
                insert: (side) =>
                  store
                    .getState()
                    .openAddField(
                      side === 'left' ? { beforeFieldId: field.id } : { afterFieldId: field.id },
                    ),
                duplicate: () => void p.actions.duplicateField(field),
                move: (by) => void p.actions.moveField(field, Math.max(0, index + by)),
                remove: () => void p.actions.deleteField(field),
                summary: (fn) => store.getState().setSummary(field.id, fn),
                resize: (w, done) => {
                  store.getState().setWidth(field.id, w);
                  if (done)
                    void p.actions
                      .updateField(field, { width: w })
                      .then(() => store.getState().setWidth(field.id, null));
                },
              }}
            />
          </div>
        );
      })}
    </>
  );
}

const ItemRow = memo(function ItemRow(p: RowProps & { row: Extract<GridRow, { kind: 'item' }> }) {
  const { row, ctx, fieldCols, vCols } = p;
  const item = row.item;
  const editable = p.canEditItem(item);
  const isSelected = p.selected.has(item.id);
  const drag = useDraggable({
    id: `row:${item.id}`,
    data: { type: 'row', itemId: item.id },
    disabled: p.dragDisabled || !editable,
  });
  const drop = useDroppable({
    id: `rowdrop:${item.id}`,
    data: { type: 'row', itemId: item.id, groupId: row.group.id },
  });
  const inRange = (col: number) =>
    !!p.range &&
    row.index >= p.range.top &&
    row.index <= p.range.bottom &&
    col >= p.range.left &&
    col <= p.range.right;
  const isActive = (col: string) => p.active?.itemId === item.id && p.active.col === col;
  const isEditing = (col: string) => p.editing?.itemId === item.id && p.editing.col === col;
  return (
    <>
      <Sticky
        width={p.stickyW}
        color={row.group.color}
        className={cn(
          isSelected && 'bg-sel',
          drop.isOver && 'shadow-[inset_0_2px_0_var(--focus)]',
          drag.isDragging && 'opacity-40',
        )}
      >
        <div ref={drop.setNodeRef} className="flex h-full w-full items-center">
          <span className="flex w-8 shrink-0 items-center justify-center">
            {p.canEdit ? (
              <input
                type="checkbox"
                aria-label={`Select ${item.name}`}
                checked={isSelected}
                onClick={(e) =>
                  p.onSelectRow(item, (e.target as HTMLInputElement).checked, e.shiftKey)
                }
                onChange={() => undefined}
              />
            ) : null}
          </span>
          <span className="flex w-6 shrink-0 items-center justify-center">
            {!p.dragDisabled && editable ? (
              <button
                ref={drag.setNodeRef}
                type="button"
                {...drag.listeners}
                {...drag.attributes}
                tabIndex={-1}
                aria-label={`Drag ${item.name} to move it`}
                className="text-muted-foreground hover:text-ink cursor-grab rounded p-0.5"
              >
                <GripVertical className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </span>
          <div
            id={cellId(item.id, 'name')}
            role="gridcell"
            aria-selected={inRange(0)}
            aria-readonly={!editable || undefined}
            data-cell={`${item.id}|name`}
            onMouseDown={p.onMouseDown}
            onDoubleClick={p.onDoubleClick}
            className={cn(
              'relative flex h-full min-w-0 flex-1 cursor-default items-center gap-2 px-2',
              inRange(0) && 'bg-sel',
              isActive('name') && 'outline-focus z-[1] outline-2 -outline-offset-2',
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {item.id.startsWith('temp-') ? (
                <span className="font-semibold">{item.name}</span>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  title={`Open ${item.displayId}`}
                  className="max-w-full truncate text-left font-semibold hover:underline"
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    // the panel returns focus here when it closes
                    e.currentTarget.focus();
                    p.onOpenItem(item);
                  }}
                >
                  {item.name}
                </button>
              )}
            </span>
            {item.locked ? (
              <span
                className="text-muted-foreground shrink-0"
                title={item.lockReason ? `Locked: ${item.lockReason}` : 'Locked'}
              >
                <Lock className="size-3.5" aria-hidden />
                <span className="sr-only">
                  {item.lockReason ? `Locked: ${item.lockReason}` : 'Locked'}
                </span>
              </span>
            ) : null}
            <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
              {item.displayId}
            </span>
            {isEditing('name') ? (
              <CellEditor
                width={Math.max(280, p.nameWidth)}
                onCancel={p.onCancelEdit}
                editor={
                  <TextEditor
                    title={`${ctx.sheet.itemLabel} name`}
                    initial={item.name}
                    maxLength={500}
                    onCommit={(t) => p.onCommit(item, 'name', t)}
                    onCancel={p.onCancelEdit}
                  />
                }
              />
            ) : null}
          </div>
        </div>
      </Sticky>
      {vCols.map((vc) => {
        if (vc.index >= fieldCols.length) return null;
        const field = fieldCols[vc.index]!.field;
        const col = p.colIndex.get(field.id)!;
        return (
          <GridCell
            key={field.id}
            item={item}
            field={field}
            ctx={ctx}
            left={vc.start}
            width={vc.size}
            selected={inRange(col)}
            active={isActive(field.id)}
            editing={isEditing(field.id)}
            readOnly={!editable || explainOnly(field)}
            onMouseDown={p.onMouseDown}
            onDoubleClick={p.onDoubleClick}
            onCommit={p.onCommit}
            onCancel={p.onCancelEdit}
            actions={p.actions}
            canEdit={editable}
            onOpenItem={p.onOpenItem}
          />
        );
      })}
    </>
  );
});

const GridCell = memo(function GridCell({
  item,
  field,
  ctx,
  left,
  width,
  selected,
  active,
  editing,
  readOnly,
  canEdit,
  onMouseDown,
  onDoubleClick,
  onCommit,
  onCancel,
  actions,
  onOpenItem,
}: {
  item: Item;
  field: Field;
  ctx: Ctx;
  left: number;
  width: number;
  selected: boolean;
  active: boolean;
  editing: boolean;
  readOnly: boolean;
  canEdit: boolean;
  onMouseDown(e: React.MouseEvent): void;
  onDoubleClick(e: React.MouseEvent): void;
  onCommit(item: Item, col: string, raw: unknown): void;
  onCancel(): void;
  actions: SheetActions;
  onOpenItem(item: Item): void;
}) {
  const ui = fieldUI(field.type);
  const value = cellValue(item, field, ctx);
  const def = resolveFieldType(field.type)!;
  const missing = field.required && def.storage === 'values' && def.isEmpty(value as never);
  return (
    <div
      id={cellId(item.id, field.id)}
      role="gridcell"
      aria-selected={selected}
      aria-readonly={readOnly || undefined}
      aria-label={missing ? `${field.name}: required, empty` : undefined}
      data-cell={`${item.id}|${field.id}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        'border-line absolute top-0 flex h-full items-center overflow-hidden border-r border-b px-2 text-[13px]',
        selected && 'bg-sel',
        active && 'outline-focus z-[1] outline-2 -outline-offset-2',
      )}
      style={{ left, width }}
    >
      <ui.Cell value={value as never} field={field} item={item} ctx={ctx} density="grid" />
      {missing ? (
        <span
          aria-hidden
          title="Required"
          className="absolute top-0 right-0 size-0 border-t-[7px] border-l-[7px] border-t-[var(--crit)] border-l-transparent"
        />
      ) : null}
      {editing ? (
        <CellEditor
          width={ui.editorWidth ?? Math.max(260, width)}
          onCancel={onCancel}
          editor={
            <ui.Editor
              value={value as never}
              field={field}
              item={item}
              ctx={ctx}
              onCommit={(v) => onCommit(item, field.id, v)}
              onCancel={onCancel}
              onCommitField={canEdit ? (fieldId, v) => onCommit(item, fieldId, v) : undefined}
              onButton={
                canEdit
                  ? () => {
                      onCancel();
                      void actions.clickButton(item, field);
                    }
                  : undefined
              }
              onOpenItem={() => {
                onCancel();
                onOpenItem(item);
              }}
            />
          }
        />
      ) : null}
    </div>
  );
});

function CellEditor({
  width,
  editor,
  onCancel,
}: {
  width: number;
  editor: React.ReactNode;
  onCancel(): void;
}) {
  return (
    <Popover open onOpenChange={(o) => !o && onCancel()}>
      <PopoverAnchor asChild>
        <span className="absolute inset-0" aria-hidden />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={2}
        className="p-3"
        style={{ width: Math.min(width, 420) }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {editor}
      </PopoverContent>
    </Popover>
  );
}

function AddRow(p: RowProps & { row: Extract<GridRow, { kind: 'add' }> }) {
  const { row, ctx } = p;
  const [name, setName] = useState('');
  const drop = useDroppable({
    id: `add:${row.group.id}`,
    data: { type: 'group', groupId: row.group.id, at: 'end' },
  });
  return (
    <Sticky width={p.stickyW} color={row.group.color} className={cn(drop.isOver && 'bg-sel')}>
      <div ref={drop.setNodeRef} className="flex h-full w-full items-center pl-14">
        <input
          ref={p.addRef}
          className="placeholder:text-muted-foreground h-full w-full bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset"
          placeholder={`+ Add ${ctx.sheet.itemLabel.toLowerCase()}`}
          aria-label={`Add ${ctx.sheet.itemLabel.toLowerCase()} to ${row.group.name}`}
          value={name}
          maxLength={500}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const n = name.trim();
              if (!n) return;
              setName('');
              void p.onAdd(row.group, n);
            } else if (e.key === 'Escape') {
              setName('');
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
    </Sticky>
  );
}

function SummaryRow(p: RowProps & { row: Extract<GridRow, { kind: 'summary' }> }) {
  const { row, ctx, fieldCols, vCols } = p;
  return (
    <>
      <Sticky width={p.stickyW} color={row.group.color} className="border-b-0">
        <span className="sr-only">Summary of {row.group.name}</span>
      </Sticky>
      {vCols.map((vc) => {
        if (vc.index >= fieldCols.length) return null;
        const field = fieldCols[vc.index]!.field;
        return (
          <div
            key={field.id}
            role="gridcell"
            className="border-line absolute top-0 flex h-full items-center border-r border-b px-2"
            style={{ left: vc.start, width: vc.size }}
          >
            <GroupSummary field={field} items={row.items} ctx={ctx} fn={p.summaries[field.id]} />
          </div>
        );
      })}
    </>
  );
}
