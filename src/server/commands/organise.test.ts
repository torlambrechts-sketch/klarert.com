// Folder and sheet organisation commands (folders.ts, sheets.ts): role checks, workspace checks, neighbours and the
// template folder. Supabase is replaced by a small in-memory fake that understands the queries these commands make.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./subitems', () => ({ setUpSubitems: vi.fn() }));
vi.mock('./two-way', () => ({ createInverseField: vi.fn() }));

type Row = Record<string, unknown>;
type Write = { table: string; op: string; patch: unknown; ids: unknown[] };

const ORG = 'o1';
const db = {
  role: 'admin' as string,
  tables: {} as Record<string, Row[]>,
  writes: [] as Write[],
  rpcs: [] as { name: string; args: unknown }[],
};

function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op = 'select';
  let patch: unknown;
  let single: 'one' | 'maybe' | null = null;
  let head = false;
  const b = {
    select(_cols?: string, opts?: { head?: boolean }) {
      if (opts?.head) head = true;
      return b;
    },
    eq(k: string, v: unknown) {
      if (!k.includes('.')) filters.push((r) => r[k] === v);
      return b;
    },
    neq(k: string, v: unknown) {
      filters.push((r) => r[k] !== v);
      return b;
    },
    is(k: string, v: unknown) {
      filters.push((r) => (r[k] ?? null) === v);
      return b;
    },
    in(k: string, vs: unknown[]) {
      filters.push((r) => vs.includes(r[k]));
      return b;
    },
    not(k: string, _op: string, v: unknown) {
      filters.push((r) => (r[k] ?? null) !== v);
      return b;
    },
    order: () => b,
    limit: () => b,
    update(p: unknown) {
      op = 'update';
      patch = p;
      return b;
    },
    insert(p: unknown) {
      op = 'insert';
      patch = p;
      return b;
    },
    delete() {
      op = 'delete';
      return b;
    },
    maybeSingle() {
      single = 'maybe';
      return b;
    },
    single() {
      single = 'one';
      return b;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  function run() {
    if (table === 'memberships')
      return { data: { role: db.role, orgs: { id: ORG, slug: 'acme' } }, error: null };
    const rows = (db.tables[table] ??= []);
    const hits = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'insert') {
      const row = { id: `new-${rows.length + 1}`, archived_at: null, ...(patch as Row) };
      rows.push(row);
      db.writes.push({ table, op, patch, ids: [row.id] });
      return { data: single ? row : [row], error: null };
    }
    if (op === 'update' || op === 'delete') {
      db.writes.push({ table, op, patch, ids: hits.map((r) => r.id) });
      for (const r of hits) {
        if (op === 'update') Object.assign(r, patch);
        else rows.splice(rows.indexOf(r), 1);
      }
      return { data: hits.map((r) => ({ id: r.id })), error: null };
    }
    const data = hits.map((r) =>
      table === 'sheets'
        ? {
            ...r,
            folders: db.tables.folders?.find((f) => f.id === r.folder_id) ?? null,
          }
        : { ...r },
    );
    if (head) return { count: data.length, data: null, error: null };
    if (single) return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }
  return b;
}

const fake = {
  from,
  rpc: async (name: string, args: unknown) => {
    db.rpcs.push({ name, args });
    return { data: 2, error: null };
  },
};

vi.mock('@/server/auth', () => ({
  getSession: async () => ({ supabase: fake, user: { id: 'u1' }, profile: { id: 'u1' } }),
  isAdminRole: (r: string) => r === 'owner' || r === 'admin',
  isEditorRole: (r: string) => r !== 'viewer',
}));

const { moveFolder, createFolder, renameFolder, sortFolderAZ, archiveFolder, restoreFolder } =
  await import('./folders');
const { moveSheet, renameSheet, archiveSheet, sheetFolder } = await import('./sheets');

const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';
const F3 = '33333333-3333-4333-8333-333333333333';
const OTHER = '99999999-9999-4999-8999-999999999999';
const S1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const S2 = 'aaaaaaaa-2222-4222-8222-222222222222';
const S3 = 'aaaaaaaa-3333-4333-8333-333333333333';
const CHILD = 'aaaaaaaa-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  db.role = 'admin';
  db.writes = [];
  db.rpcs = [];
  db.tables = {
    folders: [
      { id: F1, org_id: ORG, name: 'Operations', position: 'a0', archived_at: null },
      { id: F2, org_id: ORG, name: 'Audit and CAPA', position: 'a1', archived_at: null },
      { id: F3, org_id: ORG, name: 'Suppliers', position: 'a2', archived_at: null },
      { id: OTHER, org_id: 'o2', name: 'Elsewhere', position: 'a0', archived_at: null },
    ],
    sheets: [
      { id: S1, org_id: ORG, name: 'Permits', folder_id: F1, position: 'a0', archived_at: null, parent_sheet_id: null },
      { id: S2, org_id: ORG, name: 'Checks', folder_id: F1, position: 'a1', archived_at: null, parent_sheet_id: null },
      { id: S3, org_id: ORG, name: 'Risk register', folder_id: null, position: 'a2', archived_at: null, parent_sheet_id: null },
      { id: CHILD, org_id: ORG, name: 'Actions', folder_id: null, position: 'a3', archived_at: null, parent_sheet_id: S2 },
    ],
  };
});

const position = (table: string, id: string) =>
  db.tables[table]!.find((r) => r.id === id)!.position as string;

describe('folder commands are for owners and admins', () => {
  const ops = [
    () => createFolder({ org: 'acme', name: 'New' }),
    () => renameFolder({ org: 'acme', folderId: F1, name: 'Ops' }),
    () => moveFolder({ org: 'acme', folderId: F1, before: F2 }),
    () => sortFolderAZ({ org: 'acme', folderId: F1 }),
    () => archiveFolder({ org: 'acme', folderId: F1 }),
    () => restoreFolder({ org: 'acme', folderId: F1 }),
  ];

  it.each(['viewer', 'editor'])('refuses a %s', async (role) => {
    db.role = role;
    for (const op of ops) expect(await op()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(db.writes).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });

  it('lets an admin reorder: the key goes between the neighbours', async () => {
    const r = await moveFolder({ org: 'acme', folderId: F1, before: F2, after: F3 });
    expect(r).toEqual({ ok: true, data: { index: 1, total: 3 } });
    const p = position('folders', F1);
    expect(p > 'a1' && p < 'a2').toBe(true);
  });

  it('puts a new folder at the top when asked', async () => {
    const r = await createFolder({ org: 'acme', name: 'Risk and controls', at: 'first' });
    expect(r.ok).toBe(true);
    expect(db.tables.folders!.at(-1)).toMatchObject({ name: 'Risk and controls' });
    expect((db.tables.folders!.at(-1)!.position as string) < 'a0').toBe(true);
  });

  it('refuses a folder of another workspace and a stale neighbour', async () => {
    expect(await moveFolder({ org: 'acme', folderId: OTHER, before: F1 })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await moveFolder({ org: 'acme', folderId: F1, before: OTHER })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });

  it('re-keys the folders when keys collide', async () => {
    db.tables.folders![1]!.position = 'a0';
    db.tables.folders![2]!.position = 'a0';
    const r = await moveFolder({ org: 'acme', folderId: F1, before: F2, after: F3 });
    expect(r.ok).toBe(true);
    expect(db.writes.filter((w) => w.table === 'folders').length).toBeGreaterThan(1);
    const order = [F2, F1, F3].map((id) => position('folders', id));
    expect([...order].sort()).toEqual(order);
    expect(new Set(order).size).toBe(3);
  });

  it('sorts a folder A–Z', async () => {
    expect(await sortFolderAZ({ org: 'acme', folderId: F1 })).toEqual({ ok: true, data: { sorted: 2 } });
    expect(position('sheets', S2) < position('sheets', S1)).toBe(true);
  });

  it('archives through the RPC that archives the sheets with it', async () => {
    expect(await archiveFolder({ org: 'acme', folderId: F1 })).toEqual({ ok: true, data: { sheets: 2 } });
    expect(db.rpcs).toEqual([{ name: 'set_folder_archived', args: { p_folder: F1, p_archived: true } }]);
  });

  it('rejects bad input before anything else', async () => {
    expect(await moveFolder({ org: 'acme', folderId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    expect(await createFolder({ org: 'acme', name: '   ' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });
});

describe('sheet moves', () => {
  it('refuses a viewer', async () => {
    db.role = 'viewer';
    expect(await moveSheet({ org: 'acme', sheetId: S3, folderId: F1 })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await renameSheet({ org: 'acme', sheetId: S3, name: 'Risks' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('lets an editor move a sheet into a folder between neighbours', async () => {
    db.role = 'editor';
    const r = await moveSheet({ org: 'acme', sheetId: S3, folderId: F1, before: S1, after: S2 });
    expect(r).toEqual({ ok: true, data: { index: 1, total: 3, folderId: F1 } });
    const s = db.tables.sheets!.find((x) => x.id === S3)!;
    expect(s.folder_id).toBe(F1);
    expect((s.position as string) > 'a0' && (s.position as string) < 'a1').toBe(true);
  });

  it('moves a sheet out of folders to the end of Other sheets', async () => {
    db.role = 'editor';
    const r = await moveSheet({ org: 'acme', sheetId: S1, folderId: '' });
    expect(r).toMatchObject({ ok: true, data: { folderId: null, index: 1, total: 2 } });
  });

  it('refuses a folder of another workspace', async () => {
    db.role = 'editor';
    expect(await moveSheet({ org: 'acme', sheetId: S3, folderId: OTHER })).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: 'Folder not found.' },
    });
  });

  it('refuses a sub-item sheet', async () => {
    db.role = 'editor';
    expect(await moveSheet({ org: 'acme', sheetId: CHILD, folderId: F1 })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    expect(await renameSheet({ org: 'acme', sheetId: CHILD, name: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('rejects input without a folder field or with a bad neighbour id', async () => {
    expect(await moveSheet({ org: 'acme', sheetId: S3 })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    expect(await moveSheet({ org: 'acme', sheetId: S3, folderId: F1, before: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('archiving a sheet is for owners and admins', async () => {
    db.role = 'editor';
    expect(await archiveSheet({ org: 'acme', sheetId: S3, archived: 'true' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    db.role = 'owner';
    expect(await archiveSheet({ org: 'acme', sheetId: S3, archived: 'true' })).toEqual({
      ok: true,
      data: { archived: true },
    });
  });
});

describe('the folder of a sheet from a template', () => {
  const run = (v: { folderId: string | null; folderName?: string | null; startId?: string }) =>
    sheetFolder(fake as never, ORG, v);

  it('reuses a folder with the same name, ignoring case', async () => {
    expect(await run({ folderId: null, folderName: 'audit and capa', startId: 'capa' })).toEqual({
      ok: true,
      data: F2,
    });
    expect(db.writes).toEqual([]);
  });

  it('creates the start folder when it is missing (an editor may, in this path)', async () => {
    db.tables.folders = db.tables.folders!.filter((f) => f.id !== F2);
    const r = await run({ folderId: null, folderName: 'Audit and CAPA', startId: 'capa' });
    expect(r.ok).toBe(true);
    expect(db.writes).toMatchObject([{ table: 'folders', op: 'insert', patch: { name: 'Audit and CAPA' } }]);
  });

  it('only creates the start’s own folder', async () => {
    expect(await run({ folderId: null, folderName: 'Anything', startId: 'capa' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    expect(await run({ folderId: null, folderName: 'Anything', startId: 'tracker' })).toMatchObject({
      ok: false,
    });
    expect(db.writes).toEqual([]);
  });

  it('lets the person pick another folder or no folder', async () => {
    expect(await run({ folderId: F3, folderName: null, startId: 'capa' })).toEqual({ ok: true, data: F3 });
    expect(await run({ folderId: null, folderName: null, startId: 'capa' })).toEqual({ ok: true, data: null });
    expect(await run({ folderId: OTHER, startId: 'capa' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });
});
