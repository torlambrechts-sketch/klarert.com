'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react';
import {
  deleteGroupAction,
  moveGroupAction,
  updateGroupAction,
  updateGroupNowAction,
} from '@/app/[org]/s/actions';
import { ActionForm } from '@/components/forms/action-form';
import { SubmitButton } from '@/components/forms/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COLOR_LABELS, LABEL_COLORS } from '@/lib/schemas/sheets';
import { GroupSwatch } from './group-swatch';
import { NewGroupForm } from './new-group-form';
import { selectClass } from './wizard/fields';

export type ManagedGroup = { id: string; name: string; color: string; count: number };

/** FR-8: add, rename, recolour, reorder (drag or arrows), delete when empty or after moving the items. */
export function GroupsManager({
  org,
  sheetId,
  groups: initial,
}: {
  org: string;
  sheetId: string;
  groups: ManagedGroup[];
}) {
  const [groups, setGroups] = useState(initial);
  useEffect(() => setGroups(initial), [initial]);
  const [, start] = useTransition();
  // a stable id keeps dnd-kit's aria-describedby the same on the server and the client
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function move(id: string, toIndex: number) {
    const from = groups.findIndex((g) => g.id === id);
    if (from < 0 || toIndex < 0 || toIndex >= groups.length || from === toIndex) return;
    const before = groups;
    setGroups(arrayMove(groups, from, toIndex));
    start(async () => {
      const r = await moveGroupAction({ org, groupId: id, toIndex });
      if (r.ok) toast('Group moved.');
      else {
        setGroups(before);
        toast.error(r.error.message);
      }
    });
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    move(
      String(e.active.id),
      groups.findIndex((g) => g.id === e.over!.id),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'To pick up a group, press space or enter. Use the arrow keys to move it, space or enter to drop it, escape to cancel.',
          },
        }}
      >
        <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2" aria-label="Groups">
            {groups.map((g, i) => (
              <GroupRow
                key={g.id}
                org={org}
                group={g}
                index={i}
                total={groups.length}
                others={groups.filter((x) => x.id !== g.id)}
                onMove={move}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <NewGroupForm org={org} sheetId={sheetId} />
    </div>
  );
}

function GroupRow({
  org,
  group,
  index,
  total,
  others,
  onMove,
}: {
  org: string;
  group: ManagedGroup;
  index: number;
  total: number;
  others: ManagedGroup[];
  onMove: (id: string, toIndex: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });
  const [deleting, setDeleting] = useState(false);
  const [color, setColor] = useState(group.color);
  useEffect(() => setColor(group.color), [group.color]);
  const [, start] = useTransition();
  const colorId = useId();

  function recolour(next: string) {
    const before = color;
    setColor(next);
    start(async () => {
      const r = await updateGroupNowAction({ org, groupId: group.id, color: next });
      if (r.ok) toast('Group colour changed.');
      else {
        setColor(before);
        toast.error(r.error.message);
      }
    });
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-line bg-background-100 flex flex-col gap-2 rounded-lg border p-2 ${isDragging ? 'shadow-menu relative z-10' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${group.name}`}
          className="hover:bg-soft flex size-8 cursor-grab touch-none items-center justify-center rounded-md"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <GroupSwatch color={color} className="size-3.5" />
        <ActionForm
          action={updateGroupAction}
          hidden={{ org, groupId: group.id }}
          success="Group renamed."
          resetOnFailure
          className="flex min-w-0 flex-1 items-center gap-2"
          aria-label={`Rename ${group.name}`}
        >
          <Input
            name="name"
            defaultValue={group.name}
            key={group.name}
            maxLength={80}
            aria-label={`Name of group ${group.name}`}
            className="min-w-32 flex-1"
          />
          <SubmitButton size="sm" variant="outline">
            Rename
          </SubmitButton>
        </ActionForm>
        <label htmlFor={colorId} className="sr-only">
          Colour of {group.name}
        </label>
        <select
          id={colorId}
          className={`${selectClass} w-28`}
          value={color}
          onChange={(e) => recolour(e.target.value)}
        >
          {LABEL_COLORS.map((c) => (
            <option key={c} value={c}>
              {COLOR_LABELS[c]}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-label-13 w-16 text-right tabular-nums">
          {group.count === 1 ? '1 item' : `${group.count} items`}
        </span>
        <span className="flex gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Move ${group.name} up`}
            disabled={index === 0}
            onClick={() => onMove(group.id, index - 1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Move ${group.name} down`}
            disabled={index === total - 1}
            onClick={() => onMove(group.id, index + 1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${group.name}`}
            disabled={total <= 1}
            title={total <= 1 ? 'A sheet needs at least one group' : undefined}
            onClick={() => setDeleting(true)}
          >
            <Trash2 aria-hidden />
          </Button>
        </span>
      </div>
      {deleting ? (
        <DeleteGroup org={org} group={group} others={others} onCancel={() => setDeleting(false)} />
      ) : null}
    </li>
  );
}

function DeleteGroup({
  org,
  group,
  others,
  onCancel,
}: {
  org: string;
  group: ManagedGroup;
  others: ManagedGroup[];
  onCancel: () => void;
}) {
  const moveId = useId();
  return (
    <ActionForm
      action={deleteGroupAction}
      hidden={{ org, groupId: group.id }}
      success="Group deleted."
      className="bg-soft flex flex-wrap items-center gap-2 rounded-md p-2"
      aria-label={`Delete ${group.name}`}
    >
      {group.count > 0 ? (
        <>
          <label htmlFor={moveId} className="text-label-13">
            {group.count === 1 ? 'Move its item to' : `Move its ${group.count} items to`}
          </label>
          <select
            id={moveId}
            name="moveTo"
            className={`${selectClass} w-auto`}
            defaultValue={others[0]?.id}
          >
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <SubmitButton size="sm" variant="destructive" pendingText="Deleting…">
            Move items and delete
          </SubmitButton>
        </>
      ) : (
        <>
          <span className="text-label-13">Delete this empty group?</span>
          <SubmitButton size="sm" variant="destructive" pendingText="Deleting…">
            Delete group
          </SubmitButton>
        </>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </ActionForm>
  );
}
