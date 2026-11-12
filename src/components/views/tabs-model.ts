// The sheet's view tabs (docs/01 FR-26): which saved or built-in view backs the Table tab and each "More" entry,
// which saved views get tabs of their own, and the view a URL id opens. Pure, so it is unit-tested.
import { toViewType, VIEW_TYPE_LABEL, type SavedView, type ViewType } from '@/engine/views/config';

export interface ActiveView {
  /** The id in the URL: a saved view's uuid or a built-in type. */
  id: string;
  type: ViewType;
  name: string;
  saved: SavedView | null;
  /** Changes save to the view (personal: mine; shared: I am an editor). */
  canWrite: boolean;
}

export interface ViewTabs {
  /** The Table tab: the first shared table view, else the built-in one. */
  table: ActiveView;
  /** Kanban, Calendar and Form under "More": the first shared view of that type, else the built-in one. */
  more: Record<'kanban' | 'calendar' | 'form', ActiveView>;
  /** Other saved views, each its own tab. */
  others: ActiveView[];
  /** The former Grid tab's view when the List one backs the Table: no tab, opens by its id. */
  merged: ActiveView[];
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
  const firstOf = (type: 'kanban' | 'calendar' | 'form') => {
    const v = base(type);
    return v ? asActive(v) : builtin(type);
  };
  return {
    table: tableBase ? { ...asActive(tableBase), name: 'Table' } : builtin('table'),
    more: { kanban: firstOf('kanban'), calendar: firstOf('calendar'), form: firstOf('form') },
    others: sorted.filter((v) => v.id !== tableBase?.id && v.id !== merged?.id).map(asActive),
    merged: merged ? [asActive(merged)] : [],
  };
}

/** The view a URL id (or the sheet's default) opens. Former ids (list, grid) open the Table. */
export function resolveActive(tabs: ViewTabs, id: string): ActiveView | null {
  const type = toViewType(id);
  if (type) return type === 'table' ? tabs.table : tabs.more[type];
  for (const v of [tabs.table, ...Object.values(tabs.more), ...tabs.others, ...tabs.merged])
    if (v.id === id) return v;
  return null;
}
