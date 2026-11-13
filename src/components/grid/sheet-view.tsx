'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Folder, Plus, Settings, Share, Sheet } from 'lucide-react';
import { toast } from 'sonner';
import { sheetCtx, withSubitems } from '@/engine/sheet-data';
import { useSubitems, type SubitemsHandle } from '@/components/subitems/use-subitems';
import { searchSubitems } from '@/engine/subitems';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import { CLIENT_FILTER_LIMIT, groupRows } from '@/engine/views/apply';
import type { ConfigEnv } from '@/components/fields/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SheetAutomations } from '@/components/automations/sheet-automations';
import { ItemPanel } from '@/components/item-panel/item-panel';
import { CalendarView } from '@/components/views/calendar-view';
import { FilterButton, SheetSearch, SortButton } from '@/components/views/filter-bar';
import { FormView } from '@/components/views/form-view';
import { KanbanView } from '@/components/views/kanban-view';
import { InsightsView } from '@/components/insights/insights-view';
import { ownerField } from '@/engine/item-panel';
import { statusFilterField } from '@/engine/views/quick-filters';
import { NewItemDialog, type NewItemRequest } from '@/components/views/new-item-dialog';
import { useOnline } from '@/components/states/use-online';
import { useViewItems } from '@/components/views/use-view-items';
import { useViews, type ViewsState } from '@/components/views/use-views';
import { ViewMenu, ViewTabs } from '@/components/views/view-tabs';
import { PageHeader } from '@/components/shell/page-header';
import { ShellCrumb } from '@/components/shell/shell-crumb';
import { cn } from '@/lib/utils';
import { FieldPicker } from './field-picker';
import { FieldSettings } from './field-settings';
import { GroupSelect } from '@/components/table/group-select';
import { TableView } from '@/components/table/table-view';
import {
  ColumnsMenu,
  DensityToggle,
  OwnerFilter,
  StatusFilter,
  TableActions,
  useDensityPreference,
  ValueFilterChip,
} from '@/components/table/table-actions';
import { createGridStore, GridStoreContext, useGrid, useGridStore } from './grid-store';
import {
  useRelatedRealtime,
  useSheetActions,
  useSheetQuery,
  useSheetRealtime,
  useSheetsList,
  type SheetActions,
} from './use-sheet';

// The sheet page's client part: data (TanStack Query + realtime); the page header (crumb, title, description, Share
// and New item); the view tabs; one toolbar row (search, Actions with the bulk actions for selected rows, groups,
// status and owner filters, sort, filter, columns, row density, automations); the active view (Table, Kanban,
// Calendar, Form), the item panel, field settings and the add-field picker.

/** The page header's actions: the board design's 36 px buttons with 15 px icons. */
const headerButton =
  "text-label-13.5 h-9 gap-1.5 px-3.5 has-[>svg]:px-3.5 [&_svg:not([class*='size-'])]:size-[15px]";

export interface SheetViewProps {
  org: string;
  sheetId: string;
  sheetName: string;
  /** sheets.description, shown under the title when set. */
  description?: string | null;
  folderName: string | null;
  archived: boolean;
  userId: string;
  timeZone: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  onlyGroup: string | null;
  /** sheets.settings.defaultViewId: a saved view's id or a built-in view; null = Table. */
  defaultViewId: string | null;
}

export function SheetView(props: SheetViewProps) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: 1 } },
      }),
  );
  const [store] = useState(() => createGridStore());
  return (
    <QueryClientProvider client={client}>
      <GridStoreContext.Provider value={store}>
        <SheetBody {...props} />
      </GridStoreContext.Provider>
    </QueryClientProvider>
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 759px)');
    const set = () => setNarrow(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);
  return narrow;
}

/** The sheet search, kept in ?q= (replaced, not pushed, while typing). */
function useSearchParam(): [string, (v: string) => void] {
  const params = useSearchParams();
  const fromUrl = params.get('q') ?? '';
  const [q, setQ] = useState(fromUrl);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setQ((cur) => (timer.current ? cur : fromUrl));
  }, [fromUrl]);
  const set = useCallback((v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const url = new URL(window.location.href);
      if (v.trim()) url.searchParams.set('q', v);
      else url.searchParams.delete('q');
      window.history.replaceState(null, '', url.toString());
    }, 300);
  }, []);
  return [q, set];
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

function SheetBody(props: SheetViewProps) {
  const { org, sheetId, sheetName, userId, timeZone, role } = props;
  const query = useSheetQuery(sheetId);
  const actions = useSheetActions(org, sheetId);
  const realtime = useSheetRealtime(sheetId, actions.pending);
  useRelatedRealtime(sheetId, query.data?.related.sheets.map((s) => s.id) ?? []);
  const online = useOnline();
  const narrow = useNarrow();
  const canEdit = role !== 'viewer';
  const isAdmin = role === 'owner' || role === 'admin';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const raw = query.data;
  // sub-items (docs/02 §12): the child sheet loads beside the sheet; its rows join the Ctx for roll-ups
  const subEnv = useMemo(() => ({ now, timeZone, userId, isAdmin }), [now, timeZone, userId, isAdmin]);
  const sub = useSubitems(org, raw?.sheet.childSheetId ?? null, raw, subEnv);
  const subData = sub.state?.data;
  const data = useMemo(() => (raw ? withSubitems(raw, subData) : undefined), [raw, subData]);
  const ctx = useMemo(
    () =>
      data
        ? sheetCtx(data, {
            now,
            timeZone,
            userId,
            isAdmin,
            newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
          })
        : null,
    [data, now, timeZone, userId, isAdmin],
  );
  const sheets = useSheetsList(data?.sheet.orgId);
  const store = useGridStore();
  const views = useViews({ org, sheetId, userId, canEdit, defaultViewId: props.defaultViewId });
  const { active, config, setConfig } = views;
  const [q, setQ] = useSearchParam();
  const [addTick, setAddTick] = useState(0);
  const [newItem, setNewItem] = useState<NewItemRequest | null>(null);
  useDensityPreference();

  // hidden columns belong to the view: view → grid store, and column menu → view
  const fields = data?.fields;
  useEffect(() => {
    if (!fields) return;
    const ids = new Set(fields.filter((f) => config.hidden.includes(f.key)).map((f) => f.id));
    if (!sameSet(ids, store.getState().hidden)) store.setState({ hidden: ids });
  }, [config.hidden, fields, store]);
  useEffect(() => {
    store.setState({
      onHiddenChange: (ids) =>
        setConfig((c) => ({
          ...c,
          hidden: (fields ?? []).filter((f) => ids.has(f.id)).map((f) => f.key),
        })),
    });
  }, [fields, setConfig, store]);
  const hidden = useGrid((s) => s.hidden);

  const env: ConfigEnv | null = useMemo(
    () =>
      data && ctx
        ? {
            sheet: data.sheet,
            fields: data.fields,
            sheets: sheets.data ?? [],
            ctx,
            firstItemId: data.items[0]?.id,
          }
        : null,
    [data, ctx, sheets.data],
  );

  const hiddenCount = data ? data.fields.filter((f) => hidden.has(f.id)).length : 0;
  const tabular = active.type === 'table';
  const filterable = active.type !== 'form';
  const inScope = useMemo(
    () =>
      data
        ? props.onlyGroup
          ? data.items.filter((i) => i.groupId === props.onlyGroup)
          : data.items
        : [],
    [data, props.onlyGroup],
  );
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Link copied.');
    } catch {
      toast.error('The link could not be copied. Copy it from the address bar.');
    }
  };
  const itemLabel = data?.sheet.itemLabel.toLowerCase() ?? 'item';

  return (
    <main
      className={cn(
        'flex min-w-0 flex-col px-4 pt-5 sm:px-[28px] sm:pt-[26px]',
        // the Table and Insights scroll with the page; the other views fill the window and scroll inside
        tabular || active.type === 'insights'
          ? 'min-h-[calc(100dvh-48px)] pb-[24px]'
          : 'h-[calc(100dvh-48px)] pb-3 max-[759px]:h-[calc(100dvh-112px)]',
      )}
    >
      <ShellCrumb>
        <nav aria-label="Breadcrumb" className="text-label-14 flex min-w-0 items-center gap-2.5">
          {props.folderName ? (
            <>
              <span className="text-muted-foreground flex min-w-0 items-center gap-2">
                <Folder className="size-[15px] shrink-0" aria-hidden />
                <span className="truncate">{props.folderName}</span>
              </span>
              <span aria-hidden className="text-line-strong text-label-20 leading-none font-light">
                /
              </span>
            </>
          ) : null}
          <span className="text-ink flex min-w-0 items-center gap-2" aria-current="page">
            <Sheet className="size-[15px] shrink-0" aria-hidden />
            <span className="truncate font-medium">{sheetName}</span>
          </span>
          {props.archived || data?.sheet.isLibrary ? (
            <span className="bg-soft text-muted-foreground text-label-12 shrink-0 rounded-full px-[9px] py-0.5 font-medium">
              {props.archived ? 'Archived' : 'Library'}
            </span>
          ) : null}
        </nav>
      </ShellCrumb>
      <PageHeader
        title={sheetName}
        description={
          props.description || (realtime === 'offline' && online) ? (
            <>
              {props.description}
              {realtime === 'offline' && online ? (
                <span className="text-muted-foreground text-label-13 block">
                  Live updates paused, reconnecting.
                </span>
              ) : null}
            </>
          ) : undefined
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              className={headerButton}
              onClick={() => void share()}
            >
              <Share aria-hidden /> Share
            </Button>
            {canEdit && active.type !== 'form' ? (
              <Button
                type="button"
                className={cn(headerButton, 'font-semibold')}
                onClick={() => (tabular ? setAddTick((t) => t + 1) : setNewItem({}))}
                disabled={!data}
              >
                <Plus aria-hidden /> New {itemLabel}
              </Button>
            ) : null}
          </>
        }
      />
      <ViewTabs
        className="-mx-4 px-4 sm:-mx-[28px] sm:px-[28px]"
        views={views}
        fields={data?.fields ?? []}
        end={
          <>
            <ViewMenu views={views} canEdit={canEdit} />
            <Button asChild variant="ghost" size="icon-sm">
              <Link href={`/${org}/s/${sheetId}/settings`} aria-label="Sheet settings">
                <Settings aria-hidden />
              </Link>
            </Button>
          </>
        }
      />
      <div className="mt-[16px] mb-[14px] flex flex-wrap items-center gap-2">
        {filterable ? (
          <div className="flex min-w-0 flex-[1_1_240px] [&>*]:w-full">
            <SheetSearch value={q} onChange={setQ} />
          </div>
        ) : null}
        {data && env && tabular ? (
          <TableActions
            actions={actions}
            fields={data.fields}
            env={env}
            allItems={data.items}
            canEdit={canEdit}
            isAdmin={isAdmin}
          />
        ) : null}
        {data ? (
          <GroupSelect
            org={org}
            data={data}
            onlyGroup={props.onlyGroup}
            canEdit={canEdit}
            archived={props.archived}
          />
        ) : null}
        {data && ctx && tabular ? (
          <>
            <StatusFilter items={inScope} ctx={ctx} />
            <OwnerFilter items={inScope} ctx={ctx} />
            <ValueFilterChip />
          </>
        ) : null}
        {data && ctx && filterable ? (
          <>
            {active.type !== 'insights' ? (
              <SortButton config={config} setConfig={setConfig} fields={data.fields} ctx={ctx} />
            ) : null}
            <FilterButton
              config={config}
              setConfig={setConfig}
              fields={data.fields}
              ctx={ctx}
              computedNotice={data.items.length > CLIENT_FILTER_LIMIT}
            />
          </>
        ) : null}
        {data && tabular ? (
          <>
            <ColumnsMenu fields={data.fields} hiddenCount={hiddenCount} />
            <DensityToggle />
          </>
        ) : null}
        <SheetAutomations
          org={org}
          sheetId={sheetId}
          sheetName={sheetName}
          ctx={ctx}
          role={role}
          timeZone={timeZone}
        />
      </div>
      {!canEdit ? (
        <p className="text-muted-foreground text-copy-13 -mt-1 mb-3">
          You can view this sheet. Ask an editor or admin to change it.
        </p>
      ) : null}
      {query.isError ? (
        <div
          role="alert"
          className="border-line flex flex-col items-start gap-2 rounded-lg border p-4"
        >
          <p className="font-semibold">The sheet could not be loaded.</p>
          <p className="text-muted-foreground text-copy-13">{query.error.message}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : views.query.isError ? (
        <div
          role="alert"
          className="border-line flex flex-col items-start gap-2 rounded-lg border p-4"
        >
          <p className="font-semibold">The views of this sheet could not be loaded.</p>
          <Button type="button" variant="outline" onClick={() => void views.query.refetch()}>
            Retry
          </Button>
        </div>
      ) : !data || !ctx || !env || !views.ready ? (
        <GridSkeleton />
      ) : (
        <ViewBody
          {...props}
          data={data}
          ctx={ctx}
          env={env}
          actions={actions}
          views={views}
          search={q}
          narrow={narrow}
          canEdit={canEdit}
          isAdmin={isAdmin}
          addTick={addTick}
          newItem={newItem}
          setNewItem={setNewItem}
          sub={sub}
        />
      )}
    </main>
  );
}

function ViewBody({
  org,
  onlyGroup: groupParam,
  data,
  ctx,
  env,
  actions,
  views,
  search,
  narrow,
  canEdit,
  isAdmin,
  addTick,
  newItem,
  setNewItem,
  sub,
}: SheetViewProps & {
  data: SheetData;
  ctx: Ctx;
  env: ConfigEnv;
  actions: SheetActions;
  views: ViewsState;
  search: string;
  narrow: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  addTick: number;
  newItem: NewItemRequest | null;
  setNewItem(r: NewItemRequest | null): void;
  sub: SubitemsHandle;
}) {
  const store = useGridStore();
  const settingsFor = useGrid((s) => s.settingsFor);
  const addFieldAt = useGrid((s) => s.addFieldAt);
  const selected = useGrid((s) => s.selected);
  const { active, config, setConfig } = views;
  const onlyGroup = groupParam && data.groups.some((g) => g.id === groupParam) ? groupParam : null;
  const view = useViewItems({ org, data, ctx, config, search, onlyGroup });

  // drop selections of items that left the sheet
  useEffect(() => {
    if (selected.size === 0) return;
    const ids = new Set(data.items.map((i) => i.id));
    const kept = [...selected].filter((id) => ids.has(id));
    if (kept.length !== selected.size) store.getState().setSelected(kept);
  }, [data, selected, store]);

  // ───────────── item panel: ?item=<display id> (FR-27) ─────────────
  const params = useSearchParams();
  const itemParam = params.get('item');
  const setItemParam = useCallback((displayId: string | null, mode: 'push' | 'replace') => {
    const url = new URL(window.location.href);
    if (displayId) url.searchParams.set('item', displayId);
    else url.searchParams.delete('item');
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url.toString());
  }, []);
  const panelItem = itemParam ? data.items.find((i) => i.displayId === itemParam) : undefined;
  // a sub-item opens in the same panel, with its parent in the breadcrumb (docs/05 §3.4)
  const subState = sub.state;
  const panelSub =
    itemParam && !panelItem && subState
      ? subState.data.items.find((i) => i.displayId === itemParam)
      : undefined;
  const panelParent = panelSub ? data.items.find((i) => i.id === panelSub.parentId) : undefined;
  const [panelTab, setPanelTab] = useState<string | undefined>(undefined);
  const panelSubId = panelSub?.id;
  const finishSubRef = useRef(subState?.actions.finishItem);
  finishSubRef.current = subState?.actions.finishItem;
  useEffect(() => {
    if (!panelSubId) return;
    return () => {
      if (store.getState().active?.itemId !== panelSubId) void finishSubRef.current?.(panelSubId);
    };
  }, [panelSubId, store]);
  // a search that matches a sub-item opens its parent and keeps the parent in the Table
  const subMatches = useMemo(
    () =>
      subState
        ? searchSubitems(subState.data.items, subState.data.fields, search, subState.ctx)
        : undefined,
    [subState, search],
  );
  // closing the panel or moving to another item finishes the row it showed (its held automations run)
  const panelItemId = panelItem?.id;
  const finishItemRef = useRef(actions.finishItem);
  finishItemRef.current = actions.finishItem;
  useEffect(() => {
    if (!panelItemId) return;
    return () => {
      if (store.getState().active?.itemId !== panelItemId) void finishItemRef.current(panelItemId);
    };
  }, [panelItemId, store]);
  useEffect(() => {
    if (!itemParam || panelItem || panelSub || sub.loading) return;
    toast.error(`${itemParam} no longer exists in this sheet or was archived.`);
    setItemParam(null, 'replace');
  }, [itemParam, panelItem, panelSub, sub.loading, setItemParam]);
  const tableItems = useMemo(() => {
    if (!subMatches || subMatches.size === 0) return view.items;
    const shown = new Set(view.items.map((i) => i.id));
    const extra = data.items.filter(
      (i) => subMatches.has(i.id) && !shown.has(i.id) && (!onlyGroup || i.groupId === onlyGroup),
    );
    return extra.length ? [...view.items, ...extra] : view.items;
  }, [subMatches, view.items, data.items, onlyGroup]);
  const openSubitem = useCallback(
    (item: Item) => {
      setPanelTab(undefined);
      setItemParam(item.displayId, 'push');
    },
    [setItemParam],
  );
  const order = useMemo(() => {
    const groups = [...data.groups].sort((a, b) => (a.position < b.position ? -1 : 1));
    return groupRows(groups, view.items).flatMap((r) => r.items);
  }, [data.groups, view.items]);
  const openItem = useCallback(
    (item: Item) => setItemParam(item.displayId, 'push'),
    [setItemParam],
  );
  const clearFilters = () => setConfig((c) => ({ ...c, filters: [] }));
  const insightsEnv = useMemo(
    () => ({ now: ctx.now, timeZone: ctx.timeZone, userId: ctx.userId, isAdmin }),
    [ctx.now, ctx.timeZone, ctx.userId, isAdmin],
  );
  // a bar in the Insights view: the Table, filtered to that value (the status and owner filters where they apply)
  const openView = views.open;
  const tableId = views.tabs.table.id;
  const filterTable = useCallback(
    (fieldKey: string, key: string, label: string) => {
      const field = data.fields.find((f) => f.key === fieldKey);
      if (!field) return;
      const s = store.getState();
      s.clearPeople();
      s.clearStatuses();
      s.setValueFilter(null);
      if (field.id === statusFilterField(ctx)?.id) s.toggleStatus(key);
      else if (field.id === ownerField(ctx)?.id) s.togglePerson(key);
      else s.setValueFilter({ fieldId: field.id, key, label: `${field.name}: ${label}` });
      openView(tableId);
    },
    [ctx, data.fields, openView, store, tableId],
  );
  const [localAddTick, setLocalAddTick] = useState(0);

  return (
    <>
      {view.filtered && active.type !== 'form' && active.type !== 'table' ? (
        <p className="text-muted-foreground text-label-12 -mt-1" aria-live="polite">
          Showing {view.items.length.toLocaleString('en-GB')} of{' '}
          {(onlyGroup
            ? data.items.filter((i) => i.groupId === onlyGroup).length
            : data.items.length
          ).toLocaleString('en-GB')}{' '}
          items.
        </p>
      ) : null}
      {active.type === 'table' ? (
        <TableView
          data={data}
          ctx={ctx}
          actions={actions}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onlyGroup={onlyGroup}
          narrow={narrow}
          addFocusTick={addTick + localAddTick}
          onOpenItem={openItem}
          items={tableItems}
          compare={view.compare}
          filtered={view.filtered}
          sub={subState}
          subMatches={subMatches}
          onOpenSubitem={openSubitem}
          onClearFilters={clearFilters}
          onNew={() => setLocalAddTick((t) => t + 1)}
          config={config}
          setConfig={setConfig}
        />
      ) : active.type === 'insights' ? (
        <InsightsView
          org={org}
          data={data}
          ctx={ctx}
          items={view.items}
          views={views}
          env={insightsEnv}
          onOpenItem={openItem}
          onSlice={filterTable}
        />
      ) : active.type === 'kanban' ? (
        <KanbanView
          data={data}
          ctx={ctx}
          actions={actions}
          items={view.items}
          config={config}
          setConfig={setConfig}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onOpenItem={openItem}
          onNew={(r) => setNewItem({ ...r, groupId: onlyGroup })}
        />
      ) : active.type === 'calendar' ? (
        <CalendarView
          data={data}
          ctx={ctx}
          items={view.items}
          config={config}
          setConfig={setConfig}
          canEdit={canEdit}
          onOpenItem={openItem}
          onNew={(r) => setNewItem({ ...r, groupId: onlyGroup })}
        />
      ) : (
        <FormView
          org={org}
          data={data}
          ctx={ctx}
          actions={actions}
          view={active}
          config={config}
          setConfig={setConfig}
          views={views}
          canEdit={canEdit}
        />
      )}
      <NewItemDialog
        request={newItem}
        onClose={() => setNewItem(null)}
        sheet={data.sheet}
        groups={data.groups}
        items={data.items}
        actions={actions}
      />
      {panelItem ? (
        <ItemPanel
          key={`item-${panelItem.id}`}
          org={org}
          data={data}
          ctx={ctx}
          actions={actions}
          item={panelItem}
          order={order.some((i) => i.id === panelItem.id) ? order : [panelItem]}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onClose={() => setItemParam(null, 'push')}
          onNavigate={(it) => setItemParam(it.displayId, 'replace')}
          subitems={data.sheet.childSheetId ? { handle: sub, onOpen: openSubitem } : null}
          initialTab={panelTab}
        />
      ) : panelSub && subState ? (
        <ItemPanel
          key={`sub-${panelSub.id}`}
          org={org}
          data={subState.data}
          ctx={subState.ctx}
          actions={subState.actions}
          item={panelSub}
          order={subState.data.items
            .filter((i) => i.parentId === panelSub.parentId)
            .sort((a, b) => (a.position < b.position ? -1 : 1))}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onClose={() => setItemParam(null, 'push')}
          onNavigate={(it) => setItemParam(it.displayId, 'replace')}
          parent={panelParent ?? null}
          onBack={() => {
            if (!panelParent) return setItemParam(null, 'push');
            setPanelTab('subitems');
            setItemParam(panelParent.displayId, 'push');
          }}
        />
      ) : null}
      <FieldSettings
        field={data.fields.find((f) => f.id === settingsFor) ?? null}
        ctx={ctx}
        env={env}
        canEdit={canEdit}
        isAdmin={isAdmin}
        actions={actions}
        onClose={() => store.getState().openSettings(null)}
      />
      <Dialog open={!!addFieldAt} onOpenChange={(o) => !o && store.getState().openAddField(null)}>
        <DialogContent className="w-[min(380px,calc(100vw-32px))]">
          <DialogTitle className="text-heading-16">Add a field</DialogTitle>
          <DialogDescription className="sr-only">
            Choose the type of the new field.
          </DialogDescription>
          <FieldPicker
            onPick={(type, name) => {
              const at = store.getState().addFieldAt ?? undefined;
              store.getState().openAddField(null);
              void actions.addField(type, at, name);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function GridSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the table"
      className="border-line flex flex-1 flex-col gap-2 rounded-lg border p-3"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="bg-soft h-7 animate-pulse rounded"
          style={{ width: `${70 + ((i * 13) % 30)}%` }}
        />
      ))}
    </div>
  );
}
