import { describe, expect, it } from 'vitest';
import {
  acceptAttribute,
  acceptsFile,
  fileVersions,
  formatBytes,
  freshnessView,
  hourlyTick,
  PENDING_UPLOAD_MAX_AGE_MS,
  safeFilename,
  stalePendingUploads,
  storagePath,
  storagePathOrg,
  toHex,
  validUntilFor,
} from './files';
import { makeFile } from './testing/fixtures';

describe('file helpers', () => {
  it('writes digests as lower-case hex', () => {
    expect(toHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff');
    expect(toHex(new Uint8Array([1, 2]).buffer)).toBe('0102');
  });

  it('makes file names safe for storage keys', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Users\\me\\Fire drill (May).pdf')).toBe('Fire drill (May).pdf');
    expect(safeFilename('Prüfbericht №5?.pdf')).toBe('Prufbericht No5_.pdf');
    expect(safeFilename('...')).toBe('file');
    const long = safeFilename(`${'x'.repeat(200)}.pdf`);
    expect(long).toHaveLength(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('builds the storage path', () => {
    expect(storagePath('o', 'i', 'f', 'a.pdf')).toBe('org/o/item/i/f/a.pdf');
  });

  it('checks the accept list', () => {
    expect(acceptsFile([], 'a.exe', 'application/x-msdownload')).toBe(true);
    expect(acceptsFile(['.pdf'], 'Report.PDF', 'application/pdf')).toBe(true);
    expect(acceptsFile(['image/*'], 'a.png', 'image/png')).toBe(true);
    expect(acceptsFile(['application/pdf', 'docx'], 'a.docx', '')).toBe(true);
    expect(acceptsFile(['.pdf', 'image/*'], 'a.txt', 'text/plain')).toBe(false);
    expect(acceptAttribute(['pdf', 'image/*', '.docx'])).toBe('.pdf,image/*,.docx');
  });

  it('formats sizes and evidence validity', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12_345)).toBe('12 KB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
    expect(validUntilFor('2026-11-11', 365)).toBe('2027-11-11');
  });
});

describe('freshnessView', () => {
  const at = (validUntil: string | null) => [makeFile({ itemId: 'i', fieldId: 'f', validUntil })];
  it.each([
    [null, 'none', 'No files', 'No evidence yet.'],
    [at(null), 'current', 'Current', 'No expiry date.'],
    [at('2027-03-01'), 'current', 'Current', 'Valid until 1 Mar 2027 · in 110 days'],
    [at('2026-12-01'), 'expiring', 'Expiring', 'Valid until 1 Dec 2026 · in 20 days'],
    [at('2026-11-11'), 'expiring', 'Expiring', 'Valid until 11 Nov 2026 · expires today'],
    [at('2026-11-10'), 'expired', 'Expired', 'Expired on 10 Nov 2026 · 1 day ago'],
  ] as const)('%o', (rows, freshness, label, detail) => {
    expect(freshnessView(rows ? [...rows] : null, '2026-11-11')).toEqual({
      freshness,
      label,
      detail,
    });
  });
});

describe('fileVersions', () => {
  it('groups older versions under the current one, newest first', () => {
    const v1 = makeFile({ id: 'v1', itemId: 'i', fieldId: 'f', replacedBy: 'v2' });
    const v2 = makeFile({ id: 'v2', itemId: 'i', fieldId: 'f', replacedBy: 'v3' });
    const v3 = makeFile({ id: 'v3', itemId: 'i', fieldId: 'f' });
    const other = makeFile({ id: 'o1', itemId: 'i', fieldId: 'f' });
    const elsewhere = makeFile({ id: 'x', itemId: 'j', fieldId: 'f' });
    expect(fileVersions([v1, v3, other, v2, elsewhere], 'i', 'f')).toEqual([
      { current: v3, older: [v2, v1] },
      { current: other, older: [] },
    ]);
  });
});

describe('abandoned uploads (the scheduler, hourly)', () => {
  const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
  const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
  const NOW = new Date('2026-11-15T12:05:00Z');
  const path = (org: string, file = 'f1') => storagePath(org, 'item-1', file, 'scan.pdf');

  it('storagePathOrg reads the workspace of an item file path only', () => {
    expect(storagePathOrg(path(ORG))).toBe(ORG);
    expect(storagePathOrg(`org/${ORG}/logo.png`)).toBeNull();
    expect(storagePathOrg(`org/not-a-uuid/item/i/f/a.pdf`)).toBeNull();
    expect(storagePathOrg(`org/${ORG}/item/i/f/`)).toBeNull();
    expect(storagePathOrg(`tmp/${ORG}/item/i/f/a.pdf`)).toBeNull();
  });

  it('picks uploads an hour old or more, by workspace, and leaves the rest', () => {
    const got = stalePendingUploads(
      [
        { orgId: ORG, path: path(ORG, 'old'), writtenAt: '2026-11-15T11:05:00Z' },
        { orgId: ORG, path: path(ORG, 'older'), writtenAt: '2026-11-14T09:00:00Z' },
        { orgId: OTHER, path: path(OTHER, 'old'), writtenAt: '2026-11-15T10:00:00Z' },
        // 59 minutes: may still be confirmed
        { orgId: ORG, path: path(ORG, 'young'), writtenAt: '2026-11-15T11:06:00Z' },
        // a path of another shape, or of another workspace than the row says
        { orgId: ORG, path: `org/${ORG}/elsewhere.pdf`, writtenAt: '2026-11-01T00:00:00Z' },
        { orgId: ORG, path: path(OTHER, 'x'), writtenAt: '2026-11-01T00:00:00Z' },
        { orgId: ORG, path: path(ORG, 'bad-date'), writtenAt: 'yesterday' },
        // confirmed meanwhile
        { orgId: ORG, path: path(ORG, 'kept'), writtenAt: '2026-11-01T00:00:00Z' },
      ],
      NOW,
      new Set([path(ORG, 'kept')]),
    );
    expect([...got.keys()]).toEqual([ORG, OTHER]);
    expect(got.get(ORG)).toEqual([path(ORG, 'old'), path(ORG, 'older')]);
    expect(got.get(OTHER)).toEqual([path(OTHER, 'old')]);
    expect(PENDING_UPLOAD_MAX_AGE_MS).toBe(60 * 60 * 1000);
  });

  it('runs on the first scheduler tick of each hour', () => {
    expect(hourlyTick(new Date('2026-11-15T12:00:00Z'))).toBe(true);
    expect(hourlyTick(new Date('2026-11-15T12:14:59Z'))).toBe(true);
    expect(hourlyTick(new Date('2026-11-15T12:15:00Z'))).toBe(false);
    expect(hourlyTick(new Date('2026-11-15T12:45:00Z'))).toBe(false);
  });
});
