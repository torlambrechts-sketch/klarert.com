// Files (docs/02 §8, docs/01 FR-30/31): storage paths, the accept list, checksums as hex and evidence freshness for
// display. Pure: the browser and the upload commands share these.
import { EXPIRING_DAYS, earliestValidUntil, freshness, type Freshness } from './fields/evidence';
import { addDays, daysBetween, formatDate } from './fields/helpers';
import type { FileRow } from './types';

/** The bucket's limit: 25 MB per file (0023_item_files.sql, decided with the product owner). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Lower-case hex of a digest (crypto.subtle.digest in the browser, node:crypto on the server). */
export function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export const isSha256 = (s: string) => /^[0-9a-f]{64}$/.test(s);

/**
 * A file name that is safe as the last part of a storage key: no folders, no control characters, only letters,
 * digits and `. _ - ( )` and spaces; at most 120 characters, keeping the extension.
 */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  let clean = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._\-() ]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s]+/, '')
    .trim();
  if (!clean || /^_+$/.test(clean)) clean = 'file';
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : '';
  return clean.slice(0, 120 - ext.length) + ext;
}

/** org/<org_id>/item/<item_id>/<file_id>/<filename> (docs/02 §8). */
export const storagePath = (orgId: string, itemId: string, fileId: string, filename: string) =>
  `org/${orgId}/item/${itemId}/${fileId}/${filename}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The workspace of an item file's storage path (storagePath's shape), or null for any other path. */
export function storagePathOrg(path: string): string | null {
  const [root, org, kind, item, file, ...name] = path.split('/');
  if (root !== 'org' || kind !== 'item' || !org || !UUID.test(org)) return null;
  if (!item || !file || name.length === 0 || name.some((p) => p === '')) return null;
  return org;
}

/** An upload that is never confirmed is removed once it is this old (docs/02 §8, the scheduler's hourly job). */
export const PENDING_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

/** An object in the files bucket that no `files` row holds yet, as the database lists it. */
export interface PendingUpload {
  orgId: string;
  path: string;
  /** When the object was last written (ISO). */
  writtenAt: string;
}

/**
 * Which pending uploads to remove now, by workspace: item-file paths of that workspace, written at least
 * PENDING_UPLOAD_MAX_AGE_MS before `now`, and not confirmed (`confirmed` holds the paths `files` rows hold; the
 * database already leaves those out, this checks again). Everything else stays: a path of another shape, a younger
 * upload that may still be confirmed, an object whose path names another workspace than the row says.
 */
export function stalePendingUploads(
  candidates: readonly PendingUpload[],
  now: Date,
  confirmed: ReadonlySet<string> = new Set(),
): Map<string, string[]> {
  const cutoff = now.getTime() - PENDING_UPLOAD_MAX_AGE_MS;
  const out = new Map<string, string[]>();
  for (const c of candidates) {
    const written = Date.parse(c.writtenAt);
    if (!Number.isFinite(written) || written > cutoff) continue;
    if (storagePathOrg(c.path) !== c.orgId || confirmed.has(c.path)) continue;
    out.set(c.orgId, [...(out.get(c.orgId) ?? []), c.path]);
  }
  return out;
}

/**
 * Whether the scheduler tick at `now` runs the hourly jobs: the first tick of each hour (the cron runs every 15
 * minutes, so a tick a few minutes late still counts, and a missed hour is caught up by the next).
 */
export const hourlyTick = (now: Date, everyMinutes = 15) => now.getUTCMinutes() < everyMinutes;

/**
 * Whether a file matches a field's accept list: extensions (".pdf"), MIME types ("application/pdf") or MIME
 * families ("image/*"). An empty list accepts everything.
 */
export function acceptsFile(accept: readonly string[], filename: string, mime: string): boolean {
  const rules = accept.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (rules.length === 0) return true;
  const name = filename.toLowerCase();
  const type = mime.toLowerCase();
  return rules.some((r) => {
    if (r.startsWith('.')) return name.endsWith(r);
    if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
    if (r.includes('/')) return type === r;
    return name.endsWith(`.${r}`);
  });
}

/** The accept attribute of a file input for the same list. */
export const acceptAttribute = (accept: readonly string[]) =>
  accept
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => (a.startsWith('.') || a.includes('/') ? a : `.${a}`))
    .join(',');

/** "12 KB", "3.4 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** valid_until of new evidence: the collection date plus the field's validDays. */
export const validUntilFor = (collectedAt: string, validDays: number) =>
  addDays(collectedAt, validDays);

export interface FreshnessView {
  freshness: Freshness;
  /** "Current", "Expiring", "Expired", "No files". */
  label: string;
  /** "Valid until 11 Nov 2026 · in 20 days", "Expired on 1 Nov 2026 · 10 days ago". */
  detail: string;
}

const LABELS: Record<Freshness, string> = {
  current: 'Current',
  expiring: 'Expiring',
  expired: 'Expired',
  none: 'No files',
};

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/** The freshness of a set of current evidence files, worded for the panel (docs/01 FR-31). */
export function freshnessView(rows: FileRow[] | null, today: string): FreshnessView {
  const f = freshness(rows, today);
  const exp = earliestValidUntil(rows);
  if (f === 'none') return { freshness: f, label: LABELS[f], detail: 'No evidence yet.' };
  if (!exp) return { freshness: f, label: LABELS[f], detail: 'No expiry date.' };
  const left = daysBetween(exp, today);
  const detail =
    left < 0
      ? `Expired on ${formatDate(exp)} · ${days(-left)} ago`
      : left === 0
        ? `Valid until ${formatDate(exp)} · expires today`
        : `Valid until ${formatDate(exp)} · in ${days(left)}`;
  return { freshness: f, label: LABELS[f], detail };
}

export { EXPIRING_DAYS };

/** Files of one field on one item: the current versions, each with its older versions newest first. */
export function fileVersions(
  rows: FileRow[],
  itemId: string,
  fieldId: string,
): { current: FileRow; older: FileRow[] }[] {
  const mine = rows.filter((r) => r.itemId === itemId && r.fieldId === fieldId);
  const byReplacement = new Map<string, FileRow>();
  for (const r of mine) if (r.replacedBy) byReplacement.set(r.replacedBy, r);
  return mine
    .filter((r) => !r.replacedBy)
    .map((current) => {
      const older: FileRow[] = [];
      const seen = new Set<string>([current.id]);
      let prev = byReplacement.get(current.id);
      while (prev && !seen.has(prev.id)) {
        older.push(prev);
        seen.add(prev.id);
        prev = byReplacement.get(prev.id);
      }
      return { current, older };
    });
}
