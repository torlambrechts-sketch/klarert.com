'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createViewAction,
  deleteViewAction,
  duplicateViewAction,
  setDefaultViewAction,
  updateViewAction,
} from '@/app/[org]/s/view-actions';
import {
  emptyConfig,
  isBuiltinViewId,
  parseViewConfig,
  sameConfig,
  VIEW_TYPE_LABEL,
  type SavedView,
  type ViewConfig,
  type ViewType,
} from '@/engine/views/config';
import { toView } from '@/lib/sheet-rows';
import { createClient } from '@/lib/supabase/client';

// The sheet's views (docs/01 FR-26): saved views from the database (RLS: shared ones and my personal ones), the
// built-in List/Grid/Kanban/Calendar/Form views, the active view from ?view=, and its configuration.
// A saved view I may change saves itself as I change it; anything else is a draft I can "Save as view".

export const viewsKey = (sheetId: string) => ['views', sheetId] as const;

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
  /** The List and Grid tabs: the first shared view of that type, else the built-in one. */
  list: ActiveView;
  grid: ActiveView;
  /** Kanban, Calendar and Form under "More": the first shared view of that type, else the built-in one. */
  more: Record<'kanban' | 'calendar' | 'form', ActiveView>;
  /** Other saved views, each its own tab. */
  others: ActiveView[];
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
  const listBase = base('list');
  const gridBase = base('grid');
  const used = new Set([listBase?.id, gridBase?.id]);
  const firstOf = (type: 'kanban' | 'calendar' | 'form') => {
    const v = base(type);
    return v ? asActive(v) : builtin(type);
  };
  return {
    list: listBase ? { ...asActive(listBase), name: 'List' } : builtin('list'),
    grid: gridBase ? { ...asActive(gridBase), name: 'Grid' } : builtin('grid'),
    more: { kanban: firstOf('kanban'), calendar: firstOf('calendar'), form: firstOf('form') },
    others: sorted.filter((v) => !used.has(v.id)).map(asActive),
  };
}

/** The view a URL id (or the sheet's default) opens. Unknown ids fall back to List. */
export function resolveActive(tabs: ViewTabs, id: string): ActiveView | null {
  if (isBuiltinViewId(id)) {
    if (id === 'list') return tabs.list;
    if (id === 'grid') return tabs.grid;
    return tabs.more[id];
  }
  for (const v of [tabs.list, tabs.grid, ...Object.values(tabs.more), ...tabs.others])
    if (v.id === id) return v;
  return null;
}

const localKey = (sheetId: string, id: string) => `view:${sheetId}:${id}`;

function readLocal(sheetId: string, id: string): ViewConfig | null {
  try {
    const raw = localStorage.getItem(localKey(sheetId, id));
    return raw ? parseViewConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(sheetId: string, id: string, cfg: ViewConfig) {
  try {
    localStorage.setItem(localKey(sheetId, id), JSON.stringify(cfg));
  } catch {
    // blocked storage: the draft lasts for this visit only
  }
}

export function useViews(input: {
  org: string;
  sheetId: string;
  userId: string;
  canEdit: boolean;
  defaultViewId: string | null;
}) {
  const { org, sheetId, userId, canEdit } = input;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: viewsKey(sheetId),
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('views')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('position');
      if (error) throw new Error(error.message);
      return (data ?? []).map(toView);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const views = useMemo(() => query.data ?? [], [query.data]);
  const tabs = useMemo(() => buildTabs(views, userId, canEdit), [views, userId, canEdit]);

  // ───────────── the active view: ?view=, else the sheet's default, else List ─────────────
  const search = useSearchParams();
  const param = search.get('view');
  const [defaultViewId, setDefaultViewId] = useState(input.defaultViewId);
  const wanted = param ?? defaultViewId ?? 'list';
  const resolved = query.isSuccess ? resolveActive(tabs, wanted) : null;
  const active: ActiveView =
    resolved ?? (isBuiltinViewId(wanted) ? resolveActive(tabs, wanted)! : tabs.list);
  const missing = query.isSuccess && !resolved;
  useEffect(() => {
    if (!missing || !param) return;
    toast.error('That view no longer exists or is not shared with you. Showing the list.');
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    window.history.replaceState(null, '', url.toString());
  }, [missing, param]);

  const open = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', id);
    url.searchParams.delete('item');
    window.history.pushState(null, '', url.toString());
  }, []);

  // ───────────── configuration: drafts, autosave for views I may change ─────────────
  const [drafts, setDrafts] = useState<Record<string, ViewConfig>>({});
  const base = active.saved?.config ?? emptyConfig();
  const [localLoaded, setLocalLoaded] = useState<Record<string, ViewConfig | null>>({});
  useEffect(() => {
    if (active.saved || active.id in localLoaded) return;
    setLocalLoaded((m) => ({ ...m, [active.id]: readLocal(sheetId, active.id) }));
  }, [active.id, active.saved, localLoaded, sheetId]);
  const config = drafts[active.id] ?? (active.saved ? base : (localLoaded[active.id] ?? base));

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const setConfig = useCallback(
    (update: (c: ViewConfig) => ViewConfig) => {
      const next = update(config);
      setDrafts((d) => ({ ...d, [active.id]: next }));
      if (!active.saved) {
        writeLocal(sheetId, active.id, next);
        return;
      }
      if (!active.canWrite) return;
      const id = active.saved.id;
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(async () => {
          const r = await updateViewAction({ org, viewId: id, config: next });
          if (!r.ok) return void toast.error(r.error.message);
          qc.setQueryData<SavedView[]>(viewsKey(sheetId), (list) =>
            list?.map((v) => (v.id === id ? r.data.view : v)),
          );
        }, 500),
      );
    },
    [active, config, org, qc, sheetId],
  );
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => clearTimeout(x));
  }, []);

  /** A draft that differs from what the view saves: offer "Save as view". */
  const unsaved = !active.canWrite && !sameConfig(config, base);

  // ───────────── view commands ─────────────
  const upsert = useCallback(
    (view: SavedView) =>
      qc.setQueryData<SavedView[]>(viewsKey(sheetId), (list) => [
        ...(list ?? []).filter((v) => v.id !== view.id),
        view,
      ]),
    [qc, sheetId],
  );

  const create = useCallback(
    async (v: { name: string; type: ViewType; shared: boolean; config: ViewConfig }) => {
      const r = await createViewAction({ org, sheetId, ...v });
      if (!r.ok) {
        toast.error(r.error.message);
        return null;
      }
      upsert(r.data.view);
      setDrafts((d) => {
        const { [active.id]: _drop, ...rest } = d;
        void _drop;
        return rest;
      });
      open(r.data.view.id);
      toast(v.shared ? 'View saved and shared.' : 'View saved. Only you can see it.');
      return r.data.view;
    },
    [active.id, open, org, sheetId, upsert],
  );

  const rename = useCallback(
    async (view: SavedView, name: string) => {
      const r = await updateViewAction({ org, viewId: view.id, name });
      if (!r.ok) return void toast.error(r.error.message);
      upsert(r.data.view);
      toast('View renamed.');
    },
    [org, upsert],
  );

  const duplicate = useCallback(
    async (view: SavedView, name: string, shared: boolean) => {
      const r = await duplicateViewAction({ org, viewId: view.id, name, shared });
      if (!r.ok) return void toast.error(r.error.message);
      upsert(r.data.view);
      open(r.data.view.id);
      toast('View duplicated.');
    },
    [open, org, upsert],
  );

  const remove = useCallback(
    async (view: SavedView) => {
      const r = await deleteViewAction({ org, viewId: view.id });
      if (!r.ok) return void toast.error(r.error.message);
      qc.setQueryData<SavedView[]>(viewsKey(sheetId), (list) =>
        list?.filter((v) => v.id !== view.id),
      );
      if (defaultViewId === view.id) setDefaultViewId(null);
      open('list');
      toast('View deleted.');
    },
    [defaultViewId, open, org, qc, sheetId],
  );

  const makeDefault = useCallback(
    async (id: string) => {
      const r = await setDefaultViewAction({ org, sheetId, viewId: id });
      if (!r.ok) return void toast.error(r.error.message);
      setDefaultViewId(r.data.viewId);
      toast('This view now opens first for everyone.');
    },
    [org, sheetId],
  );

  return {
    query,
    views,
    tabs,
    active,
    config,
    setConfig,
    unsaved,
    /** Shared views need an editor. */
    canShare: canEdit,
    ready: query.isSuccess || query.isError,
    defaultViewId: defaultViewId ?? 'list',
    open,
    create,
    rename,
    duplicate,
    remove,
    makeDefault,
    upsert,
  };
}

export type ViewsState = ReturnType<typeof useViews>;
