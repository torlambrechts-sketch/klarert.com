'use client';

import { useId, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Calendar,
  ChartColumn,
  FileText,
  GripVertical,
  Lock,
  Pencil,
  SquareKanban,
  Star,
  Table,
} from 'lucide-react';
import type { ViewType } from '@/engine/views/config';
import { builtinTabs, MAX_TAB_LABEL, sameTabs, type SheetTab } from '@/engine/views/tabs';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { layoutEntries, type TabRow } from './tabs-model';

export type { TabRow } from './tabs-model';

// Customise tabs (docs/05 §3): one row per tab with a drag handle (Alt+↑/↓ too), show/hide, rename and "Open this tab
// first"; the Table pinned first. A live preview of the bar, Save / Cancel and "Reset to template default". The same
// component sits in the tab bar's More menu (popover, bottom sheet on a phone) and in Sheet settings.

const ICONS: Record<ViewType, typeof Table> = {
  table: Table,
  insights: ChartColumn,
  kanban: SquareKanban,
  calendar: Calendar,
  form: FileText,
};

const entriesOf = (rows: readonly TabRow[]): SheetTab[] => layoutEntries(rows);

/** The Table first, then the others in order. */
const pinTable = (rows: TabRow[]) => [
  ...rows.filter((r) => r.entryId === 'table'),
  ...rows.filter((r) => r.entryId !== 'table'),
];

/** The rows laid out as a tab set: its order, shown state and labels; rows it does not list follow, shown. */
function rowsFor(rows: readonly TabRow[], set: readonly SheetTab[]): TabRow[] {
  const out: TabRow[] = [];
  for (const t of set) {
    const r = rows.find((x) => x.entryId === t.id || x.viewId === t.id);
    if (!r || out.includes(r)) continue;
    out.push({ ...r, hidden: r.entryId !== 'table' && !!t.hidden, label: t.label ?? r.name });
  }
  for (const r of rows)
    if (!out.some((x) => x.entryId === r.entryId)) out.push({ ...r, hidden: false, label: r.name });
  return pinTable(out);
}

export function TabsEditor({
  rows: initialRows,
  defaultViewId,
  templateDefault,
  canEdit,
  onSave,
  onCancel,
  className,
}: {
  rows: TabRow[];
  /** settings.defaultViewId: a built-in id or a view's uuid. */
  defaultViewId: string;
  /** settings.tabsDefault: the template's tabs, or null (the built-in order). */
  templateDefault: SheetTab[] | null;
  canEdit: boolean;
  /** Resolves true when saved. */
  onSave(tabs: SheetTab[], defaultViewId: string): Promise<boolean>;
  onCancel?(): void;
  className?: string;
}) {
  const id = useId();
  const initial = useMemo(() => pinTable(initialRows), [initialRows]);
  const startDefault =
    initial.find((r) => r.entryId === defaultViewId || r.viewId === defaultViewId)?.entryId ??
    'table';
  const [rows, setRows] = useState(initial);
  const [first, setFirst] = useState(startDefault);
  const [notice, setNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const target = templateDefault ?? builtinTabs();
  const resetRows = useMemo(() => rowsFor(initial, target), [initial, target]);
  const customised = !sameTabs(entriesOf(rows), entriesOf(resetRows));
  const changed = !sameTabs(entriesOf(rows), entriesOf(initial)) || first !== startDefault;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const movable = rows.filter((r) => r.entryId !== 'table');
  const labelOf = (entryId: UniqueIdentifier) =>
    rows.find((r) => r.entryId === entryId)?.label ?? 'Tab';

  function move(entryId: string, to: number) {
    const from = rows.findIndex((r) => r.entryId === entryId);
    // the Table stays first
    if (from < 1 || to < 1 || to >= rows.length || from === to) return;
    const next = arrayMove(rows, from, to);
    setRows(next);
    setAnnounce(`${next[to]!.label} moved to position ${to + 1} of ${next.length}.`);
    // moving the row re-inserts it: keep the keyboard on its handle
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-tab-handle="${entryId}"]`)?.focus(),
    );
  }

  function setHidden(entryId: string, hidden: boolean) {
    setRows((rs) => rs.map((r) => (r.entryId === entryId ? { ...r, hidden } : r)));
    const row = rows.find((r) => r.entryId === entryId);
    if (hidden && first === entryId && row) {
      setFirst('table');
      setNotice(`${row.label} is hidden, so Table opens first now.`);
    } else setNotice(null);
  }

  function rename(entryId: string, label: string) {
    setRows((rs) =>
      rs.map((r) => (r.entryId === entryId ? { ...r, label: label.trim() || r.name } : r)),
    );
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    move(
      String(e.active.id),
      rows.findIndex((r) => r.entryId === e.over!.id),
    );
  }

  async function save() {
    setBusy(true);
    const ok = await onSave(entriesOf(rows), first);
    setBusy(false);
    if (ok) onCancel?.();
  }

  const shown = rows.filter((r) => !r.hidden);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <p className="text-label-12 text-muted-foreground" id={`${id}-preview`}>
          Preview
        </p>
        <ul
          aria-labelledby={`${id}-preview`}
          className="border-line m-0 flex [scrollbar-width:none] list-none gap-4 overflow-x-auto border-b p-0"
        >
          {shown.map((r) => {
            const Icon = ICONS[r.type];
            return (
              <li
                key={r.entryId}
                className={cn(
                  'text-label-13 relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap',
                  r.entryId === first
                    ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[var(--ink)]'
                    : 'text-muted-foreground',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {r.label}
                {r.entryId === first ? <span className="sr-only">(opens first)</span> : null}
              </li>
            );
          })}
        </ul>
      </div>

      {canEdit ? (
        <p className="text-copy-13 text-muted-foreground" id={`${id}-help`}>
          Drag or press Alt with the arrow keys to reorder. Hidden tabs stay in More and still open
          from links.
        </p>
      ) : (
        <p className="text-copy-13 text-muted-foreground">
          Only owners and admins can change tabs.
        </p>
      )}

      <DndContext
        id={`${id}-dnd`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'To pick up a tab, press space or enter. Use the arrow keys to move it, space or enter to drop it, escape to cancel.',
          },
          announcements: {
            onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
            onDragOver: ({ active, over }) =>
              over ? `${labelOf(active.id)} is over ${labelOf(over.id)}.` : undefined,
            onDragEnd: ({ active, over }) =>
              over ? `${labelOf(active.id)} dropped.` : `${labelOf(active.id)} put back.`,
            onDragCancel: ({ active }) => `Moving ${labelOf(active.id)} was cancelled.`,
          },
        }}
      >
        <ul
          ref={list}
          aria-label="Tabs"
          aria-describedby={`${id}-help`}
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {rows[0] ? (
            <TabEditorRow
              row={rows[0]}
              index={0}
              total={rows.length}
              pinned
              canEdit={canEdit}
              isFirst={first === rows[0].entryId}
              editing={editing === rows[0].entryId}
              onEdit={setEditing}
              onRename={rename}
              onHidden={setHidden}
              onFirst={setFirst}
              onMove={move}
            />
          ) : null}
          <SortableContext
            items={movable.map((r) => r.entryId)}
            strategy={verticalListSortingStrategy}
          >
            {movable.map((r) => (
              <TabEditorRow
                key={r.entryId}
                row={r}
                index={rows.indexOf(r)}
                total={rows.length}
                canEdit={canEdit}
                isFirst={first === r.entryId}
                editing={editing === r.entryId}
                onEdit={setEditing}
                onRename={rename}
                onHidden={setHidden}
                onFirst={(e) => {
                  setFirst(e);
                  setNotice(null);
                }}
                onMove={move}
              />
            ))}
          </SortableContext>
        </ul>
      </DndContext>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {notice ? (
        <p role="status" className="text-copy-13 text-warn">
          {notice}
        </p>
      ) : null}
      {customised ? (
        <p className="text-label-12 text-muted-foreground">
          Customised: these tabs differ from the{' '}
          {templateDefault ? 'template default' : 'built-in tabs'}.
        </p>
      ) : null}

      {canEdit ? (
        confirmReset ? (
          <div
            role="group"
            aria-label="Reset tabs"
            className="border-line bg-background-200 flex flex-col gap-2 rounded-md border p-3"
          >
            <p className="text-copy-13">
              {templateDefault
                ? 'Reset the tabs to the template default? Names and order go back too.'
                : 'Reset the tabs to the built-in order? Names and order go back too.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmReset(false)}
              >
                Keep my tabs
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setRows(resetRows);
                  const firstRow = resetRows.find((r) => r.entryId === first);
                  if (!firstRow || firstRow.hidden) setFirst('table');
                  setConfirmReset(false);
                  setNotice(null);
                  setAnnounce('Tabs reset. Save to keep them.');
                }}
              >
                Reset tabs
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!customised}
              onClick={() => setConfirmReset(true)}
            >
              {templateDefault ? 'Reset to template default' : 'Reset to built-in tabs'}
            </Button>
            <div className="flex gap-2">
              {onCancel ? (
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!changed}
                  onClick={() => {
                    setRows(initial);
                    setFirst(startDefault);
                    setNotice(null);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                disabled={busy || !changed}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : 'Save tabs'}
              </Button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function TabEditorRow({
  row,
  index,
  total,
  pinned,
  canEdit,
  isFirst,
  editing,
  onEdit,
  onRename,
  onHidden,
  onFirst,
  onMove,
}: {
  row: TabRow;
  index: number;
  total: number;
  pinned?: boolean;
  canEdit: boolean;
  isFirst: boolean;
  editing: boolean;
  onEdit(entryId: string | null): void;
  onRename(entryId: string, label: string): void;
  onHidden(entryId: string, hidden: boolean): void;
  onFirst(entryId: string): void;
  onMove(entryId: string, to: number): void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.entryId, disabled: pinned || !canEdit });
  const Icon = ICONS[row.type];
  const [draft, setDraft] = useState(row.label);
  const input = useRef<HTMLInputElement>(null);
  const checkId = useId();
  return (
    <li
      ref={pinned ? undefined : setNodeRef}
      style={pinned ? undefined : { transform: CSS.Transform.toString(transform), transition }}
      onKeyDown={(e) => {
        if (!canEdit || pinned || !e.altKey || editing) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          // handled here: not the page's own arrow-key handling
          e.stopPropagation();
          onMove(row.entryId, index + (e.key === 'ArrowUp' ? -1 : 1));
        }
      }}
      className={cn(
        'border-line bg-background-100 flex min-h-11 items-center gap-2 rounded-md border px-2 py-1',
        isDragging && 'shadow-menu relative z-10',
        row.hidden && 'bg-background-200',
      )}
    >
      {pinned ? (
        <span className="group/lock relative inline-flex size-7 shrink-0 items-center justify-center">
          <span
            role="img"
            tabIndex={0}
            aria-label="Table is always shown"
            className="focus-visible:outline-focus text-muted-foreground inline-flex rounded outline-offset-2 focus-visible:outline-2"
          >
            <Lock className="size-3.5" aria-hidden />
          </span>
          <span
            role="tooltip"
            className="bg-ink text-label-12 pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-40 rounded px-2 py-1 text-white group-focus-within/lock:block group-hover/lock:block"
          >
            Table is always shown
          </span>
        </span>
      ) : (
        <button
          type="button"
          ref={setActivatorNodeRef}
          data-tab-handle={row.entryId}
          {...attributes}
          {...listeners}
          disabled={!canEdit}
          aria-label={`Move ${row.label}, position ${index + 1} of ${total}`}
          className="focus-visible:outline-focus text-muted-foreground hover:text-ink inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded outline-offset-2 focus-visible:outline-2 disabled:cursor-default disabled:opacity-40"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      <input
        id={checkId}
        type="checkbox"
        className="size-4 shrink-0"
        checked={!row.hidden}
        disabled={pinned || !canEdit}
        aria-label={`Show ${row.label}`}
        onChange={(e) => onHidden(row.entryId, !e.target.checked)}
      />
      <Icon className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        {editing ? (
          <input
            ref={input}
            data-tab-rename
            autoFocus
            className={cn(inputClass, 'h-8 w-full')}
            value={draft}
            maxLength={MAX_TAB_LABEL}
            aria-label={`Name of the ${row.name} tab`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onRename(row.entryId, draft);
                onEdit(null);
              } else if (e.key === 'Escape') {
                // Esc cancels the rename, not the popover
                e.preventDefault();
                e.stopPropagation();
                setDraft(row.label);
                onEdit(null);
              }
            }}
            onBlur={() => {
              onRename(row.entryId, draft);
              onEdit(null);
            }}
          />
        ) : (
          <label
            htmlFor={checkId}
            className={cn('text-label-13 truncate', row.hidden && 'text-muted-foreground')}
          >
            {row.label}
            {row.hidden ? <span className="text-label-12"> · hidden</span> : null}
          </label>
        )}
        {row.label !== row.name && !editing ? (
          <span className="text-label-12 text-muted-foreground truncate">{row.name}</span>
        ) : null}
        {row.type === 'form' && row.hidden ? (
          <span className="text-label-12 text-muted-foreground">Public form link stays active</span>
        ) : null}
      </div>
      {canEdit && !editing ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Rename ${row.label}`}
          onClick={() => {
            setDraft(row.label);
            onEdit(row.entryId);
          }}
        >
          <Pencil aria-hidden />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Open ${row.label} first`}
        aria-pressed={isFirst}
        title={isFirst ? 'Opens first' : 'Open this tab first'}
        disabled={!canEdit || row.hidden}
        onClick={() => onFirst(row.entryId)}
        className={isFirst ? 'text-ink' : 'text-muted-foreground'}
      >
        <Star className={cn(isFirst && 'fill-current')} aria-hidden />
      </Button>
    </li>
  );
}
