// Organising the side menu (docs/05 §2.1, docs/02 §1 folders): where a moved folder or sheet lands, A–Z sorting,
// the folder a sheet made from a template goes into, and the readable sentence for folder and sheet log entries.
// Pure: the server reads the rows and passes them in.
import { keyBetween, keysBetween, needsRekey } from './ordering';
import type { Json } from './types';

export type Keyed = { id: string; position: string };

/** Fractional keys compare by code unit (not by the database's locale); ties fall back to the id. */
export function byPosition(a: Keyed, b: Keyed): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type Placement =
  | {
      ok: true;
      /** The moved row's new key. */
      position: string;
      /** Siblings whose key must change too (only when the level was re-keyed). */
      rekey: Keyed[];
      /** 0-based index of the moved row in its level after the move, and the level's size. */
      index: number;
      total: number;
    }
  | { ok: false; reason: 'neighbour' };

/**
 * Place `movingId` among `siblings` (the rows of the level it lands in; the moving row itself is ignored if present)
 * right after `beforeId` or right before `afterId`. Both null = at the end. When both are given but no longer next
 * to each other (someone else moved a row meanwhile), `beforeId` wins. The level is re-keyed evenly when the keys
 * around the gap are equal or out of order, or when the new key would grow past 50 characters (docs/02 §3).
 */
export function placeBetween(
  siblings: Keyed[],
  movingId: string,
  beforeId: string | null,
  afterId: string | null,
): Placement {
  const list = siblings.filter((s) => s.id !== movingId).sort(byPosition);
  let at: number;
  if (beforeId) {
    const i = list.findIndex((s) => s.id === beforeId);
    if (i < 0) return { ok: false, reason: 'neighbour' };
    at = i + 1;
  } else if (afterId) {
    const i = list.findIndex((s) => s.id === afterId);
    if (i < 0) return { ok: false, reason: 'neighbour' };
    at = i;
  } else at = list.length;
  const lo = list[at - 1]?.position ?? null;
  const hi = list[at]?.position ?? null;
  const total = list.length + 1;
  if (lo === null || hi === null || lo < hi) {
    const position = keyBetween(lo, hi);
    if (!needsRekey(position)) return { ok: true, position, rekey: [], index: at, total };
  }
  return { ok: true, ...rekeyLevel(list, movingId, at), index: at, total };
}

function rekeyLevel(list: Keyed[], movingId: string, at: number) {
  const order = [
    ...list.slice(0, at).map((s) => s.id),
    movingId,
    ...list.slice(at).map((s) => s.id),
  ];
  const keys = keysBetween(null, null, order.length);
  const old = new Map(list.map((s) => [s.id, s.position]));
  const rekey: Keyed[] = [];
  order.forEach((id, i) => {
    if (id !== movingId && old.get(id) !== keys[i]) rekey.push({ id, position: keys[i]! });
  });
  return { position: keys[at]!, rekey };
}

/** New keys for a level sorted by name, A to Z (case- and accent-insensitive, numbers in natural order). */
export function sortByName<T extends { id: string; name: string }>(rows: T[]): Keyed[] {
  const sorted = [...rows].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) ||
      (a.id < b.id ? -1 : 1),
  );
  const keys = keysBetween(null, null, sorted.length);
  return sorted.map((r, i) => ({ id: r.id, position: keys[i]! }));
}

/** Key for a new row at the top (`first`) or the end of a level. */
export function edgeKey(level: Keyed[], where: 'first' | 'last'): string {
  const sorted = [...level].sort(byPosition);
  return where === 'first'
    ? keyBetween(null, sorted[0]?.position ?? null)
    : keyBetween(sorted[sorted.length - 1]?.position ?? null, null);
}

// ───────────────────────── the folder of a sheet made from a template ─────────────────────────

export type FolderChoice =
  { kind: 'existing'; id: string } | { kind: 'create'; name: string } | { kind: 'none' };

const sameName = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), 'en', { sensitivity: 'accent' }) === 0;

/**
 * Where a new sheet goes. A folder the person picked wins; "No folder" (no id, no name) means none. Otherwise the
 * template's folder name: an existing (not archived) folder with that name, compared without case, is reused, or
 * the folder is created.
 */
export function resolveFolder(
  folders: { id: string; name: string; archived?: boolean }[],
  choice: { folderId: string | null; folderName: string | null },
): FolderChoice {
  if (choice.folderId) return { kind: 'existing', id: choice.folderId };
  const name = choice.folderName?.trim();
  if (!name) return { kind: 'none' };
  const found = folders.find((f) => !f.archived && sameName(f.name, name));
  return found ? { kind: 'existing', id: found.id } : { kind: 'create', name };
}

/** The wizard's folder field for a start with a template folder: the matching folder's id, or the new name. */
export function templateFolderDefault(
  folders: { id: string; name: string }[],
  folderName: string | undefined,
): { folderId: string } | { newFolder: string } | null {
  if (!folderName) return null;
  const found = folders.find((f) => sameName(f.name, folderName));
  return found ? { folderId: found.id } : { newFolder: folderName.trim() };
}

// ───────────────────────── folder and sheet log entries ─────────────────────────

export const ORGANISE_ACTIONS = [
  'folders.insert',
  'folders.update',
  'folders.delete',
  'sheets.insert',
  'sheets.update',
  'sheets.delete',
] as const;

type Row = { [k: string]: Json } | null;
const asRow = (v: Json | null): Row =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as { [k: string]: Json }) : null;
const str = (r: Row, k: string): string | null =>
  typeof r?.[k] === 'string' ? (r[k] as string) : null;

/**
 * One sentence for a folder or sheet entry of the workspace log: "Moved Risk register from Operations to Risk and
 * controls", "Reordered sheets in Operations", "Archived folder Suppliers" …
 * `folderName` looks folders up by id (archived and deleted ones included where known).
 */
export function organiseText(
  e: { action: string; oldValue: Json | null; newValue: Json | null },
  folderName: (id: string) => string | undefined,
): string {
  const before = asRow(e.oldValue);
  const after = asRow(e.newValue);
  const name = str(after, 'name') ?? str(before, 'name') ?? 'Untitled';
  const folder = (id: string | null) =>
    id ? (folderName(id) ?? 'a deleted folder') : 'Other sheets';
  switch (e.action) {
    case 'folders.insert':
      return `Created folder ${name}`;
    case 'folders.delete':
      return `Deleted folder ${name}`;
    case 'sheets.insert':
      return `Created sheet ${name}`;
    case 'sheets.delete':
      return `Deleted sheet ${name}`;
    case 'folders.update': {
      const was = str(before, 'archived_at');
      const now = str(after, 'archived_at');
      if (!was && now) return `Archived folder ${name}`;
      if (was && !now) return `Restored folder ${name}`;
      if (str(before, 'name') !== str(after, 'name'))
        return `Renamed folder ${str(before, 'name') ?? ''} to ${name}`;
      if (str(before, 'position') !== str(after, 'position'))
        return `Reordered folders: moved ${name}`;
      return `Changed folder ${name}`;
    }
    case 'sheets.update': {
      const was = str(before, 'archived_at');
      const now = str(after, 'archived_at');
      if (!was && now) return `Archived sheet ${name}`;
      if (was && !now) return `Restored sheet ${name}`;
      const from = str(before, 'folder_id');
      const to = str(after, 'folder_id');
      if (from !== to) return `Moved ${name} from ${folder(from)} to ${folder(to)}`;
      if (str(before, 'name') !== str(after, 'name'))
        return `Renamed sheet ${str(before, 'name') ?? ''} to ${name}`;
      if (str(before, 'position') !== str(after, 'position'))
        return `Reordered sheets in ${folder(to)}`;
      return `Changed the settings of ${name}`;
    }
    default:
      return e.action;
  }
}

// ───────────────────────── the side menu's tree (optimistic moves in the browser) ─────────────────────────

export type MenuSheet = { id: string; name: string };
export type MenuTree<S extends MenuSheet = MenuSheet> = {
  folders: { id: string; name: string; sheets: S[] }[];
  unfiled: S[];
};

/** The sheets of one level: a folder's, or "Other sheets" (null). */
export function levelOf<S extends MenuSheet>(t: MenuTree<S>, folderId: string | null): S[] {
  return folderId ? (t.folders.find((f) => f.id === folderId)?.sheets ?? []) : t.unfiled;
}

export function locateSheet<S extends MenuSheet>(t: MenuTree<S>, sheetId: string) {
  const i = t.unfiled.findIndex((s) => s.id === sheetId);
  if (i >= 0) return { folderId: null as string | null, index: i, sheet: t.unfiled[i]! };
  for (const f of t.folders) {
    const j = f.sheets.findIndex((s) => s.id === sheetId);
    if (j >= 0) return { folderId: f.id as string | null, index: j, sheet: f.sheets[j]! };
  }
  return null;
}

export type TreeMove<S extends MenuSheet> = {
  tree: MenuTree<S>;
  /** Neighbours for the move command: the row lands after `before` / before `after`. */
  before: string | null;
  after: string | null;
  /** 0-based position in the target level and the level's size after the move. */
  index: number;
  total: number;
};

/**
 * Move a sheet to `index` of the target level (counted without the sheet itself). Returns the new tree and the
 * neighbours the server needs, or null when nothing changes.
 */
export function moveSheetInTree<S extends MenuSheet>(
  t: MenuTree<S>,
  sheetId: string,
  folderId: string | null,
  index: number,
): TreeMove<S> | null {
  const from = locateSheet(t, sheetId);
  if (!from || (folderId && !t.folders.some((f) => f.id === folderId))) return null;
  const target = levelOf(t, folderId).filter((s) => s.id !== sheetId);
  const at = Math.max(0, Math.min(index, target.length));
  if (from.folderId === folderId && from.index === at) return null;
  const without = (list: S[]) => list.filter((s) => s.id !== sheetId);
  const insert = (list: S[]) => [...list.slice(0, at), from.sheet, ...list.slice(at)];
  const tree: MenuTree<S> = {
    folders: t.folders.map((f) => ({
      ...f,
      sheets: f.id === folderId ? insert(without(f.sheets)) : without(f.sheets),
    })),
    unfiled: folderId === null ? insert(without(t.unfiled)) : without(t.unfiled),
  };
  return {
    tree,
    before: target[at - 1]?.id ?? null,
    after: target[at]?.id ?? null,
    index: at,
    total: target.length + 1,
  };
}

/** Move a folder to `index` among the other folders. */
export function moveFolderInTree<S extends MenuSheet>(
  t: MenuTree<S>,
  folderId: string,
  index: number,
): TreeMove<S> | null {
  const from = t.folders.findIndex((f) => f.id === folderId);
  if (from < 0) return null;
  const others = t.folders.filter((f) => f.id !== folderId);
  const at = Math.max(0, Math.min(index, others.length));
  if (at === from) return null;
  const folders = [...others.slice(0, at), t.folders[from]!, ...others.slice(at)];
  return {
    tree: { ...t, folders },
    before: others[at - 1]?.id ?? null,
    after: others[at]?.id ?? null,
    index: at,
    total: folders.length,
  };
}
