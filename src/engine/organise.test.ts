import { describe, expect, it } from 'vitest';
import {
  byPosition,
  edgeKey,
  levelOf,
  locateSheet,
  moveFolderInTree,
  moveSheetInTree,
  organiseText,
  placeBetween,
  resolveFolder,
  sortByName,
  templateFolderDefault,
  type Keyed,
} from './organise';

const level: Keyed[] = [
  { id: 'a', position: 'a0' },
  { id: 'b', position: 'a1' },
  { id: 'c', position: 'a2' },
];
const order = (rows: Keyed[]) => [...rows].sort(byPosition).map((r) => r.id);
const apply = (rows: Keyed[], id: string, p: ReturnType<typeof placeBetween>) => {
  if (!p.ok) throw new Error('not placed');
  const next = new Map(rows.map((r) => [r.id, r.position]));
  next.set(id, p.position);
  for (const r of p.rekey) next.set(r.id, r.position);
  return [...next].map(([i, position]) => ({ id: i, position }));
};

describe('placeBetween', () => {
  it('places a row between two neighbours', () => {
    const p = placeBetween(level, 'x', 'a', 'b');
    expect(p).toMatchObject({ ok: true, rekey: [], index: 1, total: 4 });
    expect(order(apply(level, 'x', p))).toEqual(['a', 'x', 'b', 'c']);
  });

  it('places at the start (after = first) and at the end (both null)', () => {
    expect(order(apply(level, 'x', placeBetween(level, 'x', null, 'a')))).toEqual([
      'x',
      'a',
      'b',
      'c',
    ]);
    const end = placeBetween(level, 'x', null, null);
    expect(end).toMatchObject({ ok: true, index: 3, total: 4 });
    expect(order(apply(level, 'x', end))).toEqual(['a', 'b', 'c', 'x']);
  });

  it('places into an empty level', () => {
    const p = placeBetween([], 'x', null, null);
    expect(p).toMatchObject({ ok: true, rekey: [], index: 0, total: 1 });
  });

  it('moves a row within its own level (the row itself is ignored)', () => {
    const p = placeBetween(level, 'a', 'c', null);
    expect(order(apply(level, 'a', p))).toEqual(['b', 'c', 'a']);
  });

  it('prefers "before" when the neighbours are no longer next to each other', () => {
    const p = placeBetween(level, 'x', 'a', 'c');
    expect(order(apply(level, 'x', p))).toEqual(['a', 'x', 'b', 'c']);
  });

  it('refuses a neighbour that is not in the level', () => {
    expect(placeBetween(level, 'x', 'zzz', null)).toEqual({ ok: false, reason: 'neighbour' });
    expect(placeBetween(level, 'x', null, 'zzz')).toEqual({ ok: false, reason: 'neighbour' });
  });

  it('re-keys the level when the neighbours have equal keys', () => {
    const tied: Keyed[] = [
      { id: 'a', position: 'a0' },
      { id: 'b', position: 'a0' },
    ];
    const p = placeBetween(tied, 'x', 'a', 'b');
    expect(p.ok && p.rekey.length).toBeGreaterThan(0);
    expect(order(apply(tied, 'x', p))).toEqual(['a', 'x', 'b']);
  });

  it('re-keys the level when the new key would grow past 50 characters', () => {
    const long = 'a0' + 'V'.repeat(49);
    const rows: Keyed[] = [
      { id: 'a', position: long },
      { id: 'b', position: long + 'V' },
    ];
    const p = placeBetween(rows, 'x', 'a', 'b');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.position.length).toBeLessThanOrEqual(50);
    expect(p.rekey.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(order(apply(rows, 'x', p))).toEqual(['a', 'x', 'b']);
  });
});

describe('sortByName and edgeKey', () => {
  it('sorts A to Z without case, numbers naturally', () => {
    const rows = [
      { id: '1', name: 'suppliers' },
      { id: '2', name: 'Audit 10' },
      { id: '3', name: 'Audit 2' },
    ];
    expect(order(sortByName(rows))).toEqual(['3', '2', '1']);
  });

  it('puts a new row first or last', () => {
    expect(edgeKey(level, 'first') < 'a0').toBe(true);
    expect(edgeKey(level, 'last') > 'a2').toBe(true);
    expect(edgeKey([], 'first')).toBe('a0');
  });
});

describe('resolveFolder (sheets from a template)', () => {
  const folders = [
    { id: 'f1', name: 'Audit and CAPA' },
    { id: 'f2', name: 'Old', archived: true },
  ];

  it('reuses a folder with the same name, ignoring case', () => {
    expect(resolveFolder(folders, { folderId: null, folderName: 'audit and capa' })).toEqual({
      kind: 'existing',
      id: 'f1',
    });
  });

  it('creates the folder when none matches (archived folders do not count)', () => {
    expect(resolveFolder(folders, { folderId: null, folderName: 'Risk and controls' })).toEqual({
      kind: 'create',
      name: 'Risk and controls',
    });
    expect(resolveFolder(folders, { folderId: null, folderName: 'old' })).toEqual({
      kind: 'create',
      name: 'old',
    });
  });

  it('lets the person override: another folder or no folder', () => {
    expect(resolveFolder(folders, { folderId: 'f9', folderName: 'Audit and CAPA' })).toEqual({
      kind: 'existing',
      id: 'f9',
    });
    expect(resolveFolder(folders, { folderId: null, folderName: null })).toEqual({ kind: 'none' });
  });

  it('prefills the wizard field', () => {
    expect(templateFolderDefault(folders, 'AUDIT AND CAPA')).toEqual({ folderId: 'f1' });
    expect(templateFolderDefault(folders, 'Suppliers')).toEqual({ newFolder: 'Suppliers' });
    expect(templateFolderDefault(folders, undefined)).toBeNull();
  });
});

describe('organiseText', () => {
  const names: Record<string, string> = { f1: 'Operations', f2: 'Risk and controls' };
  const t = (action: string, oldValue: object | null, newValue: object | null) =>
    organiseText({ action, oldValue, newValue } as never, (id) => names[id]);
  const sheet = { name: 'Risk register', folder_id: 'f1', position: 'a0', archived_at: null };

  it('describes sheet moves, reorders and archiving', () => {
    expect(t('sheets.update', sheet, { ...sheet, folder_id: 'f2' })).toBe(
      'Moved Risk register from Operations to Risk and controls',
    );
    expect(t('sheets.update', sheet, { ...sheet, folder_id: null })).toBe(
      'Moved Risk register from Operations to Other sheets',
    );
    expect(t('sheets.update', sheet, { ...sheet, position: 'a1' })).toBe(
      'Reordered sheets in Operations',
    );
    expect(t('sheets.update', sheet, { ...sheet, archived_at: '2026-11-13' })).toBe(
      'Archived sheet Risk register',
    );
    expect(t('sheets.update', sheet, { ...sheet, name: 'Risks' })).toBe(
      'Renamed sheet Risk register to Risks',
    );
    expect(t('sheets.update', { ...sheet, folder_id: 'gone' }, sheet)).toBe(
      'Moved Risk register from a deleted folder to Operations',
    );
  });

  it('describes folder changes', () => {
    const f = { name: 'Suppliers', position: 'a0', archived_at: null };
    expect(t('folders.insert', null, f)).toBe('Created folder Suppliers');
    expect(t('folders.update', f, { ...f, archived_at: '2026-11-13' })).toBe(
      'Archived folder Suppliers',
    );
    expect(t('folders.update', { ...f, archived_at: '2026-11-13' }, f)).toBe(
      'Restored folder Suppliers',
    );
    expect(t('folders.update', f, { ...f, name: 'Vendors' })).toBe(
      'Renamed folder Suppliers to Vendors',
    );
    expect(t('folders.update', f, { ...f, position: 'Zz' })).toBe(
      'Reordered folders: moved Suppliers',
    );
    expect(t('folders.delete', f, null)).toBe('Deleted folder Suppliers');
  });
});

describe('the menu tree', () => {
  const tree = {
    folders: [
      {
        id: 'f1',
        name: 'Operations',
        sheets: [
          { id: 's1', name: 'Permits' },
          { id: 's2', name: 'Checks' },
        ],
      },
      { id: 'f2', name: 'Risk and controls', sheets: [] },
    ],
    unfiled: [{ id: 's3', name: 'Risk register' }],
  };

  it('moves a sheet into another folder with its neighbours', () => {
    const m = moveSheetInTree(tree, 's3', 'f2', 0);
    expect(m).toMatchObject({ before: null, after: null, index: 0, total: 1 });
    expect(m!.tree.folders[1]!.sheets.map((s) => s.id)).toEqual(['s3']);
    expect(m!.tree.unfiled).toEqual([]);
  });

  it('reorders within a level and moves out of folders', () => {
    expect(moveSheetInTree(tree, 's1', 'f1', 1)).toMatchObject({
      before: 's2',
      after: null,
      index: 1,
      total: 2,
    });
    const out = moveSheetInTree(tree, 's2', null, 0);
    expect(out).toMatchObject({ before: null, after: 's3', total: 2 });
    expect(locateSheet(out!.tree, 's2')).toMatchObject({ folderId: null, index: 0 });
  });

  it('does nothing when the place is the same or the folder is unknown', () => {
    expect(moveSheetInTree(tree, 's1', 'f1', 0)).toBeNull();
    expect(moveSheetInTree(tree, 's1', 'nope', 0)).toBeNull();
  });

  it('reorders folders', () => {
    const m = moveFolderInTree(tree, 'f1', 1);
    expect(m).toMatchObject({ before: 'f2', after: null, index: 1, total: 2 });
    expect(m!.tree.folders.map((f) => f.id)).toEqual(['f2', 'f1']);
    expect(moveFolderInTree(tree, 'f1', 0)).toBeNull();
    expect(levelOf(tree, null)).toBe(tree.unfiled);
  });
});
