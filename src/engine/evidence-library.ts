// Evidence library (docs/05 §4): the current file versions of a workspace with their validity status, filters and
// counts. Pure: today is injected; the repository reads the rows under the person's RLS.
import { EXPIRING_DAYS } from './fields/evidence';
import { daysBetween, formatDate } from './fields/helpers';

export type EvidenceStatus = 'valid' | 'expiring' | 'expired' | 'none';

export const EVIDENCE_STATUSES: EvidenceStatus[] = ['valid', 'expiring', 'expired', 'none'];

export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = {
  valid: 'Valid',
  expiring: `Expiring within ${EXPIRING_DAYS} days`,
  expired: 'Expired',
  none: 'No expiry',
};

export const isEvidenceStatus = (s: unknown): s is EvidenceStatus =>
  typeof s === 'string' && (EVIDENCE_STATUSES as string[]).includes(s);

/** Valid, expiring within 30 days (today included), expired (before today) or no expiry date. */
export function evidenceStatus(validUntil: string | null, today: string): EvidenceStatus {
  if (!validUntil) return 'none';
  const left = daysBetween(validUntil, today);
  if (left < 0) return 'expired';
  return left <= EXPIRING_DAYS ? 'expiring' : 'valid';
}

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/** "in 12 days", "expires today", "3 days ago", or null without an expiry date. */
export function validityDetail(validUntil: string | null, today: string): string | null {
  if (!validUntil) return null;
  const left = daysBetween(validUntil, today);
  if (left === 0) return 'expires today';
  return left > 0 ? `in ${days(left)}` : `${days(-left)} ago`;
}

/** "Upload", "Form", "Connector: Microsoft 365". */
export function sourceLabel(source: string): string {
  if (source === 'upload') return 'Upload';
  if (source === 'form') return 'Form';
  if (source.startsWith('connector:')) return `Connector: ${source.slice('connector:'.length)}`;
  return source || 'Upload';
}

/** One current file as the library lists it. */
export interface EvidenceRow {
  fileId: string;
  filename: string;
  source: string;
  collectedAt: string;
  validUntil: string | null;
  uploadedBy: string | null;
  item: { id: string; displayId: string; name: string };
  sheet: { id: string; name: string };
  field: { id: string; name: string };
}

export interface EvidenceView extends EvidenceRow {
  status: EvidenceStatus;
  statusLabel: string;
  collectedLabel: string;
  validUntilLabel: string;
  /** "in 12 days" / "3 days ago"; null without an expiry. */
  validityDetail: string | null;
  sourceLabel: string;
}

export interface EvidenceFilter {
  q?: string | null;
  sheetId?: string | null;
  status?: EvidenceStatus | null;
}

export interface EvidenceLibrary {
  /** Rows matching search and sheet (every status), soonest expiry first. */
  rows: EvidenceView[];
  /** Rows matching search and sheet, per status: the tiles. */
  counts: Record<EvidenceStatus, number>;
  /** Rows matching every filter. */
  shown: EvidenceView[];
  /** Sheets that hold files, by name, with their file counts. */
  sheets: { id: string; name: string; count: number }[];
}

const STATUS_ORDER: Record<EvidenceStatus, number> = { expired: 0, expiring: 1, valid: 2, none: 3 };

function view(r: EvidenceRow, today: string): EvidenceView {
  const status = evidenceStatus(r.validUntil, today);
  return {
    ...r,
    status,
    statusLabel: EVIDENCE_STATUS_LABEL[status],
    collectedLabel: formatDate(r.collectedAt),
    validUntilLabel: r.validUntil ? formatDate(r.validUntil) : 'No expiry',
    validityDetail: validityDetail(r.validUntil, today),
    sourceLabel: sourceLabel(r.source),
  };
}

const matchesQuery = (r: EvidenceRow, q: string) =>
  !q ||
  [r.filename, r.item.name, r.item.displayId, r.sheet.name, r.field.name]
    .join('\n')
    .toLowerCase()
    .includes(q);

/** The library for a filter: expired first, then expiring, valid and no expiry; by expiry date, then file name. */
export function buildEvidenceLibrary(
  input: EvidenceRow[],
  today: string,
  filter: EvidenceFilter = {},
): EvidenceLibrary {
  const all = input
    .map((r) => view(r, today))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.validUntil ?? '').localeCompare(b.validUntil ?? '') ||
        a.filename.localeCompare(b.filename, 'en-GB'),
    );
  const sheetCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const r of all) {
    const s = sheetCounts.get(r.sheet.id) ?? { ...r.sheet, count: 0 };
    s.count += 1;
    sheetCounts.set(r.sheet.id, s);
  }
  const q = (filter.q ?? '').trim().toLowerCase();
  const rows = all.filter(
    (r) => matchesQuery(r, q) && (!filter.sheetId || r.sheet.id === filter.sheetId),
  );
  const counts: Record<EvidenceStatus, number> = { valid: 0, expiring: 0, expired: 0, none: 0 };
  for (const r of rows) counts[r.status] += 1;
  return {
    rows,
    counts,
    shown: filter.status ? rows.filter((r) => r.status === filter.status) : rows,
    sheets: [...sheetCounts.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-GB')),
  };
}
