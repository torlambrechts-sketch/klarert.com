// Pack commands (packs.ts): role checks, the previewed hash, blocked and installed plans, and the workspace check on
// archive. Supabase and the pack server module are replaced by small fakes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const ORG = 'o1';
const HASH = 'a'.repeat(64);
const state = {
  role: 'admin' as string,
  installs: [] as { id: string; org_id: string }[],
  rpcs: [] as { name: string; args: unknown }[],
  plan: {
    state: 'ready',
    preview: {
      conflicts: [] as string[],
      renamedPrefixes: [],
      warnings: [],
      sheets: [],
      frameworks: [],
      level: null,
      extendsLevel: null,
    },
    operations: [],
    payload: {},
  } as Record<string, unknown>,
  written: [] as unknown[],
};

function from(table: string) {
  const filters: [string, unknown][] = [];
  const b = {
    select: () => b,
    eq(k: string, v: unknown) {
      filters.push([k, v]);
      return b;
    },
    maybeSingle() {
      if (table === 'memberships')
        return Promise.resolve({
          data: { role: state.role, orgs: { id: ORG, slug: 'acme' } },
          error: null,
        });
      const hit = state.installs.find((r) =>
        filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v),
      );
      return Promise.resolve({ data: hit ?? null, error: null });
    },
  };
  return b;
}
const fake = {
  from,
  rpc: async (name: string, args: unknown) => {
    state.rpcs.push({ name, args });
    return { data: { sheets: 2, folders: 1, automations: 1, dashboards: 0 }, error: null };
  },
};

vi.mock('@/server/auth', () => ({
  getSession: async () => ({
    supabase: fake,
    user: { id: 'u1' },
    profile: { id: 'u1' },
    twoStep: { enrolled: false, level: 'aal1', needsCode: false },
  }),
  isAdminRole: (r: string) => r === 'owner' || r === 'admin',
  isEditorRole: (r: string) => r !== 'viewer',
}));

const manifest = { key: 'suppliers', sheets: [{ ref: 'supplier', name: 'Suppliers' }] };
/** Required packs the command installs first (docs/11 Extends). */
const firsts: { list: unknown[] } = { list: [] };
vi.mock('@/server/packs/install', () => ({
  readPack: async (_db: unknown, key: string) =>
    key === 'suppliers'
      ? { key, version: '1.0.0', title: 'Suppliers', description: '', hash: HASH, manifest }
      : key === 'core'
        ? { key, version: '1.0.0', title: 'Core registers', description: '', hash: HASH, manifest }
        : null,
  readCatalogue: async () => [],
  requiredFirst: async () => firsts.list,
  planInstall: async () => state.plan,
  writeInstall: async (_db: unknown, orgId: string, plan: unknown) => {
    state.written.push({ orgId, plan });
    return {
      ok: true,
      data: { installId: 'i1', refMap: { 'sheet:supplier': 's1' }, counts: { sheets: 1 } },
    };
  },
}));

const { previewPack, installPack, archivePack } = await import('./packs');

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  state.role = 'admin';
  state.installs = [
    { id: '11111111-1111-4111-8111-111111111111', org_id: ORG },
    { id: '22222222-2222-4222-8222-222222222222', org_id: 'o2' },
  ];
  state.rpcs = [];
  state.written = [];
  state.plan = {
    state: 'ready',
    preview: {
      conflicts: [],
      renamedPrefixes: [],
      warnings: [],
      sheets: [],
      frameworks: [],
      level: null,
      extendsLevel: null,
    },
    operations: [],
    payload: {},
  };
});

describe('pack commands', () => {
  it.each(['editor', 'viewer'])(
    'refuse a %s: preview, install and archive are for owners and admins',
    async (role) => {
      state.role = role;
      for (const r of [
        await previewPack({ org: 'acme', key: 'suppliers' }),
        await installPack({ org: 'acme', key: 'suppliers', hash: HASH }),
        await archivePack({ org: 'acme', installId: '11111111-1111-4111-8111-111111111111' }),
      ])
        expect(r).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(state.written).toEqual([]);
      expect(state.rpcs).toEqual([]);
    },
  );

  it('check the input before anything else', async () => {
    expect(await installPack({ org: 'acme', key: 'Suppliers!', hash: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    expect(await archivePack({ org: 'acme', installId: 'not-a-uuid' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });

  it('install only the manifest that was previewed', async () => {
    const r = await installPack({ org: 'acme', key: 'suppliers', hash: 'b'.repeat(64) });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: 'conflict',
        message: 'This pack changed since you previewed it. Preview it again.',
      },
    });
    expect(state.written).toEqual([]);
  });

  it('install a ready plan into the person’s own workspace and return the first sheet', async () => {
    const r = await installPack({ org: 'acme', key: 'suppliers', hash: HASH });
    expect(r).toEqual({
      ok: true,
      data: {
        installId: 'i1',
        title: 'Suppliers',
        sheetId: 's1',
        counts: { sheets: 1 },
        renamedPrefixes: [],
        warnings: [],
        adopted: [],
        level: null,
        extended: false,
        installedFirst: [],
      },
    });
    expect(state.written).toEqual([{ orgId: ORG, plan: state.plan }]);
  });

  it('install the packs it requires first (install order does not matter)', async () => {
    firsts.list = [
      {
        key: 'core',
        title: 'Core registers',
        version: '1.0.0',
        level: 'starter',
        levelName: 'Starter',
        raise: false,
      },
    ];
    try {
      const r = await installPack({ org: 'acme', key: 'suppliers', hash: HASH });
      expect(r).toMatchObject({
        ok: true,
        data: { installedFirst: ['Core registers 1.0.0 (Starter)'] },
      });
      // Core first, then the pack, each in its own transaction
      expect(state.written).toHaveLength(2);
    } finally {
      firsts.list = [];
    }
  });

  it('refuse a blocked or already installed plan without writing', async () => {
    state.plan = {
      ...state.plan,
      state: 'blocked',
      preview: {
        conflicts: ['Install the pack "base" (^1.0.0) first.'],
        renamedPrefixes: [],
        warnings: [],
      },
    };
    expect(await installPack({ org: 'acme', key: 'suppliers', hash: HASH })).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: 'Install the pack "base" (^1.0.0) first.' },
    });
    state.plan = { ...state.plan, state: 'installed' };
    expect(await installPack({ org: 'acme', key: 'suppliers', hash: HASH })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(state.written).toEqual([]);
  });

  it('say when a pack is not in the catalogue', async () => {
    expect(await previewPack({ org: 'acme', key: 'gone' })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('archive only an install of the person’s workspace', async () => {
    expect(
      await archivePack({ org: 'acme', installId: '22222222-2222-4222-8222-222222222222' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(state.rpcs).toEqual([]);
    const r = await archivePack({ org: 'acme', installId: '11111111-1111-4111-8111-111111111111' });
    expect(r).toMatchObject({ ok: true, data: { counts: { sheets: 2 } } });
    expect(state.rpcs).toEqual([
      { name: 'archive_pack', args: { p_install: '11111111-1111-4111-8111-111111111111' } },
    ]);
  });
});
