'use client';

import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { SummaryFn } from '@/engine/summaries';

// UI state of one grid (Zustand, UI state only): the active cell and range, the open editor, selected rows,
// collapsed groups, the column sort, hidden columns and summary choices. Hidden columns and summaries are
// remembered per sheet in this browser (there are no saved views yet).

export type CellRef = { itemId: string; col: string };

export interface GridState {
  active: CellRef | null;
  anchor: CellRef | null;
  editing: CellRef | null;
  selected: ReadonlySet<string>;
  lastSelected: string | null;
  collapsed: ReadonlySet<string>;
  sort: { fieldId: string; dir: 'asc' | 'desc' } | null;
  hidden: ReadonlySet<string>;
  summaries: Readonly<Record<string, SummaryFn>>;
  /** Column widths while resizing, before they are saved. */
  widths: Readonly<Record<string, number>>;
  settingsFor: string | null;
  addFieldAt: { beforeFieldId?: string; afterFieldId?: string } | null;

  focus(cell: CellRef, extend?: boolean): void;
  edit(cell: CellRef | null): void;
  setSelected(ids: Iterable<string>, last?: string | null): void;
  toggleCollapsed(groupId: string): void;
  setSort(sort: GridState['sort']): void;
  setHidden(fieldId: string, hidden: boolean): void;
  setSummary(fieldId: string, fn: SummaryFn): void;
  setWidth(fieldId: string, width: number | null): void;
  openSettings(fieldId: string | null): void;
  openAddField(at: GridState['addFieldAt']): void;
}

const prefsKey = (sheetId: string) => `grid:${sheetId}`;

function readPrefs(sheetId: string): { hidden: string[]; summaries: Record<string, SummaryFn> } {
  try {
    const raw = localStorage.getItem(prefsKey(sheetId));
    const p = raw
      ? (JSON.parse(raw) as { hidden?: string[]; summaries?: Record<string, SummaryFn> })
      : {};
    return { hidden: p.hidden ?? [], summaries: p.summaries ?? {} };
  } catch {
    return { hidden: [], summaries: {} };
  }
}

function writePrefs(sheetId: string, s: Pick<GridState, 'hidden' | 'summaries'>) {
  try {
    localStorage.setItem(
      prefsKey(sheetId),
      JSON.stringify({ hidden: [...s.hidden], summaries: s.summaries }),
    );
  } catch {
    // private mode or blocked storage: preferences last for this visit only
  }
}

export function createGridStore(sheetId: string): StoreApi<GridState> {
  const prefs = typeof window === 'undefined' ? { hidden: [], summaries: {} } : readPrefs(sheetId);
  return createStore<GridState>()((set, get) => ({
    active: null,
    anchor: null,
    editing: null,
    selected: new Set(),
    lastSelected: null,
    collapsed: new Set(),
    sort: null,
    hidden: new Set(prefs.hidden),
    summaries: prefs.summaries,
    widths: {},
    settingsFor: null,
    addFieldAt: null,

    focus: (cell, extend) =>
      set({ active: cell, anchor: extend ? (get().anchor ?? get().active ?? cell) : cell }),
    edit: (cell) => set({ editing: cell }),
    setSelected: (ids, last = null) => set({ selected: new Set(ids), lastSelected: last }),
    toggleCollapsed: (groupId) => {
      const next = new Set(get().collapsed);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      set({ collapsed: next });
    },
    setSort: (sort) => set({ sort }),
    setHidden: (fieldId, hidden) => {
      const next = new Set(get().hidden);
      if (hidden) next.add(fieldId);
      else next.delete(fieldId);
      set({ hidden: next });
      writePrefs(sheetId, get());
    },
    setSummary: (fieldId, fn) => {
      set({ summaries: { ...get().summaries, [fieldId]: fn } });
      writePrefs(sheetId, get());
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
