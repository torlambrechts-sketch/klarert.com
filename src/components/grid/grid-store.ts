'use client';

import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import {
  toggleColumnFilter,
  type ColumnFilters,
  type QuickView,
} from '@/engine/views/quick-filters';

// UI state of one sheet's Table (Zustand, UI state only): the active cell and range, the open editor, selected
// rows, collapsed groups and hidden columns. Hidden columns belong to the active view (the sheet page syncs them
// both ways through `onHiddenChange`); sort and column summaries live in the view's config.

export type CellRef = { itemId: string; col: string };

export interface GridState {
  active: CellRef | null;
  anchor: CellRef | null;
  editing: CellRef | null;
  selected: ReadonlySet<string>;
  lastSelected: string | null;
  collapsed: ReadonlySet<string>;
  /** Parents whose sub-items are open in the Table (kept per person and sheet in localStorage). */
  expanded: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  /** Column widths while resizing, before they are saved. */
  widths: Readonly<Record<string, number>>;
  settingsFor: string | null;
  /** Table "Group by": a field id, or null for the sheet's own groups. UI state only. */
  groupBy: string | null;
  /** The Table's quick view (View ▾, Filter ▾ "Show"). */
  quick: QuickView;
  /** Filter ▾'s option filters: field id → option or person ids. */
  colFilters: ColumnFilters;
  /** The items the Table shows, in order (set by the Table view; Export to CSV reads it). */
  shownIds: readonly string[];
  /**
   * Table filter on one value of another field, set by clicking a bar in the Insights view (UI state, a removable
   * chip in the toolbar). `label` names it: "Severity: High".
   */
  valueFilter: { fieldId: string; key: string; label: string } | null;
  /** Table filter "Missing required": only items that leave a required field empty (UI state). */
  missingOnly: boolean;
  /** Table row height (kept per browser by the sheet page). */
  density: 'comfortable' | 'compact';
  /** The item whose row actions menu is open (keyboard: Shift+F10 on the grid). */
  rowMenu: string | null;
  addFieldAt: { beforeFieldId?: string; afterFieldId?: string } | null;
  /** The Columns menu: closed, open, or open at its hidden list ("Hidden · N"). */
  columnsMenu: null | 'all' | 'hidden';

  focus(cell: CellRef, extend?: boolean): void;
  edit(cell: CellRef | null): void;
  setSelected(ids: Iterable<string>, last?: string | null): void;
  toggleCollapsed(groupId: string): void;
  toggleExpanded(itemId: string, open?: boolean): void;
  setExpanded(ids: Iterable<string>): void;
  setHidden(fieldId: string, hidden: boolean): void;
  /** Called with the new hidden set when a column is hidden or shown (the active view saves it). */
  onHiddenChange: ((hidden: ReadonlySet<string>) => void) | null;
  setWidth(fieldId: string, width: number | null): void;
  openSettings(fieldId: string | null): void;
  setGroupBy(fieldId: string | null): void;
  setQuick(view: QuickView): void;
  toggleColFilter(fieldId: string, key: string): void;
  setColFilters(filters: ColumnFilters): void;
  /** Filter ▾ "Clear all": the quick view, the option filters, the value filter and missing required. */
  clearToolbarFilters(): void;
  setValueFilter(f: GridState['valueFilter']): void;
  setMissingOnly(on: boolean): void;
  setDensity(d: GridState['density']): void;
  openRowMenu(itemId: string | null): void;
  openAddField(at: GridState['addFieldAt']): void;
  openColumns(at: GridState['columnsMenu']): void;
}

export function createGridStore(): StoreApi<GridState> {
  return createStore<GridState>()((set, get) => ({
    active: null,
    anchor: null,
    editing: null,
    selected: new Set(),
    lastSelected: null,
    collapsed: new Set(),
    expanded: new Set(),
    hidden: new Set(),
    onHiddenChange: null,
    widths: {},
    settingsFor: null,
    groupBy: null,
    quick: 'all',
    colFilters: {},
    shownIds: [],
    valueFilter: null,
    missingOnly: false,
    // 40 px rows by default; 52 px is the comfortable density (owner decision 18 Nov 2026, docs/18 C4)
    density: 'compact',
    rowMenu: null,
    addFieldAt: null,
    columnsMenu: null,

    focus: (cell, extend) =>
      set({ active: cell, anchor: extend ? (get().anchor ?? get().active ?? cell) : cell }),
    edit: (cell) => set({ editing: cell }),
    setSelected: (ids, last = null) => set({ selected: new Set(ids), lastSelected: last }),
    setGroupBy: (fieldId) => set({ groupBy: fieldId }),
    setQuick: (quick) => set({ quick }),
    toggleColFilter: (fieldId, key) =>
      set({ colFilters: toggleColumnFilter(get().colFilters, fieldId, key) }),
    setColFilters: (colFilters) => set({ colFilters }),
    clearToolbarFilters: () =>
      set({ quick: 'all', colFilters: {}, valueFilter: null, missingOnly: false }),
    setValueFilter: (valueFilter) => set({ valueFilter }),
    setMissingOnly: (missingOnly) => set({ missingOnly }),
    setDensity: (density) => set({ density }),
    openRowMenu: (itemId) => set({ rowMenu: itemId }),
    toggleCollapsed: (groupId) => {
      const next = new Set(get().collapsed);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      set({ collapsed: next });
    },
    toggleExpanded: (itemId, open) => {
      const next = new Set(get().expanded);
      if (open ?? !next.has(itemId)) next.add(itemId);
      else next.delete(itemId);
      set({ expanded: next });
    },
    setExpanded: (ids) => set({ expanded: new Set(ids) }),
    setHidden: (fieldId, hidden) => {
      const next = new Set(get().hidden);
      if (hidden) next.add(fieldId);
      else next.delete(fieldId);
      set({ hidden: next });
      get().onHiddenChange?.(next);
    },
    setWidth: (fieldId, width) => {
      const next = { ...get().widths };
      if (width === null) delete next[fieldId];
      else next[fieldId] = width;
      set({ widths: next });
    },
    openSettings: (fieldId) => set({ settingsFor: fieldId }),
    openAddField: (at) => set({ addFieldAt: at }),
    openColumns: (at) => set({ columnsMenu: at }),
  }));
}

export const GridStoreContext = createContext<StoreApi<GridState> | null>(null);

export function useGrid<T>(pick: (s: GridState) => T): T {
  const store = useContext(GridStoreContext);
  if (!store) throw new Error('useGrid outside a grid');
  return useStore(store, pick);
}

export function useGridStore(): StoreApi<GridState> {
  const store = useContext(GridStoreContext);
  if (!store) throw new Error('useGridStore outside a grid');
  return store;
}
