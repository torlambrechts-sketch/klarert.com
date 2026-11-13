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
  setSheetTabsAction,
  updateViewAction,
} from '@/app/[org]/s/view-actions';
import {
  emptyConfig,
  parseViewConfig,
  toViewType,
  sameConfig,
  sameLayout,
  withLayout,
  type SavedView,
  type ViewConfig,
  type ViewType,
} from '@/engine/views/config';
import { dropTab, type SheetTab } from '@/engine/views/tabs';
import { toView } from '@/lib/sheet-rows';
import { applyTabLayout, buildTabs, resolveActive, type ActiveView } from './tabs-model';
import { createClient } from '@/lib/supabase/client';

// The sheet's views (docs/01 FR-26): saved views from the database (RLS: shared ones and my personal ones), the
// built-in Table/Kanban/Calendar/Form views, the active view from ?view=, and its configuration.
// A saved view I may change saves itself as I change it; anything else is a draft I can "Save as view".

export const viewsKey = (sheetId: string) => ['views', sheetId] as const;

export {
  applyTabLayout,
  buildTabs,
  resolveActive,
  type ActiveView,
  type LaidTab,
  type TabLayout,
  type ViewTabs,
} from './tabs-model';

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
  /** sheets.settings.tabs (null: today's order) and tabsDefault (the template's set). */
  tabSet?: { tabs: SheetTab[] | null; tabsDefault: SheetTab[] | null };
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
  const [tabSet, setTabSet] = useState<SheetTab[] | null>(input.tabSet?.tabs ?? null);
  const layout = useMemo(() => applyTabLayout(tabs, tabSet), [tabs, tabSet]);

  // ───────────── the active view: ?view=, else the sheet's default, else List ─────────────
  const search = useSearchParams();
  const param = search.get('view');
  const [storedDefault, setDefaultViewId] = useState(input.defaultViewId);
  // a default saved before the Table view ('list', 'grid') is the Table
  const defaultViewId = storedDefault ? (toViewType(storedDefault) ?? storedDefault) : null;
  const wanted = param ?? defaultViewId ?? 'table';
  const resolved = query.isSuccess ? resolveActive(tabs, wanted) : null;
  const active: ActiveView = resolved ?? resolveActive(tabs, toViewType(wanted) ?? 'table')!;
  const missing = query.isSuccess && !resolved;
  useEffect(() => {
    if (!missing || !param) return;
    toast.error('That view no longer exists or is not shared with you. Showing the table.');
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
      // a Table view's columns (hidden, collapsed groups) stay a draft until "Update"; the rest saves as it changes
      const saved = active.saved.config;
      const payload = active.type === 'table' ? withLayout(next, saved) : next;
      clearTimeout(timers.current.get(id));
      if (sameConfig(payload, saved)) return;
      timers.current.set(
        id,
        setTimeout(async () => {
          const r = await updateViewAction({ org, viewId: id, config: payload });
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
  /** A Table view I may change whose columns differ from what it saves: offer "Update". */
  const layoutDirty =
    active.type === 'table' && !!active.saved && active.canWrite && !sameLayout(config, base);

  /** Save the draft's columns into the active saved view. */
  const updateLayout = useCallback(async () => {
    const saved = active.saved;
    if (!saved || !active.canWrite) return;
    const r = await updateViewAction({
      org,
      viewId: saved.id,
      config: withLayout(saved.config, config),
    });
    if (!r.ok) return void toast.error(r.error.message);
    qc.setQueryData<SavedView[]>(viewsKey(sheetId), (list) =>
      list?.map((v) => (v.id === saved.id ? r.data.view : v)),
    );
    toast(`“${saved.name}” updated.`);
  }, [active, config, org, qc, sheetId]);

  /** Open a Table view with the columns it saves (a chip of the view bar). */
  const choose = useCallback(
    (id: string) => {
      if (id === active.id) {
        setDrafts((d) => ({ ...d, [id]: withLayout(config, base) }));
        return;
      }
      setDrafts((d) => {
        const { [id]: _drop, ...rest } = d;
        void _drop;
        return rest;
      });
      open(id);
    },
    [active.id, base, config, open],
  );

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
      setTabSet((set) => (set ? (dropTab({ tabs: set }, view.id).tabs ?? set) : set));
      open('table');
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

  /** Save the sheet's tab set (owners and admins). Resolves true when saved. */
  const saveTabs = useCallback(
    async (next: SheetTab[], firstId: string) => {
      const r = await setSheetTabsAction({ org, sheetId, tabs: next, defaultViewId: firstId });
      if (!r.ok) {
        toast.error(r.error.message);
        return false;
      }
      setTabSet(r.data.tabs);
      setDefaultViewId(r.data.defaultViewId);
      toast('Tabs saved.', r.data.summary ? { description: r.data.summary } : undefined);
      if (r.data.notice) toast(r.data.notice);
      return true;
    },
    [org, sheetId],
  );

  return {
    query,
    views,
    tabs,
    layout,
    tabSet,
    tabsDefault: input.tabSet?.tabsDefault ?? null,
    saveTabs,
    active,
    config,
    setConfig,
    unsaved,
    layoutDirty,
    updateLayout,
    choose,
    /** Shared views need an editor. */
    canShare: canEdit,
    ready: query.isSuccess || query.isError,
    defaultViewId: defaultViewId ?? 'table',
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
