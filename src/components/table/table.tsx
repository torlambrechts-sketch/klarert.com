'use client';

import { itemRequirementRef } from '@/engine/frameworks/refs';
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
import {
  defaultRangeExtractor,
  useVirtualizer,
  useWindowVirtualizer,
  type Range,
} from '@tanstack/react-virtual';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  GripVertical,
  Lock,
  LockOpen,
  MoreHorizontal,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cellColumns, copyRange, planClear, planPaste, type GridColumn } from '@/engine/clipboard';
import { resolveFieldType } from '@/engine/fields/resolve';
import { ownerField, ownerOf } from '@/engine/item-panel';
import { donePercent } from '@/engine/views/group-by';
import { missingRequired, missingText } from '@/engine/views/new-item';
import { keysBetween } from '@/engine/ordering';
import type { SheetData } from '@/engine/sheet-data';
import { columnSummaries, type SummaryFn } from '@/engine/summaries';
import type { Ctx, Field, Group, Item } from '@/engine/types';
import { setSummary, type ViewConfig } from '@/engine/views/config';
import {
  groupByKey,
  liveCollapsed,
  parseColumnGroups,
  stubField,
} from '@/engine/views/column-groups';
import { textOf } from '@/engine/values';
import { trendPolarity } from '@/engine/values/trend';
import { fieldUI } from '@/components/fields/registry';
import { cellValue, TextEditor } from '@/components/fields/shared';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ProgressChip } from '@/components/subitems/progress-chip';
import type { SubitemsState } from '@/components/subitems/use-subitems';
import { isSubitemDone, subitemLabel } from '@/engine/subitems';
import { cn } from '@/lib/utils';
import { CommentBubble } from './comment-bubble';
import { FilesMarker } from './files-marker';
import { CellEditor, cellId, explainOnly, Sticky, TableCell } from './table-cells';
import {
  SubAddRow,
  subAddId,
  SubEmptyRow,
  SubHeaderRow,
  SubItemRow,
  type SubRowAction,
  type SubRowContext,
} from './subitem-rows';
import type { UpdateSummary } from './use-update-counts';
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
  columnRuns,
  cycleSort,
  endsCard,
  GROUP_LABEL_H,
  ownLine,
  trailWidth,
  positionsAtEnd,
  rangeOf,
  rowHeight,
  step,
  stickyHeaders,
  tableColumns,
  type Density,
  type TableRow,
} from './table-model';

/** The app's sticky top bar (docs/05 §2): pinned column headers sit under it. */
const TOP_BAR_H = 48;

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
/** A collapsed column group's stub column. */
const STUB_W = 168;

/** A column after the name: a field or a collapsed group's stub. */
type BodyCol = Exclude<GridColumn, { kind: 'name' }>;
type StubCol = Extract<GridColumn, { kind: 'stub' }>;

/** A column group's label over its columns (left and width in table pixels). */
interface RunBox {
  key: string;
  groupId: string | null;
  name: string;
  size: number;
  collapsed: boolean;
  left: number;
  width: number;
}

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
  /** Comments (updates people wrote) per item, for the marker after the name. */
  updateCounts: ReadonlyMap<string, UpdateSummary>;
  /** The sheet's sub-items (null when it has none or they are loading). */
  sub?: SubitemsState | null;
  /** Parents a search or filter opened, with the sub-items that matched. */
  subMatches?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Open a sub-item in the item panel. */
  onOpenSubitem?(item: Item): void;
  /** The item the item panel shows: its row is marked and kept in view. */
  currentItemId?: string | null;
}

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
  sub = null,
  subMatches,
  onOpenSubitem,
  currentItemId = null,
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
  const expanded = useGrid((s) => s.expanded);
  const scrollRef = useRef<HTMLDivElement>(null);

  // a click outside the table clears the active cell, the range and the selected rows; the toolbar (bulk actions),
  // menus, dialogs, the item panel and toasts keep them
  useEffect(() => {
    const keep =
      '[data-keep-selection], [data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-sonner-toaster]';
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.isConnected) return;
      if (scrollRef.current?.contains(t) || t.closest(keep)) return;
      const s = store.getState();
      if (!s.active && !s.anchor && s.selected.size === 0) return;
      if (s.editing) return;
      store.setState({ active: null, anchor: null });
      if (s.selected.size) s.setSelected([]);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [store]);
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
  // column groups (docs/05 §3.1): defined on the sheet, collapsed per view
  const groupList = useMemo(
    () =>
      parseColumnGroups(
        data.sheet.columnGroups ?? [],
        data.fields.map((f) => f.key),
      ),
    [data.sheet.columnGroups, data.fields],
  );
  const collapsedGroups = useMemo(
    () => new Set(liveCollapsed(groupList, config.collapsedGroups)),
    [groupList, config.collapsedGroups],
  );
  /** Every column as drawn: the name, fields and collapsed groups' stubs. */
  const drawn = useMemo(
    () => tableColumns(data.fields, hidden, { list: groupList, collapsed: collapsedGroups }),
    [data.fields, hidden, groupList, collapsedGroups],
  );
  /** The selection axis: the drawn columns without stubs (selection, copy and paste skip them). */
  const columns = useMemo(() => cellColumns(drawn), [drawn]);
  const bodyCols = useMemo(() => drawn.slice(1) as BodyCol[], [drawn]);
  const fieldCols = useMemo(
    () => columns.filter((c): c is Extract<GridColumn, { kind: 'field' }> => c.kind === 'field'),
    [columns],
  );
  const runs = useMemo(() => columnRuns(drawn, groupList), [drawn, groupList]);
  const labels = runs.length > 0;
  /** The member a stub shows for each collapsed group. */
  const stubFields = useMemo(() => {
    const m = new Map<string, Field | null>();
    for (const c of bodyCols) if (c.kind === 'stub') m.set(c.groupId, stubField(c.fields, ctx));
    return m;
  }, [bodyCols, ctx]);
  const toggleGroup = useCallback(
    (groupId: string) =>
      setConfig((c) => {
        const next = new Set(c.collapsedGroups ?? []);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        const { collapsedGroups: _drop, ...rest } = c;
        void _drop;
        return next.size ? { ...rest, collapsedGroups: [...next] } : rest;
      }),
    [setConfig],
  );
  // number, option and date columns show a summary unless switched off; others when chosen
  const summaries = useMemo(
    () =>
      columnSummaries(
        [
          ...fieldCols.map((c) => c.field),
          ...[...stubFields.values()].filter((f): f is Field => !!f),
        ],
        config.summaries,
        config.summaryOff,
        ctx,
      ),
    [fieldCols, stubFields, config.summaries, config.summaryOff, ctx],
  );
  const showSummaries = Object.keys(summaries).length > 0;
  const tg = useTableGroups({
    groups: data.groups,
    sheetId: data.sheet.id,
    ctx,
    items: visibleItems,
    onlyGroup,
  });
  // sub-items (docs/05 §3.1): each parent's rows in position order (temporary rows too, while they save)
  const childMap = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of sub?.data.items ?? []) {
      if (!it.parentId) continue;
      const list = m.get(it.parentId) ?? [];
      list.push(it);
      m.set(it.parentId, list);
    }
    for (const list of m.values()) list.sort(byPosition);
    return m;
  }, [sub?.data.items]);
  const subLayout = useMemo(
    () =>
      sub
        ? {
            childrenOf: (id: string) => childMap.get(id) ?? [],
            expanded,
            matched: subMatches,
            canAdd: canEdit,
          }
        : null,
    [sub, childMap, expanded, subMatches, canEdit],
  );
  // expanded parents are kept per person and sheet
  const expandKey = `subitems-expanded:${ctx.userId}:${data.sheet.id}`;
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(expandKey);
      if (raw) store.getState().setExpanded(JSON.parse(raw) as string[]);
    } catch {
      // private windows and blocked storage start collapsed
    }
  }, [expandKey, store]);
  useEffect(
    () =>
      store.subscribe((st, prev) => {
        if (st.expanded === prev.expanded) return;
        try {
          window.localStorage.setItem(expandKey, JSON.stringify([...st.expanded].slice(0, 500)));
        } catch {
          // not kept: the rows still open and close
        }
      }),
    [expandKey, store],
  );
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
        subitems: subLayout,
      }),
    [tg, visibleItems, collapsed, viewCompare, canEdit, showSummaries, subLayout],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const owner = useMemo(() => ownerField(ctx), [ctx]);
  const colIndex = useMemo(() => new Map(columns.map((c, i) => [columnId(c), i])), [columns]);
  /** column id → its index among the drawn columns (stubs included). */
  const drawnIndex = useMemo(() => new Map(drawn.map((c, i) => [columnId(c), i])), [drawn]);
  const rowIndexOfItem = useMemo(() => {
    const m = new Map<string, number>();
    layout.rows.forEach(
      (r, i) => (r.kind === 'item' || r.kind === 'subitem') && m.set(r.item.id, i),
    );
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
  const colWidth = useCallback(
    (c: BodyCol) => (c.kind === 'stub' ? STUB_W : baseWidth(c.field)),
    [baseWidth],
  );
  const trailW = useMemo(
    () => trailWidth(bodyCols.map(colWidth), stickyW + EDGE, viewW, TRAIL),
    [bodyCols, colWidth, stickyW, viewW],
  );
  // the group labels' boxes over their columns
  const runBoxes = useMemo<RunBox[]>(() => {
    if (!labels) return [];
    const starts: number[] = [];
    let x = stickyW;
    for (const c of bodyCols) {
      starts.push(x);
      x += colWidth(c);
    }
    return runs.map((r) => ({
      key: r.key,
      groupId: r.groupId,
      name: r.name,
      size: r.size,
      collapsed: r.collapsed,
      left: starts[r.from]!,
      width: starts[r.to]! + colWidth(bodyCols[r.to]!) - starts[r.from]!,
    }));
  }, [labels, runs, bodyCols, colWidth, stickyW]);
  /** A width the person dragged to, in stored terms. */
  const toBase = useCallback((_f: Field, shown: number) => shown, []);

  const docTop = useDocumentTop(scrollRef);
  // the column header of the card under the top bar stays rendered and pinned there (docs/05 §3.1)
  const sticky = useMemo(() => stickyHeaders(layout.rows), [layout.rows]);
  const stickyRef = useRef(sticky);
  stickyRef.current = sticky;
  const rowV = useWindowVirtualizer({
    count: layout.rows.length,
    scrollMargin: docTop,
    // keyboard moves keep the active row clear of the sticky top bar and the pinned column header
    scrollPaddingStart: TOP_BAR_H + rowHeight('header', density, labels),
    rangeExtractor: useCallback((range: Range) => {
      const out = defaultRangeExtractor(range);
      const header = stickyRef.current.headerOf[range.startIndex] ?? -1;
      if (header >= 0 && !out.includes(header)) out.unshift(header);
      return out;
    }, []),
    // the last row of a card also carries the card's bottom border (item and header rows draw their own line)
    estimateSize: (i) => {
      const kind = layout.rows[i]!.kind;
      const edge = !ownLine(kind) && endsCard(layout.rows, i) ? 1 : 0;
      return rowHeight(kind, density, labels) + edge;
    },
    getItemKey: useCallback((i: number) => layout.rows[i]!.key, [layout.rows]),
    overscan: 10,
  });
  const colV = useVirtualizer({
    horizontal: true,
    count: bodyCols.length + 1,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (i < bodyCols.length ? colWidth(bodyCols[i]!) : trailW),
    getItemKey: useCallback(
      (i: number) => (i < bodyCols.length ? columnId(bodyCols[i]!) : '__trail'),
      [bodyCols],
    ),
    paddingStart: stickyW,
    scrollPaddingStart: stickyW,
    overscan: 3,
  });
  useEffect(() => colV.measure(), [colV, colWidth, trailW, bodyCols, stickyW]);
  useEffect(() => rowV.measure(), [rowV, layout.rows, density, labels]);
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
      const col = columns[p.col];
      const at = col ? drawnIndex.get(columnId(col)) : p.col;
      if (p.col > 0 && at !== undefined) colV.scrollToIndex(at - 1, { align: 'auto' });
    },
    [colV, columns, drawnIndex, layout.flat, rowIndexOfItem, rowV],
  );

  /** ←/→ with the grid focused and no active cell: scroll one column (the name column stays). */
  const scrollColumn = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const edge = el.scrollLeft + stickyW;
    const cols = colV.measurementsCache.slice(0, bodyCols.length);
    const target =
      dir > 0
        ? cols.find((m) => m.start > edge + 1)
        : [...cols].reverse().find((m) => m.start < edge - 1);
    if (target) colV.scrollToIndex(target.index, { align: 'start' });
    else el.scrollLeft = dir > 0 ? el.scrollWidth : 0;
  };

  // the item panel's item: keep its row in view as Prev/Next (J/K) move
  useEffect(() => {
    if (!currentItemId) return;
    const r = rowIndexOfItem.get(currentItemId);
    if (r !== undefined) rowV.scrollToIndex(r, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItemId]);

  const lockedMessage = (item: Item) =>
    item.lockReason
      ? `This item is locked: ${item.lockReason}. Only owners and admins can change it.`
      : 'This item is locked. Only owners and admins can change it.';

  /** The item a cell belongs to: a row of the sheet, or a sub-item row. */
  const itemAt = (itemId: string): { item: Item; isSub: boolean } | null => {
    const top = layout.flat[layout.index.get(itemId) ?? -1];
    if (top) return { item: top, isSub: false };
    const r = layout.subs[layout.subIndex.get(itemId) ?? -1];
    return r ? { item: r.item, isSub: true } : null;
  };
  const fieldAt = (col: string, isSub: boolean) =>
    col === 'name'
      ? null
      : ((isSub ? sub?.data.fields : data.fields)?.find((f) => f.id === col) ?? null);
  const subCols = useMemo(() => ['name', ...(sub?.data.fields ?? []).map((f) => f.id)], [sub]);

  const startEdit = (cell: CellRef, typed: string | null = null) => {
    const at = itemAt(cell.itemId);
    if (!at) return;
    const item = at.item;
    const field = fieldAt(cell.col, at.isSub);
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
    const isSub = !!item.parentId;
    const value = cellValue(item, field, isSub && sub ? sub.ctx : ctx);
    void (isSub ? commitSub : commit)(item, field.id, ui.toggle(value));
    return true;
  };

  // ───────────── sub-items: open and close, keyboard ─────────────

  const focusAdd = (parentId: string) => {
    store.getState().toggleExpanded(parentId, true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const i = layoutRef.current.rows.findIndex((r) => r.key === `sa:${parentId}`);
        if (i >= 0) rowV.scrollToIndex(i, { align: 'auto' });
        requestAnimationFrame(() => document.getElementById(subAddId(parentId))?.focus());
      }),
    );
  };
  const childrenOf = (parentId: string) => childMap.get(parentId) ?? [];
  const isOpen = (parentId: string) => expanded.has(parentId) || !!subMatches?.has(parentId);
  const focusCell = (cell: CellRef) => {
    store.getState().focus(cell);
    const r = rowIndexOfItem.get(cell.itemId);
    if (r !== undefined) rowV.scrollToIndex(r, { align: 'auto' });
  };

  /** Keys on a sub-item cell: its own axis (rows of the same parent, the sub-item columns). */
  const onSubKey = (e: React.KeyboardEvent, cell: CellRef) => {
    const i = layout.subIndex.get(cell.itemId)!;
    const row = layout.subs[i]!;
    const col = subCols.indexOf(cell.col);
    const item = row.item;
    const field = fieldAt(cell.col, true);
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = layout.subs[i - 1];
      focusCell(
        prev && prev.parent.id === row.parent.id
          ? { itemId: prev.item.id, col: cell.col }
          : { itemId: row.parent.id, col: 'name' },
      );
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = layout.subs[i + 1];
      if (next && next.parent.id === row.parent.id)
        return focusCell({ itemId: next.item.id, col: cell.col });
      const after = layout.flat[(layout.index.get(row.parent.id) ?? -1) + 1];
      if (after) focusCell({ itemId: after.id, col: 'name' });
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      // from the name, ← goes up to the parent
      if (col <= 0) focusCell({ itemId: row.parent.id, col: 'name' });
      else focusCell({ itemId: item.id, col: subCols[col - 1]! });
    } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
      if (col < subCols.length - 1) {
        e.preventDefault();
        focusCell({ itemId: item.id, col: subCols[col + 1]! });
      }
    } else if (e.key === 'Tab' && e.shiftKey) {
      if (col > 0) {
        e.preventDefault();
        focusCell({ itemId: item.id, col: subCols[col - 1]! });
      }
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      focusAdd(row.parent.id);
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      if (field && toggle(item, field)) return;
      startEdit(cell);
    } else if (e.key === ' ') {
      e.preventDefault();
      if (!field && !item.id.startsWith('temp-')) onOpenSubitem?.(item);
      else if (field) toggle(item, field);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && field) {
      e.preventDefault();
      if (!canEditItem(item) || explainOnly(field)) return;
      void commitSub(item, field.id, null);
    } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      setSubMenu(item.id);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (field && (fieldUI(field.type).toggle || explainOnly(field))) return;
      e.preventDefault();
      startEdit(cell, e.key);
    }
  };

  /** Ctrl+Shift+E: open every parent with sub-items, or close them all when any is open. */
  const toggleAll = () => {
    if (!sub) return;
    if (expanded.size > 0) return store.getState().setExpanded([]);
    store
      .getState()
      .setExpanded(layout.flat.filter((i) => childrenOf(i.id).length > 0).map((i) => i.id));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== scrollRef.current || editing) return;
    if (sub && e.key.toLowerCase() === 'e' && e.shiftKey && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      return toggleAll();
    }
    if (active && layout.subIndex.has(active.itemId)) return onSubKey(e, active);
    if (
      !active &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      return scrollColumn(e.key === 'ArrowRight' ? 1 : -1);
    }
    const rows = layout.flat.length;
    if (rows === 0) return;
    // a parent's name: → opens its sub-items, ← closes them, ↓ goes into them, Shift+Enter adds one
    if (sub && active && layout.index.has(active.itemId) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const parent = active.itemId;
      const open = isOpen(parent);
      const kids = layout.subs.filter((r) => r.parent.id === parent);
      if (active.col === 'name' && e.key === 'ArrowRight' && !open && !e.shiftKey) {
        e.preventDefault();
        return store.getState().toggleExpanded(parent, true);
      }
      if (active.col === 'name' && e.key === 'ArrowLeft' && open && !e.shiftKey) {
        e.preventDefault();
        return store.getState().toggleExpanded(parent, false);
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && open && kids.length > 0) {
        e.preventDefault();
        return focusCell({ itemId: kids[0]!.item.id, col: 'name' });
      }
      if (e.key === 'ArrowUp' && !e.shiftKey) {
        const prev = layout.flat[(layout.index.get(parent) ?? 0) - 1];
        const prevKids = prev ? layout.subs.filter((r) => r.parent.id === prev.id) : [];
        if (prev && isOpen(prev.id) && prevKids.length > 0) {
          e.preventDefault();
          return focusCell({ itemId: prevKids.at(-1)!.item.id, col: 'name' });
        }
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        return focusAdd(parent);
      }
    }
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
  // sub-items write through their own sheet's actions (the child sheet's fields, rules and holds)
  const subCommit = useValueCommit(sub?.data ?? data, sub?.ctx ?? ctx, sub?.actions ?? actions, {
    hold: true,
  });
  const commitSub = async (item: Item, col: string, raw: unknown) => {
    store.getState().edit(null);
    setSeed(null);
    focusGrid();
    await subCommit.commit(item, col, raw);
  };
  const [subMenu, setSubMenu] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<Item | null>(null);

  // ───────────── pointer ─────────────

  const onMouseDown = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!el) return;
    const [itemId, col] = el.dataset.cell!.split('|') as [string, string];
    const cell = { itemId, col };
    const was = active && active.itemId === itemId && active.col === col;
    const at = itemAt(itemId);
    e.preventDefault();
    // sub-item rows have their own axis: no ranges across them
    store.getState().focus(cell, e.shiftKey && !at?.isSub);
    focusGrid();
    if (was && !e.shiftKey) {
      const field = fieldAt(col, !!at?.isSub);
      if (at && field && toggle(at.item, field)) return;
      startEdit(cell);
    }
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!el) return;
    const [itemId, col] = el.dataset.cell!.split('|') as [string, string];
    const field = fieldAt(col, !!itemAt(itemId)?.isSub);
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
  const finishSubRef = useRef(sub?.actions.finishAll);
  finishSubRef.current = sub?.actions.finishAll;
  useEffect(
    () =>
      store.subscribe((s, prev) => {
        if (s.active?.itemId !== prev.active?.itemId) {
          finishAllRef.current(s.active?.itemId ?? null);
          finishSubRef.current?.(s.active?.itemId ?? null);
        }
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
      { hold: true, source: 'inline' },
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
      const over = data.fields.find((f) => f.id === o.fieldId);
      const of = groupByKey(groupList);
      if (over && of.get(field.key)?.id !== of.get(over.key)?.id) {
        toast('Columns stay within their group. Change a column’s group from Columns.');
        return;
      }
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

  // ───────────── sideways scrolling: edge shadows and the pinned scrollbar ─────────────

  const [more, setMore] = useState(false);
  const [scrolledLeft, setScrolledLeft] = useState(false);
  const [wide, setWide] = useState(false);
  // a scrollbar pinned to the bottom of the window while the table is in view: rows scroll with the page, so the
  // table's own scrollbar sits at its very end, out of reach on a long sheet
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    const bar = barRef.current;
    if (!el || !bar) return;
    // Each side remembers the offset it last set on the other. A scroll event that lands on that offset is the echo of
    // our own sync and is ignored: echoing it back would set the grid to a one-frame-old offset and stop a smooth
    // scroll (scrollBy, scrollIntoView, ←/→) after a pixel.
    let barSet = -1;
    let gridSet = -1;
    const fromGrid = () => {
      if (Math.abs(el.scrollLeft - gridSet) <= 1) return;
      gridSet = -1;
      if (Math.abs(bar.scrollLeft - el.scrollLeft) > 1) {
        bar.scrollLeft = el.scrollLeft;
        barSet = bar.scrollLeft;
      }
    };
    const fromBar = () => {
      if (Math.abs(bar.scrollLeft - barSet) <= 1) return;
      barSet = -1;
      if (Math.abs(el.scrollLeft - bar.scrollLeft) > 1) {
        el.scrollLeft = bar.scrollLeft;
        gridSet = el.scrollLeft;
      }
    };
    el.addEventListener('scroll', fromGrid, { passive: true });
    bar.addEventListener('scroll', fromBar, { passive: true });
    fromGrid();
    return () => {
      el.removeEventListener('scroll', fromGrid);
      bar.removeEventListener('scroll', fromBar);
    };
  }, [wide]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
      setScrolledLeft(el.scrollLeft > 2);
      setWide(el.scrollWidth > el.clientWidth + 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [bodyCols.length, widths]);

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
    cycleSort: () => setConfig((c) => ({ ...c, sort: cycleSort(c.sort, field.key) })),
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
    move: (by) => {
      const next = data.fields[index + by];
      const of = groupByKey(groupList);
      if (next && of.get(field.key)?.id !== of.get(next.key)?.id) {
        toast('Columns stay within their group. Change a column’s group from Columns.');
        return;
      }
      void actions.moveField(field, Math.max(0, index + by));
    },
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

  const subOpen = useStableEvent((item: Item) => onOpenSubitem?.(item));
  const subCommitStable = useStableEvent(commitSub);
  // "Add …" works on the sub-items' options; their field settings live in the sheet settings (Sub-items)
  const subFieldProps = useStableEvent((field: Field) => ({
    onAddOption: subCommit.fieldProps(field, { canEdit, isAdmin }, () =>
      store.getState().edit(null),
    ).onAddOption,
  }));
  const subAdd = useStableEvent(async (parent: Item, name: string) => {
    if (!sub) return;
    const list = childrenOf(parent.id);
    const [position] = positionsAtEnd(list, 1);
    await sub.actions.createSubitem(parent.id, name, position!, { hold: true });
  });
  const subFromTemplate = useStableEvent((parent: Item) => {
    if (!sub) return;
    store.getState().toggleExpanded(parent.id, true);
    void sub.actions.subitemsFromTemplate(data.sheet.id, parent.id);
  });
  const subAction = useStableEvent((item: Item, action: SubRowAction) => {
    setSubMenu(null);
    if (action === 'open') return onOpenSubitem?.(item);
    if (action === 'move') return setMoveFor(item);
    if (action === 'archive') return void sub?.actions.setArchived([item.id], true);
  });
  const subWidth = useCallback(
    (f: Field) => f.width ?? resolveFieldType(f.type)?.defaultWidth ?? 140,
    [],
  );
  const subCtx: SubRowContext | null = useMemo(
    () =>
      sub
        ? {
            label: subitemLabel(ctx.sheet),
            one: subitemLabel(ctx.sheet, 1),
            ctx: sub.ctx,
            fields: sub.data.fields,
            widthOf: subWidth,
            actions: sub.actions,
            canEdit,
            isAdmin,
            canEditItem,
            hasTemplate: (ctx.sheet.subitems?.template.length ?? 0) > 0,
            onOpen: subOpen,
            onCommit: subCommitStable,
            onCancel: cancelEditStable,
            fieldProps: subFieldProps,
            onMouseDown: onMouseDownStable,
            onDoubleClick: onDoubleClickStable,
            onAdd: subAdd,
            onFromTemplate: subFromTemplate,
            onAction: subAction,
          }
        : null,
    [
      sub,
      ctx.sheet,
      subWidth,
      canEdit,
      isAdmin,
      canEditItem,
      subOpen,
      subCommitStable,
      cancelEditStable,
      subFieldProps,
      onMouseDownStable,
      onDoubleClickStable,
      subAdd,
      subFromTemplate,
      subAction,
    ],
  );
  const toggleExpandedStable = useStableEvent((itemId: string) =>
    store.getState().toggleExpanded(itemId),
  );

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
            aria-colcount={drawn.length + 1}
            data-scrolled-left={scrolledLeft}
            data-more-right={more}
            aria-multiselectable
            aria-activedescendant={activeId}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onCopy={onCopy}
            onPaste={onPaste}
            // rows scroll with the page; only wide tables scroll sideways here
            className={cn(
              'grid-scroll group/grid relative overflow-x-auto overflow-y-hidden rounded-lg outline-none',
              wide && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            )}
          >
            <div style={{ height: rowV.getTotalSize(), width: totalW, position: 'relative' }}>
              {vRows.map((vr) => {
                const row = layout.rows[vr.index]!;
                const first = row.kind === 'group';
                const last = endsCard(layout.rows, vr.index);
                // a column header follows the page under the top bar until its card's last row pushes it up
                const cardEnd = row.kind === 'header' ? sticky.cardEnd.get(vr.index) : undefined;
                const endOfCard =
                  cardEnd !== undefined ? rowV.measurementsCache[cardEnd]?.end : undefined;
                const top =
                  endOfCard !== undefined
                    ? Math.max(
                        vr.start,
                        Math.min((rowV.scrollOffset ?? 0) + TOP_BAR_H, endOfCard - vr.size),
                      )
                    : vr.start;
                const pinned = top > vr.start;
                return (
                  <div
                    key={row.key}
                    role={row.kind === 'gap' ? 'presentation' : 'row'}
                    data-current={
                      row.kind === 'item' && row.item.id === currentItemId ? true : undefined
                    }
                    aria-rowindex={ariaRows.index.get(row.key)}
                    className={cn(
                      'absolute top-0 left-0 flex',
                      row.kind !== 'gap' && 'border-surface-line bg-surface overflow-clip border-x',
                      row.kind === 'header' && 'bg-head',
                      (row.kind === 'item' || row.kind === 'subitem') && 'group/row',
                      first && 'rounded-t-[10px] border-t',
                      last && 'rounded-b-[10px]',
                      // item, sub-item and header rows draw their own bottom line
                      last && !ownLine(row.kind) && 'border-b',
                      pinned && 'z-[4]',
                    )}
                    data-pinned={pinned || undefined}
                    style={{
                      height: vr.size,
                      width: totalW,
                      transform: `translateY(${top - rowV.options.scrollMargin}px)`,
                    }}
                  >
                    <RowContent
                      row={row}
                      ctx={ctx}
                      stickyW={stickyW}
                      nameWidth={nameWidth}
                      bodyCols={bodyCols}
                      vCols={vCols}
                      runs={runBoxes}
                      stubFields={stubFields}
                      onToggleGroup={toggleGroup}
                      current={row.kind === 'item' && row.item.id === currentItemId}
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
                      comments={row.kind === 'item' ? updateCounts.get(row.item.id) : undefined}
                      menuOpen={row.kind === 'item' && rowMenu === row.item.id}
                      onRowAction={rowActionsStable}
                      allFields={data.fields}
                      widthOf={widthOf}
                      columnActions={columnActions}
                      density={density}
                      endOfCard={last}
                      sub={subCtx}
                      subMenu={subMenu}
                      setSubMenu={setSubMenu}
                      subExpanded={row.kind === 'item' && isOpen(row.item.id)}
                      subTotal={row.kind === 'item' ? childrenOf(row.item.id).length : 0}
                      subDone={
                        row.kind === 'item' && sub
                          ? childrenOf(row.item.id).filter((c) => isSubitemDone(c, sub.ctx)).length
                          : 0
                      }
                      onToggleSub={toggleExpandedStable}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div
            ref={barRef}
            aria-hidden
            data-scrollbar
            hidden={!wide}
            className="bg-page/95 border-line sticky bottom-0 z-[6] h-[14px] overflow-x-auto overflow-y-hidden border-t"
          >
            <div style={{ width: totalW, height: 1 }} />
          </div>
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
        {sub ? subCommit.dialog : null}
        {sub ? (
          <MoveSubitemDialog
            item={moveFor}
            parents={data.items}
            label={subitemLabel(ctx.sheet, 1).toLowerCase()}
            onClose={() => setMoveFor(null)}
            onMove={(item, parent) => {
              setMoveFor(null);
              const [position] = positionsAtEnd(childrenOf(parent.id), 1);
              void sub.actions.moveSubitem(
                item,
                parent.id,
                position!,
                `${item.displayId} moved to ${parent.displayId}. Its ID stays ${item.displayId}.`,
              );
            }}
          />
        ) : null}
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
  /** Columns after the name: fields and collapsed groups' stubs. */
  bodyCols: BodyCol[];
  /** Column group labels (empty: the sheet has no column groups). */
  runs: RunBox[];
  /** collapsed group id → the member its stub shows. */
  stubFields: Map<string, Field | null>;
  onToggleGroup(groupId: string): void;
  /** Item rows: the item panel shows this item. */
  current: boolean;
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
  /** Comments (updates people wrote) on this row's item. */
  comments: UpdateSummary | undefined;
  /** The row actions menu is open (Shift+F10 or the "…" button). */
  menuOpen: boolean;
  onRowAction(item: Item, action: RowAction): void;
  allFields: Field[];
  widthOf(f: Field): number;
  columnActions(field: Field, index: number): ColumnMenuActions;
  density: Density;
  /** The row is the last of its group card. */
  endOfCard: boolean;
  /** Sub-items of the sheet (null when it has none). */
  sub: SubRowContext | null;
  subMenu: string | null;
  setSubMenu(itemId: string | null): void;
  /** Item rows: their sub-items are open, how many there are and how many are done. */
  subExpanded: boolean;
  subTotal: number;
  subDone: number;
  onToggleSub(itemId: string): void;
}

function RowContent(p: RowProps) {
  const { row } = p;
  if (row.kind === 'gap') return null;
  if (
    p.sub &&
    (row.kind === 'subheader' ||
      row.kind === 'subitem' ||
      row.kind === 'subempty' ||
      row.kind === 'subadd')
  ) {
    const common = {
      sub: p.sub,
      stickyW: p.stickyW,
      active: p.active,
      editing: p.editing,
      seed: p.seed,
      menuOpen: row.kind === 'subitem' && p.subMenu === row.item.id,
      setMenu: p.setSubMenu,
    };
    if (row.kind === 'subheader') return <SubHeaderRow {...common} row={row} />;
    if (row.kind === 'subitem') return <SubItemRow {...common} row={row} />;
    if (row.kind === 'subempty') return <SubEmptyRow {...common} row={row} />;
    return <SubAddRow {...common} row={row} />;
  }
  if (
    row.kind !== 'group' &&
    row.kind !== 'header' &&
    row.kind !== 'item' &&
    row.kind !== 'add' &&
    row.kind !== 'summary'
  )
    return null;
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
        !row.collapsed && 'border-b-row-line border-b',
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

/** A collapsed group's stub in a card's column header: its name and how many columns it hides; a click expands it. */
function StubHeader({ col, onToggle }: { col: StubCol; onToggle(groupId: string): void }) {
  const n = col.fields.length;
  return (
    <button
      type="button"
      title={`Show ${col.name}: ${col.fields.map((f) => f.name).join(', ')}`}
      className="text-muted-foreground hover:text-ink hover:bg-subtle focus-visible:outline-focus text-label-12 flex h-full w-full items-center gap-1 truncate px-[14px] text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
      onClick={() => onToggle(col.groupId)}
    >
      <span className="truncate">
        {col.name} · {n} hidden
      </span>
    </button>
  );
}

/** The slim line of column group labels above a card's column names (sheets with column groups). */
function GroupLabels({
  runs,
  stickyW,
  onToggle,
}: {
  runs: RunBox[];
  stickyW: number;
  onToggle(groupId: string): void;
}) {
  return (
    <>
      {runs.map((r) => (
        <div
          key={r.key}
          role="columnheader"
          className="absolute top-0 flex items-center"
          style={{ left: r.left, width: r.width, height: GROUP_LABEL_H }}
        >
          {/* the label stays in view while its columns scroll under the name column */}
          <div
            className="sticky flex max-w-full min-w-0 items-center px-1.5"
            style={{ left: stickyW }}
          >
            {r.groupId ? (
              <button
                type="button"
                aria-expanded={!r.collapsed}
                title={r.collapsed ? `Show ${r.name}` : `Collapse ${r.name}`}
                className="text-muted-foreground hover:text-ink hover:bg-soft focus-visible:outline-focus text-label-12 flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-md pr-2 pl-1 font-medium focus-visible:outline-2"
                onClick={() => onToggle(r.groupId!)}
              >
                {r.collapsed ? (
                  <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="truncate">{r.name}</span>
                <span className="text-label-11-mono shrink-0 text-[var(--muted)]">
                  {r.size}
                  <span className="sr-only"> columns</span>
                </span>
              </button>
            ) : (
              <span className="text-muted-foreground text-label-12 truncate pl-1 font-medium">
                {r.name}
              </span>
            )}
          </div>
          <span aria-hidden className="bg-line absolute right-1.5 bottom-0 left-1.5 h-px" />
        </div>
      ))}
    </>
  );
}

/** The column header at the top of a group card: select all of the group, the column names, "+" add a column. */
function HeaderRow(p: RowProps & { row: Extract<TableRow, { kind: 'header' }> }) {
  const { row } = p;
  const [pickerOpen, setPickerOpen] = useState(false);
  const items = p.groupItems.get(row.group.id) ?? [];
  const allSelected = items.length > 0 && items.every((i) => p.selected.has(i.id));
  // with column groups the label line sits above the column names
  const top = p.runs.length > 0 ? GROUP_LABEL_H : 0;
  const cell = { top, height: 34 };
  return (
    <>
      <Sticky
        width={p.stickyW}
        role="columnheader"
        className="border-b-surface-line border-r-col-line bg-head items-end self-stretch border-r border-b"
      >
        <span className="flex h-[34px] w-full items-center">
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
          <span className="text-muted-foreground text-label-12 truncate pl-[4px] font-medium">
            {p.ctx.sheet.itemLabel}
          </span>
        </span>
      </Sticky>
      {top ? <GroupLabels runs={p.runs} stickyW={p.stickyW} onToggle={p.onToggleGroup} /> : null}
      {p.vCols.map((vc) => {
        if (vc.index >= p.bodyCols.length)
          return (
            <div
              key="__trail"
              role="columnheader"
              className="border-b-surface-line bg-head absolute flex items-center border-b pl-1"
              style={{ left: vc.start, width: vc.size, ...cell }}
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
        const col = p.bodyCols[vc.index]!;
        if (col.kind === 'stub')
          return (
            <div
              key={`stub:${col.groupId}`}
              role="columnheader"
              className="border-b-surface-line border-r-col-line bg-head absolute border-r border-b"
              style={{ left: vc.start, width: vc.size, ...cell }}
            >
              <StubHeader col={col} onToggle={p.onToggleGroup} />
            </div>
          );
        const field = col.field;
        const index = p.allFields.findIndex((f) => f.id === field.id);
        return (
          <div
            key={field.id}
            className="absolute"
            style={{ left: vc.start, width: vc.size, ...cell }}
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

/** A collapsed group's cell in an item row: the value of the member that matters most; a click expands the group. */
function StubCell({
  col,
  item,
  field,
  ctx,
  left,
  width,
  selected,
  onToggle,
}: {
  col: StubCol;
  item: Item;
  field: Field | null;
  ctx: Ctx;
  left: number;
  width: number;
  selected: boolean;
  onToggle(groupId: string): void;
}) {
  const ui = field ? fieldUI(field.type) : null;
  const title = [
    ...col.fields.map((f) => `${f.name}: ${textOf(item, f, ctx) || '–'}`),
    `Click to show ${col.name}`,
  ].join('\n');
  return (
    <div
      role="gridcell"
      title={title}
      onClick={() => onToggle(col.groupId)}
      className={cn(
        'border-b-row-line border-r-col-line bg-subtle group-hover/row:bg-row-hover text-label-13 absolute top-0 flex h-full cursor-pointer items-center overflow-hidden border-r border-b px-[14px] [&_[data-pill]]:-mx-1.5',
        selected && 'bg-sel group-hover/row:bg-sel',
      )}
      style={{ left, width }}
    >
      {field && ui ? (
        <span className="pointer-events-none flex min-w-0 flex-1 items-center">
          <ui.Cell
            value={cellValue(item, field, ctx) as never}
            field={field}
            item={item}
            ctx={ctx}
            density="table"
          />
        </span>
      ) : (
        <span className="text-muted-foreground">–</span>
      )}
      <span className="sr-only">{title}</span>
    </div>
  );
}

const ItemRow = memo(function ItemRow(p: RowProps & { row: Extract<TableRow, { kind: 'item' }> }) {
  const { row, ctx, bodyCols, vCols } = p;
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
  // required fields the row leaves empty (added inline, or cleared): said in words with a warning symbol
  const missing = item.id.startsWith('temp-')
    ? ''
    : missingText(missingRequired(item, ctx.fieldsOf(item.sheetId), ctx));
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
          'border-b-row-line border-r-col-line group-hover/row:bg-row-hover border-r border-b',
          isSelected && 'bg-sel group-hover/row:bg-sel',
          p.current && 'bg-soft',
          drop.isOver && 'shadow-[inset_0_2px_0_var(--focus)]',
          drag.isDragging && 'opacity-40',
        )}
      >
        {/* the row the item panel shows: a 2 px ink marker */}
        {p.current ? (
          <span aria-hidden className="bg-ink absolute inset-y-0 left-0 z-[1] w-0.5" />
        ) : null}
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
              <span className="text-label-14 flex min-w-0 items-center gap-1">
                {p.sub && !item.id.startsWith('temp-') ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-expanded={p.subExpanded}
                    aria-label={`${p.subExpanded ? 'Hide' : 'Show'} ${p.sub.label.toLowerCase()} of ${item.displayId}`}
                    title={`${p.subExpanded ? 'Hide' : 'Show'} ${p.sub.label.toLowerCase()} (→ and ←)`}
                    className="text-muted-foreground hover:text-ink hover:bg-soft -ml-1 grid size-5 shrink-0 place-items-center rounded"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onToggleSub(item.id);
                    }}
                  >
                    <ChevronRight
                      className={cn('size-3.5 transition-transform', p.subExpanded && 'rotate-90')}
                      aria-hidden
                    />
                  </button>
                ) : null}
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
                {missing && p.density === 'compact' ? (
                  <span
                    className="text-warn flex shrink-0 items-center"
                    title={missing}
                    data-testid="missing-required"
                  >
                    <TriangleAlert className="size-3.5" aria-hidden />
                    <span className="sr-only">{missing}</span>
                  </span>
                ) : null}
              </span>
              {p.density === 'compact' && !p.actions.held.has(item.id) ? null : (
                <span className="text-muted-foreground text-label-12-mono flex min-w-0 items-center gap-[7px] leading-[17px]">
                  {itemRequirementRef(item) ? (
                    <>
                      <span className="text-foreground shrink-0 font-semibold">
                        <span className="sr-only">Ref </span>
                        {itemRequirementRef(item)}
                      </span>
                      <span aria-hidden>·</span>
                    </>
                  ) : null}
                  <span className="shrink-0">{item.displayId}</span>
                  {ownerName ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{ownerName}</span>
                    </>
                  ) : null}
                  {missing && p.density !== 'compact' ? (
                    <span
                      className="text-warn flex min-w-0 items-center gap-1 font-sans"
                      title={missing}
                      data-testid="missing-required"
                    >
                      <TriangleAlert className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{missing}</span>
                    </span>
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
                      title="Actions run when you finish this item"
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
            {p.sub && p.subTotal > 0 ? (
              <ProgressChip total={p.subTotal} done={p.subDone} label={p.sub.label} />
            ) : null}
            <FilesMarker item={item} ctx={ctx} onOpen={p.onOpenItem} />
            {p.comments && p.comments.count > 0 ? (
              <CommentBubble summary={p.comments} ctx={ctx} className="min-w-[40px]" />
            ) : (
              // names line up whether or not a row has updates
              <span aria-hidden className="w-[40px] shrink-0" />
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
        if (vc.index >= bodyCols.length)
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
        const bc = bodyCols[vc.index]!;
        if (bc.kind === 'stub')
          return (
            <StubCell
              key={`stub:${bc.groupId}`}
              col={bc}
              item={item}
              field={p.stubFields.get(bc.groupId) ?? null}
              ctx={ctx}
              left={vc.start}
              width={vc.size}
              selected={isSelected}
              onToggle={p.onToggleGroup}
            />
          );
        const field = bc.field;
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
        'border-b-row-line group-hover/row:bg-row-hover bg-surface absolute top-0 flex h-full items-center justify-end border-b pr-2',
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
        !p.endOfCard && 'border-b-row-line border-b',
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
  const { row, ctx, bodyCols, vCols } = p;
  return (
    <>
      <Sticky width={p.stickyW}>
        <span className="sr-only">Summary of {row.group.name}</span>
      </Sticky>
      {vCols.map((vc) => {
        if (vc.index >= bodyCols.length) return null;
        const bc = bodyCols[vc.index]!;
        const field = bc.kind === 'stub' ? p.stubFields.get(bc.groupId) : bc.field;
        if (!field) return null;
        const fn = p.summaries[field.key];
        return (
          <div
            key={columnId(bc)}
            role="gridcell"
            className="bg-surface absolute top-0 flex h-full items-center px-[14px]"
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

/** "Move to another item": the sub-item keeps its ID; the new parent counts it from now on. */
function MoveSubitemDialog({
  item,
  parents,
  label,
  onClose,
  onMove,
}: {
  item: Item | null;
  parents: Item[];
  label: string;
  onClose(): void;
  onMove(item: Item, parent: Item): void;
}) {
  const [to, setTo] = useState('');
  const options = parents.filter((p) => p.id !== item?.parentId && !p.id.startsWith('temp-'));
  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => {
        if (!o) {
          setTo('');
          onClose();
        }
      }}
    >
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogTitle className="text-heading-16">Move {item?.displayId}</DialogTitle>
        <DialogDescription className="text-copy-13">
          Choose the item this {label} belongs to. Its ID stays {item?.displayId}.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const parent = options.find((p) => p.id === to);
            if (item && parent) {
              setTo('');
              onMove(item, parent);
            }
          }}
        >
          <label className="text-label-13 flex flex-col gap-1.5 font-medium">
            New parent
            <select
              className="border-line bg-background-100 text-label-14 h-9 rounded-md border px-2"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            >
              <option value="">Choose an item</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayId} {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!to}>
              Move
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
