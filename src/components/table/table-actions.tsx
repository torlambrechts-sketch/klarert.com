'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  ArrowDownUp,
  ChevronDown,
  Columns3,
  Download,
  FolderInput,
  Layers,
  Layers3,
  ListFilter,
  ListTree,
  Lock,
  LockOpen,
  MoreHorizontal,
  PenSquare,
  Plus,
  Rows3,
  Share,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, Item } from '@/engine/types';
import { kindOf } from '@/engine/values';
import type { ViewConfig } from '@/engine/views/config';
import { csvFileName, itemsCsv } from '@/engine/views/csv-export';
import { groupableFields } from '@/engine/views/group-by';
import { missingRequired } from '@/engine/views/new-item';
import {
  columnFilterCount,
  filterChoices,
  filterFields,
  quickViewCounts,
  quickViews,
  type QuickView,
} from '@/engine/views/quick-filters';
import { keyLabel, ConditionsEditor } from '@/components/views/filter-bar';
import { fieldUI } from '@/components/fields/registry';
import { Avatar, solidVar } from '@/components/fields/shared';
import type { ConfigEnv } from '@/components/fields/types';
import { useGrid, useGridStore } from '@/components/grid/grid-store';
import type { SheetActions } from '@/components/grid/use-sheet';
import { NewGroupForm } from '@/components/sheets/new-group-form';
import type { SubitemsState } from '@/components/subitems/use-subitems';
import type { ViewsState } from '@/components/views/use-views';
import { viewBarModel } from '@/components/views/view-bar';
import { ViewDialog } from '@/components/views/view-tabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ColumnsMenu } from './columns-menu';
import { LockDialog } from './lock-dialog';
import { cycleSort, positionsAtEnd } from './table-model';
import { toolbarButton, toolbarCount, toolbarOn } from './toolbar-styles';

// The Table's toolbar (owner decision 18 Nov 2026, docs/18 C8 and §4, docs/05 §3): View ▾, the search, Filter ▾,
// Sort ▾, More ▾ and ⚡ n. More than three related buttons become one menu (docs/18 §3), so the former row of
// selects and buttons (groups, status, owner, missing required, sort, filter, Actions, Columns, density) now sits in
// these menus; nothing they did is gone. Filters and density are UI state; density is kept per browser.

// ───────────────────────── density ─────────────────────────

// v2: 40 px rows became the default (docs/18 C4); an older saved choice is not carried over
const DENSITY_KEY = 'table-density-v2';

/** Reads the browser's row density into the grid store once, then keeps it in localStorage. */
export function useDensityPreference() {
  const store = useGridStore();
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DENSITY_KEY);
      if (saved === 'compact' || saved === 'comfortable') store.getState().setDensity(saved);
    } catch {
      // blocked storage: the default for this visit
    }
    return store.subscribe((s, prev) => {
      if (s.density === prev.density) return;
      try {
        localStorage.setItem(DENSITY_KEY, s.density);
      } catch {
        // blocked storage: kept for this visit
      }
    });
  }, [store]);
}

/** A menu trigger of the toolbar: an outline button with its words and a chevron; darker while it is on. */
function Trigger({
  on,
  children,
  label,
  className,
  ...rest
}: {
  on?: boolean;
  children: React.ReactNode;
  label?: string;
  className?: string;
} & React.ComponentProps<'button'>) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="outline"
        aria-label={label}
        className={cn(toolbarButton, 'max-w-[280px]', on && toolbarOn, className)}
        {...rest}
      >
        {children}
        <ChevronDown aria-hidden className="text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
  );
}

const menuHead = 'text-muted-foreground text-12 px-2 pt-2 pb-1 font-semibold';
const countClass = 'text-muted-foreground font-mono text-12 ml-auto pl-3 tabular-nums';

// ───────────────────────── View ▾ ─────────────────────────

/** View ▾: the quick views with counts, the saved Table views, "Save current view…". */
export function TableViewMenu({
  views,
  userId,
  ctx,
  items,
}: {
  views: ViewsState;
  userId: string;
  ctx: Ctx;
  /** The items in scope (before the quick view): the counts. */
  items: Item[];
}) {
  const store = useGridStore();
  const quick = useGrid((s) => s.quick);
  const [saving, setSaving] = useState(false);
  const defs = useMemo(() => quickViews(ctx), [ctx]);
  const counts = useMemo(() => quickViewCounts(items, ctx), [items, ctx]);
  const m = viewBarModel({
    views: views.views,
    userId,
    active: views.active,
    config: views.config,
  });
  const saved = m.chips.filter((c) => c.view);
  const current = defs.find((d) => d.id === quick) ?? defs[0]!;
  const savedOn = views.active.type === 'table' && views.active.saved ? views.active.saved : null;
  const name = quick === 'all' && savedOn ? savedOn.name : current.label;
  return (
    <>
      <DropdownMenu>
        <Trigger on={quick !== 'all'} data-testid="view-menu">
          <Layers aria-hidden />
          <span className="text-muted-foreground font-normal">View</span>{' '}
          <span className="min-w-0 truncate">{name}</span>
        </Trigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className={menuHead}>Show</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={quick}
            onValueChange={(v) => store.getState().setQuick(v as QuickView)}
          >
            {defs.map((d) => (
              <DropdownMenuRadioItem key={d.id} value={d.id}>
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                <span className={countClass}>{counts.get(d.id) ?? 0}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {saved.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className={menuHead}>Saved views</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={savedOn?.id ?? ''}
                onValueChange={(id) => views.choose(id)}
              >
                {saved.map((c) => (
                  <DropdownMenuRadioItem key={c.id} value={c.id}>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)}>
            <Plus aria-hidden /> Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ViewDialog
        open={saving}
        onClose={() => setSaving(false)}
        title="Save current view"
        submit="Save view"
        initialName={m.saved ? `${m.saved.name} (copy)` : 'My table'}
        canShare={views.canShare}
        onSubmit={({ name: n, shared }) =>
          views
            .create({ name: n, type: 'table', shared, config: views.config })
            .then(() => undefined)
        }
      />
    </>
  );
}

// ───────────────────────── Filter ▾ ─────────────────────────

/**
 * Filter ▾ (docs/18 §4): one panel that stays open while toggling: "Show" (the quick views), Missing required, then a
 * column of options with counts per option and people field; "Clear all". The view's conditions ("Show items where
 * all of these match") open from its foot, so nothing the former Filter button did is lost.
 */
export function TableFilterMenu({
  ctx,
  items,
  fields,
  config,
  setConfig,
  computedNotice,
}: {
  ctx: Ctx;
  items: Item[];
  fields: Field[];
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  computedNotice: boolean;
}) {
  const store = useGridStore();
  const quick = useGrid((s) => s.quick);
  const colFilters = useGrid((s) => s.colFilters);
  const missingOnly = useGrid((s) => s.missingOnly);
  const valueFilter = useGrid((s) => s.valueFilter);
  const [conditions, setConditions] = useState(false);
  const defs = useMemo(() => quickViews(ctx), [ctx]);
  const counts = useMemo(() => quickViewCounts(items, ctx), [items, ctx]);
  const columns = useMemo(
    () =>
      filterFields(ctx)
        .map((f) => ({
          field: f,
          choices: filterChoices(items, f, ctx).filter(
            (c) => c.count > 0 || (colFilters[f.id] ?? []).includes(c.id),
          ),
        }))
        .filter((c) => c.choices.length > 0),
    [ctx, items, colFilters],
  );
  const required = fields.some((f) => f.required && !f.hidden);
  const missingCount = useMemo(
    () => (required ? items.filter((i) => missingRequired(i, fields, ctx).length > 0).length : 0),
    [required, items, fields, ctx],
  );
  const n =
    (quick !== 'all' ? 1 : 0) +
    columnFilterCount(colFilters) +
    (missingOnly ? 1 : 0) +
    (valueFilter ? 1 : 0) +
    config.filters.length;
  const keep = (e: Event) => e.preventDefault();
  const people = (f: Field) => kindOf(f, ctx) === 'people';
  return (
    <>
      <DropdownMenu>
        <Trigger on={n > 0} data-testid="filter-menu" label={n ? `Filter, ${n} on` : 'Filter'}>
          <ListFilter aria-hidden /> Filter
          {n ? <span className={toolbarCount}>{n}</span> : null}
        </Trigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[min(70vh,560px)] w-auto max-w-[min(860px,calc(100vw-24px))] p-3"
        >
          <div className="flex items-center justify-between gap-6 px-2 pb-2">
            <span className="text-16 font-semibold">Filter</span>
            <DropdownMenuItem
              className="text-13 min-h-8 w-auto px-2 font-medium"
              disabled={n === 0}
              onSelect={(e) => {
                e.preventDefault();
                store.getState().clearToolbarFilters();
                setConfig((c) => ({ ...c, filters: [] }));
              }}
            >
              Clear all
            </DropdownMenuItem>
          </div>
          <div className="flex flex-wrap gap-5">
            <DropdownMenuGroup className="flex w-[200px] flex-col">
              <DropdownMenuLabel className={menuHead}>Show</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={quick}
                onValueChange={(v) => store.getState().setQuick(v as QuickView)}
              >
                {defs.map((d) => (
                  <DropdownMenuRadioItem key={d.id} value={d.id} onSelect={keep}>
                    <span className="min-w-0 flex-1 truncate">{d.label}</span>
                    <span className={countClass}>{counts.get(d.id) ?? 0}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {required ? (
                <DropdownMenuCheckboxItem
                  checked={missingOnly}
                  onSelect={keep}
                  data-testid="missing-filter"
                  onCheckedChange={(on) => store.getState().setMissingOnly(on === true)}
                >
                  <TriangleAlert className="text-warn size-4" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">Missing required</span>
                  <span className={countClass}>{missingCount}</span>
                </DropdownMenuCheckboxItem>
              ) : null}
            </DropdownMenuGroup>
            {columns.map(({ field, choices }) => (
              <DropdownMenuGroup key={field.id} className="flex w-[200px] flex-col">
                <DropdownMenuLabel className={menuHead}>{field.name}</DropdownMenuLabel>
                <div className="flex max-h-[300px] flex-col overflow-y-auto">
                  {choices.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={(colFilters[field.id] ?? []).includes(c.id)}
                      onSelect={keep}
                      onCheckedChange={() => store.getState().toggleColFilter(field.id, c.id)}
                    >
                      {people(field) ? (
                        <Avatar id={c.id} ctx={ctx} size={22} tone="soft" decorative />
                      ) : (
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-[3px]"
                          style={{ background: solidVar(c.color) }}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <span className={countClass}>{c.count}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </div>
              </DropdownMenuGroup>
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConditions(true)}>
            <SlidersHorizontal aria-hidden /> Conditions…
            {config.filters.length ? (
              <span className={countClass}>{config.filters.length}</span>
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={conditions} onOpenChange={setConditions}>
        <DialogContent className="w-[min(600px,calc(100vw-24px))]">
          <DialogTitle className="text-card-title">Conditions</DialogTitle>
          <DialogDescription className="sr-only">
            Show only the items that match every condition.
          </DialogDescription>
          <ConditionsEditor
            config={config}
            setConfig={setConfig}
            fields={fields}
            ctx={ctx}
            computedNotice={computedNotice}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The value filter set from the Insights view ("Severity: High"), with a button that removes it. */
export function ValueFilterChip() {
  const store = useGridStore();
  const f = useGrid((s) => s.valueFilter);
  if (!f) return null;
  return (
    <span className="border-faint bg-soft text-ink text-14 flex h-[38px] max-w-[280px] items-center gap-1 rounded-md border pr-1 pl-3 font-medium">
      <span className="min-w-0 flex-1 truncate">{f.label}</span>
      <button
        type="button"
        className="text-muted-foreground hover:bg-soft hover:text-ink inline-flex size-7 shrink-0 items-center justify-center rounded-sm"
        aria-label={`Remove filter ${f.label}`}
        onClick={() => store.getState().setValueFilter(null)}
      >
        <X className="size-[15px]" aria-hidden />
      </button>
    </span>
  );
}

// ───────────────────────── Sort ▾ ─────────────────────────

/** Sort ▾: the sortable fields; a click sorts ascending, the next descending, the third takes the field out. */
export function TableSortMenu({
  config,
  setConfig,
  fields,
  ctx,
}: {
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  fields: Field[];
  ctx: Ctx;
}) {
  const rules = config.sort;
  const sortable = fields.filter((f) => resolveFieldType(f.type)?.storage !== 'none' && !f.hidden);
  const keys = ['__name', '__id', ...sortable.map((f) => f.key)];
  const first = rules[0];
  return (
    <DropdownMenu>
      <Trigger
        on={rules.length > 0}
        data-testid="sort-menu"
        label={first ? `Sorted by ${keyLabel(first.fieldKey, ctx)}` : 'Sort'}
      >
        <ArrowDownUp aria-hidden />
        <span className="min-w-0 truncate">
          {first ? `Sort · ${keyLabel(first.fieldKey, ctx)}` : 'Sort'}
        </span>
        {rules.length > 1 ? (
          <span className={toolbarCount}>
            +{rules.length - 1}
            <span className="sr-only"> more</span>
          </span>
        ) : null}
      </Trigger>
      <DropdownMenuContent align="start" className="max-h-[min(70vh,520px)] w-72">
        <DropdownMenuLabel className={menuHead}>Sort by</DropdownMenuLabel>
        {keys.map((k) => {
          const at = rules.findIndex((r) => r.fieldKey === k);
          const r = rules[at];
          return (
            <DropdownMenuCheckboxItem
              key={k}
              checked={!!r}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => setConfig((c) => ({ ...c, sort: cycleSort(c.sort, k) }))}
            >
              <span className="min-w-0 flex-1 truncate">{keyLabel(k, ctx)}</span>
              {r ? (
                <span className="text-muted-foreground text-12 ml-auto pl-2">
                  {rules.length > 1 ? `${at + 1} · ` : ''}
                  {r.dir === 'asc' ? '▲ Ascending' : '▼ Descending'}
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          );
        })}
        {rules.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setConfig((c) => ({ ...c, sort: [] }))}>
              <X aria-hidden /> Clear sort
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ───────────────────────── More ▾ ─────────────────────────

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export items to CSV: the shown columns, display values (labels, names), in the order shown. */
export function useExportCsv(data: SheetData, ctx: Ctx) {
  const store = useGridStore();
  return (items: Item[]) => {
    const hidden = store.getState().hidden;
    const fields = [...data.fields]
      .filter((f) => !hidden.has(f.id) && !f.hidden)
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
    download(
      csvFileName(data.sheet.name, ctx.today),
      itemsCsv(fields, items, ctx, data.sheet.itemLabel),
    );
    toast(`${items.length} ${items.length === 1 ? 'item' : 'items'} exported to CSV.`);
  };
}

/** The items the Table shows, in order. */
function shownItems(data: SheetData, ids: readonly string[]) {
  const byId = new Map(data.items.map((i) => [i.id, i]));
  return ids.map((id) => byId.get(id)).filter((i): i is Item => !!i);
}

export interface TableMoreMenuProps {
  org: string;
  data: SheetData;
  ctx: Ctx;
  env: ConfigEnv;
  views: ViewsState;
  userId: string;
  actions: SheetActions;
  canEdit: boolean;
  isAdmin: boolean;
  archived: boolean;
  onlyGroup: string | null;
  sub: SubitemsState | null;
}

/**
 * More ▾: Group by, Show one group, Columns, row density, Add field, sub-items, Actions on the selected rows, Export
 * to CSV and Share view.
 */
export function TableMoreMenu(p: TableMoreMenuProps) {
  const store = useGridStore();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const groupBy = useGrid((s) => s.groupBy);
  const density = useGrid((s) => s.density);
  const selected = useGrid((s) => s.selected);
  const expanded = useGrid((s) => s.expanded);
  const hidden = useGrid((s) => s.hidden);
  const [field, setField] = useState<Field | null>(null);
  const [lockFor, setLockFor] = useState<Item[] | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const exportCsv = useExportCsv(p.data, p.ctx);
  const ctx = p.ctx;
  const groups = [...p.data.groups].sort((a, b) => (a.position < b.position ? -1 : 1));
  const byField = useMemo(() => groupableFields(ctx), [ctx]);
  const n = p.canEdit ? selected.size : 0;
  const items = p.data.items.filter((i) => selected.has(i.id));
  const valueFields = p.data.fields.filter(
    (f) => resolveFieldType(f.type)?.storage === 'values' && !fieldUI(f.type).automationOnly,
  );
  const parents = (p.sub?.data.items ?? []).map((i) => i.parentId).filter(Boolean) as string[];
  const hiddenCount = hidden.size;
  const groupHref = (id: string | null) => {
    const q = new URLSearchParams(params.toString());
    q.delete('item');
    if (id) q.set('group', id);
    else q.delete('group');
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Link to this view copied.');
    } catch {
      toast.error('The link could not be copied. Copy it from the address bar.');
    }
  };

  return (
    <>
      <DropdownMenu>
        <Trigger data-testid="more-menu" on={!!groupBy || !!p.onlyGroup}>
          <MoreHorizontal aria-hidden /> More
        </Trigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Layers3 aria-hidden /> Group by
              <span className="text-muted-foreground text-12 ml-auto truncate pl-2">
                {groupBy ? byField.find((f) => f.id === groupBy)?.name : 'Groups'}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={groupBy ?? 'group'}
                onValueChange={(v) => store.getState().setGroupBy(v === 'group' ? null : v)}
              >
                <DropdownMenuRadioItem value="group">Groups</DropdownMenuRadioItem>
                {byField.map((f) => (
                  <DropdownMenuRadioItem key={f.id} value={f.id}>
                    {f.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Layers aria-hidden /> Show one group
              <span className="text-muted-foreground text-12 ml-auto truncate pl-2">
                {groups.find((g) => g.id === p.onlyGroup)?.name ?? 'All'}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-60 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={p.onlyGroup ?? ''}
                onValueChange={(id) => router.push(groupHref(id || null))}
              >
                <DropdownMenuRadioItem value="">
                  <span className="flex-1">All groups</span>
                  <span className={countClass}>{p.data.items.length}</span>
                </DropdownMenuRadioItem>
                {groups.map((g) => (
                  <DropdownMenuRadioItem key={g.id} value={g.id}>
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: solidVar(g.color) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <span className={countClass}>
                      {p.data.items.filter((i) => i.groupId === g.id).length}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {p.canEdit && !p.archived ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setNewGroup(true)}>
                    <Plus aria-hidden /> New group…
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => store.getState().openColumns('all')}>
            <Columns3 aria-hidden /> Columns…
            {hiddenCount ? <span className={countClass}>+{hiddenCount} hidden</span> : null}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Rows3 aria-hidden /> Row height
              <span className="text-muted-foreground text-12 ml-auto pl-2">
                {density === 'compact' ? '40 px' : '52 px'}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={density}
                onValueChange={(v) => store.getState().setDensity(v as 'compact' | 'comfortable')}
              >
                <DropdownMenuRadioItem value="compact">Compact rows</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="comfortable">Comfortable rows</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {p.canEdit ? (
            <DropdownMenuItem onSelect={() => store.getState().openAddField({})}>
              <Plus aria-hidden /> Add field
            </DropdownMenuItem>
          ) : null}
          {p.sub && parents.length ? (
            <DropdownMenuItem
              onSelect={() =>
                store.getState().setExpanded(expanded.size ? [] : [...new Set(parents)])
              }
            >
              <ListTree aria-hidden />
              {expanded.size ? 'Hide all sub-items' : 'Show all sub-items'}
            </DropdownMenuItem>
          ) : null}
          {p.canEdit ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PenSquare aria-hidden /> Actions
                <span className="text-muted-foreground text-12 ml-auto pl-2">
                  {n ? `${n} selected` : ''}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                {n === 0 ? (
                  <DropdownMenuItem disabled>Select rows to change them together</DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <PenSquare aria-hidden /> Set a field
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-72 overflow-auto">
                        {valueFields.length === 0 ? (
                          <DropdownMenuItem disabled>No fields to set</DropdownMenuItem>
                        ) : null}
                        {valueFields.map((f) => (
                          <DropdownMenuItem key={f.id} onSelect={() => setField(f)}>
                            {f.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <FolderInput aria-hidden /> Move to group
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {groups.map((g) => (
                          <DropdownMenuItem
                            key={g.id}
                            onSelect={() => {
                              const target = items.filter((i) => i.groupId !== g.id);
                              const existing = p.data.items
                                .filter((i) => i.groupId === g.id && !selected.has(i.id))
                                .sort((a, b) =>
                                  a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
                                );
                              const keys = positionsAtEnd(existing, target.length);
                              void p.actions.moveItems(
                                target.map((it, i) => ({
                                  itemId: it.id,
                                  groupId: g.id,
                                  position: keys[i]!,
                                })),
                                `${target.length} ${target.length === 1 ? 'item' : 'items'} moved to ${g.name}.`,
                              );
                            }}
                          >
                            {g.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem
                      onSelect={() => {
                        store.getState().setSelected([]);
                        void p.actions.setArchived([...selected], true);
                      }}
                    >
                      <Archive aria-hidden /> Archive
                    </DropdownMenuItem>
                    {p.isAdmin ? (
                      items.every((i) => i.locked) ? (
                        <DropdownMenuItem
                          onSelect={() => items.forEach((it) => void p.actions.lockItem(it, false))}
                        >
                          <LockOpen aria-hidden /> Unlock
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setLockFor(items)}>
                          <Lock aria-hidden /> Lock
                        </DropdownMenuItem>
                      )
                    ) : null}
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => exportCsv(shownItems(p.data, store.getState().shownIds))}
          >
            <Download aria-hidden /> Export to CSV
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void share()}>
            <Share aria-hidden /> Share view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* the Columns menu opens from More (and from the view bar's "Hidden · N"), anchored here */}
      <ColumnsMenu
        org={p.org}
        data={p.data}
        ctx={ctx}
        views={p.views}
        userId={p.userId}
        canEdit={p.canEdit}
        isAdmin={p.isAdmin}
        actions={p.actions}
        anchorOnly
      />
      <Dialog open={newGroup} onOpenChange={setNewGroup}>
        <DialogContent className="w-[min(380px,calc(100vw-32px))]">
          <DialogTitle className="text-card-title">New group</DialogTitle>
          <DialogDescription className="sr-only">Name the new group.</DialogDescription>
          <NewGroupForm org={p.org} sheetId={p.data.sheet.id} />
        </DialogContent>
      </Dialog>
      <LockDialog items={lockFor} actions={p.actions} onClose={() => setLockFor(null)} />
      <BulkEditor
        field={field}
        env={p.env}
        onClose={() => setField(null)}
        onCommit={(f, raw) => {
          setField(null);
          const def = resolveFieldType(f.type)!;
          const value =
            raw === null || raw === undefined ? null : def.normalize(raw, f.config, p.env.ctx);
          if (raw !== null && raw !== undefined && value === null)
            return toast.error(`This is not a valid ${f.name.toLowerCase()}.`);
          const ids = [...selected];
          void p.actions.bulkSet(
            ids.map((itemId) => ({ itemId, values: { [f.id]: value as never } })),
            { message: `${f.name} set on ${ids.length} ${ids.length === 1 ? 'item' : 'items'}.` },
          );
        }}
      />
    </>
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
        <DialogTitle className="text-card-title">Set {field.name}</DialogTitle>
        <DialogDescription className="text-muted-foreground text-13">
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
