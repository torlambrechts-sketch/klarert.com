// The sheet's view tabs (docs/01 FR-26): which saved or built-in view backs the Table tab and each "More" entry,
// which saved views get tabs of their own, and the view a URL id opens. Pure, so it is unit-tested.
import {
  HIDDEN_BY_DEFAULT,
  toViewType,
  VIEW_TYPE_LABEL,
  type SavedView,
  type ViewType,
} from '@/engine/views/config';
import { BUILTIN_TAB_ORDER, isBuiltinTab, type SheetTab } from '@/engine/views/tabs';

export interface ActiveView {
  /** The id in the URL: a saved view's uuid or a built-in type. */
  id: string;
  type: ViewType;
  name: string;
  saved: SavedView | null;
  /** Changes save to the view (personal: mine; shared: I am an editor). */
  canWrite: boolean;
}

/** The built-in tabs after the Table, in tab order. */
export const BUILTIN_TABS = ['insights', 'kanban', 'calendar', 'form', 'design'] as const;
export type BuiltinTab = (typeof BUILTIN_TABS)[number];

export interface ViewTabs {
  /** The Table tab: the first shared table view, else the built-in one. */
  table: ActiveView;
  /**
   * Insights, Kanban, Calendar and Form: the first shared view of that type, else the built-in one. Design: always
   * the built-in one (nothing to save, docs/05 §3.8).
   */
  more: Record<BuiltinTab, ActiveView>;
  /** Other saved views, each its own tab. */
  others: ActiveView[];
  /** The former Grid tab's view when the List one backs the Table: no tab, opens by its id. */
  merged: ActiveView[];
  /** The sheet's forms (shared form views): listed on the Forms tab, never tabs of their own (docs/05 §3.3). */
  forms: ActiveView[];
}

const byPosition = (a: SavedView, b: SavedView) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export function buildTabs(views: SavedView[], userId: string, canEdit: boolean): ViewTabs {
  const sorted = [...views].sort(byPosition);
  const writable = (v: SavedView) => (v.ownerId === null ? canEdit : v.ownerId === userId);
  const asActive = (v: SavedView): ActiveView => ({
    id: v.id,
    type: v.type,
    name: v.name,
    saved: v,
    canWrite: writable(v),
  });
  const builtin = (type: ViewType): ActiveView => ({
    id: type,
    type,
    name: VIEW_TYPE_LABEL[type],
    saved: null,
    canWrite: false,
  });
  const base = (type: ViewType) => sorted.find((v) => v.type === type && v.ownerId === null);
  // The List and Grid tabs were each backed by their type's first shared view; both read as table views now. The
  // first table view backs the Table tab. The former Grid tab's view gets no tab of its own (two tabs showing the
  // same view looked broken) but still opens by its id. New table views are stored as 'list', so only an old
  // Grid base can have the stored type 'grid'.
  const tableBase = base('table');
  const gridBase = sorted.find((v) => v.legacyType === 'grid' && v.ownerId === null);
  const merged = gridBase && gridBase.id !== tableBase?.id ? gridBase : null;
  const firstOf = (type: BuiltinTab) => {
    const v = type === 'design' ? undefined : base(type);
    return v ? asActive(v) : builtin(type);
  };
  const forms = sorted.filter((v) => v.type === 'form' && v.ownerId === null).map(asActive);
  return {
    table: tableBase ? { ...asActive(tableBase), name: 'Table' } : builtin('table'),
    more: {
      insights: firstOf('insights'),
      kanban: firstOf('kanban'),
      calendar: firstOf('calendar'),
      // one tab for all the sheet's forms; who may change them is decided per form (owners and admins)
      form: { ...builtin('form'), name: forms.length > 1 ? `Forms (${forms.length})` : 'Forms' },
      design: builtin('design'),
    },
    others: sorted
      .filter((v) => v.id !== tableBase?.id && v.id !== merged?.id && v.type !== 'form')
      .map(asActive),
    merged: merged ? [asActive(merged)] : [],
    forms,
  };
}

/**
 * The view a URL id (or the sheet's default) opens. Former ids (list, grid) open the Table; a form's id opens the
 * Forms tab (which then shows that form).
 */
export function resolveActive(tabs: ViewTabs, id: string): ActiveView | null {
  const type = toViewType(id);
  if (type) return type === 'table' ? tabs.table : tabs.more[type];
  if (tabs.forms.some((f) => f.id === id)) return tabs.more.form;
  for (const v of [tabs.table, ...Object.values(tabs.more), ...tabs.others, ...tabs.merged])
    if (v.id === id) return v;
  return null;
}

// ───────────────────────── the sheet's tab set (settings.tabs) ─────────────────────────

/** One tab as the bar shows it. */
export interface LaidTab {
  /** The id in settings.tabs: a built-in type or a shared view's uuid. Personal views: their uuid. */
  entryId: string;
  view: ActiveView;
  /** The tab's words: its label, else its own name. */
  label: string;
  /** The name without a label ("Board", a saved view's name). */
  name: string;
  hidden: boolean;
  personal: boolean;
}

export interface TabLayout {
  /** Every shared tab in order, shown and hidden: what the editor lists. */
  all: LaidTab[];
  /** Shown tabs in order: the configured ones, built-ins and shared views not in the set appended. */
  shown: LaidTab[];
  /** Hidden tabs (the More menu's "Hidden tabs"); they still open by URL. */
  hidden: LaidTab[];
  /** My personal views, always after the configured tabs, in view order. */
  personal: LaidTab[];
}

/** A tab's own name: "Table" for the Table, "Board" for a built-in Kanban, else the view's name. */
export function tabName(tabs: ViewTabs, v: ActiveView): string {
  if (v.id === tabs.table.id) return 'Table';
  return v.saved ? v.name : v.type === 'kanban' ? 'Board' : v.name;
  // (the Forms tab's name, "Forms" or "Forms (3)", is set in buildTabs)
}

/**
 * The bar for a tab set (docs/05 §3): absent → today's order (Table, Insights, Board, Calendar, Form, shared views);
 * else the configured order, hidden ones aside, entries that no longer resolve skipped, and the built-ins and shared
 * views the set does not list appended. My personal views always come last.
 */
export function applyTabLayout(tabs: ViewTabs, config: readonly SheetTab[] | null): TabLayout {
  const builtin = (t: ViewType) => (t === 'table' ? tabs.table : tabs.more[t]);
  const builtins = BUILTIN_TAB_ORDER.map(builtin);
  const isBacking = (v: ActiveView) => builtins.some((b) => b.id === v.id);
  const shared = tabs.others.filter((v) => v.saved?.ownerId === null && !isBacking(v));
  const mine = tabs.others.filter((v) => v.saved && v.saved.ownerId !== null && v.canWrite);
  const lay = (entryId: string, view: ActiveView, entry?: SheetTab): LaidTab => {
    const name = tabName(tabs, view);
    return {
      entryId,
      view,
      name,
      label: entry?.label ?? name,
      // the Table is always shown
      hidden: view.id !== tabs.table.id && !!entry?.hidden,
      personal: !!view.saved && view.saved.ownerId !== null,
    };
  };
  const resolve = (id: string): ActiveView | null =>
    isBuiltinTab(id)
      ? builtin(id)
      : (builtins.find((b) => b.id === id) ?? shared.find((v) => v.id === id) ?? null);

  const laid: LaidTab[] = [];
  const used = new Set<string>();
  for (const entry of config ?? []) {
    const view = resolve(entry.id);
    if (!view || used.has(view.id)) continue;
    used.add(view.id);
    laid.push(lay(entry.id, view, entry));
  }
  if (!used.has(tabs.table.id)) {
    laid.unshift(lay('table', tabs.table));
    used.add(tabs.table.id);
  }
  // built-ins the set does not list (all of them without a set): shown, except those that start under More
  for (const [i, view] of builtins.entries())
    if (!used.has(view.id)) {
      used.add(view.id);
      const id = BUILTIN_TAB_ORDER[i]!;
      laid.push(lay(id, view, HIDDEN_BY_DEFAULT.includes(id) ? { id, hidden: true } : undefined));
    }
  for (const view of shared)
    if (!used.has(view.id)) {
      used.add(view.id);
      laid.push(lay(view.id, view));
    }
  return {
    all: laid,
    shown: laid.filter((t) => !t.hidden),
    hidden: laid.filter((t) => t.hidden),
    personal: mine.map((v) => lay(v.id, v)),
  };
}

/** The tab set for laid tabs (what the editor saves): ids, hidden, and labels that differ from the name. */
export function layoutEntries(
  laid: readonly Pick<LaidTab, 'entryId' | 'hidden' | 'label' | 'name'>[],
): SheetTab[] {
  return laid.map((t) => ({
    id: t.entryId,
    ...(t.hidden ? { hidden: true } : {}),
    ...(t.label !== t.name ? { label: t.label } : {}),
  }));
}

/** A tab as the editor needs it (serialisable: the settings page builds it on the server). */
export interface TabRow {
  entryId: string;
  /** The view behind the tab (a saved view's uuid or the built-in id). */
  viewId: string;
  type: ViewType;
  name: string;
  label: string;
  hidden: boolean;
}

export const toTabRows = (laid: readonly LaidTab[]): TabRow[] =>
  laid.map((t) => ({
    entryId: t.entryId,
    viewId: t.view.id,
    type: t.view.type,
    name: t.name,
    label: t.label,
    hidden: t.hidden,
  }));
