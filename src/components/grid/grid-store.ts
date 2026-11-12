'use client';

import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';

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
  hidden: ReadonlySet<string>;
  /** Column widths while resizing, before they are saved. */
  widths: Readonly<Record<string, number>>;
  settingsFor: string | null;
  /** Table "Group by": a field id, or null for the sheet's own groups. UI state only. */
  groupBy: string | null;
  /** Table person filter: user ids; empty = everyone. */
  people: ReadonlySet<string>;
  /** Table status filter: option ids of the item status field; empty = every status. */
  statuses: ReadonlySet<string>;
  /** Table row height (kept per browser by the sheet page). */
  density: 'comfortable' | 'compact';
  /** The item whose row actions menu is open (keyboard: Shift+F10 on the grid). */
  rowMenu: string | null;
  addFieldAt: { beforeFieldId?: string; afterFieldId?: string } | null;

  focus(cell: CellRef, extend?: boolean): void;
  edit(cell: CellRef | null): void;
  setSelected(ids: Iterable<string>, last?: string | null): void;
  toggleCollapsed(groupId: string): void;
  setHidden(fieldId: string, hidden: boolean): void;
  /** Called with the new hidden set when a column is hidden or shown (the active view saves it). */
  onHiddenChange: ((hidden: ReadonlySet<string>) => void) | null;
  setWidth(fieldId: string, width: number | null): void;
  openSettings(fieldId: string | null): void;
  setGroupBy(fieldId: string | null): void;
  togglePerson(userId: string): void;
  clearPeople(): void;
  toggleStatus(optionId: string): void;
  clearStatuses(): void;
  setDensity(d: GridState['density']): void;
  openRowMenu(itemId: string | null): void;
  openAddField(at: GridState['addFieldAt']): void;
}

export function createGridStore(): StoreApi<GridState> {
  return createStore<GridState>()((set, get) => ({
    active: null,
    anchor: null,
    editing: null,
    selected: new Set(),
    lastSelected: null,
    collapsed: new Set(),
    hidden: new Set(),
    onHiddenChange: null,
    widths: {},
    settingsFor: null,
    groupBy: null,
    people: new Set(),
    statuses: new Set(),
    density: 'comfortable',
    rowMenu: null,
    addFieldAt: null,

    focus: (cell, extend) =>
      set({ active: cell, anchor: extend ? (get().anchor ?? get().active ?? cell) : cell }),
    edit: (cell) => set({ editing: cell }),
    setSelected: (ids, last = null) => set({ selected: new Set(ids), lastSelected: last }),
    setGroupBy: (fieldId) => set({ groupBy: fieldId }),
    togglePerson: (userId) => {
      const next = new Set(get().people);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      set({ people: next });
    },
    clearPeople: () => set({ people: new Set() }),
    toggleStatus: (optionId) => {
      const next = new Set(get().statuses);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      set({ statuses: next });
    },
    clearStatuses: () => set({ statuses: new Set() }),
    setDensity: (density) => set({ density }),
    openRowMenu: (itemId) => set({ rowMenu: itemId }),
    toggleCollapsed: (groupId) => {
      const next = new Set(get().collapsed);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      set({ collapsed: next });
    },
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
