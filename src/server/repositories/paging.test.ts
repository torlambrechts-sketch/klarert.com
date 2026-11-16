// The lists behind the side menu, Build › Design, dashboard sources, search, Evidence and My work read every page
// past the API's 1000-row cap (supabase/config.toml max_rows): a workspace with more than 1000 sheets, fields or
// automations loses none of them. The fake answers as PostgREST does, cap included.
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, many, MAX_ROWS, seqId } from '@/lib/fake-db.testing';

vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({ getSession: vi.fn() }));
vi.mock('@/server/apps/read', () => ({ getApps: vi.fn(async () => []) }));
vi.mock('@/server/design/drift', () => ({ readDrift: vi.fn() }));
vi.mock('@/server/repositories/approvals', () => ({ getMyApprovals: vi.fn(async () => []) }));
vi.mock('@/server/sheet-context', () => ({ newId: () => 'id' }));
const current: { db: unknown } = { db: null };
vi.mock('@/server/commands/context', () => ({
  withOrg: (_slug: string, _need: string, run: (ctx: unknown) => unknown) =>
    run({ supabase: current.db, orgId: 'o1', role: 'owner' }),
}));

const { readNav } = await import('./sheets');
const { fetchSheetMetas, listDashboards } = await import('./dashboards');
const { fetchEvidence } = await import('./evidence');
const { loadMyWork } = await import('./my-work');
const { readDesignLists } = await import('@/server/design/read');
const { search } = await import('@/server/commands/search');

const ORG = 'o1';
const paged = (requests: { range: [number, number] | null }[]) =>
  requests.every((r) => r.range !== null && r.range[1] - r.range[0] + 1 <= MAX_ROWS);

/** n live top-level sheets of the workspace; the last one is named "Zeta register". */
const sheets = (n: number) =>
  many(n, (i) => ({
    id: seqId('s', i),
    org_id: ORG,
    name: i === n - 1 ? 'Zeta register' : `Sheet ${i}`,
    item_label: 'Item',
    id_prefix: `S${i}`,
    is_library: false,
    parent_sheet_id: null,
    folder_id: null,
    position: `a${String(i).padStart(5, '0')}`,
    created_at: '2026-01-01T00:00:00Z',
    archived_at: null,
    settings: {},
  }));

const field = (i: number, sheetId: string) => ({
  id: seqId('f', i),
  org_id: ORG,
  sheet_id: sheetId,
  key: `f${i}`,
  name: `Field ${i}`,
  type: 'text',
  position: `a${String(i).padStart(5, '0')}`,
  width: 160,
  required: false,
  locked: false,
  description: null,
  config: {},
  validation: null,
  rules: null,
  visibility: null,
  restricted_to: null,
  field_hidden: false,
  system: false,
  archived_at: null,
});

describe('the side menu: readNav', () => {
  it('lists every sheet and every access row past 1000', async () => {
    const all = sheets(1500);
    const { db, requests } = fakeDb(
      { sheets: all, folders: [] },
      {
        my_sheet_access: () =>
          all.map((s) => ({
            sheet_id: s.id,
            name: s.name,
            folder_id: null,
            parent_sheet_id: null,
            position: s.position,
            archived_at: null,
            level: 'editor',
            restricted: s.name === 'Zeta register',
            own_setting: false,
          })),
      },
    );
    const nav = await readNav(db, ORG);
    expect(nav.unfiled).toHaveLength(1500);
    expect(nav.unfiled.at(-1)).toMatchObject({ name: 'Zeta register', restricted: true });
    expect(paged(requests)).toBe(true);
  });
});

describe('Build › Design: readDesignLists', () => {
  it('reads every sheet, field, form and automation of the workspace', async () => {
    const all = sheets(20);
    const { db, requests } = fakeDb({
      sheets: all,
      folders: [],
      fields: many(2500, (i) => field(i, all[i % 20]!.id)),
      views: many(1100, (i) => ({
        id: seqId('v', i),
        org_id: ORG,
        sheet_id: all[0]!.id,
        type: 'form',
        owner_id: null,
        name: `Form ${i}`,
        config: {},
        position: `a${i}`,
      })),
      automations: many(1200, (i) => ({
        id: seqId('a', i),
        org_id: ORG,
        sheet_id: all[0]!.id,
        created_at: '2026-01-01T00:00:00Z',
      })),
      pack_installs: [],
    });
    const lists = await readDesignLists(db, ORG);
    expect(lists.sheets).toHaveLength(20);
    expect(lists.fields).toHaveLength(2500);
    expect(lists.forms).toHaveLength(1100);
    expect(lists.automations).toHaveLength(1200);
    expect(paged(requests)).toBe(true);
  });
});

describe('dashboard sources', () => {
  it('fetchSheetMetas gives every sheet its fields and groups past 1000', async () => {
    const all = sheets(1100);
    const { db, requests } = fakeDb({
      sheets: all,
      fields: many(3000, (i) => field(i, all[i % 1100]!.id)),
      groups: many(1100, (i) => ({
        id: seqId('g', i),
        org_id: ORG,
        sheet_id: all[i]!.id,
        name: 'Open',
        color: 'grey',
        position: 'a0',
      })),
      memberships: [],
      teams: [],
      team_members: [],
      job_roles: [],
      entities: [],
      sites: [],
    });
    const { sheets: metas } = await fetchSheetMetas(db, ORG);
    expect(metas).toHaveLength(1100);
    const last = metas.find((m) => m.sheet.name === 'Zeta register')!;
    expect(last.fields.length).toBeGreaterThan(0);
    expect(last.groups).toHaveLength(1);
    expect(metas.reduce((n, m) => n + m.fields.length, 0)).toBe(3000);
    expect(paged(requests)).toBe(true);
  });

  it('listDashboards reads every page', async () => {
    const { db } = fakeDb({
      dashboards: many(1001, (i) => ({
        id: seqId('d', i),
        org_id: ORG,
        name: `Dashboard ${i}`,
        position: `a${String(i).padStart(5, '0')}`,
        config: { widgets: [] },
        updated_at: '2026-01-01T00:00:00Z',
        archived_at: null,
      })),
    });
    expect(await listDashboards(db, ORG)).toHaveLength(1001);
  });
});

describe('search', () => {
  it('finds a sheet by name wherever it sorts past 1000', async () => {
    const { db } = fakeDb({ sheets: sheets(1200), items: [], memberships: [] });
    current.db = db;
    const r = await search({ org: 'meridian', q: 'zeta' });
    expect(r.ok && r.data.sheets.map((s) => s.name)).toEqual(['Zeta register']);
  });
});

describe('Evidence', () => {
  it('keeps the files of a sheet that sorts past 1000', async () => {
    const all = sheets(1200);
    const last = all.at(-1)!;
    const { db } = fakeDb({
      sheets: all,
      files: [
        {
          id: 'file-1',
          org_id: ORG,
          item_id: 'it-1',
          field_id: null,
          filename: 'policy.pdf',
          source: 'upload',
          collected_at: '2026-01-01T00:00:00Z',
          valid_until: null,
          uploaded_by: null,
          replaced_by: null,
          archived_at: null,
        },
      ],
      items: [
        {
          id: 'it-1',
          sheet_id: last.id,
          display_id: 'Z-1',
          name: 'Access policy',
          archived_at: null,
        },
      ],
      fields: [],
      memberships: [],
      teams: [],
      team_members: [],
      job_roles: [],
      entities: [],
      sites: [],
    });
    const rows = await fetchEvidence(db, ORG);
    expect(rows.map((r) => [r.filename, r.sheet.name])).toEqual([['policy.pdf', 'Zeta register']]);
  });
});

describe('My work', () => {
  it('keeps an open request on a sheet that sorts past 1000', async () => {
    const all = sheets(1300);
    const last = all.at(-1)!;
    const { db } = fakeDb(
      {
        sheets: all,
        notifications: [
          {
            id: 'n-1',
            org_id: ORG,
            user_id: 'u-maria',
            kind: 'request',
            done_at: null,
            item_id: 'it-1',
            body: 'Please check the access policy',
            created_at: '2026-11-14T09:00:00Z',
          },
        ],
        items: [
          {
            id: 'it-1',
            org_id: ORG,
            sheet_id: last.id,
            group_id: 'g-1',
            seq: 1,
            display_id: 'Z-1',
            name: 'Access policy',
            values: {},
            position: 'a0',
            locked: false,
            lock_reason: null,
            created_by: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_by: null,
            updated_at: '2026-01-01T00:00:00Z',
            archived_at: null,
          },
        ],
        fields: [],
        groups: [],
        files: [],
        restricted_values: [],
        memberships: [],
        teams: [],
        team_members: [],
        job_roles: [],
        entities: [],
        sites: [],
      },
      { items_for_people: () => [] },
    );
    const { work } = await loadMyWork(db, ORG, 'u-maria', 'Europe/London');
    expect(work.rows.map((r) => [r.name, r.sheetName, r.requests.length])).toEqual([
      ['Access policy', 'Zeta register', 1],
    ]);
    expect(work.sheets.map((s) => s.name)).toEqual(['Zeta register']);
  });
});
