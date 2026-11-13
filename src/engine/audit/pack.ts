// The audit pack (docs/11 Audit outputs): the tables that go into the zip, built from rows the server read under the
// person's session. Registers leave out the fields the person may not see (not even a "Restricted" column), the log
// extract masks restricted values, and the chain report says, per item, what verify_activity_chain found. Pure.
import { formatDateTime, isoDateInZone } from '../fields/helpers';
import { hiddenFor, visibleTextOf } from '../values';
import type { Ctx, Field, Item, Json } from '../types';

/** A file's bytes are put in the zip only up to these sizes; above them the index lists the file alone. */
export const AUDIT_FILE_LIMITS = { perFile: 10 * 1024 * 1024, total: 100 * 1024 * 1024 } as const;

/** A period, inclusive, YYYY-MM-DD in the workspace time zone. */
export interface Period {
  from: string;
  to: string;
}

export function inPeriod(instant: string, period: Period, timeZone: string): boolean {
  const day = isoDateInZone(instant, timeZone);
  return day >= period.from && day <= period.to;
}

/** A file or folder name that is safe in a zip on every system. */
export function zipName(name: string, fallback = 'file'): string {
  const clean = name
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100);
  return clean || fallback;
}

/** Names unique within one folder: "Risks", "Risks (2)". */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const count = (seen.get(k) ?? 0) + 1;
    seen.set(k, count);
    return count === 1 ? n : `${n} (${count})`;
  });
}

// ───────────────────────── registers ─────────────────────────

/** The fields a register export shows: hidden ones (restricted, or reading what the person cannot see) are left out. */
export function exportFields(fields: Field[], ctx: Ctx): Field[] {
  return fields.filter((f) => !f.hidden && !hiddenFor(f, ctx));
}

export function registerTable(
  items: Item[],
  fields: Field[],
  ctx: Ctx,
  groupName: (groupId: string) => string,
): string[][] {
  const cols = exportFields(fields, ctx);
  return [
    ['ID', 'Name', 'Group', ...cols.map((f) => f.name), 'Created', 'Last changed'],
    ...items
      .filter((i) => !i.archivedAt)
      .map((i) => [
        i.displayId,
        i.name,
        groupName(i.groupId),
        ...cols.map((f) => visibleTextOf(i, f, ctx)),
        formatDateTime(i.createdAt, ctx.timeZone),
        formatDateTime(i.updatedAt, ctx.timeZone),
      ]),
  ];
}

// ───────────────────────── evidence index ─────────────────────────

export interface EvidenceFile {
  fileId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
  validUntil: string | null;
  item: { displayId: string; name: string };
  sheetName: string;
  fieldName: string;
  /** The path inside the zip when the file itself is included. */
  zipPath?: string | null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Which files fit under the limits, smallest first, so the most files fit. */
export function filesToInclude(
  files: { fileId: string; sizeBytes: number }[],
  limits: { perFile: number; total: number } = AUDIT_FILE_LIMITS,
): Set<string> {
  const out = new Set<string>();
  let total = 0;
  for (const f of [...files].sort((a, b) => a.sizeBytes - b.sizeBytes)) {
    if (f.sizeBytes > limits.perFile || total + f.sizeBytes > limits.total) continue;
    total += f.sizeBytes;
    out.add(f.fileId);
  }
  return out;
}

export function evidenceTable(files: EvidenceFile[], timeZone: string): string[][] {
  return [
    [
      'File',
      'Sheet',
      'Item',
      'Field',
      'Uploaded by',
      'Uploaded at',
      'Valid until',
      'Size',
      'Bytes',
      'SHA-256',
      'Type',
      'In this pack',
    ],
    ...files.map((f) => [
      f.filename,
      f.sheetName,
      `${f.item.displayId} ${f.item.name}`,
      f.fieldName,
      f.uploadedBy,
      formatDateTime(f.uploadedAt, timeZone),
      f.validUntil ?? '',
      formatBytes(f.sizeBytes),
      String(f.sizeBytes),
      f.sha256,
      f.mimeType,
      f.zipPath ?? 'No (over the size limit or not included)',
    ]),
  ];
}

// ───────────────────────── activity log extract ─────────────────────────

export interface ActivityEntry {
  id: number;
  at: string;
  chainKey: string;
  itemId: string | null;
  sheetId: string | null;
  actorKind: string;
  actorId: string | null;
  action: string;
  fieldId: string | null;
  oldValue: Json | null;
  newValue: Json | null;
  note: string | null;
  prevHash: string;
  hash: string;
}

/** A logged value in words: restricted markers ({"$restricted": …}) read "Restricted". */
export function logValueText(v: Json | null): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) && '$restricted' in (x as object)
      ? 'Restricted'
      : x,
  );
}

export interface ActivityNames {
  person(id: string | null): string;
  item(id: string | null): string;
  sheet(id: string | null): string;
  field(id: string | null): string;
}

export function activityTable(
  entries: ActivityEntry[],
  names: ActivityNames,
  timeZone: string,
): string[][] {
  return [
    [
      'Entry',
      'At',
      'Sheet',
      'Item',
      'Actor',
      'Action',
      'Field',
      'Old value',
      'New value',
      'Note',
      'Chain',
      'Previous hash',
      'Hash',
    ],
    ...entries.map((e) => [
      String(e.id),
      formatDateTime(e.at, timeZone),
      names.sheet(e.sheetId),
      names.item(e.itemId),
      e.actorKind === 'user' ? names.person(e.actorId) : e.actorKind,
      e.action,
      names.field(e.fieldId),
      logValueText(e.oldValue),
      logValueText(e.newValue),
      e.note ?? '',
      e.chainKey,
      e.prevHash,
      e.hash,
    ]),
  ];
}

// ───────────────────────── chain verification ─────────────────────────

export interface ChainResult {
  chainKey: string;
  label: string;
  sheetName: string;
  /** null: the check could not run (the error says why). */
  ok: boolean | null;
  entries: number;
  firstBadId?: number | null;
  lastHash?: string | null;
  error?: string;
}

export interface ChainSummary {
  chains: number;
  ok: number;
  broken: number;
  failed: number;
  entries: number;
}

export function chainSummary(results: ChainResult[]): ChainSummary {
  return {
    chains: results.length,
    ok: results.filter((r) => r.ok === true).length,
    broken: results.filter((r) => r.ok === false).length,
    failed: results.filter((r) => r.ok === null).length,
    entries: results.reduce((n, r) => n + r.entries, 0),
  };
}

export function chainTable(results: ChainResult[]): string[][] {
  return [
    [
      'Chain',
      'Item or sheet',
      'Sheet',
      'Result',
      'Entries checked',
      'First bad entry',
      'Last hash',
    ],
    ...results.map((r) => [
      r.chainKey,
      r.label,
      r.sheetName,
      r.ok === true ? 'ok' : r.ok === false ? 'broken' : `not checked: ${r.error ?? 'error'}`,
      String(r.entries),
      r.firstBadId ? String(r.firstBadId) : '',
      r.lastHash ?? '',
    ]),
  ];
}

export const CHAIN_METHOD = [
  'Each item has its own chain in the activity log, and each sheet and the workspace one more.',
  'Every entry stores prev_hash (the hash of the entry before it in the same chain, "genesis" for the first) and',
  'hash = sha256(prev_hash | at (UTC, microseconds) | actor_kind | actor_id | action | field_id | old_value |',
  'new_value | note). The database writes both in the same transaction as the change; entries can be neither changed',
  'nor deleted.',
  'For this pack, verify_activity_chain was run on every chain in scope: it walks the whole chain from its first',
  'entry, recomputes each hash with the same function and compares prev_hash with the previous entry. It also checks',
  'every restricted value kept aside against the marker in the log. "ok" means every entry matched; "broken" names',
  'the first entry that did not. The whole chain is checked, not only the entries in the period.',
].join('\n');

// ───────────────────────── read me ─────────────────────────

export interface PackMeta {
  workspace: string;
  scope: string;
  period: Period;
  generatedAt: string;
  generatedBy: string;
  timeZone: string;
  files: string[];
  registers: number;
  evidence: { listed: number; included: number };
  entries: number;
  chains: ChainSummary;
  soa: string[];
  leftOut: string[];
}

export function packReadme(m: PackMeta): string {
  const lines = [
    'Audit pack',
    '',
    `Workspace: ${m.workspace}`,
    `Scope: ${m.scope}`,
    `Period: ${m.period.from} to ${m.period.to} (${m.timeZone})`,
    `Generated: ${formatDateTime(m.generatedAt, m.timeZone)} by ${m.generatedBy}`,
    '',
    'What is in it',
    ...(m.soa.length
      ? m.soa.map((s) => `- Statement of applicability: ${s} (CSV and a printable HTML page)`)
      : ['- No statement of applicability: no framework library is in scope.']),
    `- ${m.registers} registers as CSV, with the fields you can see`,
    `- Evidence index: ${m.evidence.listed} files listed, ${m.evidence.included} included (each file up to ${formatBytes(AUDIT_FILE_LIMITS.perFile)}, ${formatBytes(AUDIT_FILE_LIMITS.total)} in all)`,
    `- Activity log: ${m.entries} entries in the period`,
    `- Hash chains: ${m.chains.chains} checked, ${m.chains.ok} ok, ${m.chains.broken} broken${m.chains.failed ? `, ${m.chains.failed} not checked` : ''}`,
    '',
    'Access',
    'The pack holds only what the person who made it may see. Restricted sheets and restricted fields they are not',
    'listed on are left out; restricted values in the log read "Restricted".',
    ...(m.leftOut.length ? ['', 'Left out', ...m.leftOut.map((l) => `- ${l}`)] : []),
    '',
    'How the hash chains were checked',
    CHAIN_METHOD,
    '',
    'Files',
    ...m.files.map((f) => `- ${f}`),
  ];
  return lines.join('\n') + '\n';
}
