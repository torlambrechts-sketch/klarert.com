// The scheduler's lists read every page past the API's 1000-row cap (supabase/config.toml max_rows): the
// cross-workspace lists of the cron route (service role) must never skip a workspace, and the per-workspace lists
// must never drop a sheet, an automation, a pause or an archived item. The fake answers as PostgREST does, cap included.
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, many, MAX_ROWS, seqId } from '@/lib/fake-db.testing';

vi.mock('server-only', () => ({}));
vi.mock('@/server/automations', () => ({ runAutomations: vi.fn() }));
vi.mock('@/server/sheet-context', () => ({ newId: () => 'id' }));

const { workspacesWithRetention, liveSheetSettings, archivedItems } =
  await import('./retention-checks');
const { workspacesWithDateChecks, scheduledAutomations, liveSheetIds, pausedPairs } =
  await import('./date-checks');

const RULE = {
  id: 'dsr3y',
  name: 'Requests: 3 years after closing',
  from: { kind: 'created' },
  period: { n: 3, unit: 'years' },
  action: 'erase',
};

const paged = (requests: { range: [number, number] | null }[]) =>
  requests.every((r) => r.range !== null && r.range[1] - r.range[0] + 1 <= MAX_ROWS);

describe('retention: workspacesWithRetention (service role, every workspace)', () => {
  it('finds every workspace with a rule when more than 1000 sheets have retention settings', async () => {
    // 2400 sheets in 2400 workspaces; a third have an empty rule list (settings kept, rules removed)
    const sheets = many(2400, (i) => ({
      id: seqId('s', i),
      org_id: seqId('o', i),
      archived_at: null,
      settings: { retention: { rules: i % 3 === 0 ? [] : [RULE] } },
    }));
    const { db, requests } = fakeDb({ sheets });
    const orgs = await workspacesWithRetention(db);
    expect(orgs).toHaveLength(1600);
    expect(orgs).toContain(seqId('o', 2399));
    expect(requests).toHaveLength(3);
    expect(paged(requests)).toBe(true);
  });

  it('leaves out archived sheets and sheets without rules, once per workspace', async () => {
    const { db } = fakeDb({
      sheets: [
        { id: 's1', org_id: 'o1', archived_at: null, settings: { retention: { rules: [RULE] } } },
        { id: 's2', org_id: 'o1', archived_at: null, settings: { retention: { rules: [RULE] } } },
        {
          id: 's3',
          org_id: 'o2',
          archived_at: '2026-01-01',
          settings: { retention: { rules: [RULE] } },
        },
        { id: 's4', org_id: 'o3', archived_at: null, settings: {} },
      ],
    });
    expect(await workspacesWithRetention(db)).toEqual(['o1']);
  });
});

describe('retention: per-workspace lists', () => {
  it('liveSheetSettings reads every live sheet of the workspace', async () => {
    const sheets = [
      ...many(1500, (i) => ({ id: seqId('s', i), org_id: 'o1', archived_at: null, settings: {} })),
      { id: 'x', org_id: 'o2', archived_at: null, settings: {} },
      { id: 'y', org_id: 'o1', archived_at: '2026-01-01', settings: {} },
    ];
    const { db, requests } = fakeDb({ sheets });
    const got = await liveSheetSettings(db, 'o1');
    expect(got).toHaveLength(1500);
    expect(paged(requests)).toBe(true);
  });

  it('archivedItems reads every archived item of the sheet, past 1000', async () => {
    const item = (i: number, archived: string | null) => ({
      id: seqId('i', i),
      sheet_id: 's1',
      group_id: 'g1',
      seq: i,
      display_id: `R-${i}`,
      name: `Record ${i}`,
      values: {},
      position: 'a0',
      locked: false,
      lock_reason: null,
      created_by: null,
      created_at: '2020-01-01T00:00:00Z',
      updated_by: null,
      updated_at: '2020-01-01T00:00:00Z',
      archived_at: archived,
    });
    const items = [
      ...many(2100, (i) => item(i, '2021-01-01T00:00:00Z')),
      ...many(5, (i) => item(5000 + i, null)),
    ];
    const { db, requests } = fakeDb({ items });
    const got = await archivedItems(db, 's1');
    expect(got).toHaveLength(2100);
    expect(got.at(-1)?.displayId).toBe('R-2099');
    expect(requests).toHaveLength(3);
  });
});

describe('date checks: the scheduler lists', () => {
  const auto = (i: number, org: string, more: Record<string, unknown> = {}) => ({
    id: seqId('a', i),
    org_id: org,
    sheet_id: 's1',
    enabled: true,
    mode: 'live',
    created_at: '2026-01-01T00:00:00Z',
    trigger: { type: 'date_arrives', fieldKey: 'due' },
    conditions: [],
    ...more,
  });

  it('workspacesWithDateChecks finds every workspace past 1000 automations', async () => {
    const automations = [
      ...many(1200, (i) => auto(i, seqId('o', i))),
      auto(9000, 'o-off', { enabled: false }),
      auto(9001, 'o-change', { trigger: { type: 'item_created' } }),
    ];
    const { db, requests } = fakeDb({ automations });
    const orgs = await workspacesWithDateChecks(db);
    expect(orgs).toHaveLength(1200);
    expect(orgs).not.toContain('o-off');
    expect(orgs).not.toContain('o-change');
    expect(paged(requests)).toBe(true);
  });

  it('scheduledAutomations and liveSheetIds read every page of one workspace', async () => {
    const { db } = fakeDb({
      automations: many(1300, (i) => auto(i, 'o1')),
      sheets: many(1700, (i) => ({ id: seqId('s', i), org_id: 'o1', archived_at: null })),
    });
    expect(await scheduledAutomations(db, 'o1')).toHaveLength(1300);
    expect(await liveSheetIds(db, 'o1')).toHaveLength(1700);
  });

  it('pausedPairs asks for the automations in parts and reads every page of each', async () => {
    const ids = many(400, (i) => seqId('a', i));
    // 1500 pauses on the first automation alone, one on the last
    const pauses = [
      ...many(1500, (i) => ({ org_id: 'o1', automation_id: ids[0], item_id: seqId('i', i) })),
      { org_id: 'o1', automation_id: ids[399], item_id: 'i-last' },
      { org_id: 'o2', automation_id: ids[1], item_id: 'i-other-workspace' },
    ];
    const { db, requests } = fakeDb({ automation_pauses: pauses });
    const got = await pausedPairs(db, 'o1', ids);
    expect(got.size).toBe(1501);
    expect(got.has(`${ids[399]}:i-last`)).toBe(true);
    expect(got.has(`${ids[1]}:i-other-workspace`)).toBe(false);
    // 3 parts of at most 150 ids; the first takes two pages
    expect(requests).toHaveLength(4);
  });
});
