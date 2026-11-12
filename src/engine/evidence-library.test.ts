import { describe, expect, it } from 'vitest';
import {
  buildEvidenceLibrary,
  evidenceStatus,
  sourceLabel,
  validityDetail,
  type EvidenceRow,
} from './evidence-library';

const TODAY = '2026-11-11';

const row = (over: Partial<EvidenceRow> & { fileId: string }): EvidenceRow => ({
  filename: `${over.fileId}.pdf`,
  source: 'upload',
  collectedAt: '2026-01-01',
  validUntil: null,
  uploadedBy: 'Maria Pereira',
  item: { id: `i-${over.fileId}`, displayId: 'CA-001', name: 'Backup restore test' },
  sheet: { id: 's-1', name: 'Controls' },
  field: { id: 'f-ev', name: 'Evidence' },
  ...over,
});

describe('evidenceStatus', () => {
  it('reads no expiry, expired, expiring and valid', () => {
    expect(evidenceStatus(null, TODAY)).toBe('none');
    expect(evidenceStatus('2026-11-10', TODAY)).toBe('expired');
    expect(evidenceStatus('2026-11-11', TODAY)).toBe('expiring');
    expect(evidenceStatus('2026-12-11', TODAY)).toBe('expiring');
    expect(evidenceStatus('2026-12-12', TODAY)).toBe('valid');
  });

  it('words the time left', () => {
    expect(validityDetail(null, TODAY)).toBeNull();
    expect(validityDetail('2026-11-11', TODAY)).toBe('expires today');
    expect(validityDetail('2026-11-12', TODAY)).toBe('in 1 day');
    expect(validityDetail('2026-11-01', TODAY)).toBe('10 days ago');
  });

  it('labels sources', () => {
    expect(sourceLabel('upload')).toBe('Upload');
    expect(sourceLabel('form')).toBe('Form');
    expect(sourceLabel('connector:Microsoft 365')).toBe('Connector: Microsoft 365');
  });
});

describe('buildEvidenceLibrary', () => {
  const rows = [
    row({ fileId: 'a', validUntil: '2027-06-01' }),
    row({ fileId: 'b', validUntil: '2026-10-01' }),
    row({ fileId: 'c', validUntil: '2026-11-20', sheet: { id: 's-2', name: 'Assets' } }),
    row({ fileId: 'd', validUntil: null, filename: 'policy.docx' }),
  ];

  it('sorts expired first, counts per status and lists sheets', () => {
    const lib = buildEvidenceLibrary(rows, TODAY);
    expect(lib.shown.map((r) => r.fileId)).toEqual(['b', 'c', 'a', 'd']);
    expect(lib.counts).toEqual({ valid: 1, expiring: 1, expired: 1, none: 1 });
    expect(lib.sheets).toEqual([
      { id: 's-2', name: 'Assets', count: 1 },
      { id: 's-1', name: 'Controls', count: 3 },
    ]);
    expect(lib.shown[0]).toMatchObject({
      statusLabel: 'Expired',
      validUntilLabel: '1 Oct 2026',
      collectedLabel: '1 Jan 2026',
    });
  });

  it('filters by search, sheet and status; counts ignore the status filter', () => {
    const lib = buildEvidenceLibrary(rows, TODAY, { sheetId: 's-1', status: 'expired' });
    expect(lib.shown.map((r) => r.fileId)).toEqual(['b']);
    expect(lib.counts).toEqual({ valid: 1, expiring: 0, expired: 1, none: 1 });
    expect(buildEvidenceLibrary(rows, TODAY, { q: 'POLICY' }).shown.map((r) => r.fileId)).toEqual([
      'd',
    ]);
  });
});
