'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { GripVertical, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { copyRange, planClear, planPaste, type GridColumn } from '@/engine/clipboard';
import { resolveFieldType } from '@/engine/fields/resolve';
import { ownerField, ownerOf } from '@/engine/item-panel';
import { donePercent } from '@/engine/views/group-by';
import { keysBetween } from '@/engine/ordering';
import type { SheetData } from '@/engine/sheet-data';
import type { SummaryFn } from '@/engine/summaries';
import type { Ctx, Field, Group, Item } from '@/engine/types';
import { setSummary, type ViewConfig } from '@/engine/views/config';
import { fieldUI } from '@/components/fields/registry';
import {
  Avatar,
  cellValue,
  colorVar,
  editorPopoverClass,
  TextEditor,
} from '@/components/fields/shared';
import type { EditorProps } from '@/components/fields/types';
import { FieldPicker } from '@/components/grid/field-picker';
import { useGrid, useGridStore, type CellRef } from '@/components/grid/grid-store';
import { useValueCommit } from '@/components/grid/use-commit';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ColumnHeader } from './column-header';
import { GroupSummary } from './group-summary';
import { GroupTitle, groupTint } from './group-title';
import { useTableGroups } from './use-table-groups';
import {
  buildLayout,
  byPosition,
  columnId,
  HEADER_HEIGHT,
  positionsAtEnd,
  rangeOf,
  ROW_HEIGHT,
  step,
  tableColumns,
  type TableRow,
} from './table-model';

// The Table view (docs/05 §3.1, FR-21, FR-22): one sticky column header for the whole sheet, groups as collapsible
// sections with a coloured title row, readable two-line rows (name, then id and owner), "+ Add" per group and
// optional summary rows. Groups are flattened into one row list and virtualised (rows and columns), so 10,000 rows
// stay fast. The grid element keeps keyboard focus and points at the active cell with aria-activedescendant, so
// focus survives virtualisation.

const ADD_COL = 48;
const CHECK_W = 64;
const BAR_W = 4;
const cellId = (itemId: string, col: string) => `cell-${itemId}-${col}`;

export interface TableProps {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  canEdit: boolean;
  isAdmin: boolean;
  onlyGroup: string | null;
  nameWidth: number;
  /** Focus requests for the first group's "+ Add" (the header's New item button). */
  addFocusTick: number;
  /** Open the item panel (name click, Space on the name cell, "Open item" in file cells). */
  onOpenItem(item: Item): void;
  /** The items the active view shows (filters and search). */
  visibleItems: Item[];
  /** The view's sort. */
  viewCompare: ((a: Item, b: Item) => number) | null;
  /** The active view's config: sort and column summaries live there. */
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
}

const storageOf = (f: Field) => resolveFieldType(f.type)?.storage;

/** Read-only values whose editor only explains them (computed, files, buttons). */
const explainOnly = (f: Field) => {
  const s = storageOf(f);
  return s === 'computed' || s === 'files' || s === 'none';
};

/**
 * A callback that keeps its identity across renders and always calls the latest `fn`. Rows are memoised: handlers
 * that changed identity on every render made every visible row render again on every scrolled frame (M10 perf).
 */
function useStableEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

export function Table({
  data,
  ctx,
  actions,
  canEdit,
  isAdmin,
  onlyGroup,
  nameWidth,
  addFocusTick,
  onOpenItem,
  visibleItems,
  viewCompare,
  config,
  setConfig,
}: TableProps) {
  const store = useGridStore();
  const collapsed = useGrid((s) => s.collapsed);
  const hidden = useGrid((s) => s.hidden);
  const widths = useGrid((s) => s.widths);
  const active = useGrid((s) => s.active);
  const anchor = useGrid((s) => s.anchor);
  const editing = useGrid((s) => s.editing);
  const selected = useGrid((s) => s.selected);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The key typed on a cell that opened its editor (type to edit). */
  const [seed, setSeed] = useState<string | null>(null);

  const sort = config.sort.length === 1 ? config.sort[0]! : null;
  const summaries = config.summaries;
  const columns = useMemo(() => tableColumns(data.fields, hidden), [data.fields, hidden]);
  const fieldCols = useMemo(
    () => columns.filter((c): c is Extract<GridColumn, { kind: 'field' }> => c.kind === 'field'),
    [columns],
  );
  const showSummaries = !!summaries && fieldCols.some((c) => summaries[c.field.key]);
  const tg = useTableGroups({
    groups: data.groups,
    sheetId: data.sheet.id,
    ctx,
    items: visibleItems,
    onlyGroup,
  });
  const layout = useMemo(
    () =>
      buildLayout({
        groups: tg.groups,
        items: visibleItems,
        collapsed,
        compare: viewCompare,
        canAdd: canEdit && !tg.virtual,
        summaries: showSummaries,
        onlyGroup: tg.onlyGroup,
        groupOf: tg.groupOf,
      }),
    [tg, visibleItems, collapsed, viewCompare, canEdit, showSummaries],
  );
  const owner = useMemo(() => ownerField(ctx), [ctx]);
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
    // the rows start below the sticky column header
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
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
  // the same range object while the selection stays put, so memoised rows do not render again
  const rangeKey =
    activePos && anchorPos
      ? `${anchorPos.row},${anchorPos.col},${activePos.row},${activePos.col}`
      : '';
  const range = useMemo(() => {
    if (!rangeKey) return null;
    const [ar, ac, br, bc] = rangeKey.split(',').map(Number) as [number, number, number, number];
    return rangeOf({ row: ar, col: ac }, { row: br, col: bc });
  }, [rangeKey]);

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

  const startEdit = (cell: CellRef, typed: string | null = null) => {
    const item = layout.flat[layout.index.get(cell.itemId) ?? -1];
    if (!item) return;
    const field = cell.col === 'name' ? null : data.fields.find((f) => f.id === cell.col);
    if (field && explainOnly(field)) {
      setSeed(null);
      return store.getState().edit(cell);
    }
    if (!canEdit) return toast('You can view this sheet. Ask an editor or admin to change it.');
    if (item.id.startsWith('temp-')) return;
    if (!canEditItem(item)) return toast.error(lockedMessage(item));
    setSeed(typed);
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
      void applyWrites(plan);
    } else if (e.key === 'Escape') {
      store.getState().focus(active);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type to edit: the key opens the editor and becomes its first character
      if (
        column.kind === 'field' &&
        (fieldUI(column.field.type).toggle || explainOnly(column.field))
      )
        return;
      e.preventDefault();
      startEdit(active, e.key);
    }
  };

  const applyWrites = async (plan: ReturnType<typeof planClear>) => {
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
    void applyWrites(plan);
  };

  // ───────────── commits ─────────────

  const valueCommit = useValueCommit(data, ctx, actions, { hold: true });
  const commit = async (item: Item, col: string, raw: unknown, note?: string) => {
    store.getState().edit(null);
    setSeed(null);
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

  const selectItems = (items: Item[], checked: boolean) => {
    const next = new Set(store.getState().selected);
    for (const it of items) {
      if (checked) next.add(it.id);
      else next.delete(it.id);
    }
    store.getState().setSelected(next);
  };

  // ───────────── add items ─────────────

  // Held rows (see useSheetActions): leaving a row finishes every other held row.
  const finishAllRef = useRef(actions.finishAll);
  finishAllRef.current = actions.finishAll;
  useEffect(
    () =>
      store.subscribe((s, prev) => {
        if (s.active?.itemId !== prev.active?.itemId)
          finishAllRef.current(s.active?.itemId ?? null);
      }),
    [store],
  );

  const addItem = async (group: Group, name: string) => {
    // after every item of the group, also those a filter hides, so keys never collide
    const list = data.items.filter((i) => i.groupId === group.id).sort(byPosition);
    const [position] = positionsAtEnd(list, 1);
    await actions.createItem(
      group.id,
      name,
      position!,
      (tempId, saved) => {
        // a cell of the new row may already be active: follow the row to its saved id
        const s = store.getState();
        const swap = (c: CellRef | null) =>
          c && c.itemId === tempId ? { ...c, itemId: saved.id } : c;
        if (s.active?.itemId === tempId || s.anchor?.itemId === tempId)
          store.setState({ active: swap(s.active), anchor: swap(s.anchor) });
      },
      { hold: true },
    );
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

  // ───────────── "More columns →" ─────────────

  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [fieldCols.length, widths]);

  // ───────────── render ─────────────

  const onMouseDownStable = useStableEvent(onMouseDown);
  const onDoubleClickStable = useStableEvent(onDoubleClick);
  const selectRowStable = useStableEvent(selectRow);
  const selectItemsStable = useStableEvent(selectItems);
  const addItemStable = useStableEvent(addItem);
  const commitStable = useStableEvent(commit);
  const openItemStable = useStableEvent(onOpenItem);
  const cancelEditStable = useStableEvent(() => {
    store.getState().edit(null);
    setSeed(null);
    focusGrid();
  });
  const fieldPropsStable = useStableEvent((field: Field) =>
    valueCommit.fieldProps(field, { canEdit, isAdmin }, () => store.getState().edit(null)),
  );

  const vRows = rowV.getVirtualItems();
  const vCols = colV.getVirtualItems();
  const totalW = colV.getTotalSize();
  const dragDisabled = config.sort.length > 0 || !canEdit || tg.virtual;
  const activeId =
    active && rowIndexOfItem.has(active.itemId) ? cellId(active.itemId, active.col) : undefined;
  const editingItem = editing ? layout.flat[layout.index.get(editing.itemId) ?? -1] : undefined;
  const shownItems = useMemo(
    () =>
      [...layout.byGroup.entries()]
        .filter(([g]) => !onlyGroup || g === onlyGroup)
        .flatMap(([, l]) => l),
    [layout.byGroup, onlyGroup],
  );

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
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          role="grid"
          aria-label={`${ctx.sheet.name} table`}
          aria-rowcount={layout.flat.length + 1}
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
          className="grid-scroll relative min-h-0 flex-1 overflow-auto bg-white outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]"
        >
          <HeaderRow
            ctx={ctx}
            width={totalW}
            stickyW={stickyW}
            fieldCols={fieldCols}
            vCols={vCols}
            widthOf={widthOf}
            canEdit={canEdit}
            isAdmin={isAdmin}
            allFields={data.fields}
            actions={actions}
            sort={sort}
            setConfig={setConfig}
            summaries={summaries}
            shownItems={shownItems}
            selected={selected}
            onSelectItems={selectItemsStable}
          />
          <div style={{ height: rowV.getTotalSize(), width: totalW, position: 'relative' }}>
            {vRows.map((vr) => {
              const row = layout.rows[vr.index]!;
              return (
                <div
                  key={row.key}
                  role={row.kind === 'gap' ? 'presentation' : 'row'}
                  aria-rowindex={row.kind === 'item' ? row.index + 2 : undefined}
                  className="absolute top-0 left-0 flex"
                  style={{
                    height: vr.size,
                    width: totalW,
                    transform: `translateY(${vr.start - rowV.options.scrollMargin}px)`,
                  }}
                >
                  <RowContent
                    row={row}
                    ctx={ctx}
                    stickyW={stickyW}
                    nameWidth={nameWidth}
                    fieldCols={fieldCols}
                    vCols={vCols}
                    canEdit={canEdit}
                    canEditItem={canEditItem}
                    owner={owner}
                    active={active}
                    range={range}
                    colIndex={colIndex}
                    selected={selected}
                    editing={editing}
                    seed={seed}
                    summaries={summaries}
                    dragDisabled={dragDisabled}
                    actions={actions}
                    onMouseDown={onMouseDownStable}
                    onDoubleClick={onDoubleClickStable}
                    onSelectRow={selectRowStable}
                    onSelectItems={selectItemsStable}
                    onAdd={addItemStable}
                    addRef={row.key === firstAddGroup ? firstAddRef : undefined}
                    groupItems={layout.byGroup}
                    onCommit={commitStable}
                    onOpenItem={openItemStable}
                    onCancelEdit={cancelEditStable}
                    fieldProps={fieldPropsStable}
                    editingItem={editingItem}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {more ? (
          <div
            className="pointer-events-none absolute top-0 right-0 bottom-0 z-[5] flex w-[130px] items-center justify-end"
            style={{
              background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.96) 70%)',
            }}
          >
            <button
              type="button"
              className="border-line hover:border-ink focus-visible:outline-focus pointer-events-auto mr-2 rounded-full border bg-white px-3 py-1 text-xs font-bold shadow-sm focus-visible:outline-2"
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollBy({ left: el.clientWidth * 0.6, behavior: 'smooth' });
              }}
            >
              More columns →
            </button>
          </div>
        ) : null}
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

// ───────────────────────── the column header ─────────────────────────

function HeaderRow(p: {
  ctx: Ctx;
  width: number;
  stickyW: number;
  fieldCols: Extract<GridColumn, { kind: 'field' }>[];
  vCols: { index: number; start: number; size: number; key: React.Key }[];
  widthOf(f: Field): number;
  canEdit: boolean;
  isAdmin: boolean;
  allFields: Field[];
  actions: SheetActions;
  sort: { fieldKey: string; dir: 'asc' | 'desc' } | null;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  summaries: ViewConfig['summaries'];
  shownItems: Item[];
  selected: ReadonlySet<string>;
  onSelectItems(items: Item[], checked: boolean): void;
}) {
  const store = useGridStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const allSelected = p.shownItems.length > 0 && p.shownItems.every((i) => p.selected.has(i.id));
  return (
    <div
      role="row"
      aria-rowindex={1}
      className="sticky top-0 z-[4] flex"
      style={{ height: HEADER_HEIGHT, width: p.width }}
    >
      <div
        role="columnheader"
        className="border-line bg-soft sticky left-0 z-[2] flex shrink-0 items-center border-r border-b"
        style={{ width: p.stickyW, paddingLeft: BAR_W }}
      >
        {p.canEdit ? (
          <span className="flex w-8 shrink-0 justify-center">
            <input
              type="checkbox"
              aria-label="Select all items"
              checked={allSelected}
              disabled={p.shownItems.length === 0}
              onChange={(e) => p.onSelectItems(p.shownItems, e.target.checked)}
            />
          </span>
        ) : null}
        <span
          className="text-meta text-muted-foreground flex-1 truncate px-2 font-semibold tracking-wide uppercase"
          style={{ paddingLeft: p.canEdit ? 28 : 8 }}
        >
          {p.ctx.sheet.itemLabel}
        </span>
      </div>
      {p.vCols.map((vc) => {
        if (vc.index >= p.fieldCols.length)
          return (
            <div
              key="__add"
              role="columnheader"
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
                    onPick={(type, name) => {
                      setPickerOpen(false);
                      void p.actions.addField(type, undefined, name);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          );
        const field = p.fieldCols[vc.index]!.field;
        const index = p.allFields.findIndex((f) => f.id === field.id);
        return (
          <div
            key={field.id}
            className="bg-soft absolute top-0 h-full"
            style={{ left: vc.start, width: vc.size }}
          >
            <ColumnHeader
              field={field}
              width={p.widthOf(field)}
              ctx={p.ctx}
              canEdit={p.canEdit}
              isAdmin={p.isAdmin}
              sorted={p.sort?.fieldKey === field.key ? p.sort.dir : null}
              summary={p.summaries?.[field.key]}
              first={index === 0}
              last={index === p.allFields.length - 1}
              dragDisabled={!p.canEdit}
              actions={{
                sort: (dir) =>
                  p.setConfig((c) => ({ ...c, sort: dir ? [{ fieldKey: field.key, dir }] : [] })),
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
                summary: (fn: SummaryFn | null) => p.setConfig((c) => setSummary(c, field.key, fn)),
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
    </div>
  );
}

// ───────────────────────── rows ─────────────────────────

interface RowProps {
  row: TableRow;
  onOpenItem(item: Item): void;
  ctx: Ctx;
  stickyW: number;
  nameWidth: number;
  fieldCols: Extract<GridColumn, { kind: 'field' }>[];
  vCols: { index: number; start: number; size: number; key: React.Key }[];
  canEdit: boolean;
  canEditItem(item: Item): boolean;
  /** The sheet's owner field (first people field), shown under the name. */
  owner: Field | null;
  active: CellRef | null;
  range: { top: number; left: number; bottom: number; right: number } | null;
  colIndex: Map<string, number>;
  selected: ReadonlySet<string>;
  editing: CellRef | null;
  editingItem: Item | undefined;
  seed: string | null;
  summaries: ViewConfig['summaries'];
  dragDisabled: boolean;
  actions: SheetActions;
  onMouseDown(e: React.MouseEvent): void;
  onDoubleClick(e: React.MouseEvent): void;
  onSelectRow(item: Item, checked: boolean, shift: boolean): void;
  onSelectItems(items: Item[], checked: boolean): void;
  onAdd(group: Group, name: string): Promise<void>;
  addRef?: React.RefObject<HTMLInputElement | null>;
  groupItems: Map<string, Item[]>;
  onCommit(item: Item, col: string, raw: unknown): void;
  onCancelEdit(): void;
  /** "Add …" and "Edit options" for the open editor (people who may edit the field). */
  fieldProps(field: Field): Pick<EditorProps, 'onAddOption' | 'onEditField'>;
}

/** The sticky left part of a row: room for the group bar (only the title row draws it), then the checkbox, handle and name. */
function Sticky({
  width,
  children,
  className,
  role = 'gridcell',
}: {
  width: number;
  /** Kept by callers; only the group title row carries the colour bar. */
  color?: string;
  children?: React.ReactNode;
  className?: string;
  /** Rows own only cells (ARIA grid): the sticky part is a cell of its own, or none when it wraps the name cell. */
  role?: 'gridcell' | 'none';
}) {
  return (
    <div
      role={role}
      className={cn(
        'border-line sticky left-0 z-[2] flex shrink-0 items-center border-r border-b bg-white',
        className,
      )}
      style={{ width, borderLeft: `${BAR_W}px solid transparent` }}
    >
      {children}
    </div>
  );
}

function RowContent(p: RowProps) {
  const { row } = p;
  if (row.kind === 'gap') return null;
  if (row.kind === 'group') return <GroupRow {...p} row={row} />;
  if (row.kind === 'item') return <ItemRow {...p} row={row} />;
  if (row.kind === 'add') return <AddRow {...p} row={row} />;
  return <SummaryRow {...p} row={row} />;
}

function GroupRow(p: RowProps & { row: Extract<TableRow, { kind: 'group' }> }) {
  const { row } = p;
  const store = useGridStore();
  const drop = useDroppable({
    id: `group:${row.group.id}`,
    data: { type: 'group', groupId: row.group.id, at: 'top' },
  });
  const items = p.groupItems.get(row.group.id) ?? [];
  const allSelected = items.length > 0 && items.every((i) => p.selected.has(i.id));
  return (
    <div
      ref={drop.setNodeRef}
      role="gridcell"
      className={cn('border-line flex w-full items-center border-b', drop.isOver && 'bg-sel')}
      style={{
        borderLeft: `${BAR_W}px solid ${colorVar(row.group.color)}`,
        background: drop.isOver ? undefined : groupTint(row.group.color),
      }}
    >
      <div className="sticky left-0 flex items-center gap-1">
        {p.canEdit ? (
          <span className="flex w-8 shrink-0 justify-center">
            <input
              type="checkbox"
              aria-label={`Select all items in ${row.group.name}`}
              checked={allSelected}
              disabled={items.length === 0}
              onChange={(e) => p.onSelectItems(items, e.target.checked)}
            />
          </span>
        ) : null}
        <GroupTitle
          group={row.group}
          count={row.count}
          donePct={donePercent(items, p.ctx)}
          collapsed={row.collapsed}
          onToggle={() => store.getState().toggleCollapsed(row.group.id)}
        />
      </div>
    </div>
  );
}

const ItemRow = memo(function ItemRow(p: RowProps & { row: Extract<TableRow, { kind: 'item' }> }) {
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
  const ownerId = p.owner ? ownerOf(item, p.owner, ctx) : null;
  const ownerName = ownerId ? (ctx.people.get(ownerId)?.name ?? 'Former member') : null;
  return (
    <>
      <Sticky
        width={p.stickyW}
        color={row.group.color}
        role="none"
        className={cn(
          isSelected && 'bg-sel',
          drop.isOver && 'shadow-[inset_0_2px_0_var(--focus)]',
          drag.isDragging && 'opacity-40',
        )}
      >
        {/* the name cell holds the row's checkbox and drag handle too (rows own only cells) */}
        <div
          ref={drop.setNodeRef}
          id={cellId(item.id, 'name')}
          role="gridcell"
          aria-selected={inRange(0)}
          aria-readonly={!editable || undefined}
          className="flex h-full w-full items-center"
        >
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
            data-cell={`${item.id}|name`}
            onMouseDown={p.onMouseDown}
            onDoubleClick={p.onDoubleClick}
            className={cn(
              'relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-center gap-0.5 px-2',
              inRange(0) && 'bg-sel',
              isActive('name') && 'outline-focus z-[1] outline-2 -outline-offset-2',
            )}
          >
            <span className="text-cell flex min-w-0 items-center leading-tight">
              {item.id.startsWith('temp-') ? (
                <span className="truncate font-semibold">{item.name}</span>
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
            <span className="text-muted-foreground text-meta flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 font-mono">{item.displayId}</span>
              {ownerId ? (
                <>
                  <span aria-hidden>·</span>
                  <Avatar id={ownerId} ctx={ctx} size={20} decorative />
                  <span className="truncate">{ownerName}</span>
                </>
              ) : null}
              {item.locked ? (
                <span
                  className="flex shrink-0 items-center gap-0.5"
                  title={item.lockReason ? `Locked: ${item.lockReason}` : 'Locked'}
                >
                  <Lock className="size-3" aria-hidden />
                  <span className="sr-only">
                    {item.lockReason ? `Locked: ${item.lockReason}` : 'Locked'}
                  </span>
                </span>
              ) : null}
              {p.actions.held.has(item.id) ? (
                <span
                  className="flex shrink-0 items-center gap-1"
                  title="Actions run when you finish this row"
                >
                  <span className="border-line text-ink rounded-full border px-1.5 leading-4">
                    Editing
                  </span>
                  <span className="sr-only">Actions run when you finish this row.</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="text-ink font-semibold underline-offset-2 hover:underline"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void p.actions.finishItem(item.id);
                    }}
                  >
                    Done
                  </button>
                </span>
              ) : null}
            </span>
            {isEditing('name') ? (
              <CellEditor
                width={Math.max(280, p.nameWidth)}
                onCancel={p.onCancelEdit}
                seed={p.seed}
                editor={
                  <TextEditor
                    title={`${ctx.sheet.itemLabel} name`}
                    initial={p.seed ?? item.name}
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
        const cellEditing = isEditing(field.id);
        return (
          <TableCell
            key={field.id}
            item={item}
            field={field}
            ctx={ctx}
            left={vc.start}
            width={vc.size}
            selected={inRange(col)}
            active={isActive(field.id)}
            editing={cellEditing}
            seed={cellEditing ? p.seed : null}
            readOnly={!editable || explainOnly(field)}
            onMouseDown={p.onMouseDown}
            onDoubleClick={p.onDoubleClick}
            onCommit={p.onCommit}
            onCancel={p.onCancelEdit}
            actions={p.actions}
            canEdit={editable}
            editorProps={cellEditing ? p.fieldProps(field) : undefined}
            onOpenItem={p.onOpenItem}
          />
        );
      })}
    </>
  );
});

const TableCell = memo(function TableCell({
  item,
  field,
  ctx,
  left,
  width,
  selected,
  active,
  editing,
  seed,
  readOnly,
  canEdit,
  onMouseDown,
  onDoubleClick,
  onCommit,
  onCancel,
  actions,
  onOpenItem,
  editorProps,
}: {
  item: Item;
  field: Field;
  ctx: Ctx;
  left: number;
  width: number;
  selected: boolean;
  active: boolean;
  editing: boolean;
  seed: string | null;
  readOnly: boolean;
  canEdit: boolean;
  onMouseDown(e: React.MouseEvent): void;
  onDoubleClick(e: React.MouseEvent): void;
  onCommit(item: Item, col: string, raw: unknown): void;
  onCancel(): void;
  actions: SheetActions;
  onOpenItem(item: Item): void;
  editorProps?: Pick<EditorProps, 'onAddOption' | 'onEditField'>;
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
        'border-line text-cell absolute top-0 flex h-full items-center overflow-hidden border-r border-b px-2 hover:shadow-[inset_0_0_0_1.5px_#9AA3B5] [&_[data-pill]]:-mx-1.5',
        selected && 'bg-sel',
        active && 'outline-focus z-[1] outline-2 -outline-offset-2',
      )}
      style={{ left, width }}
    >
      <ui.Cell value={value as never} field={field} item={item} ctx={ctx} density="list" />
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
          seed={seed}
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
              {...editorProps}
            />
          }
        />
      ) : null}
    </div>
  );
});

/**
 * The editor popover anchored to a cell. With a `seed` (the key typed on the cell), the editor's focused text box
 * starts with that character, as typing into a spreadsheet cell does.
 */
function CellEditor({
  width,
  editor,
  onCancel,
  seed = null,
}: {
  width: number;
  editor: React.ReactNode;
  onCancel(): void;
  seed?: string | null;
}) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!seed) return;
    const frame = requestAnimationFrame(() => {
      const el = document.activeElement;
      if (!content.current?.contains(el)) return;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      if (el instanceof HTMLInputElement && !['text', 'search', ''].includes(el.type)) return;
      if (el.value !== seed) {
        // set through the native setter so React sees the change
        const proto = el instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement;
        Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, seed);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // carry on typing after the key, not over it
      el.setSelectionRange(seed.length, seed.length);
    });
    return () => cancelAnimationFrame(frame);
    // only when the editor opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Popover open onOpenChange={(o) => !o && onCancel()}>
      <PopoverAnchor asChild>
        <span className="absolute inset-0" aria-hidden />
      </PopoverAnchor>
      <PopoverContent
        ref={content}
        align="start"
        sideOffset={2}
        className={editorPopoverClass}
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

function AddRow(p: RowProps & { row: Extract<TableRow, { kind: 'add' }> }) {
  const { row, ctx } = p;
  const [name, setName] = useState('');
  const drop = useDroppable({
    id: `add:${row.group.id}`,
    data: { type: 'group', groupId: row.group.id, at: 'end' },
  });
  const label = ctx.sheet.itemLabel.toLowerCase();
  return (
    <Sticky width={p.stickyW} color={row.group.color} className={cn(drop.isOver && 'bg-sel')}>
      <div ref={drop.setNodeRef} className="flex h-full w-full items-center pl-14">
        <input
          ref={p.addRef}
          className="placeholder:text-muted-foreground text-cell h-full w-full bg-transparent px-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset"
          placeholder={`+ Add ${label}`}
          aria-label={`Add ${label} to ${row.group.name}`}
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

function SummaryRow(p: RowProps & { row: Extract<TableRow, { kind: 'summary' }> }) {
  const { row, ctx, fieldCols, vCols } = p;
  return (
    <>
      <Sticky width={p.stickyW} color={row.group.color}>
        <span className="text-muted-foreground text-meta px-3 font-semibold">
          Summary<span className="sr-only"> of {row.group.name}</span>
        </span>
      </Sticky>
      {vCols.map((vc) => {
        if (vc.index >= fieldCols.length) return null;
        const field = fieldCols[vc.index]!.field;
        const fn = p.summaries?.[field.key];
        return (
          <div
            key={field.id}
            role="gridcell"
            className="border-line bg-soft/60 absolute top-0 flex h-full items-center border-r border-b px-2"
            style={{ left: vc.start, width: vc.size }}
          >
            {fn ? (
              <span className="block w-full min-w-0">
                <GroupSummary field={field} items={row.items} ctx={ctx} fn={fn} />
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
