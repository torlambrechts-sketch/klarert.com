import { describe, expect, it } from 'vitest';
import { fakeDb, many, MAX_ROWS, seqId } from './fake-db.testing';
import { basicCtx } from '@/engine/context';
import { rowsToItems } from '@/engine/fields/csv';
import '@/engine/fields/registry';
import { fetchAllPages, fetchDirectory, fetchLiveSheets, fetchPeople } from './sheet-query';

// fetchAllPages reads a list past the API's 1000-row cap (supabase/config.toml max_rows): a page at a time until a
// short page, so a workspace with more than 1000 sheets still offers every one of them in a sheet picker.

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));

function source(all: { id: string }[]) {
  const asked: [number, number][] = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    return { data: all.slice(from, to + 1), error: null };
  };
  return { asked, page };
}

describe('fetchAllPages', () => {
  it('reads one short page once', async () => {
    const s = source(rows(3));
    expect(await fetchAllPages(s.page)).toHaveLength(3);
    expect(s.asked).toEqual([[0, 999]]);
  });

  it('reads past 1000 rows, page by page, until a short page', async () => {
    const s = source(rows(2345));
    const got = await fetchAllPages(s.page);
    expect(got).toHaveLength(2345);
    expect(got.at(-1)).toEqual({ id: 's2344' });
    expect(s.asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks once more after a full last page and stops at the empty one', async () => {
    const s = source(rows(2000));
    expect(await fetchAllPages(s.page)).toHaveLength(2000);
    expect(s.asked).toHaveLength(3);
  });

  it('throws the error of a page', async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: 'permission denied' } })),
    ).rejects.toThrow('permission denied');
  });
});

describe('fetchDirectory and fetchLiveSheets', () => {
  it('reads every member, team membership and live sheet past 1000', async () => {
    const people = many(1300, (i) => ({
      org_id: 'o1',
      user_id: seqId('u', i),
      profiles: { id: seqId('u', i), display_name: `Person ${i}`, initials: 'PP', color: 'blue' },
    }));
    const { db, requests } = fakeDb({
      memberships: [...people, { org_id: 'o2', user_id: 'u-other', profiles: null }],
      teams: [{ id: 't1', org_id: 'o1', name: 'Quality' }],
      team_members: many(1200, (i) => ({ org_id: 'o1', team_id: 't1', user_id: seqId('u', i) })),
      job_roles: [],
      entities: [],
      sites: [],
      sheets: [
        ...many(2100, (i) => ({
          id: seqId('s', i),
          org_id: 'o1',
          name: `S${i}`,
          archived_at: null,
        })),
        { id: 's-archived', org_id: 'o1', name: 'Old', archived_at: '2026-01-01' },
      ],
    });
    const dir = await fetchDirectory(db, 'o1');
    expect(dir.people).toHaveLength(1300);
    expect(dir.teams[0]!.memberIds).toHaveLength(1200);
    const live = await fetchLiveSheets(db, 'o1');
    expect(live).toHaveLength(2100);
    expect(live.some((s) => s.id === 's-archived')).toBe(false);
    expect(requests.every((r) => r.range && r.range[1] - r.range[0] + 1 <= MAX_ROWS)).toBe(true);
  });
});

describe('fetchPeople (the CSV importer’s people)', () => {
  it('reads every member past 1000, so a people column matches the 1400th person by name', async () => {
    const members = many(1500, (i) => ({
      org_id: 'o1',
      user_id: seqId('u', i),
      profiles: { id: seqId('u', i), display_name: `Person ${i}`, initials: 'PP', color: 'blue' },
    }));
    const { db, requests } = fakeDb({ memberships: members });
    const people = await fetchPeople(db, 'o1');
    expect(people).toHaveLength(1500);
    expect(requests).toHaveLength(2);
    // what importCsv does with them (src/server/commands/sheets.ts)
    const ctx = basicCtx({
      today: '2026-11-15',
      now: new Date('2026-11-15T12:00:00Z'),
      timeZone: 'UTC',
      userId: seqId('u', 0),
      sheet: {
        id: 's1',
        orgId: 'o1',
        name: 'Import',
        itemLabel: 'Item',
        idPrefix: 'IMP-',
        isLibrary: false,
      },
      people,
      newId: (p) => `${p}_1`,
    });
    const { items, skippedCells } = rowsToItems(
      { header: ['Name', 'Owner'], rows: [['Row 1', 'Person 1400']] },
      [{ index: 1, fieldId: 'f-owner', type: 'people', config: { multiple: true } }],
      ctx,
    );
    expect(skippedCells).toBe(0);
    expect(items[0]!.values['f-owner']).toEqual([seqId('u', 1400)]);
  });
});
