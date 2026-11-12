'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Lock,
  Plus,
  Settings2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/engine/fields/helpers';
import { itemStatusField } from '@/engine/fields/item-status';
import { resolveFieldType } from '@/engine/fields/resolve';
import { itemSummary } from '@/engine/item-panel';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, Item } from '@/engine/types';
import { groupRows } from '@/engine/views/apply';
import { PAGE_SIZES, type PageSize, type ViewConfig } from '@/engine/views/config';
import { paginate } from '@/engine/views/pagination';
import { fieldUI } from '@/components/fields/registry';
import { cellValue, colorVar, displayText, editorPopoverClass } from '@/components/fields/shared';
import type { EditorProps } from '@/components/fields/types';
import { FieldPicker } from '@/components/grid/field-picker';
import { useGrid, useGridStore } from '@/components/grid/grid-store';
import { mayEditField, useValueCommit } from '@/components/grid/use-commit';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// The List view (docs/05 §3.1, FR-22): a readable register. Sticky 360 px name column with the display id and the
// first person, status first, then the visible fields; every cell opens its type's editor in a popover; "+" adds a
// field; locked fields show a lock; a fade with "More columns →" when columns overflow; 25/50/100 per page.
// Below 760 px the same rows render as cards (docs/05 §5).

export interface ListViewProps {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  /** The view's items: filtered, searched, sorted (all groups). */
  items: Item[];
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  canEdit: boolean;
  isAdmin: boolean;
  narrow: boolean;
  filtered: boolean;
  onClearFilters(): void;
  onOpenItem(item: Item): void;
  onNew(): void;
}

const HINT_KEY = 'list-hint-dismissed';
const storageOf = (f: Field) => resolveFieldType(f.type)?.storage;
const explainOnly = (f: Field) => {
  const s = storageOf(f);
  return s === 'computed' || s === 'files' || s === 'none';
};

export function ListView(p: ListViewProps) {
  const { data, ctx, items, config } = p;
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // back to the first page when the rows change shape
  const shape = `${p.items.length}|${config.pageSize}|${JSON.stringify(config.filters)}|${JSON.stringify(config.sort)}`;
  const lastShape = useRef(shape);
  useEffect(() => {
    if (lastShape.current === shape) return;
    lastShape.current = shape;
    setPage(0);
  }, [shape]);

  const groups = useMemo(
    () => [...data.groups].sort((a, b) => (a.position < b.position ? -1 : 1)),
    [data.groups],
  );
  const ordered = useMemo(() => groupRows(groups, items).flatMap((r) => r.items), [groups, items]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of ordered) m.set(it.groupId, (m.get(it.groupId) ?? 0) + 1);
    return m;
  }, [ordered]);
  const pg = paginate(ordered.length, config.pageSize, page);
  const pageRows = useMemo(
    () => groupRows(groups, ordered.slice(pg.from, pg.to)),
    [groups, ordered, pg.from, pg.to],
  );

  const status = itemStatusField(ctx);
  const hidden = useGrid((s) => s.hidden);
  const columns = useMemo(() => {
    const visible = data.fields.filter((f) => !hidden.has(f.id) && f.id !== status?.id);
    return status && !hidden.has(status.id) ? [status, ...visible] : visible;
  }, [data.fields, hidden, status]);

  const { commit, dialog, fieldProps } = useValueCommit(data, ctx, p.actions);
  const total = data.items.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Hint />
      {total === 0 ? (
        <Empty>
          No items yet.{' '}
          {p.canEdit ? (
            <button type="button" className="text-focus font-semibold underline" onClick={p.onNew}>
              Add the first one.
            </button>
          ) : null}
        </Empty>
      ) : ordered.length === 0 ? (
        <Empty>
          {p.filtered ? 'No items match these filters.' : 'No items in this group.'}{' '}
          {p.filtered ? (
            <button
              type="button"
              className="text-focus font-semibold underline"
              onClick={p.onClearFilters}
            >
              Clear filters
            </button>
          ) : null}
        </Empty>
      ) : p.narrow ? (
        <Cards
          rows={pageRows}
          counts={counts}
          ctx={ctx}
          status={status}
          onOpenItem={p.onOpenItem}
        />
      ) : (
        <Table
          {...p}
          rows={pageRows}
          counts={counts}
          columns={columns}
          collapsed={collapsed}
          toggle={(id) =>
            setCollapsed((c) => {
              const next = new Set(c);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          commit={commit}
          fieldProps={(f, close) =>
            fieldProps(f, { canEdit: p.canEdit, isAdmin: p.isAdmin }, close)
          }
        />
      )}
      {ordered.length > 0 ? (
        <footer className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Items per page</span>
            <select
              className="border-input h-8 rounded-md border bg-white px-2"
              value={config.pageSize}
              onChange={(e) =>
                p.setConfig((c) => ({ ...c, pageSize: Number(e.target.value) as PageSize }))
              }
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span aria-live="polite" className="tabular-nums">
              {pg.label}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!pg.hasPrev}
              onClick={() => setPage(pg.page - 1)}
            >
              Prev
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!pg.hasNext}
              onClick={() => setPage(pg.page + 1)}
            >
              Next
            </Button>
          </div>
        </footer>
      ) : null}
      {dialog}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line rounded-[var(--radius-card)] border border-dashed p-6 text-sm">
      {children}
    </div>
  );
}

function Hint() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try {
      setShown(localStorage.getItem(HINT_KEY) !== '1');
    } catch {
      setShown(true);
    }
  }, []);
  if (!shown) return null;
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span>
        <b className="text-ink">Click any cell to edit.</b> Click a name to open the item.{' '}
        <b className="text-ink">+</b> adds a column. <Lock className="inline size-3" aria-hidden />
        <span className="sr-only">Lock</span> kept by the app.
      </span>
      <button
        type="button"
        aria-label="Dismiss hint"
        className="hover:text-ink rounded p-0.5"
        onClick={() => {
          setShown(false);
          try {
            localStorage.setItem(HINT_KEY, '1');
          } catch {
            // blocked storage: hidden for this visit
          }
        }}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </p>
  );
}

/** The lock after a locked field's name, with its explanation on hover and focus. */
function LockedMark() {
  const text = 'Kept by the app. You can hide it, not delete it.';
  return (
    <span className="group/lock relative inline-flex">
      <span
        role="img"
        tabIndex={0}
        aria-label={text}
        className="inline-flex rounded outline-offset-2"
      >
        <Lock className="size-3 opacity-60" aria-hidden />
      </span>
      <span
        role="tooltip"
        className="bg-ink pointer-events-none absolute top-full left-1/2 z-20 mt-1 hidden w-52 -translate-x-1/2 rounded px-2 py-1 text-xs font-normal whitespace-normal text-white group-focus-within/lock:block group-hover/lock:block"
      >
        {text}
      </span>
    </span>
  );
}

/** A column header's menu (as in the Grid, docs/05 §3.2): sort, hide, and the field settings. */
function ColumnMenu({
  field,
  icon: Icon,
  editable,
  sorted,
  onSort,
  onHide,
  onSettings,
}: {
  field: Field;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  editable: boolean;
  sorted: 'asc' | 'desc' | null;
  onSort(dir: 'asc' | 'desc' | null): void;
  onHide(): void;
  onSettings(): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${field.name} column menu`}
        className="hover:bg-sel focus-visible:outline-focus -mx-1.5 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left focus-visible:outline-2"
      >
        <Icon className="text-muted-foreground size-3.5" aria-hidden />
        {field.name}
        {sorted === 'asc' ? (
          <ArrowDownAZ className="size-3.5" aria-label="sorted A to Z" />
        ) : sorted === 'desc' ? (
          <ArrowUpAZ className="size-3.5" aria-label="sorted Z to A" />
        ) : null}
        <ChevronDown className="text-muted-foreground size-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={() => onSort('asc')}>
          <ArrowDownAZ aria-hidden /> Sort A to Z
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSort('desc')}>
          <ArrowUpAZ aria-hidden /> Sort Z to A
        </DropdownMenuItem>
        {sorted ? (
          <DropdownMenuItem onSelect={() => onSort(null)}>
            <X aria-hidden /> Clear sort
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onHide}>
          <EyeOff aria-hidden /> Hide
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSettings}>
          <Settings2 aria-hidden /> {editable ? 'Settings' : 'About this field'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Rows = ReturnType<typeof groupRows<SheetData['groups'][number]>>;

function Table(
  p: ListViewProps & {
    rows: Rows;
    counts: Map<string, number>;
    columns: Field[];
    collapsed: ReadonlySet<string>;
    toggle(groupId: string): void;
    commit(item: Item, col: string, raw: unknown): Promise<void>;
    fieldProps(f: Field, close: () => void): Pick<EditorProps, 'onAddOption' | 'onEditField'>;
  },
) {
  const { ctx, columns } = p;
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<{ itemId: string; fieldId: string } | null>(null);
  const store = useGridStore();
  const selected = useGrid((s) => s.selected);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [columns.length, p.rows]);

  const canEditItem = (item: Item) =>
    p.canEdit && !item.id.startsWith('temp-') && (!item.locked || p.isAdmin);

  const open = (item: Item, field: Field) => {
    if (explainOnly(field) || canEditItem(item))
      return setEditing({ itemId: item.id, fieldId: field.id });
    if (!p.canEdit) return toast('You can view this sheet. Ask an editor or admin to change it.');
    toast.error(
      item.lockReason
        ? `This item is locked: ${item.lockReason}. Only owners and admins can change it.`
        : 'This item is locked. Only owners and admins can change it.',
    );
  };

  const toggleSelect = (item: Item, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(item.id);
    else next.delete(item.id);
    store.getState().setSelected(next, item.id);
  };

  return (
    <div className="border-line relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-card)] border">
      <div ref={scroller} className="h-full overflow-auto">
        <table className="text-cell w-max min-w-full border-separate border-spacing-0">
          <thead className="bg-soft sticky top-0 z-[2]">
            <tr>
              <th
                scope="col"
                className="bg-soft border-line text-label sticky left-0 z-[3] w-[360px] min-w-[360px] border-r border-b px-3 py-2 text-left"
              >
                {ctx.sheet.itemLabel}
              </th>
              {columns.map((f) => {
                const Icon = fieldUI(f.type).icon;
                return (
                  <th
                    key={f.id}
                    scope="col"
                    className="border-line text-label border-r border-b px-3 py-2 text-left whitespace-nowrap"
                    style={{
                      minWidth: Math.max(
                        120,
                        f.width ?? resolveFieldType(f.type)?.defaultWidth ?? 140,
                      ),
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <ColumnMenu
                        field={f}
                        icon={Icon}
                        editable={mayEditField(f, p)}
                        sorted={
                          p.config.sort.length === 1 && p.config.sort[0]!.fieldKey === f.key
                            ? p.config.sort[0]!.dir
                            : null
                        }
                        onSort={(dir) =>
                          p.setConfig((c) => ({
                            ...c,
                            sort: dir ? [{ fieldKey: f.key, dir }] : [],
                          }))
                        }
                        onHide={() => store.getState().setHidden(f.id, true)}
                        onSettings={() => store.getState().openSettings(f.id)}
                      />
                      {f.locked ? <LockedMark /> : null}
                    </span>
                  </th>
                );
              })}
              {p.canEdit ? (
                <th scope="col" className="border-line w-14 border-b px-2 py-1 text-center">
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Add a field">
                        <Plus aria-hidden />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80">
                      <FieldPicker
                        onPick={(type, name) => {
                          setPickerOpen(false);
                          void p.actions.addField(type, undefined, name);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {p.rows.map(({ group, items }) => {
              const isCollapsed = p.collapsed.has(group.id);
              return (
                <GroupBlock key={group.id}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={columns.length + 1 + (p.canEdit ? 1 : 0)}
                      className="border-line border-b bg-white px-0 py-0 text-left"
                    >
                      <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        onClick={() => p.toggle(group.id)}
                        className="text-cell sticky left-0 flex items-center gap-2 px-3 py-2 font-bold"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="size-4" aria-hidden />
                        ) : (
                          <ChevronDown className="size-4" aria-hidden />
                        )}
                        <span
                          aria-hidden
                          className="size-2.5 rounded-full"
                          style={{ background: colorVar(group.color) }}
                        />
                        {group.name}
                        <span className="text-muted-foreground text-meta font-semibold tabular-nums">
                          ({p.counts.get(group.id) ?? items.length})
                        </span>
                      </button>
                    </th>
                  </tr>
                  {isCollapsed
                    ? null
                    : items.map((item) => (
                        <Row
                          key={item.id}
                          item={item}
                          columns={columns}
                          ctx={ctx}
                          canEdit={p.canEdit}
                          selected={selected.has(item.id)}
                          onSelect={(on) => toggleSelect(item, on)}
                          editing={editing?.itemId === item.id ? editing.fieldId : null}
                          onEdit={(f) => open(item, f)}
                          onCancel={() => setEditing(null)}
                          onCommit={(fieldId, raw) => {
                            setEditing(null);
                            void p.commit(item, fieldId, raw);
                          }}
                          fieldProps={(f) => p.fieldProps(f, () => setEditing(null))}
                          onButton={(f) => {
                            setEditing(null);
                            void p.actions.clickButton(item, f);
                          }}
                          onOpenItem={() => {
                            setEditing(null);
                            p.onOpenItem(item);
                          }}
                          addCell={p.canEdit}
                        />
                      ))}
                </GroupBlock>
              );
            })}
          </tbody>
        </table>
      </div>
      {more ? (
        <div
          className="pointer-events-none absolute top-0 right-0 bottom-0 z-[4] flex w-[130px] items-center justify-end"
          style={{
            background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.96) 70%)',
          }}
        >
          <button
            type="button"
            className="border-line hover:border-ink pointer-events-auto mr-2 rounded-full border bg-white px-3 py-1 text-xs font-bold shadow-sm"
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollBy({ left: el.clientWidth * 0.6, behavior: 'smooth' });
            }}
          >
            More columns →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GroupBlock({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Row({
  item,
  columns,
  ctx,
  canEdit,
  selected,
  onSelect,
  editing,
  onEdit,
  onCancel,
  onCommit,
  onButton,
  onOpenItem,
  addCell,
  fieldProps,
}: {
  item: Item;
  columns: Field[];
  ctx: Ctx;
  canEdit: boolean;
  selected: boolean;
  onSelect(on: boolean): void;
  editing: string | null;
  onEdit(f: Field): void;
  onCancel(): void;
  onCommit(fieldId: string, raw: unknown): void;
  onButton(f: Field): void;
  onOpenItem(): void;
  addCell: boolean;
  fieldProps(f: Field): Pick<EditorProps, 'onAddOption' | 'onEditField'>;
}) {
  const summary = itemSummary(item, ctx);
  const person = summary.person?.userId ? ctx.people.get(summary.person.userId)?.name : null;
  return (
    <tr className={cn('group/row', selected && 'bg-sel')}>
      <td
        className={cn(
          'border-line sticky left-0 z-[1] w-[360px] max-w-[360px] min-w-[360px] border-r border-b px-3 py-2 align-top',
          selected ? 'bg-sel' : 'bg-white',
        )}
      >
        <div className="flex items-start gap-2">
          {canEdit ? (
            <input
              type="checkbox"
              className="mt-0.5"
              aria-label={`Select ${item.name}`}
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            <button
              type="button"
              onClick={onOpenItem}
              className="line-clamp-2 text-left leading-[1.3] font-semibold break-words hover:underline"
            >
              {item.name}
            </button>
            <span className="text-muted-foreground text-xs">
              <span className="font-mono">{item.displayId}</span>
              {person ? ` · ${person}` : ''}
              {item.locked ? (
                <span className="ml-1 inline-flex items-center gap-0.5">
                  <Lock className="size-3" aria-hidden /> Locked
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </td>
      {columns.map((f) => (
        <Cell
          key={f.id}
          item={item}
          field={f}
          ctx={ctx}
          editing={editing === f.id}
          onEdit={() => onEdit(f)}
          onCancel={onCancel}
          onCommit={(raw) => onCommit(f.id, raw)}
          onCommitField={canEdit ? onCommit : undefined}
          onButton={canEdit ? () => onButton(f) : undefined}
          onOpenItem={onOpenItem}
          editorProps={editing === f.id ? fieldProps(f) : undefined}
        />
      ))}
      {addCell ? <td className="border-line border-b" /> : null}
    </tr>
  );
}

function Cell({
  item,
  field,
  ctx,
  editing,
  onEdit,
  onCancel,
  onCommit,
  onCommitField,
  onButton,
  onOpenItem,
  editorProps,
}: {
  item: Item;
  field: Field;
  ctx: Ctx;
  editing: boolean;
  onEdit(): void;
  onCancel(): void;
  onCommit(raw: unknown): void;
  onCommitField?: (fieldId: string, raw: unknown) => void;
  onButton?: () => void;
  onOpenItem(): void;
  editorProps?: Pick<EditorProps, 'onAddOption' | 'onEditField'>;
}) {
  const ui = fieldUI(field.type);
  const value = cellValue(item, field, ctx);
  const text = displayText(field, value, ctx);
  const trigger = (
    <button
      type="button"
      // the shown value is part of the name (WCAG 2.5.3 label in name)
      aria-label={`${field.name} of ${item.name}${text ? `: ${text}` : ''}`}
      onClick={onEdit}
      className="flex min-h-9 w-full min-w-0 items-center px-2 py-1.5 text-left hover:bg-white hover:shadow-[inset_0_0_0_1.5px_#9AA3B5] focus-visible:shadow-[inset_0_0_0_2px_var(--focus)] focus-visible:outline-none"
    >
      <span className="flex min-w-0 flex-1 items-center">
        <ui.Cell value={value as never} field={field} item={item} ctx={ctx} density="list" />
      </span>
    </button>
  );
  return (
    <td className="border-line relative border-r border-b p-0 align-middle">
      {editing ? (
        <Popover open onOpenChange={(o) => !o && onCancel()}>
          <PopoverAnchor asChild>{trigger}</PopoverAnchor>
          <PopoverContent
            align="start"
            sideOffset={2}
            className={editorPopoverClass}
            style={{ width: Math.min(ui.editorWidth ?? 280, 420) }}
          >
            <ui.Editor
              value={value as never}
              field={field}
              item={item}
              ctx={ctx}
              onCommit={onCommit}
              onCancel={onCancel}
              onCommitField={onCommitField}
              onButton={onButton}
              onOpenItem={onOpenItem}
              {...editorProps}
            />
          </PopoverContent>
        </Popover>
      ) : (
        trigger
      )}
    </td>
  );
}

// ───────────────────────── phone cards (docs/05 §5) ─────────────────────────

function Cards({
  rows,
  counts,
  ctx,
  status,
  onOpenItem,
}: {
  rows: Rows;
  counts: Map<string, number>;
  ctx: Ctx;
  status: Field | null;
  onOpenItem(item: Item): void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {rows.map(({ group, items }) => (
        <section key={group.id} aria-label={group.name} className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: colorVar(group.color) }}
            />
            {group.name}
            <span className="text-muted-foreground text-xs font-semibold">
              ({counts.get(group.id) ?? items.length})
            </span>
          </h2>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <ItemCard item={item} ctx={ctx} status={status} onOpen={() => onOpenItem(item)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ItemCard({
  item,
  ctx,
  status,
  onOpen,
}: {
  item: Item;
  ctx: Ctx;
  status: Field | null;
  onOpen(): void;
}) {
  const summary = itemSummary(item, ctx);
  const person = summary.person?.userId ? ctx.people.get(summary.person.userId)?.name : null;
  const StatusCell = status ? fieldUI(status.type).Cell : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="item-card"
      className="border-line hover:border-ink flex w-full flex-col gap-1.5 rounded-[var(--radius-card)] border bg-white p-3 text-left"
    >
      <span className="text-cell leading-snug font-bold break-words">{item.name}</span>
      <span className="flex flex-wrap items-center gap-2 text-xs">
        {status && StatusCell ? (
          <StatusCell
            value={cellValue(item, status, ctx) as never}
            field={status}
            item={item}
            ctx={ctx}
            density="list"
          />
        ) : null}
        <span className="text-muted-foreground font-mono">{item.displayId}</span>
      </span>
      {person || summary.due ? (
        <span className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate">{person ?? ''}</span>
          {summary.due ? (
            <span className={cn('shrink-0 font-semibold', summary.due.overdue && 'text-crit')}>
              {formatDate(summary.due.date)}
              {summary.due.overdue ? ' · overdue' : ''}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
