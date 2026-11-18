'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Columns3,
  GripVertical,
} from 'lucide-react';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field } from '@/engine/types';
import {
  arrangeFields,
  groupByKey,
  hiddenWithCollapsed,
  KEY_COLUMN_LABEL,
  keyColumns,
  liveCollapsed,
  OTHER_GROUP,
  parseColumnGroups,
  type KeyColumn,
} from '@/engine/views/column-groups';
import { withLayout } from '@/engine/views/config';
import { fieldUI } from '@/components/fields/registry';
import { useGrid, useGridStore } from '@/components/grid/grid-store';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ViewBarActions } from '@/components/views/view-bar';
import type { ViewsState } from '@/components/views/use-views';
import { cn } from '@/lib/utils';
import { ColumnGroupsEditor } from './column-groups-editor';
import { toolbarButton, toolbarCount } from './toolbar-styles';

// The Columns menu (docs/05 §3.1): a popover (a bottom sheet on phones) listing the columns by column group with
// a checkbox each, a drag handle and Move up / Move down (within the group), the key columns marked, the hidden
// columns ("Hidden · N") with Show, and "Show all". Owners and admins edit the groups here too. Hidden columns and
// collapsed groups belong to the view; the column order and the groups belong to the sheet.

const PHONE = '(max-width: 639px)';

function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const set = () => setPhone(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);
  return phone;
}

export interface ColumnsMenuProps {
  org: string;
  data: SheetData;
  ctx: Ctx;
  views: ViewsState;
  userId: string;
  canEdit: boolean;
  isAdmin: boolean;
  actions: SheetActions;
  /** No button of its own: it opens from More ▾ and "Hidden · N" and is anchored where it is rendered. */
  anchorOnly?: boolean;
}

export function ColumnsMenu(p: ColumnsMenuProps) {
  const store = useGridStore();
  const open = useGrid((s) => s.columnsMenu);
  const hidden = useGrid((s) => s.hidden);
  const phone = usePhone();
  const groups = useMemo(
    () =>
      parseColumnGroups(
        p.data.sheet.columnGroups ?? [],
        p.data.fields.map((f) => f.key),
      ),
    [p.data.sheet.columnGroups, p.data.fields],
  );
  const effHidden = useMemo(
    () =>
      hiddenWithCollapsed(
        p.data.fields,
        hidden,
        groups,
        liveCollapsed(groups, p.views.config.collapsedGroups),
      ),
    [p.data.fields, hidden, groups, p.views.config.collapsedGroups],
  );
  const setOpen = (o: boolean) => store.getState().openColumns(o ? 'all' : null);
  const trigger = p.anchorOnly ? (
    <span aria-hidden className="block h-[38px] w-0" />
  ) : (
    <Button
      type="button"
      variant="outline"
      className={toolbarButton}
      onClick={phone ? () => setOpen(true) : undefined}
    >
      <Columns3 aria-hidden /> Columns
      {effHidden.size ? (
        <span className={toolbarCount}>
          +{effHidden.size}
          <span className="sr-only"> hidden</span>
        </span>
      ) : null}
    </Button>
  );
  const panel = (
    <ColumnsPanel {...p} groups={groups} effHidden={effHidden} phone={phone} at={open} />
  );
  if (phone)
    return (
      <>
        {trigger}
        <Dialog open={!!open} onOpenChange={setOpen}>
          <DialogContent className="top-auto bottom-0 left-0 max-h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-t-xl rounded-b-none p-4">
            <DialogTitle className="text-heading-16">Columns</DialogTitle>
            <DialogDescription className="sr-only">
              Choose the columns this view shows and their order.
            </DialogDescription>
            {panel}
          </DialogContent>
        </Dialog>
      </>
    );
  return (
    <Popover open={!!open} onOpenChange={setOpen}>
      {p.anchorOnly ? (
        <PopoverAnchor asChild>{trigger}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        aria-label="Columns"
        // opened from "Hidden · N": focus goes to the hidden list, not the first control
        onOpenAutoFocus={(e) => {
          if (open === 'hidden') e.preventDefault();
        }}
        // "Hidden · N" moves an open menu to its hidden list instead of closing it
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest?.('[data-columns-opener]')) e.preventDefault();
        }}
        className="flex max-h-[min(640px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto p-2"
      >
        <h2 className="text-label-14 px-2 pt-1.5 pb-1 font-semibold">Columns</h2>
        {panel}
      </PopoverContent>
    </Popover>
  );
}

interface Section {
  id: string;
  name: string;
  isGroup: boolean;
  /** Every member in column order. */
  members: Field[];
}

function ColumnsPanel({
  org,
  data,
  ctx,
  views,
  userId,
  canEdit,
  isAdmin,
  actions,
  groups,
  effHidden,
  phone,
  at,
}: ColumnsMenuProps & {
  groups: ReturnType<typeof parseColumnGroups>;
  effHidden: Set<string>;
  phone: boolean;
  at: null | 'all' | 'hidden';
}) {
  const store = useGridStore();
  const { config, setConfig } = views;
  const [editing, setEditing] = useState(false);
  const hiddenRef = useRef<HTMLHeadingElement>(null);
  const fields = data.fields;
  const arranged = useMemo(() => arrangeFields(fields, groups), [fields, groups]);
  const keys = useMemo(() => keyColumns(ctx), [ctx]);
  const collapsed = new Set(liveCollapsed(groups, config.collapsedGroups));
  const sections = useMemo(() => {
    const of = groupByKey(groups);
    const out: Section[] = [];
    const byId = new Map<string, Section>();
    for (const f of arranged) {
      const g = of.get(f.key);
      const id = g?.id ?? OTHER_GROUP.id;
      let s = byId.get(id);
      if (!s) {
        s = { id, name: g?.name ?? OTHER_GROUP.name, isGroup: !!g, members: [] };
        byId.set(id, s);
        out.push(s);
      }
      s.members.push(f);
    }
    // groups with no columns yet still show (admins assign columns to them)
    for (const g of groups)
      if (!byId.has(g.id)) out.push({ id: g.id, name: g.name, isGroup: true, members: [] });
    return out;
  }, [arranged, groups]);
  const shown = fields.length - effHidden.size;
  const hiddenList = arranged.filter((f) => effHidden.has(f.id));
  const indexOf = (f: Field) => fields.findIndex((x) => x.id === f.id);
  const canMove = canEdit;

  useEffect(() => {
    if (at !== 'hidden') return;
    const t = requestAnimationFrame(() => {
      hiddenRef.current?.scrollIntoView({ block: 'nearest' });
      hiddenRef.current?.focus();
    });
    return () => cancelAnimationFrame(t);
  }, [at]);

  const toggleGroup = (id: string) =>
    setConfig((c) => {
      const next = new Set(c.collapsedGroups ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return withLayout(c, { hidden: c.hidden, collapsedGroups: [...next] });
    });
  const show = (f: Field) => {
    if (hiddenHas(f)) store.getState().setHidden(f.id, false);
    const g = groups.find((x) => x.fieldKeys.includes(f.key));
    if (g && collapsed.has(g.id)) toggleGroup(g.id);
  };
  const hiddenHas = (f: Field) => store.getState().hidden.has(f.id);

  if (editing)
    return (
      <div className="flex flex-col gap-3 px-2 pb-2">
        <div className="flex items-center justify-between">
          <h3 className="text-label-13 font-semibold">Column groups</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Done
          </Button>
        </div>
        <ColumnGroupsEditor
          org={org}
          sheetId={data.sheet.id}
          fields={arranged}
          groups={groups}
          onSaved={() => void actions.refresh()}
        />
      </div>
    );

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <span className="text-muted-foreground text-label-12">
          {shown} of {fields.length} shown
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-full"
          disabled={effHidden.size === 0}
          onClick={() => setConfig((c) => withLayout(c, { hidden: [], collapsedGroups: [] }))}
        >
          Show all
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="text-muted-foreground text-copy-13 px-2 pb-2">No fields yet.</p>
      ) : null}
      <div className="border-soft flex flex-col border-y py-1">
        {sections.map((s) => {
          const visible = s.members.filter((f) => !effHidden.has(f.id));
          const shut = collapsed.has(s.id);
          if (!s.isGroup && visible.length === 0) return null;
          return (
            <section key={s.id} aria-label={s.name} className="flex flex-col">
              {groups.length ? (
                <div className="flex items-center gap-1 px-2 pt-2 pb-1">
                  {s.isGroup && s.members.length ? (
                    <button
                      type="button"
                      aria-expanded={!shut}
                      className="text-muted-foreground hover:text-ink focus-visible:outline-focus text-label-12 flex items-center gap-1 rounded font-medium focus-visible:outline-2"
                      onClick={() => toggleGroup(s.id)}
                    >
                      {shut ? (
                        <ChevronRight className="size-3.5" aria-hidden />
                      ) : (
                        <ChevronDown className="size-3.5" aria-hidden />
                      )}
                      {s.name}
                      <span className="sr-only">{shut ? ', collapsed' : ''}</span>
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-label-12 font-medium">
                      {s.name}
                    </span>
                  )}
                  <span className="text-label-11-mono ml-auto text-[var(--muted)]">
                    {shut ? `${s.members.length} hidden` : `${visible.length}/${s.members.length}`}
                  </span>
                </div>
              ) : null}
              <SectionList
                fields={visible}
                keys={keys}
                canMove={canMove}
                onHide={(f) => store.getState().setHidden(f.id, true)}
                onMove={(f, to) => void actions.moveField(f, indexOf(to))}
              />
            </section>
          );
        })}
        {hiddenList.length ? (
          <section aria-labelledby="columns-hidden" className="flex flex-col">
            <h3
              id="columns-hidden"
              ref={hiddenRef}
              tabIndex={-1}
              className="text-muted-foreground text-label-12 px-2 pt-2 pb-1 font-medium outline-none"
            >
              Hidden · {hiddenList.length}
            </h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {hiddenList.map((f) => {
                const Icon = fieldUI(f.type).icon;
                return (
                  <li
                    key={f.id}
                    className="hover:bg-subtle flex h-[34px] items-center gap-2 rounded-md pr-1 pl-2"
                  >
                    <Icon className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden />
                    <span className="text-muted-foreground text-label-13 min-w-0 flex-1 truncate">
                      {f.name}
                    </span>
                    <KeyMark kind={keys.get(f.id)} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      aria-label={`Show ${f.name}`}
                      onClick={() => show(f)}
                    >
                      Show
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 px-2 pt-2">
        <p className="text-muted-foreground text-label-12">
          Hidden columns and collapsed groups belong to this view. Column order is the sheet’s.
        </p>
        {phone ? <ViewBarActions views={views} userId={userId} /> : null}
        {isAdmin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setEditing(true)}
          >
            Edit column groups
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function KeyMark({ kind }: { kind: KeyColumn | undefined }) {
  if (!kind) return null;
  return (
    <span
      title="Key column"
      className="border-line text-muted-foreground text-label-11 shrink-0 rounded-full border px-1.5 leading-[18px]"
    >
      {KEY_COLUMN_LABEL[kind]}
      <span className="sr-only"> (key column)</span>
    </span>
  );
}

function SectionList({
  fields,
  keys,
  canMove,
  onHide,
  onMove,
}: {
  fields: Field[];
  keys: Map<string, KeyColumn>;
  canMove: boolean;
  onHide(f: Field): void;
  /** Move `f` to where `to` is (before it going up, after it going down). */
  onMove(f: Field, to: Field): void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const f = fields.find((x) => x.id === e.active.id);
    const to = fields.find((x) => x.id === e.over!.id);
    if (f && to) onMove(f, to);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <ul className="m-0 flex list-none flex-col p-0">
          {fields.map((f, i) => (
            <ColumnRow
              key={f.id}
              field={f}
              keyKind={keys.get(f.id)}
              canMove={canMove}
              prev={fields[i - 1]}
              next={fields[i + 1]}
              onHide={() => onHide(f)}
              onMove={(to) => onMove(f, to)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function ColumnRow({
  field,
  keyKind,
  canMove,
  prev,
  next,
  onHide,
  onMove,
}: {
  field: Field;
  keyKind: KeyColumn | undefined;
  canMove: boolean;
  prev: Field | undefined;
  next: Field | undefined;
  onHide(): void;
  onMove(to: Field): void;
}) {
  const s = useSortable({ id: field.id, disabled: !canMove });
  const Icon = fieldUI(field.type).icon;
  const label = resolveFieldType(field.type)?.label ?? field.type;
  return (
    <li
      ref={s.setNodeRef}
      style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }}
      className={cn(
        'group/col hover:bg-subtle focus-within:bg-subtle relative flex h-[34px] items-center gap-0.5 rounded-md pr-1',
        s.isDragging && 'bg-background-100 z-[1] shadow-[var(--shadow-menu)]',
      )}
    >
      {canMove ? (
        <button
          type="button"
          aria-label={`Drag to reorder ${field.name}`}
          className="focus-visible:outline-focus grid h-full w-5 shrink-0 cursor-grab place-items-center rounded text-[var(--muted)] focus-visible:outline-2"
          {...s.attributes}
          {...s.listeners}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <label className="text-label-13 flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-1">
        <input type="checkbox" checked onChange={onHide} aria-label={`Show ${field.name}`} />
        <Icon className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{field.name}</span>
        <KeyMark kind={keyKind} />
        <span className="text-label-11 shrink-0 text-[var(--muted)] group-focus-within/col:hidden group-hover/col:hidden">
          {label}
        </span>
      </label>
      {canMove ? (
        <span className="hidden items-center group-focus-within/col:flex group-hover/col:flex">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-6"
            aria-label={`Move ${field.name} up`}
            disabled={!prev}
            onClick={() => prev && onMove(prev)}
          >
            <ArrowUp aria-hidden className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-6"
            aria-label={`Move ${field.name} down`}
            disabled={!next}
            onClick={() => next && onMove(next)}
          >
            <ArrowDown aria-hidden className="size-3.5" />
          </Button>
        </span>
      ) : null}
    </li>
  );
}
