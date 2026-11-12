'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/engine/fields/helpers';
import { laneInput } from '@/engine/fields/view-support';
import { itemSummary } from '@/engine/item-panel';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import type { ViewConfig } from '@/engine/views/config';
import { kanbanLanes, laneField, laneFields, type Lane } from '@/engine/views/kanban';
import { colorVar } from '@/components/fields/shared';
import { useValueCommit } from '@/components/grid/use-commit';
import type { SheetActions } from '@/components/grid/use-sheet';
import { cn } from '@/lib/utils';
import type { NewItemRequest } from './new-item-dialog';

// Kanban (docs/05 §3.3, FR-23): lanes per option of the lane field (first status field by default; the choice is
// saved in the view), cards with name, id · first person, group and first date. Dragging a card to another lane
// saves the lane's value through setValues, so status rules and comment-on-value apply; a refused change snaps the
// card back and says why.

export function KanbanView({
  data,
  ctx,
  actions,
  items,
  config,
  setConfig,
  canEdit,
  isAdmin,
  onOpenItem,
  onNew,
}: {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  items: Item[];
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  canEdit: boolean;
  isAdmin: boolean;
  onOpenItem(item: Item): void;
  onNew(req: NewItemRequest): void;
}) {
  const choices = laneFields(data.fields, ctx);
  const field = laneField(data.fields, config.labelFieldKey, ctx);
  const lanes = useMemo(() => (field ? kanbanLanes(field, items, ctx) : []), [field, items, ctx]);
  const { commit, dialog } = useValueCommit(data, ctx, actions);
  const [over, setOver] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const canMove = (item: Item) =>
    canEdit && !item.id.startsWith('temp-') && (!item.locked || isAdmin);

  if (!field)
    return (
      <div className="border-line rounded-[var(--radius-card)] border border-dashed p-6 text-sm">
        Kanban needs a status, dropdown or another label field for its lanes. Add one to this sheet
        first.
      </div>
    );

  const laneId = (l: Lane) => `lane:${l.key ?? ''}`;
  const onDragEnd = (e: DragEndEvent) => {
    setOver(null);
    const itemId = String(e.active.id).replace(/^card:/, '');
    const target = e.over?.data.current as { key: string | null } | undefined;
    const item = items.find((i) => i.id === itemId);
    if (!item || !target) return;
    const from = lanes.find((l) => l.items.some((i) => i.id === itemId));
    if (from && from.key === target.key) return;
    if (!canMove(item))
      return void toast.error('This item is locked. Only owners and admins can change it.');
    void commit(item, field.id, laneInput(field, ctx, target.key));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Lanes by</span>
          <select
            className="border-input h-8 rounded-md border bg-white px-2"
            value={field.key}
            onChange={(e) => setConfig((c) => ({ ...c, labelFieldKey: e.target.value }))}
          >
            {choices.map((f) => (
              <option key={f.id} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {canEdit ? (
          <span className="text-muted-foreground text-xs">
            Drag a card to another lane to change it. Status rules still apply.
          </span>
        ) : null}
      </div>
      <DndContext
        sensors={sensors}
        onDragOver={(e) => setOver(e.over ? String(e.over.id) : null)}
        onDragCancel={() => setOver(null)}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${cardName(items, active.id)}.`,
            onDragOver: ({ active, over: o }) =>
              o ? `${cardName(items, active.id)} is over ${laneName(lanes, o.id)}.` : '',
            onDragEnd: ({ active, over: o }) =>
              o ? `${cardName(items, active.id)} dropped in ${laneName(lanes, o.id)}.` : 'Dropped.',
            onDragCancel: ({ active }) => `Moving ${cardName(items, active.id)} was cancelled.`,
          },
        }}
      >
        <div
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2"
          role="list"
          aria-label="Lanes"
        >
          {lanes.map((lane) => (
            <LaneColumn
              key={laneId(lane)}
              id={laneId(lane)}
              lane={lane}
              highlighted={over === laneId(lane)}
              ctx={ctx}
              canEdit={canEdit}
              canMove={canMove}
              onOpenItem={onOpenItem}
              onAdd={() =>
                onNew({
                  note: `${field.name}: ${lane.option?.label ?? 'no value'}`,
                  values:
                    lane.key === null ? undefined : { [field.id]: laneInput(field, ctx, lane.key) },
                })
              }
            />
          ))}
        </div>
      </DndContext>
      {dialog}
    </div>
  );
}

const cardName = (items: Item[], id: string | number) =>
  items.find((i) => `card:${i.id}` === String(id))?.name ?? 'the card';
const laneName = (lanes: Lane[], id: string | number) =>
  lanes.find((l) => `lane:${l.key ?? ''}` === String(id))?.option?.label ?? 'No value';

function LaneColumn({
  id,
  lane,
  highlighted,
  ctx,
  canEdit,
  canMove,
  onOpenItem,
  onAdd,
}: {
  id: string;
  lane: Lane;
  highlighted: boolean;
  ctx: Ctx;
  canEdit: boolean;
  canMove(item: Item): boolean;
  onOpenItem(item: Item): void;
  onAdd(): void;
}) {
  const drop = useDroppable({ id, data: { key: lane.key } });
  const name = lane.option?.label ?? 'No value';
  const color = colorVar(lane.option?.color ?? 'grey');
  return (
    <section
      ref={drop.setNodeRef}
      role="listitem"
      aria-label={`${name}, ${lane.items.length} ${lane.items.length === 1 ? 'item' : 'items'}`}
      data-lane={name}
      className={cn(
        'border-line flex w-[272px] shrink-0 flex-col rounded-[var(--radius-card)] border bg-[#FBFAF6]',
        highlighted && 'outline-ink bg-sel outline-2 -outline-offset-2 outline-dashed',
      )}
    >
      <h3
        className="border-line bg-soft flex items-center justify-between gap-2 border-b px-3 py-2.5 text-[13px] font-extrabold"
        style={{ borderLeft: `4px solid ${color}` }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-sm"
            style={{ background: color }}
          />
          <span className="truncate">{name}</span>
        </span>
        <span className="border-line rounded-sm border bg-white px-2 text-xs tabular-nums">
          {lane.items.length}
        </span>
      </h3>
      <ul className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {lane.items.map((item) => (
          <li key={item.id}>
            <Card item={item} ctx={ctx} draggable={canMove(item)} onOpen={() => onOpenItem(item)} />
          </li>
        ))}
      </ul>
      {canEdit ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add an item to ${name}`}
          className="text-muted-foreground hover:text-ink m-2 mt-0 flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold"
        >
          <Plus className="size-4" aria-hidden /> Add
        </button>
      ) : null}
    </section>
  );
}

function Card({
  item,
  ctx,
  draggable,
  onOpen,
}: {
  item: Item;
  ctx: Ctx;
  draggable: boolean;
  onOpen(): void;
}) {
  const drag = useDraggable({ id: `card:${item.id}`, disabled: !draggable });
  const summary = itemSummary(item, ctx);
  const person = summary.person?.userId ? ctx.people.get(summary.person.userId)?.name : null;
  const group = ctx.groups.get(item.groupId);
  return (
    <div
      ref={drag.setNodeRef}
      data-testid="kanban-card"
      style={{
        transform: CSS.Translate.toString(drag.transform),
        zIndex: drag.isDragging ? 10 : undefined,
      }}
      className={cn(
        'border-line flex flex-col gap-1 rounded-[var(--radius-card)] border bg-white p-2.5 text-[13px] shadow-sm',
        drag.isDragging && 'shadow-lg',
        draggable && 'cursor-grab touch-none',
      )}
      {...drag.attributes}
      {...drag.listeners}
      aria-roledescription={draggable ? 'Draggable card' : undefined}
      aria-label={draggable ? `${item.name}. Press space to move it to another lane.` : undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="text-left leading-snug font-semibold break-words hover:underline"
      >
        {item.name}
      </button>
      <span className="text-muted-foreground text-xs">
        <span className="font-mono">{item.displayId}</span>
        {person ? ` · ${person}` : ''}
      </span>
      <span className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: colorVar(group?.color ?? 'grey') }}
          />
          <span className="truncate">{group?.name ?? ''}</span>
        </span>
        {summary.due ? (
          <span className={cn('shrink-0', summary.due.overdue && 'text-crit font-semibold')}>
            {formatDate(summary.due.date)}
            {summary.due.overdue ? ' · overdue' : ''}
          </span>
        ) : null}
      </span>
    </div>
  );
}
