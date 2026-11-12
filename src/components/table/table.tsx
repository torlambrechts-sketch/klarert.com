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
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  Archive,
  ExternalLink,
  FileText,
  GripVertical,
  Lock,
  LockOpen,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { copyRange, planClear, planPaste, type GridColumn } from '@/engine/clipboard';
import { resolveFieldType } from '@/engine/fields/resolve';
import { ownerField, ownerOf } from '@/engine/item-panel';
import { donePercent } from '@/engine/views/group-by';
import { keysBetween } from '@/engine/ordering';
import type { SheetData } from '@/engine/sheet-data';
import { columnSummaries, type SummaryFn } from '@/engine/summaries';
import type { Ctx, Field, Group, Item } from '@/engine/types';
import { setSummary, type ViewConfig } from '@/engine/views/config';
import { trendPolarity } from '@/engine/values/trend';
import { fieldUI } from '@/components/fields/registry';
import { cellValue, editorPopoverClass, TextEditor } from '@/components/fields/shared';
import { TrendContext } from '@/components/fields/trend';
import type { EditorProps } from '@/components/fields/types';
import { FieldPicker } from '@/components/grid/field-picker';
import { useGrid, useGridStore, type CellRef } from '@/components/grid/grid-store';
import { useValueCommit } from '@/components/grid/use-commit';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ColumnHeader, type ColumnMenuActions } from './column-header';
import { GroupSummary } from './group-summary';
import { GroupTitle } from './group-title';
import { LockDialog } from './lock-dialog';
import { useDocumentTop } from './use-document-top';
import { useTableGroups } from './use-table-groups';
import { useTrendHistory } from './use-trends';
import {
  buildLayout,
  byPosition,
  columnId,
  endsCard,
  trailWidth,
  positionsAtEnd,
  rangeOf,
  rowHeight,
  step,
  tableColumns,
  type Density,
  type TableRow,
} from './table-model';

// The Table view (docs/05 §3.1): each group is a card spanning the content width: a title row (chevron, dot, name,
// item count), its own column header (select all, small muted names, "+" add column), readable two-line rows
// (name, then id and owner), "+ Add" and a summary footer. Groups are flattened into one row list and virtualised
// (rows and columns), so 10,000 rows stay fast; columns stretch to fill the width and scroll only when they do not
// fit. The grid element keeps keyboard focus and points at the active cell with aria-activedescendant, so focus
// survives virtualisation. Shift+F10 opens the active row's actions menu.

/**
 * The trailing column: "+" in the column headers, the row actions menu in item rows. At least this wide; it takes
 * the room the columns leave in the card, so "+" follows the last column and "…" sits at the card's right edge.
 */
const TRAIL = 44;
/**
 * The leading part of the sticky column: 16 px (the drag handle), the sheet's 28 px round row icon, 14 px before the
 * name. The checkbox replaces the icon on hover, focus or selection.
 */
const CHECK_W = 58;
/** A column that shows a score with its meter and trend line is at least this wide. */
const SCORE_W = 150;
/** The card's left and right borders. */
const EDGE = 2;
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
  /** Updates (comments) per item, for the bubble after the name. */
  updateCounts: ReadonlyMap<string, number>;
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
  updateCounts,
}: TableProps) {
  const store = useGridStore();
  const collapsed = useGrid((s) => s.collapsed);
  const hidden = useGrid((s) => s.hidden);
  const widths = useGrid((s) => s.widths);
  const active = useGrid((s) => s.active);
  const anchor = useGrid((s) => s.anchor);
  const editing = useGrid((s) => s.editing);
  const selected = useGrid((s) => s.selected);
  const density = useGrid((s) => s.density);
  const rowMenu = useGrid((s) => s.rowMenu);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lockFor, setLockFor] = useState<Item[] | null>(null);
  // the width the columns stretch to fill
  const [viewW, setViewW] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The key typed on a cell that opened its editor (type to edit). */
  const [seed, setSeed] = useState<string | null>(null);

  const sort = config.sort.length === 1 ? config.sort[0]! : null;
  const columns = useMemo(() => tableColumns(data.fields, hidden), [data.fields, hidden]);
  const fieldCols = useMemo(
    () => columns.filter((c): c is Extract<GridColumn, { kind: 'field' }> => c.kind === 'field'),
    [columns],
  );
  // number, option and date columns show a summary unless switched off; others when chosen
  const summaries = useMemo(
    () =>
      columnSummaries(
        fieldCols.map((c) => c.field),
        config.summaries,
        config.summaryOff,
        ctx,
      ),
    [fieldCols, config.summaries, config.summaryOff, ctx],
  );
  const showSummaries = Object.keys(summaries).length > 0;
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
  // trend lines (comfortable density): the history loads after the sheet; columns that show one get its width
  // up front, unless the person sized them, so nothing shifts when it arrives
  const showTrends = density === 'comfortable';
  const trendHistory = useTrendHistory(data, showTrends);
  const trendState = useMemo(
    () => ({ show: showTrends, history: trendHistory }),
    [showTrends, trendHistory],
  );
  const baseWidth = useCallback(
    (f: Field) => {
      const w = widths[f.id] ?? f.width ?? resolveFieldType(f.type)?.defaultWidth ?? 140;
      return showTrends && trendPolarity(f) !== null && widths[f.id] === undefined
        ? Math.max(w, SCORE_W)
        : w;
    },
    [widths, showTrends],
  );
  const stickyW = CHECK_W + nameWidth;
  // columns keep their widths (wider tables scroll); the trailing column takes the room left in the card
  const widthOf = baseWidth;
  const trailW = useMemo(
    () =>
      trailWidth(
        fieldCols.map((c) => baseWidth(c.field)),
        stickyW + EDGE,
        viewW,
        TRAIL,
      ),
    [fieldCols, baseWidth, stickyW, viewW],
  );
  /** A width the person dragged to, in stored terms. */
  const toBase = useCallback((_f: Field, shown: number) => shown, []);

  const docTop = useDocumentTop(scrollRef);
  const rowV = useWindowVirtualizer({
    count: layout.rows.length,
    scrollMargin: docTop,
    // keyboard moves keep the active row clear of the sticky top bar
    scrollPaddingStart: 48,
    // the last row of a card also carries the card's bottom border (item and header rows draw their own line)
    estimateSize: (i) => {
      const kind = layout.rows[i]!.kind;
      const edge = kind !== 'item' && kind !== 'header' && endsCard(layout.rows, i) ? 1 : 0;
      return rowHeight(kind, density) + edge;
    },
    getItemKey: useCallback((i: number) => layout.rows[i]!.key, [layout.rows]),
    overscan: 10,
  });
  const colV = useVirtualizer({
    horizontal: true,
    count: fieldCols.length + 1,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (i < fieldCols.length ? widthOf(fieldCols[i]!.field) : trailW),
    getItemKey: useCallback(
      (i: number) => (i < fieldCols.length ? fieldCols[i]!.field.id : '__trail'),
      [fieldCols],
    ),
    paddingStart: stickyW,
    scrollPaddingStart: stickyW,
    overscan: 3,
  });
  useEffect(() => colV.measure(), [colV, widthOf, trailW, fieldCols, stickyW]);
  useEffect(() => rowV.measure(), [rowV, layout.rows, density]);
  /** ARIA row numbers: every row but the gaps between cards. */
  const ariaRows = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const r of layout.rows) if (r.kind !== 'gap') m.set(r.key, (n += 1));
    return { index: m, count: n };
  }, [layout.rows]);

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
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      if (!active || active.itemId.startsWith('temp-')) return;
      e.preventDefault();
      reveal({ row: activePos?.row ?? 0, col: columns.length });
      store.getState().openRowMenu(active.itemId);
      return;
    }
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
  const rowActionsStable = useStableEvent((item: Item, action: RowAction) => {
    store.getState().openRowMenu(null);
    if (action === 'open') return onOpenItem(item);
    if (action === 'archive') {
      const s = store.getState();
      if (s.selected.has(item.id)) {
        const next = new Set(s.selected);
        next.delete(item.id);
        s.setSelected(next);
      }
      return void actions.setArchived([item.id], true);
    }
    if (action === 'lock') return setLockFor([item]);
    if (action === 'unlock') return void actions.lockItem(item, false);
  });
  const columnActions = useStableEvent((field: Field, index: number): ColumnMenuActions => ({
    sort: (dir) => setConfig((c) => ({ ...c, sort: dir ? [{ fieldKey: field.key, dir }] : [] })),
    hide: () => {
      store.getState().setHidden(field.id, true);
      toast(`${field.name} hidden. Show it again from Columns.`);
    },
    settings: () => store.getState().openSettings(field.id),
    insert: (side) =>
      store
        .getState()
        .openAddField(side === 'left' ? { beforeFieldId: field.id } : { afterFieldId: field.id }),
    duplicate: () => void actions.duplicateField(field),
    move: (by) => void actions.moveField(field, Math.max(0, index + by)),
    remove: () => void actions.deleteField(field),
    summary: (fn: SummaryFn | null) => setConfig((c) => setSummary(c, field.key, fn)),
    resize: (w, done) => {
      const base = toBase(field, w);
      store.getState().setWidth(field.id, base);
      if (done)
        void actions
          .updateField(field, { width: base })
          .then(() => store.getState().setWidth(field.id, null));
    },
  }));

  const vRows = rowV.getVirtualItems();
  const vCols = colV.getVirtualItems();
  const totalW = colV.getTotalSize() + EDGE;
  const dragDisabled = config.sort.length > 0 || !canEdit || tg.virtual;
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
    <TrendContext.Provider value={trendState}>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="relative flex flex-col">
          <div
            ref={scrollRef}
            role="grid"
            aria-label={`${ctx.sheet.name} table`}
            aria-rowcount={ariaRows.count}
            aria-colcount={columns.length + 1}
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
            // rows scroll with the page; only wide tables scroll sideways here
            className="grid-scroll relative overflow-x-auto overflow-y-hidden rounded-lg outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]"
          >
            <div style={{ height: rowV.getTotalSize(), width: totalW, position: 'relative' }}>
              {vRows.map((vr) => {
                const row = layout.rows[vr.index]!;
                const first = row.kind === 'group';
                const last = endsCard(layout.rows, vr.index);
                return (
                  <div
                    key={row.key}
                    role={row.kind === 'gap' ? 'presentation' : 'row'}
                    aria-rowindex={ariaRows.index.get(row.key)}
                    className={cn(
                      'absolute top-0 left-0 flex',
                      row.kind !== 'gap' && 'border-line bg-background-100 overflow-clip border-x',
                      row.kind === 'item' && 'group/row',
                      first && 'rounded-t-[10px] border-t',
                      last && 'rounded-b-[10px]',
                      // item and header rows draw their own bottom line
                      last && row.kind !== 'item' && row.kind !== 'header' && 'border-b',
                    )}
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
                      isAdmin={isAdmin}
                      canEditItem={canEditItem}
                      owner={owner}
                      active={active}
                      range={range}
                      colIndex={colIndex}
                      selected={selected}
                      editing={editing}
                      seed={seed}
                      summaries={summaries}
                      sort={sort}
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
                      comments={row.kind === 'item' ? (updateCounts.get(row.item.id) ?? 0) : 0}
                      menuOpen={row.kind === 'item' && rowMenu === row.item.id}
                      onRowAction={rowActionsStable}
                      allFields={data.fields}
                      widthOf={widthOf}
                      columnActions={columnActions}
                      density={density}
                      endOfCard={last}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          {more ? (
            <div
              className="pointer-events-none absolute top-0 right-0 bottom-0 z-[5] flex w-[56px] items-start justify-end"
              style={{
                background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.9))',
              }}
            >
              <button
                type="button"
                // stays in view while the page scrolls past a long table
                className="border-line hover:border-line-strong focus-visible:outline-focus bg-background-100 text-label-12 pointer-events-auto sticky top-[50vh] mt-[60px] mr-2 shrink-0 rounded-full border px-3 py-1 font-medium whitespace-nowrap focus-visible:outline-2"
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
            <div className="bg-ink text-label-13 shadow-menu rounded-md px-3 py-1.5 font-semibold text-white">
              {selected.has(dragging.slice(4)) && selected.size > 1
                ? `${selected.size} items`
                : (layout.flat.find((i) => i.id === dragging.slice(4))?.name ?? '')}
            </div>
          ) : null}
        </DragOverlay>
        <LockDialog items={lockFor} actions={actions} onClose={() => setLockFor(null)} />
        {valueCommit.dialog}
      </DndContext>
    </TrendContext.Provider>
  );
}

// ───────────────────────── rows ─────────────────────────

type RowAction = 'open' | 'archive' | 'lock' | 'unlock';

interface RowProps {
  row: TableRow;
  onOpenItem(item: Item): void;
  ctx: Ctx;
  stickyW: number;
  nameWidth: number;
  fieldCols: Extract<GridColumn, { kind: 'field' }>[];
  vCols: { index: number; start: number; size: number; key: React.Key }[];
  canEdit: boolean;
  isAdmin: boolean;
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
  /** Field key → the summary its column shows. */
  summaries: Record<string, SummaryFn>;
  sort: { fieldKey: string; dir: 'asc' | 'desc' } | null;
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
  /** Updates (comments) on this row's item. */
  comments: number;
  /** The row actions menu is open (Shift+F10 or the "…" button). */
  menuOpen: boolean;
  onRowAction(item: Item, action: RowAction): void;
  allFields: Field[];
  widthOf(f: Field): number;
  columnActions(field: Field, index: number): ColumnMenuActions;
  density: Density;
  /** The row is the last of its group card. */
  endOfCard: boolean;
}

/** The sticky left part of a row: the leading controls and the name. */
function Sticky({
  width,
  children,
  className,
  role = 'gridcell',
}: {
  width: number;
  children?: React.ReactNode;
  className?: string;
  /** Rows own only cells (ARIA grid): the sticky part is a cell of its own, or none when it wraps the name cell. */
  role?: 'gridcell' | 'none' | 'columnheader';
}) {
  return (
    <div
      role={role}
      className={cn('bg-background-100 sticky left-0 z-[2] flex shrink-0 items-center', className)}
      style={{ width }}
    >
      {children}
    </div>
  );
}

function RowContent(p: RowProps) {
  const { row } = p;
  if (row.kind === 'gap') return null;
  if (row.kind === 'group') return <GroupRow {...p} row={row} />;
  if (row.kind === 'header') return <HeaderRow {...p} row={row} />;
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
  return (
    <div
      ref={drop.setNodeRef}
      role="gridcell"
      className={cn(
        'flex w-full items-center',
        !row.collapsed && 'border-b-line border-b',
        drop.isOver && 'bg-sel',
      )}
    >
      <div className="sticky left-0 flex items-center px-4">
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

/** The column header at the top of a group card: select all of the group, the column names, "+" add a column. */
function HeaderRow(p: RowProps & { row: Extract<TableRow, { kind: 'header' }> }) {
  const { row } = p;
  const [pickerOpen, setPickerOpen] = useState(false);
  const items = p.groupItems.get(row.group.id) ?? [];
  const allSelected = items.length > 0 && items.every((i) => p.selected.has(i.id));
  return (
    <>
      <Sticky width={p.stickyW} role="columnheader" className="border-b-soft border-b">
        {p.canEdit ? (
          <span className="flex w-[58px] shrink-0 items-center pl-[24px]">
            <input
              type="checkbox"
              className="row-check"
              aria-label={`Select all items in ${row.group.name}`}
              checked={allSelected}
              disabled={items.length === 0}
              onChange={(e) => p.onSelectItems(items, e.target.checked)}
            />
          </span>
        ) : (
          <span className="w-[58px] shrink-0" />
        )}
        <span className="text-muted-foreground text-label-12 truncate pl-[4px]">
          {p.ctx.sheet.itemLabel}
        </span>
      </Sticky>
      {p.vCols.map((vc) => {
        if (vc.index >= p.fieldCols.length)
          return (
            <div
              key="__trail"
              role="columnheader"
              className="border-b-soft bg-background-100 absolute top-0 flex h-full items-center border-b pl-1"
              style={{ left: vc.start, width: vc.size }}
            >
              {p.canEdit ? (
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Add a field"
                      className="text-muted-foreground"
                    >
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
              ) : (
                <span className="sr-only">Actions</span>
              )}
            </div>
          );
        const field = p.fieldCols[vc.index]!.field;
        const index = p.allFields.findIndex((f) => f.id === field.id);
        return (
          <div
            key={field.id}
            className="absolute top-0 h-full"
            style={{ left: vc.start, width: vc.size }}
          >
            <ColumnHeader
              scope={row.group.id}
              field={field}
              width={p.widthOf(field)}
              ctx={p.ctx}
              canEdit={p.canEdit}
              isAdmin={p.isAdmin}
              sorted={p.sort?.fieldKey === field.key ? p.sort.dir : null}
              summary={p.summaries[field.key]}
              first={index === 0}
              last={index === p.allFields.length - 1}
              dragDisabled={!p.canEdit}
              actions={p.columnActions(field, index)}
            />
          </div>
        );
      })}
    </>
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
  const rowActive = p.active?.itemId === item.id;
  const ownerId = p.owner ? ownerOf(item, p.owner, ctx) : null;
  const ownerName = ownerId ? (ctx.people.get(ownerId)?.name ?? 'Former member') : null;
  // the leading controls show on hover, on the active row and while anything is selected
  const reveal = cn(
    'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
    (rowActive || p.selected.size > 0) && 'opacity-100',
  );
  return (
    <>
      <Sticky
        width={p.stickyW}
        role="none"
        className={cn(
          'border-b-line group-hover/row:bg-subtle border-b',
          isSelected && 'bg-sel group-hover/row:bg-sel',
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
          <span className="relative flex h-full w-[58px] shrink-0 items-center">
            {!p.dragDisabled && editable ? (
              <button
                ref={drag.setNodeRef}
                type="button"
                {...drag.listeners}
                {...drag.attributes}
                tabIndex={-1}
                aria-label={`Drag ${item.name} to move it`}
                className={cn(
                  'text-muted-foreground hover:text-ink absolute top-1/2 left-0 flex w-[16px] -translate-y-1/2 cursor-grab justify-center rounded py-0.5',
                  reveal,
                )}
              >
                <GripVertical className="size-3.5" aria-hidden />
              </button>
            ) : null}
            {/* the sheet's row icon at rest; the checkbox takes its place on hover, focus or selection */}
            <span
              aria-hidden
              className={cn(
                'border-line text-muted-foreground bg-background-100 absolute top-1/2 left-[16px] grid size-[28px] -translate-y-1/2 place-items-center rounded-full border',
                p.canEdit && 'group-focus-within/row:invisible group-hover/row:invisible',
                p.canEdit && (rowActive || p.selected.size > 0) && 'invisible',
              )}
            >
              <FileText className="size-[14px]" />
            </span>
            <span className="absolute top-1/2 left-[24px] flex -translate-y-1/2">
              {p.canEdit ? (
                <input
                  type="checkbox"
                  aria-label={`Select ${item.name}`}
                  checked={isSelected}
                  className={cn(
                    'row-check',
                    reveal,
                    'group-focus-within/row:opacity-100',
                    isSelected && 'opacity-100',
                  )}
                  onClick={(e) =>
                    p.onSelectRow(item, (e.target as HTMLInputElement).checked, e.shiftKey)
                  }
                  onChange={() => undefined}
                />
              ) : null}
            </span>
          </span>
          <div
            data-cell={`${item.id}|name`}
            onMouseDown={p.onMouseDown}
            onDoubleClick={p.onDoubleClick}
            className={cn(
              'relative -ml-[6px] flex h-full min-w-0 flex-1 cursor-default items-center gap-[14px] pr-[14px] pl-[6px]',
              inRange(0) && 'bg-sel',
              isActive('name') && 'outline-focus z-[1] outline-2 -outline-offset-2',
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              <span className="text-label-14 flex min-w-0 items-center">
                {item.id.startsWith('temp-') ? (
                  <span className="text-ink truncate">{item.name}</span>
                ) : (
                  <button
                    type="button"
                    tabIndex={-1}
                    title={`Open ${item.displayId}`}
                    className="text-ink min-w-0 truncate text-left font-normal hover:underline"
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
              {p.density === 'compact' && !p.actions.held.has(item.id) ? null : (
                <span className="text-muted-foreground text-label-12-mono flex min-w-0 items-center gap-[7px] leading-[17px]">
                  <span className="shrink-0">{item.displayId}</span>
                  {ownerName ? (
                    <>
                      <span aria-hidden>·</span>
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
              )}
            </span>
            {p.comments > 0 ? (
              <span
                className="text-ink bg-background-100 text-label-11-mono border-gray-alpha-500 inline-flex h-[22px] min-w-[28px] shrink-0 items-center justify-center rounded-full border px-1.5 font-semibold"
                title={p.comments === 1 ? '1 update' : `${p.comments} updates`}
              >
                {p.comments}
                <span className="sr-only">{p.comments === 1 ? ' update' : ' updates'}</span>
              </span>
            ) : (
              // names line up whether or not a row has updates
              <span aria-hidden className="w-[28px] shrink-0" />
            )}
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
        if (vc.index >= fieldCols.length)
          return (
            <RowMenu
              key="__trail"
              item={item}
              left={vc.start}
              width={vc.size}
              selected={isSelected}
              open={p.menuOpen}
              canEdit={p.canEdit}
              isAdmin={p.isAdmin}
              onAction={p.onRowAction}
            />
          );
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
            rowSelected={isSelected}
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

/** The "…" at the end of every item row: open, archive, lock (admins). Shift+F10 on the grid opens it too. */
function RowMenu({
  item,
  left,
  width,
  selected,
  open,
  canEdit,
  isAdmin,
  onAction,
}: {
  item: Item;
  left: number;
  width: number;
  selected: boolean;
  open: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  onAction(item: Item, action: RowAction): void;
}) {
  const store = useGridStore();
  const temp = item.id.startsWith('temp-');
  return (
    <div
      role="gridcell"
      className={cn(
        'border-b-line group-hover/row:bg-subtle bg-background-100 absolute top-0 flex h-full items-center justify-end border-b pr-2',
        selected && 'bg-sel group-hover/row:bg-sel',
      )}
      style={{ left, width }}
    >
      {temp ? null : (
        <DropdownMenu
          open={open}
          onOpenChange={(o) => store.getState().openRowMenu(o ? item.id : null)}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              tabIndex={-1}
              aria-label={`Actions for ${item.name}`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => {
              // back to the grid, which keeps the active cell
              e.preventDefault();
              document.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
            }}
          >
            <DropdownMenuItem onSelect={() => onAction(item, 'open')}>
              <ExternalLink aria-hidden /> Open
            </DropdownMenuItem>
            {canEdit && (!item.locked || isAdmin) ? (
              <DropdownMenuItem onSelect={() => onAction(item, 'archive')}>
                <Archive aria-hidden /> Archive
              </DropdownMenuItem>
            ) : null}
            {isAdmin ? (
              <>
                <DropdownMenuSeparator />
                {item.locked ? (
                  <DropdownMenuItem onSelect={() => onAction(item, 'unlock')}>
                    <LockOpen aria-hidden /> Unlock
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onAction(item, 'lock')}>
                    <Lock aria-hidden /> Lock
                  </DropdownMenuItem>
                )}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

const TableCell = memo(function TableCell({
  item,
  field,
  ctx,
  left,
  width,
  selected,
  rowSelected,
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
  /** The row's checkbox is ticked. */
  rowSelected: boolean;
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
        'border-b-line text-ink group-hover/row:bg-subtle bg-background-100 text-label-14 absolute top-0 flex h-full items-center overflow-hidden border-b px-[14px] hover:shadow-[inset_0_0_0_1px_var(--line-strong)] has-[[data-box]]:px-2 [&_[data-pill]]:-mx-1.5',
        (selected || rowSelected) && 'bg-sel group-hover/row:bg-sel',
        active && 'outline-focus z-[1] outline-2 -outline-offset-2',
      )}
      style={{ left, width }}
    >
      <ui.Cell value={value as never} field={field} item={item} ctx={ctx} density="table" />
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
    <div
      className={cn(
        'flex w-full items-stretch',
        !p.endOfCard && 'border-b-line border-b',
        drop.isOver && 'bg-sel',
      )}
    >
      <Sticky width={p.stickyW} className={cn(drop.isOver && 'bg-sel')}>
        <div ref={drop.setNodeRef} className="flex h-full w-full items-center pl-[58px]">
          <input
            ref={p.addRef}
            className="placeholder:text-muted-foreground text-ink text-label-14 h-full w-full bg-transparent px-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset"
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
    </div>
  );
}

function SummaryRow(p: RowProps & { row: Extract<TableRow, { kind: 'summary' }> }) {
  const { row, ctx, fieldCols, vCols } = p;
  return (
    <>
      <Sticky width={p.stickyW}>
        <span className="sr-only">Summary of {row.group.name}</span>
      </Sticky>
      {vCols.map((vc) => {
        if (vc.index >= fieldCols.length) return null;
        const field = fieldCols[vc.index]!.field;
        const fn = p.summaries[field.key];
        return (
          <div
            key={field.id}
            role="gridcell"
            className="bg-background-100 absolute top-0 flex h-full items-center px-[14px]"
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
