'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Lock } from 'lucide-react';
import { formatDate } from '@/engine/fields/helpers';
import { resolveFieldType } from '@/engine/fields/resolve';
import { itemSummary, ownerField, ownerOf } from '@/engine/item-panel';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, Group, Item } from '@/engine/types';
import { fieldUI } from '@/components/fields/registry';
import { Avatar, cellValue, colorVar } from '@/components/fields/shared';
import { useGrid, useGridStore } from '@/components/grid/grid-store';
import type { SheetActions } from '@/components/grid/use-sheet';
import { cn } from '@/lib/utils';
import { GroupTitle } from './group-title';
import { useDocumentTop } from './use-document-top';
import { useTableGroups } from './use-table-groups';
import { donePercent } from '@/engine/views/group-by';
import { buildLayout, byPosition, cardFields, positionsAtEnd, type TableRow } from './table-model';

// The Table view on phones (< 640 px, docs/05 §5): the same groups with the same collapsible titles, one card per
// item (name, display id, owner and a few key values as blocks), tap opens the item panel, "+ Add" per group.
// Cards differ in height, so the virtualiser measures them.

const ESTIMATE: Record<TableRow['kind'], number> = {
  group: 44,
  header: 0,
  item: 120,
  add: 48,
  summary: 0,
  gap: 12,
};

export function TableCards({
  data,
  ctx,
  actions,
  canEdit,
  onlyGroup,
  addFocusTick,
  onOpenItem,
  visibleItems,
  viewCompare,
}: {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  canEdit: boolean;
  onlyGroup: string | null;
  addFocusTick: number;
  onOpenItem(item: Item): void;
  visibleItems: Item[];
  viewCompare: ((a: Item, b: Item) => number) | null;
}) {
  const store = useGridStore();
  const collapsed = useGrid((s) => s.collapsed);
  const hidden = useGrid((s) => s.hidden);
  const tg = useTableGroups({
    groups: data.groups,
    sheetId: data.sheet.id,
    ctx,
    items: visibleItems,
    onlyGroup,
  });
  const layout = useMemo(
    () =>
      buildLayout({
        groups: tg.groups,
        items: visibleItems,
        collapsed,
        compare: viewCompare,
        canAdd: canEdit && !tg.virtual,
        headers: false,
        onlyGroup: tg.onlyGroup,
        groupOf: tg.groupOf,
      }),
    [tg, visibleItems, collapsed, viewCompare, canEdit],
  );
  const owner = useMemo(() => ownerField(ctx), [ctx]);
  const shown = useMemo(
    () => cardFields(data.fields, hidden, owner?.id ?? null),
    [data.fields, hidden, owner],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // the cards scroll with the page, like the Table
  const docTop = useDocumentTop(scrollRef);
  const v = useWindowVirtualizer({
    count: layout.rows.length,
    scrollMargin: docTop,
    estimateSize: (i) => ESTIMATE[layout.rows[i]!.kind],
    getItemKey: useCallback((i: number) => layout.rows[i]!.key, [layout.rows]),
    overscan: 6,
  });

  const addItem = async (group: Group, name: string) => {
    const list = data.items.filter((i) => i.groupId === group.id).sort(byPosition);
    const [position] = positionsAtEnd(list, 1);
    await actions.createItem(group.id, name, position!);
  };

  const firstAddRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (addFocusTick === 0) return;
    const first = layout.rows.findIndex((r) => r.kind === 'add');
    if (first >= 0) v.scrollToIndex(first, { align: 'auto' });
    requestAnimationFrame(() => firstAddRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFocusTick]);
  const firstAdd = layout.rows.find((r) => r.kind === 'add')?.key;

  return (
    <div
      ref={scrollRef}
      data-testid="item-cards"
      className="relative"
      aria-label={`${ctx.sheet.name} items`}
      role="region"
    >
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vr) => {
          const row = layout.rows[vr.index]!;
          return (
            <div
              key={row.key}
              ref={v.measureElement}
              data-index={vr.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${vr.start - v.options.scrollMargin}px)` }}
            >
              {row.kind === 'group' ? (
                <div className="border-line bg-subtle flex items-center rounded-[var(--radius-card)] border py-0.5">
                  <GroupTitle
                    group={row.group}
                    count={row.count}
                    donePct={donePercent(layout.byGroup.get(row.group.id) ?? [], ctx)}
                    collapsed={row.collapsed}
                    onToggle={() => store.getState().toggleCollapsed(row.group.id)}
                  />
                </div>
              ) : row.kind === 'item' ? (
                <div className="pt-2">
                  <ItemCard
                    item={row.item}
                    group={row.group}
                    ctx={ctx}
                    owner={owner}
                    fields={shown}
                    onOpen={() => onOpenItem(row.item)}
                  />
                </div>
              ) : row.kind === 'add' ? (
                <div className="pt-2">
                  <AddCard
                    group={row.group}
                    label={ctx.sheet.itemLabel.toLowerCase()}
                    inputRef={row.key === firstAdd ? firstAddRef : undefined}
                    onAdd={(name) => void addItem(row.group, name)}
                  />
                </div>
              ) : (
                <div style={{ height: ESTIMATE.gap }} aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One item as a card. The whole card opens the item; the name is the button. */
function ItemCard({
  item,
  group,
  ctx,
  owner,
  fields,
  onOpen,
}: {
  item: Item;
  group: Group;
  ctx: Ctx;
  owner: Field | null;
  fields: Field[];
  onOpen(): void;
}) {
  const ownerId = owner ? ownerOf(item, owner, ctx) : null;
  const summary = itemSummary(item, ctx).due;
  // the first date shows on its own only when it is not one of the card's values
  const due = summary && !fields.some((f) => f.id === summary.field.id) ? summary : null;
  // empty values take no room on a phone
  const filled = fields.filter(
    (f) => !resolveFieldType(f.type)!.isEmpty(cellValue(item, f, ctx) as never),
  );
  return (
    <article
      data-testid="item-card"
      className="border-line hover:border-ink focus-within:border-ink relative flex w-full flex-col gap-1.5 rounded-[var(--radius-card)] border bg-white p-3"
      style={{ borderLeft: `4px solid ${colorVar(group.color)}` }}
    >
      <h3 className="m-0">
        <button
          type="button"
          onClick={onOpen}
          disabled={item.id.startsWith('temp-')}
          className="text-cell focus-visible:outline-focus text-left leading-snug font-bold break-words outline-offset-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-2"
        >
          {item.name}
        </button>
      </h3>
      <span className="text-muted-foreground text-meta flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-mono">{item.displayId}</span>
        {ownerId ? (
          <>
            <span aria-hidden>·</span>
            <Avatar id={ownerId} ctx={ctx} size={20} decorative />
            <span className="truncate">{ctx.people.get(ownerId)?.name ?? 'Former member'}</span>
          </>
        ) : null}
        {item.locked ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <Lock className="size-3" aria-hidden /> Locked
          </span>
        ) : null}
      </span>
      {filled.length ? (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
          {filled.map((f) => {
            const ui = fieldUI(f.type);
            return (
              <div key={f.id} className="contents">
                <dt className="text-muted-foreground text-meta truncate">{f.name}</dt>
                <dd className="flex min-h-[34px] min-w-0 items-center">
                  <ui.Cell
                    value={cellValue(item, f, ctx) as never}
                    field={f}
                    item={item}
                    ctx={ctx}
                    density="list"
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {due ? (
        <span className={cn('text-meta self-end font-semibold', due.overdue && 'text-crit')}>
          {due.field.name}: {formatDate(due.date)}
          {due.overdue ? ' · late' : ''}
        </span>
      ) : null}
    </article>
  );
}

function AddCard({
  group,
  label,
  inputRef,
  onAdd,
}: {
  group: Group;
  label: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onAdd(name: string): void;
}) {
  const [name, setName] = useState('');
  return (
    <input
      ref={inputRef}
      className="border-line placeholder:text-muted-foreground text-cell focus-visible:outline-focus h-11 w-full rounded-[var(--radius-card)] border border-dashed bg-white px-3 focus-visible:outline-2"
      placeholder={`+ Add ${label}`}
      aria-label={`Add ${label} to ${group.name}`}
      value={name}
      maxLength={500}
      enterKeyHint="done"
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          setName('');
          onAdd(n);
        } else if (e.key === 'Escape') {
          setName('');
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
