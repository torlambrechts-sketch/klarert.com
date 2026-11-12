'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Archive,
  Columns3,
  FolderInput,
  Lock,
  LockOpen,
  PenSquare,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { resolveFieldType } from '@/engine/fields/resolve';
import { sheetCtx } from '@/engine/sheet-data';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, Item } from '@/engine/types';
import { CLIENT_FILTER_LIMIT, groupRows } from '@/engine/views/apply';
import { fieldUI } from '@/components/fields/registry';
import { inputClass } from '@/components/fields/shared';
import type { ConfigEnv } from '@/components/fields/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SheetAutomations } from '@/components/automations/sheet-automations';
import { ItemPanel } from '@/components/item-panel/item-panel';
import { ListView } from '@/components/list/list-view';
import { CalendarView } from '@/components/views/calendar-view';
import { FilterButton, SheetSearch, SortButton } from '@/components/views/filter-bar';
import { FormView } from '@/components/views/form-view';
import { KanbanView } from '@/components/views/kanban-view';
import { NewItemDialog, type NewItemRequest } from '@/components/views/new-item-dialog';
import { useOnline } from '@/components/states/use-online';
import { useViewItems } from '@/components/views/use-view-items';
import { useViews, type ViewsState } from '@/components/views/use-views';
import { ViewMenu, ViewTabs } from '@/components/views/view-tabs';
import { FieldPicker } from './field-picker';
import { FieldSettings } from './field-settings';
import { Grid } from './grid';
import { positionsAtEnd } from './grid-model';
import { createGridStore, GridStoreContext, useGrid, useGridStore } from './grid-store';
import {
  useRelatedRealtime,
  useSheetActions,
  useSheetQuery,
  useSheetRealtime,
  useSheetsList,
  type SheetActions,
} from './use-sheet';

// The sheet page's client part: data (TanStack Query + realtime), the view tabs and the header actions (search,
// filters, sort, columns), the active view (List, Grid, Kanban, Calendar, Form), the bulk bar for selected rows, the
// item panel, field settings and the add-field picker.

export interface SheetViewProps {
  org: string;
  sheetId: string;
  sheetName: string;
  userId: string;
  timeZone: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  onlyGroup: string | null;
  /** sheets.settings.defaultViewId: a saved view's id or a built-in view; null = List. */
  defaultViewId: string | null;
}

export function SheetView(props: SheetViewProps) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: 1 } },
      }),
  );
  const [store] = useState(() => createGridStore(props.sheetId));
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
  const data = query.data;
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
  const total = data?.items.length ?? 0;
  const tabular = active.type === 'list' || active.type === 'grid';
  const filterable = active.type !== 'form';

  return (
    <main className="flex h-[calc(100dvh-58px)] min-w-0 flex-col gap-3 px-4 pt-5 pb-3 max-[759px]:h-[calc(100dvh-122px)] sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="break-words">{sheetName}</h1>
            <p className="text-muted-foreground text-sm">
              {active.name} ·{' '}
              {data
                ? total === 1
                  ? '1 item'
                  : `${total.toLocaleString('en-GB')} items`
                : 'loading items'}
              {realtime === 'offline' && online ? ' · live updates paused, reconnecting' : ''}
            </p>
          </div>
          <ViewTabs views={views} fields={data?.fields ?? []} />
        </div>
        <div className="flex flex-wrap items-center gap-2 max-[759px]:w-full">
          {canEdit && active.type !== 'form' ? (
            <Button
              type="button"
              onClick={() => (active.type === 'grid' ? setAddTick((t) => t + 1) : setNewItem({}))}
              disabled={!data}
            >
              <Plus aria-hidden /> New {data?.sheet.itemLabel.toLowerCase() ?? 'item'}
            </Button>
          ) : null}
          {filterable ? <SheetSearch value={q} onChange={setQ} /> : null}
          {data && ctx && filterable ? (
            <>
              <FilterButton
                config={config}
                setConfig={setConfig}
                fields={data.fields}
                ctx={ctx}
                computedNotice={data.items.length > CLIENT_FILTER_LIMIT}
              />
              <SortButton config={config} setConfig={setConfig} fields={data.fields} ctx={ctx} />
            </>
          ) : null}
          {data && tabular ? <ColumnsMenu fields={data.fields} hiddenCount={hiddenCount} /> : null}
          <SheetAutomations
            org={org}
            sheetId={sheetId}
            sheetName={sheetName}
            ctx={ctx}
            role={role}
            timeZone={timeZone}
          />
          <ViewMenu views={views} canEdit={canEdit} />
          <Button asChild variant="outline" size="icon">
            <Link href={`/${org}/s/${sheetId}/settings`} aria-label="Sheet settings">
              <Settings aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
      {!canEdit ? (
        <p className="text-muted-foreground text-sm">
          You can view this sheet. Ask an editor or admin to change it.
        </p>
      ) : null}
      {query.isError ? (
        <div
          role="alert"
          className="border-line flex flex-col items-start gap-2 rounded-[var(--radius-card)] border p-4"
        >
          <p className="font-semibold">The sheet could not be loaded.</p>
          <p className="text-muted-foreground text-sm">{query.error.message}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : views.query.isError ? (
        <div
          role="alert"
          className="border-line flex flex-col items-start gap-2 rounded-[var(--radius-card)] border p-4"
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
  useEffect(() => {
    if (!itemParam || panelItem) return;
    toast.error(`${itemParam} no longer exists in this sheet or was archived.`);
    setItemParam(null, 'replace');
  }, [itemParam, panelItem, setItemParam]);
  const order = useMemo(() => {
    const groups = [...data.groups].sort((a, b) => (a.position < b.position ? -1 : 1));
    return groupRows(groups, view.items).flatMap((r) => r.items);
  }, [data.groups, view.items]);
  const openItem = useCallback(
    (item: Item) => setItemParam(item.displayId, 'push'),
    [setItemParam],
  );
  const clearFilters = () => setConfig((c) => ({ ...c, filters: [] }));

  return (
    <>
      {view.filtered && active.type !== 'form' ? (
        <p className="text-muted-foreground -mt-1 text-xs" aria-live="polite">
          Showing {view.items.length.toLocaleString('en-GB')} of{' '}
          {(onlyGroup
            ? data.items.filter((i) => i.groupId === onlyGroup).length
            : data.items.length
          ).toLocaleString('en-GB')}{' '}
          items.
        </p>
      ) : null}
      {active.type === 'grid' ? (
        <>
          {data.items.length === 0 && canEdit ? (
            <p className="text-sm">
              No items yet. Use “+ Add item” in a group to add the first one.
            </p>
          ) : null}
          <div className="border-line flex min-h-[240px] flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border">
            <Grid
              data={data}
              ctx={ctx}
              actions={actions}
              canEdit={canEdit}
              isAdmin={isAdmin}
              onlyGroup={onlyGroup}
              nameWidth={narrow ? 150 : 300}
              addFocusTick={addTick}
              onOpenItem={openItem}
              visibleItems={view.items}
              viewCompare={view.compare}
            />
          </div>
        </>
      ) : active.type === 'list' ? (
        <ListView
          data={data}
          ctx={ctx}
          actions={actions}
          items={view.items}
          config={config}
          setConfig={setConfig}
          canEdit={canEdit}
          isAdmin={isAdmin}
          narrow={narrow}
          filtered={view.filtered}
          onClearFilters={() => {
            clearFilters();
          }}
          onOpenItem={openItem}
          onNew={() => setNewItem({ groupId: onlyGroup })}
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
      {canEdit && selected.size > 0 && (active.type === 'grid' || active.type === 'list') ? (
        <BulkBar
          actions={actions}
          fields={data.fields}
          env={env}
          allItems={data.items}
          isAdmin={isAdmin}
        />
      ) : null}
      {panelItem ? (
        <ItemPanel
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
          <DialogTitle className="text-lg font-bold">Add a field</DialogTitle>
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
      aria-label="Loading the grid"
      className="border-line flex flex-1 flex-col gap-2 rounded-[var(--radius-card)] border p-3"
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

function ColumnsMenu({ fields, hiddenCount }: { fields: Field[]; hiddenCount: number }) {
  const store = useGridStore();
  const hidden = useGrid((s) => s.hidden);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          <Columns3 aria-hidden /> Columns{hiddenCount ? ` · ${hiddenCount} hidden` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">Show columns</legend>
          {fields.length === 0 ? (
            <p className="text-muted-foreground text-sm">No fields yet.</p>
          ) : null}
          <div className="flex max-h-72 flex-col gap-0.5 overflow-auto">
            {fields.map((f) => {
              const Icon = fieldUI(f.type).icon;
              return (
                <label
                  key={f.id}
                  className="hover:bg-soft flex items-center gap-2 rounded px-1 py-0.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(f.id)}
                    onChange={(e) => store.getState().setHidden(f.id, !e.target.checked)}
                  />
                  <Icon className="text-muted-foreground size-3.5" aria-hidden />
                  {f.name}
                </label>
              );
            })}
          </div>
          <p className="text-muted-foreground pt-1 text-xs">Hidden columns belong to this view.</p>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

function BulkBar({
  actions,
  fields,
  env,
  allItems,
  isAdmin,
}: {
  actions: SheetActions;
  fields: Field[];
  env: ConfigEnv;
  allItems: Item[];
  isAdmin: boolean;
}) {
  const store = useGridStore();
  const selected = useGrid((s) => s.selected);
  const [field, setField] = useState<Field | null>(null);
  const [locking, setLocking] = useState(false);
  const [reason, setReason] = useState('');
  const data = env;
  const ids = [...selected];
  const items = allItems.filter((i) => selected.has(i.id));
  const groups = [...data.ctx.groups.values()].sort((a, b) => (a.position < b.position ? -1 : 1));
  const valueFields = fields.filter(
    (f) => resolveFieldType(f.type)?.storage === 'values' && !fieldUI(f.type).automationOnly,
  );
  const n = selected.size;
  return (
    <div
      role="region"
      aria-label="Selected items"
      className="bg-ink fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-white shadow-xl max-[759px]:bottom-[76px]"
    >
      <span className="text-sm font-semibold">{n === 1 ? '1 selected' : `${n} selected`}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary">
            <PenSquare aria-hidden /> Set a field
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-72">
          {valueFields.length === 0 ? (
            <DropdownMenuItem disabled>No fields to set</DropdownMenuItem>
          ) : null}
          {valueFields.map((f) => (
            <DropdownMenuItem key={f.id} onSelect={() => setField(f)}>
              {f.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary">
            <FolderInput aria-hidden /> Move to group
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {groups.map((g) => (
            <DropdownMenuItem
              key={g.id}
              onSelect={() => {
                const target = items.filter((i) => i.groupId !== g.id);
                const existing = allItems
                  .filter((i) => i.groupId === g.id && !selected.has(i.id))
                  .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
                const keys = positionsAtEnd(existing, target.length);
                void actions.moveItems(
                  target.map((it, i) => ({ itemId: it.id, groupId: g.id, position: keys[i]! })),
                  `${target.length} ${target.length === 1 ? 'item' : 'items'} moved to ${g.name}.`,
                );
              }}
            >
              {g.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          store.getState().setSelected([]);
          void actions.setArchived(ids, true);
        }}
      >
        <Archive aria-hidden /> Archive
      </Button>
      {isAdmin ? (
        items.every((i) => i.locked) ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => items.forEach((it) => void actions.lockItem(it, false))}
          >
            <LockOpen aria-hidden /> Unlock
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setLocking(true)}>
            <Lock aria-hidden /> Lock
          </Button>
        )
      ) : null}
      <Dialog open={locking} onOpenChange={setLocking}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">
            Lock {n === 1 ? 'this item' : `${n} items`}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Only owners and admins can change a locked item. Everyone sees the lock and the reason.
          </DialogDescription>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setLocking(false);
              items
                .filter((i) => !i.locked)
                .forEach((it) => void actions.lockItem(it, true, reason.trim()));
              setReason('');
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Reason
              <input
                className={inputClass}
                maxLength={200}
                value={reason}
                placeholder="Approved by QA"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setLocking(false)}>
                Cancel
              </Button>
              <Button type="submit">Lock</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-white hover:bg-white/15 hover:text-white"
        aria-label="Clear selection"
        onClick={() => store.getState().setSelected([])}
      >
        <X aria-hidden />
      </Button>
      <BulkEditor
        field={field}
        env={env}
        onClose={() => setField(null)}
        onCommit={(f, raw) => {
          setField(null);
          const def = resolveFieldType(f.type)!;
          const value =
            raw === null || raw === undefined ? null : def.normalize(raw, f.config, env.ctx);
          if (raw !== null && raw !== undefined && value === null)
            return toast.error(`This is not a valid ${f.name.toLowerCase()}.`);
          void actions.bulkSet(
            ids.map((itemId) => ({ itemId, values: { [f.id]: value as never } })),
            { message: `${f.name} set on ${ids.length} ${ids.length === 1 ? 'item' : 'items'}.` },
          );
        }}
      />
    </div>
  );
}

function BulkEditor({
  field,
  env,
  onClose,
  onCommit,
}: {
  field: Field | null;
  env: ConfigEnv;
  onClose(): void;
  onCommit(f: Field, raw: unknown): void;
}) {
  if (!field) return null;
  const ui = fieldUI(field.type);
  const blank = {
    id: 'bulk',
    sheetId: env.sheet.id,
    groupId: '',
    seq: 0,
    displayId: '',
    name: '',
    values: {},
    position: 'a0',
    locked: false,
    createdAt: env.ctx.now.toISOString(),
    updatedAt: env.ctx.now.toISOString(),
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogTitle className="text-lg font-bold">Set {field.name}</DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          The value is set on every selected item.
        </DialogDescription>
        <ui.Editor
          value={null}
          field={field}
          item={blank}
          ctx={env.ctx}
          onCommit={(v) => onCommit(field, v)}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
