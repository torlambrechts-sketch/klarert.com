// The hourly cleanup of abandoned uploads (security review 9.1 item 2): what the database lists is checked again,
// removed through the Storage API in batches, and summed up per workspace.
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/sheet-query';

vi.mock('server-only', () => ({}));
const { removeStalePendingUploads } = await import('./pending-uploads');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-15T12:02:00Z');
const path = (org: string, i: number) => `org/${org}/item/it-1/f-${i}/scan.pdf`;

function fake(
  rows: { org_id: string; name: string; written_at: string }[],
  refuse = new Set<string>(),
) {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  const removed: string[][] = [];
  const remove = vi.fn(async (paths: string[]) => {
    removed.push(paths);
    if (paths.some((p) => refuse.has(p))) return { data: null, error: { message: 'denied' } };
    return { data: paths.map((name) => ({ name })), error: null };
  });
  const db = { rpc, storage: { from: (bucket: string) => ({ bucket, remove }) } } as unknown as Db;
  return { db, rpc, removed };
}

describe('removeStalePendingUploads', () => {
  it('asks the database for uploads older than an hour and removes them per workspace', async () => {
    const rows = [
      ...Array.from({ length: 230 }, (_, i) => ({
        org_id: A,
        name: path(A, i),
        written_at: '2026-11-15T10:00:00Z',
      })),
      { org_id: B, name: path(B, 1), written_at: '2026-11-15T09:00:00Z' },
      // younger than an hour: the database would not list it; listed anyway, it stays
      { org_id: B, name: path(B, 2), written_at: '2026-11-15T11:30:00Z' },
    ];
    const { db, rpc, removed } = fake(rows);
    const got = await removeStalePendingUploads(db, NOW);
    expect(rpc).toHaveBeenCalledWith('stale_pending_uploads', {
      p_before: NOW.toISOString(),
      p_limit: 500,
    });
    expect(got).toEqual([
      { orgId: A, removed: 230, failed: 0 },
      { orgId: B, removed: 1, failed: 0 },
    ]);
    // batches of at most 100 paths, never a path of another workspace in a batch
    expect(removed.map((b) => b.length)).toEqual([100, 100, 30, 1]);
    expect(removed.flat()).not.toContain(path(B, 2));
  });

  it('counts a refused batch as failed and carries on with the next workspace', async () => {
    const { db } = fake(
      [
        { org_id: A, name: path(A, 1), written_at: '2026-11-15T09:00:00Z' },
        { org_id: B, name: path(B, 1), written_at: '2026-11-15T09:00:00Z' },
      ],
      new Set([path(A, 1)]),
    );
    expect(await removeStalePendingUploads(db, NOW)).toEqual([
      { orgId: A, removed: 0, failed: 1 },
      { orgId: B, removed: 1, failed: 0 },
    ]);
  });

  it('does nothing when nothing is abandoned', async () => {
    const { db, removed } = fake([]);
    expect(await removeStalePendingUploads(db, NOW)).toEqual([]);
    expect(removed).toEqual([]);
  });
});
