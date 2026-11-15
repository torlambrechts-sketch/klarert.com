// The audit reads of the workspace chain (owner decision 15 Nov 2026): the audit pack's workspace entries read every
// page past the API's 1000-row cap, and the Exports list reads a page of exports at a time, newest first, with a
// cursor to the next. The fake answers as PostgREST does, cap included.
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, many, MAX_ROWS } from '@/lib/fake-db.testing';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'http://localhost' } }));
vi.mock('@/server/frameworks/catalogue', () => ({ readFrameworks: vi.fn() }));
vi.mock('@/server/frameworks/workspace', () => ({ linksAround: vi.fn() }));
vi.mock('@/server/sheet-context', () => ({ newId: () => 'id' }));

const { readActivity, readExports, readWorkspaceActivity } = await import('./read');

const ORG = 'o1';
const entry = (id: number, more: Record<string, unknown> = {}) => ({
  id,
  org_id: ORG,
  at: '2026-06-01T10:00:00Z',
  chain_key: `sheet:${ORG}`,
  item_id: null,
  sheet_id: null,
  actor_kind: 'user',
  actor_id: 'u-maria',
  action: 'pack.settings_changed',
  field_id: null,
  old_value: null,
  new_value: {},
  note: null,
  prev_hash: 'p',
  hash: `h${id}`,
  ...more,
});
const PERIOD = { from: '2026-01-01', to: '2026-12-31' };

describe('readWorkspaceActivity', () => {
  it('reads every workspace entry of the period past 1000, and nothing else', async () => {
    const { db, requests } = fakeDb({
      activity_log: [
        ...many(2300, (i) => entry(i + 1)),
        entry(5000, { chain_key: 'i-1', item_id: 'i-1', sheet_id: 's-1' }),
        entry(5001, { at: '2025-06-01T10:00:00Z' }),
        entry(5002, { org_id: 'o2', chain_key: 'sheet:o2' }),
      ],
    });
    const got = await readWorkspaceActivity(db, ORG, PERIOD);
    expect(got).toHaveLength(2300);
    expect(got.at(-1)).toMatchObject({ id: 2300, chainKey: 'sheet:o1', sheetId: null });
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.range && r.range[1] - r.range[0] + 1 <= MAX_ROWS)).toBe(true);
  });
});

describe('readActivity', () => {
  it('reads every entry of the sheets past 1000, oldest first', async () => {
    const { db } = fakeDb({
      activity_log: [
        ...many(1500, (i) =>
          entry(3000 - i, { chain_key: 'i-1', item_id: 'i-1', sheet_id: 's-1' }),
        ),
        entry(1, {}),
      ],
    });
    const got = await readActivity(db, ORG, ['s-1'], PERIOD);
    expect(got).toHaveLength(1500);
    expect(got[0]!.id).toBeLessThan(got[1]!.id);
  });
});

describe('readExports', () => {
  it('a page of audit exports, newest first, with the cursor to the next', async () => {
    const { db } = fakeDb({
      activity_log: [
        ...many(120, (i) =>
          entry(i + 1, { action: 'audit.exported', new_value: { kind: 'soa.csv' } }),
        ),
        entry(500, { action: 'pack.installed' }),
        entry(501, { action: 'audit.exported', org_id: 'o2', chain_key: 'sheet:o2' }),
      ],
    });
    const first = await readExports(db, ORG);
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0]).toMatchObject({ id: 120, newValue: { kind: 'soa.csv' } });
    expect(first.next).toBe(71);
    const second = await readExports(db, ORG, { before: first.next! });
    expect(second.entries[0]!.id).toBe(70);
    const third = await readExports(db, ORG, { before: second.next! });
    expect(third.entries.map((e) => e.id)).toEqual(many(20, (i) => 20 - i));
    expect(third.next).toBeNull();
  });
});
