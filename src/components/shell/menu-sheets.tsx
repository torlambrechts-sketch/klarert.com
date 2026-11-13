'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import {
  Check,
  ChevronRight,
  Folder,
  FolderInput,
  GripVertical,
  Lock,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import {
  archiveFolderAction,
  archiveSheetNowAction,
  createFolderAction,
  moveFolderAction,
  moveSheetAction,
  renameFolderAction,
  renameSheetAction,
  sortFolderAction,
} from '@/app/[org]/s/actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  levelOf,
  locateSheet,
  moveFolderInTree,
  moveSheetInTree,
  type MenuTree,
  type TreeMove,
} from '@/engine/organise';
import { cn } from '@/lib/utils';
import type { Result } from '@/server/result';
import type { Nav, NavSheet } from '@/server/repositories/sheets';
import { AccessDialog, type AccessTarget } from '@/components/access/access-panel';
import { SheetCode, iconClass, itemClass, revealClass } from './menu-bits';

// The "Sheets" part of the side menu (docs/05 §2.1): folders with their sheets, then "Other sheets". Editors rename
// and move sheets (drag and drop, Alt+arrow keys, or the "…" menu); owners and admins also create, rename, reorder,
// sort and archive folders and archive sheets. Viewers see the list only. Moves are optimistic: the menu changes at
// once, the server puts the row between the same neighbours, and a failure rolls back with a "Retry" toast.

type Tree = MenuTree<NavSheet>;
type Edge = 'before' | 'after';
type Drop =
  | {
      kind: 'sheet';
      folderId: string | null;
      index: number;
      line?: { id: string; edge: Edge };
      into?: string;
    }
  | { kind: 'folder'; index: number; line: { id: string; edge: Edge } };
type DragData =
  | { kind: 'sheet'; id: string }
  | { kind: 'folder'; id: string }
  | { kind: 'empty'; folderId: string | null };
type Renaming = { kind: 'folder' | 'sheet'; id: string } | { kind: 'new-folder' } | null;

const UNFILED = 'unfiled';
const OPEN_DELAY = 600;
const NEW_FOLDER_NOTE =
  'Folders organise sheets. To choose who sees a folder’s sheets, use Access in its menu.';

/** A folder shown before the server has answered: no menu actions on it yet. */
const isTemp = (id: string) => id.startsWith('new-');

function toTree(nav: Nav): Tree {
  return { folders: nav.folders, unfiled: nav.unfiled };
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    setMatches(m.matches);
    const on = () => setMatches(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Ctrl+B collapses the menu to icons (side-menu.tsx sets data-side on <html>). */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const read = () => setCollapsed(document.documentElement.dataset.side === 'collapsed');
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-side'] });
    return () => obs.disconnect();
  }, []);
  return collapsed;
}

export type MenuSheetsProps = {
  org: string;
  nav: Nav;
  activeSheet: string | null;
  /** The "Find" text, lower-cased; empty when not filtering. */
  q: string;
  hit: (label: string) => boolean;
  isClosed: (id: string) => boolean;
  toggle: (id: string) => void;
  setOpen: (id: string) => void;
  canEdit: boolean;
  canManage: boolean;
  /** Phones: the menu is a sheet that closes on navigation; drag and drop is off there. */
  onNavigate?: () => void;
};

export function MenuSheets(props: MenuSheetsProps) {
  const { org, nav, activeSheet, q, hit, canEdit, canManage, onNavigate } = props;
  const router = useRouter();
  const [tree, setTree] = useState<Tree>(() => toTree(nav));
  useEffect(() => setTree(toTree(nav)), [nav]);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [moveTo, setMoveTo] = useState<NavSheet | null>(null);
  const [accessFor, setAccessFor] = useState<AccessTarget | null>(null);
  const [archiving, setArchiving] = useState<
    { kind: 'folder'; id: string } | { kind: 'sheet'; id: string } | null
  >(null);
  const [live, setLive] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [, start] = useTransition();

  const wide = useMedia('(min-width: 760px)');
  const collapsed = useCollapsed();
  const canDrag = canEdit && !q && !collapsed && wide && !onNavigate;

  // keep focus on a row that moved to another list (keyboard moves)
  useEffect(() => {
    if (!focusId) return;
    const el = document.querySelector<HTMLElement>(`[data-menu-row="${focusId}"]`);
    if (el) {
      el.focus();
      setFocusId(null);
    }
  }, [focusId, tree]);

  const folderName = useCallback(
    (id: string | null) =>
      id ? (treeRef.current.folders.find((f) => f.id === id)?.name ?? 'a folder') : 'Other sheets',
    [],
  );

  /** Run a menu command with an optimistic tree; roll back and offer Retry on failure. */
  function commit<T>(
    next: Tree,
    action: () => Promise<Result<T>>,
    failure: string,
    retry: () => void,
    onDone?: (data: T) => void,
  ) {
    const before = treeRef.current;
    setTree(next);
    start(async () => {
      let r: Result<T>;
      try {
        r = await action();
      } catch {
        r = { ok: false, error: { code: 'failed', message: 'Check your connection.' } };
      }
      if (r.ok) {
        onDone?.(r.data);
        router.refresh();
        return;
      }
      setTree(before);
      toast.error(`${failure} ${r.error.message}`, { action: { label: 'Retry', onClick: retry } });
    });
  }

  function moveSheet(sheetId: string, folderId: string | null, index: number, focus = false) {
    if (folderId && isTemp(folderId)) return;
    const m: TreeMove<NavSheet> | null = moveSheetInTree(treeRef.current, sheetId, folderId, index);
    if (!m) return;
    const name = locateSheet(treeRef.current, sheetId)?.sheet.name ?? 'Sheet';
    if (folderId) props.setOpen(folderId);
    if (focus) setFocusId(sheetId);
    setLive(`${name} moved to ${folderName(folderId)}, position ${m.index + 1} of ${m.total}`);
    commit(
      m.tree,
      () => moveSheetAction({ org, sheetId, folderId, before: m.before, after: m.after }),
      `Could not move ${name}.`,
      () => moveSheet(sheetId, folderId, index),
    );
  }

  function moveFolder(folderId: string, index: number, focus = false) {
    if (isTemp(folderId)) return;
    const m = moveFolderInTree(treeRef.current, folderId, index);
    if (!m) return;
    const name = folderName(folderId);
    if (focus) setFocusId(folderId);
    setLive(`${name} moved to position ${m.index + 1} of ${m.total}`);
    commit(
      m.tree,
      () => moveFolderAction({ org, folderId, before: m.before, after: m.after }),
      `Could not move ${name}.`,
      () => moveFolder(folderId, index),
    );
  }

  function rename(target: Exclude<Renaming, null>, name: string) {
    setRenaming(null);
    const value = name.trim();
    const t = treeRef.current;
    if (target.kind === 'new-folder') {
      if (!value) return;
      const temp = { id: `new-${Date.now()}`, name: value, sheets: [] };
      commit(
        { ...t, folders: [temp, ...t.folders] },
        () => createFolderAction({ org, name: value, at: 'first' }),
        `Could not create ${value}.`,
        () => rename(target, value),
        (d) => {
          // the folder gets its real id at once, so it can be renamed or moved before the menu refreshes
          setTree((was) => ({
            ...was,
            folders: was.folders.map((f) => (f.id === temp.id ? { ...f, id: d.id } : f)),
          }));
          toast('Folder created.');
        },
      );
      return;
    }
    if (target.kind === 'folder') {
      const f = t.folders.find((x) => x.id === target.id);
      if (!f || isTemp(f.id) || !value || value === f.name) return;
      commit(
        { ...t, folders: t.folders.map((x) => (x.id === f.id ? { ...x, name: value } : x)) },
        () => renameFolderAction({ org, folderId: f.id, name: value }),
        `Could not rename ${f.name}.`,
        () => rename(target, value),
      );
      return;
    }
    const s = locateSheet(t, target.id)?.sheet;
    if (!s || !value || value === s.name) return;
    const named = (list: NavSheet[]) =>
      list.map((x) => (x.id === s.id ? { ...x, name: value } : x));
    commit(
      {
        folders: t.folders.map((f) => ({ ...f, sheets: named(f.sheets) })),
        unfiled: named(t.unfiled),
      },
      () => renameSheetAction({ org, sheetId: s.id, name: value }),
      `Could not rename ${s.name}.`,
      () => rename(target, value),
    );
  }

  function sortFolder(folderId: string) {
    const t = treeRef.current;
    const sorted = t.folders.map((f) =>
      f.id === folderId
        ? {
            ...f,
            sheets: [...f.sheets].sort((a, b) =>
              a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }),
            ),
          }
        : f,
    );
    commit(
      { ...t, folders: sorted },
      () => sortFolderAction({ org, folderId }),
      `Could not sort ${folderName(folderId)}.`,
      () => sortFolder(folderId),
      () => toast(`Sorted ${folderName(folderId)} A–Z.`),
    );
  }

  function archive() {
    const target = archiving;
    if (!target) return;
    setArchiving(null);
    const t = treeRef.current;
    if (target.kind === 'folder') {
      const f = t.folders.find((x) => x.id === target.id);
      if (!f) return;
      commit(
        { ...t, folders: t.folders.filter((x) => x.id !== f.id) },
        () => archiveFolderAction({ org, folderId: f.id }),
        `Could not archive ${f.name}.`,
        () => setArchiving(target),
        (d) => {
          toast(
            d.sheets === 0
              ? `Archived ${f.name}.`
              : `Archived ${f.name} and ${d.sheets === 1 ? '1 sheet' : `${d.sheets} sheets`}.`,
          );
          if (f.sheets.some((s) => s.id === activeSheet)) router.push(`/${org}/home`);
        },
      );
      return;
    }
    const s = locateSheet(t, target.id)?.sheet;
    if (!s) return;
    const drop = (list: NavSheet[]) => list.filter((x) => x.id !== s.id);
    commit(
      {
        folders: t.folders.map((f) => ({ ...f, sheets: drop(f.sheets) })),
        unfiled: drop(t.unfiled),
      },
      () => archiveSheetNowAction({ org, sheetId: s.id, archived: 'true' }),
      `Could not archive ${s.name}.`,
      () => setArchiving(target),
      () => {
        toast(`Archived ${s.name}.`);
        if (s.id === activeSheet) router.push(`/${org}/home`);
      },
    );
  }

  // ───────────── keyboard: F2, Alt+↑/↓, Alt+→ / Alt+← ─────────────

  function onSheetKey(e: React.KeyboardEvent, s: NavSheet) {
    if (!canEdit || q) return;
    if (e.key === 'F2') {
      e.preventDefault();
      setRenaming({ kind: 'sheet', id: s.id });
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const loc = locateSheet(treeRef.current, s.id);
    if (!loc) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveSheet(s.id, loc.folderId, loc.index + (e.key === 'ArrowUp' ? -1 : 1), true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const above = treeRef.current.folders.at(-1);
      if (loc.folderId)
        setLive(`${s.name} is already in a folder. Use Move to… to choose another.`);
      else if (above) moveSheet(s.id, above.id, above.sheets.length, true);
      else setLive('There is no folder to move it into.');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (loc.folderId) moveSheet(s.id, null, 0, true);
    }
  }

  function onFolderKey(e: React.KeyboardEvent, folderId: string) {
    if (!canManage || q) return;
    if (e.key === 'F2') {
      e.preventDefault();
      setRenaming({ kind: 'folder', id: folderId });
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const i = treeRef.current.folders.findIndex((f) => f.id === folderId);
    moveFolder(folderId, i + (e.key === 'ArrowUp' ? -1 : 1), true);
  }

  // ───────────── drag and drop ─────────────

  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const openTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearOpenTimer = () => {
    if (openTimer.current) clearTimeout(openTimer.current.timer);
    openTimer.current = null;
  };
  useEffect(() => clearOpenTimer, []);

  const collision: CollisionDetection = useCallback((args) => {
    const kind = (args.active.data.current as DragData | undefined)?.kind;
    const containers = args.droppableContainers.filter((c) => {
      const k = (c.data.current as DragData | undefined)?.kind;
      return kind === 'folder' ? k === 'folder' : !!k;
    });
    const within = pointerWithin({ ...args, droppableContainers: containers });
    return within.length ? within : closestCenter({ ...args, droppableContainers: containers });
  }, []);

  function dropFor(active: Active, over: Over | null): Drop | null {
    const a = active.data.current as DragData | undefined;
    const o = over?.data.current as DragData | undefined;
    const r = active.rect.current.translated;
    if (!a || !o || !over || !r) return null;
    const below = r.top + r.height / 2 > over.rect.top + over.rect.height / 2;
    const t = treeRef.current;
    if (a.kind === 'folder') {
      if (o.kind !== 'folder' || o.id === a.id) return null;
      const others = t.folders.filter((f) => f.id !== a.id);
      const i = others.findIndex((f) => f.id === o.id);
      if (i < 0) return null;
      return {
        kind: 'folder',
        index: i + (below ? 1 : 0),
        line: { id: o.id, edge: below ? 'after' : 'before' },
      };
    }
    if (a.kind !== 'sheet') return null;
    if (o.kind === 'folder') {
      const list = levelOf(t, o.id).filter((s) => s.id !== a.id);
      return { kind: 'sheet', folderId: o.id, index: list.length, into: o.id };
    }
    if (o.kind === 'empty')
      return { kind: 'sheet', folderId: o.folderId, index: 0, into: o.folderId ?? UNFILED };
    if (o.id === a.id) return null;
    const loc = locateSheet(t, o.id);
    if (!loc) return null;
    const list = levelOf(t, loc.folderId).filter((s) => s.id !== a.id);
    const i = list.findIndex((s) => s.id === o.id);
    return {
      kind: 'sheet',
      folderId: loc.folderId,
      index: i + (below ? 1 : 0),
      line: { id: o.id, edge: below ? 'after' : 'before' },
    };
  }

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as DragData | undefined) ?? null);
  }

  function onDragMove(e: DragMoveEvent) {
    const next = dropFor(e.active, e.over);
    setDrop((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    // a closed folder opens after hovering 600 ms
    const into = next?.kind === 'sheet' ? next.into : undefined;
    if (into && into !== UNFILED && props.isClosed(into)) {
      if (openTimer.current?.id !== into) {
        clearOpenTimer();
        openTimer.current = { id: into, timer: setTimeout(() => props.setOpen(into), OPEN_DELAY) };
      }
    } else clearOpenTimer();
  }

  function onDragEnd(e: DragEndEvent) {
    const d = dropFor(e.active, e.over);
    const a = e.active.data.current as DragData | undefined;
    setDragging(null);
    setDrop(null);
    clearOpenTimer();
    if (!d || !a) return;
    if (d.kind === 'folder' && a.kind === 'folder') moveFolder(a.id, d.index);
    if (d.kind === 'sheet' && a.kind === 'sheet') moveSheet(a.id, d.folderId, d.index);
  }

  function onDragCancel() {
    setDragging(null);
    setDrop(null);
    clearOpenTimer();
  }

  const nameOfDrag = (id: string | number) => {
    const [kind, ...rest] = String(id).split(':');
    const key = rest.join(':');
    return kind === 'f'
      ? folderName(key)
      : (locateSheet(treeRef.current, key)?.sheet.name ?? 'Sheet');
  };
  const describeOver = (over: Over) => {
    const o = over.data.current as DragData | undefined;
    if (!o) return 'a place in the menu';
    if (o.kind === 'folder') return `folder ${folderName(o.id)}`;
    if (o.kind === 'empty') return folderName(o.folderId);
    return locateSheet(treeRef.current, o.id)?.sheet.name ?? 'a sheet';
  };

  // ───────────── render ─────────────

  const sections = useMemo(
    () => [
      ...tree.folders.map((f) => ({
        id: f.id,
        folder: true as const,
        name: f.name,
        restricted: !!(f as { restricted?: boolean }).restricted,
        sheets: f.sheets,
      })),
      {
        id: UNFILED,
        folder: false as const,
        name: 'Other sheets',
        restricted: false,
        sheets: tree.unfiled,
      },
    ],
    [tree],
  );
  const draggingSheet = dragging?.kind === 'sheet';
  const empty = tree.folders.length === 0 && tree.unfiled.length === 0;
  const newSheetHref = (folderId?: string) =>
    folderId ? `/${org}/s/new?folder=${folderId}` : `/${org}/s/new`;

  const shared = {
    org,
    canEdit,
    canManage,
    canDrag,
    q,
    renaming,
    setRenaming,
    rename,
    onNavigate,
    newSheetHref,
  };

  return (
    <>
      {q ? null : (
        <div className="group/row flex items-center pr-1">
          <h2 className="text-muted-foreground text-label-12 flex-1 px-2.5 pt-0.5 pb-1.5 font-medium">
            Sheets
          </h2>
          {canEdit ? (
            <AddMenu
              org={org}
              canManage={canManage}
              onNavigate={onNavigate}
              onNewFolder={() => setRenaming({ kind: 'new-folder' })}
            />
          ) : null}
        </div>
      )}
      <p aria-live="polite" role="status" className="sr-only">
        {live}
      </p>
      {renaming?.kind === 'new-folder' ? (
        <div className="flex flex-col gap-1 px-1 pb-1">
          <RenameInput
            label="Folder name"
            placeholder="Folder name"
            initial=""
            onDone={(v) => (v === null ? setRenaming(null) : rename({ kind: 'new-folder' }, v))}
            icon={<Folder className={iconClass} aria-hidden />}
            describedBy="menu-new-folder-note"
          />
          <p id="menu-new-folder-note" className="text-muted-foreground text-label-12 px-2.5">
            {NEW_FOLDER_NOTE}
          </p>
        </div>
      ) : null}
      {empty && !q ? (
        <div className="flex flex-col items-start gap-1 px-2.5 py-1.5">
          <p className="text-muted-foreground text-copy-13 m-0">No sheets yet.</p>
          {canEdit ? (
            <Link
              href={newSheetHref()}
              onClick={onNavigate}
              className="text-ink text-label-13 font-medium underline-offset-4 hover:underline"
            >
              Create your first sheet
            </Link>
          ) : null}
        </div>
      ) : null}
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'To pick up, press space or enter. Use the arrow keys to move, space or enter to drop, escape to cancel. Alt with the up and down arrows also moves it one place.',
          },
          announcements: {
            onDragStart: ({ active }) => `Picked up ${nameOfDrag(active.id)}.`,
            onDragOver: ({ active, over }) =>
              over
                ? `${nameOfDrag(active.id)} is over ${describeOver(over)}.`
                : `${nameOfDrag(active.id)} is not over a place to drop.`,
            onDragEnd: ({ active, over }) =>
              over
                ? `${nameOfDrag(active.id)} dropped.`
                : `${nameOfDrag(active.id)} was not moved.`,
            onDragCancel: ({ active }) => `Moving ${nameOfDrag(active.id)} was cancelled.`,
          },
        }}
      >
        {sections.map((s) => {
          const sheets = s.sheets.filter((x) => props.hit(x.name) || hit(s.name));
          if (!s.folder && s.sheets.length === 0 && !draggingSheet) return null;
          if (q && sheets.length === 0) return null;
          const open =
            !!q || !props.isClosed(s.id) || sheets.some((x) => x.id === activeSheet) || false;
          const into = drop?.kind === 'sheet' && drop.into === s.id;
          const line =
            drop?.kind === 'folder' && drop.line.id === s.id ? drop.line.edge : undefined;
          return (
            <FolderSection
              key={s.id}
              {...shared}
              id={s.id}
              folder={s.folder}
              name={s.name}
              restricted={s.restricted}
              sheetNames={s.sheets.map((x) => x.name)}
              open={open}
              into={into}
              line={line}
              dimmed={dragging?.kind === 'folder' && dragging.id === s.id}
              onToggle={() => props.toggle(s.id)}
              onKey={(e) => onFolderKey(e, s.id)}
              menu={
                s.folder && canEdit ? (
                  <FolderMenu
                    {...shared}
                    folderId={s.id}
                    name={s.name}
                    first={tree.folders[0]?.id === s.id}
                    last={tree.folders.at(-1)?.id === s.id}
                    empty={s.sheets.length === 0}
                    onMove={(d) =>
                      moveFolder(s.id, tree.folders.findIndex((f) => f.id === s.id) + d, true)
                    }
                    onSort={() => sortFolder(s.id)}
                    onArchive={() => setArchiving({ kind: 'folder', id: s.id })}
                    onAccess={() => setAccessFor({ kind: 'folder', id: s.id, name: s.name })}
                  />
                ) : null
              }
            >
              {sheets.map((x, i) => (
                <SheetRow
                  key={x.id}
                  {...shared}
                  sheet={x}
                  active={x.id === activeSheet}
                  line={
                    drop?.kind === 'sheet' && drop.line?.id === x.id ? drop.line.edge : undefined
                  }
                  dimmed={dragging?.kind === 'sheet' && dragging.id === x.id}
                  onKey={(e) => onSheetKey(e, x)}
                  menu={
                    canEdit && !x.noAccess ? (
                      <SheetMenu
                        {...shared}
                        sheet={x}
                        first={i === 0}
                        last={i === sheets.length - 1}
                        onMove={(d) => {
                          const loc = locateSheet(treeRef.current, x.id);
                          if (loc) moveSheet(x.id, loc.folderId, loc.index + d, true);
                        }}
                        onMoveTo={() => setMoveTo(x)}
                        onArchive={() => setArchiving({ kind: 'sheet', id: x.id })}
                        onAccess={() => setAccessFor({ kind: 'sheet', id: x.id, name: x.name })}
                      />
                    ) : null
                  }
                />
              ))}
              {s.folder && s.sheets.length === 0 && !q ? (
                <EmptyFolder
                  folderId={s.id}
                  canEdit={canEdit}
                  href={newSheetHref(s.id)}
                  onNavigate={onNavigate}
                />
              ) : null}
            </FolderSection>
          );
        })}
        <DragOverlay dropAnimation={null}>
          {dragging && dragging.kind !== 'empty' ? (
            <div className="bg-background-100 border-line shadow-menu text-label-13.5 text-ink flex h-8 items-center gap-2 rounded-md border px-2">
              {dragging.kind === 'folder' ? (
                <Folder className="text-muted-foreground size-4" aria-hidden />
              ) : null}
              <span className="truncate">
                {nameOfDrag(`${dragging.kind === 'folder' ? 'f' : 's'}:${dragging.id}`)}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <MoveToDialog
        sheet={moveTo}
        folders={tree.folders}
        current={moveTo ? (locateSheet(tree, moveTo.id)?.folderId ?? null) : null}
        onClose={() => setMoveTo(null)}
        onPick={(folderId) => {
          const s = moveTo;
          setMoveTo(null);
          if (s) moveSheet(s.id, folderId, levelOf(treeRef.current, folderId).length);
        }}
      />
      <ArchiveDialog
        target={archiving}
        tree={tree}
        onCancel={() => setArchiving(null)}
        onConfirm={archive}
      />
      <AccessDialog org={org} target={accessFor} onClose={() => setAccessFor(null)} />
    </>
  );
}

// ───────────────────────── pieces ─────────────────────────

type Shared = {
  org: string;
  canEdit: boolean;
  canManage: boolean;
  canDrag: boolean;
  q: string;
  renaming: Renaming;
  setRenaming: (r: Renaming) => void;
  rename: (target: Exclude<Renaming, null>, name: string) => void;
  onNavigate?: () => void;
  newSheetHref: (folderId?: string) => string;
};

/** Inline rename: Enter saves, Escape cancels, leaving the field saves. */
function RenameInput({
  label,
  initial,
  placeholder,
  onDone,
  icon,
  describedBy,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  onDone: (value: string | null) => void;
  icon: React.ReactNode;
  describedBy?: string;
}) {
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // focus once an open menu has closed and given the focus back (it would take it from an autofocused field)
  useEffect(() => {
    const t = setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <div className="border-focus bg-background-100 flex h-8 items-center gap-2 rounded-md border px-2">
      {icon}
      <input
        ref={input}
        defaultValue={initial}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={describedBy}
        maxLength={label === 'Folder name' ? 80 : 120}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(null);
          }
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
        className="text-ink text-label-13.5 placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
      />
    </div>
  );
}

type Listeners = ReturnType<typeof useDraggable>['listeners'];
/** The whole row starts a pointer drag; the handle alone takes the keyboard (Enter on the link still opens it). */
const pointerDown = (l: Listeners) => l?.onPointerDown as React.PointerEventHandler | undefined;
const keyDown = (l: Listeners) => l?.onKeyDown as React.KeyboardEventHandler | undefined;

function DropLine({ edge }: { edge?: Edge }) {
  if (!edge) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'bg-focus pointer-events-none absolute right-1 left-1 z-10 h-0.5 rounded-full',
        edge === 'before' ? '-top-px' : '-bottom-px',
      )}
    />
  );
}

function FolderSection({
  id,
  folder,
  name,
  restricted,
  open,
  into,
  line,
  dimmed,
  onToggle,
  onKey,
  menu,
  children,
  canManage,
  canDrag,
  renaming,
  rename,
  setRenaming,
}: Shared & {
  id: string;
  folder: boolean;
  name: string;
  restricted?: boolean;
  sheetNames: string[];
  open: boolean;
  into: boolean;
  line?: Edge;
  dimmed: boolean;
  onToggle: () => void;
  onKey: (e: React.KeyboardEvent) => void;
  menu: React.ReactNode;
  children: React.ReactNode;
}) {
  const listId = `menu-folder-${id}`;
  const dragId = folder ? `f:${id}` : `e:${UNFILED}-h`;
  const drag = useDraggable({
    id: `f:${id}`,
    data: { kind: 'folder', id },
    disabled: !folder || !canDrag || !canManage,
  });
  const dropZone = useDroppable({
    id: dragId,
    data: folder ? { kind: 'folder', id } : { kind: 'empty', folderId: null },
  });
  const isRenaming = renaming?.kind === 'folder' && renaming.id === id;
  return (
    <section
      aria-labelledby={`${listId}-h`}
      className={cn('flex flex-col', dimmed && 'opacity-50')}
      data-folder-section={id}
    >
      <div
        ref={(el) => {
          dropZone.setNodeRef(el);
          drag.setNodeRef(el);
        }}
        className={cn(
          'group/row relative flex items-center rounded-md',
          into && 'bg-nav-active ring-focus ring-1',
        )}
        onPointerDown={canDrag && folder && canManage ? pointerDown(drag.listeners) : undefined}
      >
        <DropLine edge={line} />
        <h3 id={`${listId}-h`} className="m-0 flex min-w-0 flex-1">
          {isRenaming ? (
            <div className="flex-1">
              <RenameInput
                label="Folder name"
                initial={name}
                onDone={(v) => (v === null ? setRenaming(null) : rename({ kind: 'folder', id }, v))}
                icon={<Folder className={iconClass} aria-hidden />}
              />
            </div>
          ) : (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              data-menu-row={id}
              onClick={(e) => {
                if (e.detail === 2 && folder && canManage) {
                  onToggle();
                  setRenaming({ kind: 'folder', id });
                  return;
                }
                onToggle();
              }}
              onKeyDown={folder ? onKey : undefined}
              className={cn(itemClass, 'group/item min-w-0 flex-1')}
            >
              <Folder className={iconClass} aria-hidden />
              <span data-side-text className="min-w-0 flex-1 truncate">
                {name}
              </span>
              {restricted ? (
                <span data-side-text title="Restricted" className="text-muted-foreground shrink-0">
                  <Lock className="size-3.5" aria-hidden />
                  <span className="sr-only">Restricted</span>
                </span>
              ) : null}
              <ChevronRight
                data-side-text
                className={cn(
                  'text-muted-foreground size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
                  open && 'rotate-90',
                )}
                aria-hidden
              />
            </button>
          )}
        </h3>
        {folder && canDrag && canManage && !isRenaming ? (
          <button
            type="button"
            ref={drag.setActivatorNodeRef}
            {...drag.attributes}
            onKeyDown={keyDown(drag.listeners)}
            aria-label={`Drag ${name}`}
            data-side-text
            className={cn(
              'text-muted-foreground hover:bg-nav-hover hover:text-ink flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md outline-offset-[-2px]',
              revealClass,
            )}
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        ) : null}
        {menu && !isRenaming ? <span data-side-text>{menu}</span> : null}
      </div>
      <ul
        id={listId}
        hidden={!open}
        data-side-list
        className="border-line my-px mb-1 ml-[18px] flex flex-col gap-px border-l pl-2"
      >
        {children}
      </ul>
    </section>
  );
}

function SheetRow({
  sheet,
  active,
  line,
  dimmed,
  onKey,
  menu,
  org,
  canEdit,
  canDrag,
  renaming,
  rename,
  setRenaming,
  onNavigate,
}: Shared & {
  sheet: NavSheet;
  active: boolean;
  line?: Edge;
  dimmed: boolean;
  onKey: (e: React.KeyboardEvent) => void;
  menu: React.ReactNode;
}) {
  const drag = useDraggable({
    id: `s:${sheet.id}`,
    data: { kind: 'sheet', id: sheet.id },
    disabled: !canDrag,
  });
  const dropZone = useDroppable({ id: `s:${sheet.id}`, data: { kind: 'sheet', id: sheet.id } });
  const isRenaming = renaming?.kind === 'sheet' && renaming.id === sheet.id;
  return (
    <li
      ref={(el) => {
        dropZone.setNodeRef(el);
        drag.setNodeRef(el);
      }}
      className={cn('group/row relative flex items-center', dimmed && 'opacity-50')}
      onPointerDown={canDrag ? pointerDown(drag.listeners) : undefined}
    >
      <DropLine edge={line} />
      {isRenaming ? (
        <div className="flex-1">
          <RenameInput
            label="Sheet name"
            initial={sheet.name}
            onDone={(v) =>
              v === null ? setRenaming(null) : rename({ kind: 'sheet', id: sheet.id }, v)
            }
            icon={<SheetCode code={sheet.code} />}
          />
        </div>
      ) : sheet.noAccess ? (
        // owners and admins see a restricted sheet's name; it opens nothing (docs/02 §16)
        <span
          data-menu-row={sheet.id}
          tabIndex={0}
          onKeyDown={onKey}
          aria-disabled="true"
          aria-label={`${sheet.name}, restricted: you do not have access`}
          title="Restricted. Ask an owner to give you access."
          className={cn(
            itemClass,
            'text-muted-foreground text-label-13.5 h-8 min-w-0 flex-1 cursor-default gap-[9px] px-2',
          )}
        >
          <SheetCode code={sheet.code} />
          <span data-side-text className="min-w-0 flex-1 truncate">
            {sheet.name}
          </span>
          <span data-side-text className="text-label-12 flex shrink-0 items-center gap-1">
            <Lock className="size-3.5" aria-hidden /> Restricted
          </span>
        </span>
      ) : (
        <Link
          href={`/${org}/s/${sheet.id}`}
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
          onKeyDown={onKey}
          onDoubleClick={canEdit ? () => setRenaming({ kind: 'sheet', id: sheet.id }) : undefined}
          data-testid={`rail-sheet-${sheet.code}`}
          data-menu-row={sheet.id}
          className={cn(itemClass, 'group/item text-label-13.5 h-8 min-w-0 flex-1 gap-[9px] px-2')}
          title={sheet.name}
        >
          <SheetCode code={sheet.code} />
          <span data-side-text className="min-w-0 flex-1 truncate">
            {sheet.name}
          </span>
          {sheet.restricted ? (
            <span data-side-text title="Restricted" className="text-muted-foreground shrink-0">
              <Lock className="size-3.5" aria-hidden />
              <span className="sr-only">Restricted</span>
            </span>
          ) : null}
        </Link>
      )}
      {canDrag && !isRenaming ? (
        <button
          type="button"
          ref={drag.setActivatorNodeRef}
          {...drag.attributes}
          onKeyDown={keyDown(drag.listeners)}
          aria-label={`Drag ${sheet.name}`}
          data-side-text
          className={cn(
            'text-muted-foreground hover:bg-nav-hover hover:text-ink flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md outline-offset-[-2px]',
            revealClass,
          )}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {menu && !isRenaming ? <span data-side-text>{menu}</span> : null}
    </li>
  );
}

function EmptyFolder({
  folderId,
  canEdit,
  href,
  onNavigate,
}: {
  folderId: string;
  canEdit: boolean;
  href: string;
  onNavigate?: () => void;
}) {
  const zone = useDroppable({ id: `e:${folderId}`, data: { kind: 'empty', folderId } });
  return (
    <li
      ref={zone.setNodeRef}
      className="flex flex-col items-start gap-0.5 px-2 py-1"
      data-side-text
    >
      <span className="text-muted-foreground text-label-13">No sheets in this folder</span>
      {canEdit ? (
        <Link
          href={href}
          onClick={onNavigate}
          className="text-ink text-label-13 font-medium underline-offset-4 hover:underline"
        >
          New sheet here
        </Link>
      ) : null}
    </li>
  );
}

const triggerClass = cn(
  'text-muted-foreground hover:bg-nav-hover hover:text-ink flex size-6 shrink-0 items-center justify-center rounded-md outline-offset-[-2px]',
  revealClass,
);

function AddMenu({
  org,
  canManage,
  onNavigate,
  onNewFolder,
}: {
  org: string;
  canManage: boolean;
  onNavigate?: () => void;
  onNewFolder: () => void;
}) {
  const newFolder = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Add a sheet or folder" className={triggerClass}>
        <Plus className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        onCloseAutoFocus={(e) => {
          // the new folder's name field takes the focus
          if (newFolder.current) e.preventDefault();
          newFolder.current = false;
        }}
      >
        <DropdownMenuItem asChild>
          <Link href={`/${org}/s/new`} onClick={onNavigate}>
            New sheet
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <DropdownMenuItem
            onSelect={() => {
              newFolder.current = true;
              onNewFolder();
            }}
          >
            New folder
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href={`/${org}/s/new?start=csv`} onClick={onNavigate}>
            Import CSV
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-label-12 font-normal">
              {NEW_FOLDER_NOTE}
            </DropdownMenuLabel>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FolderMenu({
  folderId,
  name,
  first,
  last,
  canManage,
  q,
  onMove,
  onSort,
  onArchive,
  onAccess,
  setRenaming,
  newSheetHref,
  onNavigate,
}: Shared & {
  folderId: string;
  name: string;
  first: boolean;
  last: boolean;
  empty: boolean;
  onMove: (delta: -1 | 1) => void;
  onSort: () => void;
  onArchive: () => void;
  onAccess: () => void;
}) {
  const renameNext = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`More for folder ${name}`} className={triggerClass}>
        <MoreHorizontal className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52"
        onCloseAutoFocus={(e) => {
          if (renameNext.current) e.preventDefault();
          renameNext.current = false;
        }}
      >
        <DropdownMenuItem asChild>
          <Link href={newSheetHref(folderId)} onClick={onNavigate}>
            New sheet here
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuItem
              onSelect={() => {
                renameNext.current = true;
                setRenaming({ kind: 'folder', id: folderId });
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled={first || !!q} onSelect={() => onMove(-1)}>
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last || !!q} onSelect={() => onMove(1)}>
              Move down
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSort}>Sort A–Z</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                renameNext.current = true;
                onAccess();
              }}
            >
              <Lock className="size-4" aria-hidden /> Access…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onArchive}>
              Archive
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SheetMenu({
  org,
  sheet,
  first,
  last,
  canManage,
  q,
  onMove,
  onMoveTo,
  onArchive,
  onAccess,
  setRenaming,
  onNavigate,
}: Shared & {
  sheet: NavSheet;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  onMoveTo: () => void;
  onArchive: () => void;
  onAccess: () => void;
}) {
  const keepFocus = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`More for ${sheet.name}`} className={triggerClass}>
        <MoreHorizontal className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52"
        onCloseAutoFocus={(e) => {
          if (keepFocus.current) e.preventDefault();
          keepFocus.current = false;
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            keepFocus.current = true;
            setRenaming({ kind: 'sheet', id: sheet.id });
          }}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            keepFocus.current = true;
            onMoveTo();
          }}
        >
          <FolderInput className="size-4" aria-hidden /> Move to…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={first || !!q} onSelect={() => onMove(-1)}>
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last || !!q} onSelect={() => onMove(1)}>
          Move down
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${org}/s/new?start=copy&source=${sheet.id}`} onClick={onNavigate}>
            Duplicate
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${org}/s/${sheet.id}/settings`} onClick={onNavigate}>
            Sheet settings
          </Link>
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuItem
              onSelect={() => {
                keepFocus.current = true;
                onAccess();
              }}
            >
              <Lock className="size-4" aria-hidden /> Access…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onArchive}>
              Archive
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Move to…": a searchable list of folders and "No folder". */
function MoveToDialog({
  sheet,
  folders,
  current,
  onClose,
  onPick,
}: {
  sheet: NavSheet | null;
  folders: { id: string; name: string }[];
  current: string | null;
  onClose: () => void;
  onPick: (folderId: string | null) => void;
}) {
  const [find, setFind] = useState('');
  useEffect(() => setFind(''), [sheet]);
  const options = [
    ...folders.map((f) => ({ id: f.id as string | null, name: f.name })),
    { id: null, name: 'No folder' },
  ].filter((o) => o.name.toLowerCase().includes(find.trim().toLowerCase()));
  const pickable = options.filter((o) => o.id !== current);
  return (
    <Dialog open={!!sheet} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3">
        <DialogTitle className="text-heading-16">Move {sheet?.name} to…</DialogTitle>
        <DialogDescription className="text-muted-foreground text-copy-13">
          Folders organise sheets. They do not restrict who can see them.
        </DialogDescription>
        <input
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pickable[0]) {
              e.preventDefault();
              onPick(pickable[0].id);
            }
          }}
          placeholder="Find a folder"
          aria-label="Find a folder"
          autoComplete="off"
          className="border-line text-ink placeholder:text-muted-foreground focus:border-focus text-label-14 bg-background-100 h-9 rounded-md border px-2.5 outline-none"
        />
        <ul aria-label="Folders" className="flex max-h-72 flex-col gap-px overflow-y-auto">
          {options.length === 0 ? (
            <li className="text-muted-foreground text-copy-13 px-2.5 py-2">No folder matches.</li>
          ) : null}
          {options.map((o) => (
            <li key={o.id ?? 'none'}>
              <button
                type="button"
                disabled={o.id === current}
                onClick={() => onPick(o.id)}
                className={cn(itemClass, 'h-9 disabled:opacity-60')}
              >
                <Folder className={iconClass} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.id === current ? (
                  <span className="text-muted-foreground text-label-12 flex items-center gap-1">
                    <Check className="size-3.5" aria-hidden /> Current
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({
  target,
  tree,
  onCancel,
  onConfirm,
}: {
  target: { kind: 'folder'; id: string } | { kind: 'sheet'; id: string } | null;
  tree: Tree;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const folder = target?.kind === 'folder' ? tree.folders.find((f) => f.id === target.id) : null;
  const sheet = target?.kind === 'sheet' ? locateSheet(tree, target.id)?.sheet : null;
  const name = folder?.name ?? sheet?.name ?? '';
  const count = folder?.sheets.length ?? 0;
  return (
    <Dialog open={!!target} onOpenChange={(o) => (o ? null : onCancel())}>
      <DialogContent className="gap-3">
        <DialogTitle className="text-heading-16">
          {folder
            ? count === 0
              ? `Archive ${name}?`
              : `Archive ${name} and its ${count === 1 ? 'sheet' : `${count} sheets`}?`
            : `Archive ${name}?`}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-copy-13">
          {folder
            ? count === 0
              ? 'The folder is hidden from the side menu. Owners and admins can restore it from Workspace admin, Archived.'
              : 'The folder and these sheets are hidden from the side menu. Their items are kept. Owners and admins can restore them together from Workspace admin, Archived.'
            : 'The sheet is hidden from the side menu. Its items are kept. Owners and admins can restore it from Workspace admin, Archived.'}
        </DialogDescription>
        {folder && count > 0 ? (
          <ul aria-label="Sheets archived with the folder" className="flex flex-col gap-1 pl-1">
            {folder.sheets.map((s) => (
              <li key={s.id} className="text-label-13.5 flex items-center gap-2">
                <SheetCode code={s.code} /> {s.name}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {folder && count > 0 ? 'Archive folder and sheets' : 'Archive'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
