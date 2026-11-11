import { describe, expect, it } from 'vitest';
import {
  acceptAttribute,
  acceptsFile,
  fileVersions,
  formatBytes,
  freshnessView,
  safeFilename,
  storagePath,
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
