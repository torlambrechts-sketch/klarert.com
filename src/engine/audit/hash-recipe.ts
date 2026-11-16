// What an auditor needs to recompute an activity log hash from the audit pack's log.csv alone (docs/02 §6, security
// review 9.1 item 3): the columns that hold each hashed input exactly as the database hashed it, the recipe in words
// (activity/method.txt) and the recipe as code, which the unit test checks against hashes the database made. Pure:
// the caller hashes the returned string with SHA-256.
import { unescapeFormula } from './csv';

/**
 * The raw columns at the end of activity/log.csv, named as the database names them. With "Previous hash", "Action",
 * "Chain" and "Hash" they are every input of activity_hash (v1) and activity_hash_v2 (v2).
 */
export const HASH_COLUMNS = [
  'org_id',
  'sheet_id',
  'item_id',
  'chain_seq',
  'hash_v',
  'at_utc',
  'actor_kind',
  'actor_id',
  'field_id',
  'old_value_json',
  'new_value_json',
  'note_json',
] as const;

/** What the CSV calls the other hashed columns. */
export const HASH_INPUT_HEADERS = {
  prevHash: 'Previous hash',
  action: 'Action',
  chainKey: 'Chain',
  hash: 'Hash',
} as const;

const TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * An instant as the hash has it: UTC with six decimals, `YYYY-MM-DDTHH:MM:SS.ffffffZ` (Postgres
 * `to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`). Takes the timestamp text the API returns
 * (any offset, up to six decimals, trailing zeros dropped) without losing the microseconds a JavaScript Date drops.
 */
export function hashTime(at: string): string {
  const m = TIME.exec(at.trim());
  if (!m) throw new Error(`not a timestamp: ${at}`);
  const [, y, mo, d, h, mi, s, frac = '', zone = 'Z'] = m;
  let offsetMin = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || '0'));
  }
  const ms = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!) - offsetMin * 60_000;
  const t = new Date(ms).toISOString(); // whole seconds: YYYY-MM-DDTHH:MM:SS.000Z
  return `${t.slice(0, 19)}.${frac.padEnd(6, '0')}Z`;
}

/** The hashed inputs of one entry, as the database keeps them. */
export interface HashedEntry {
  orgId: string;
  sheetId: string | null;
  itemId: string | null;
  chainKey: string;
  chainSeq: number | null;
  hashV: number;
  at: string;
  actorKind: string;
  actorId: string | null;
  action: string;
  fieldId: string | null;
  /** `old_value::text` as the database prints it (key order, number scale and spacing are part of the hash). */
  oldValueText: string | null;
  newValueText: string | null;
  note: string | null;
}

/** The HASH_COLUMNS cells of an entry. SQL null is '' for ids and 'null' for values, as the hash takes them. */
export function hashCells(e: HashedEntry): string[] {
  return [
    e.orgId,
    e.sheetId ?? '',
    e.itemId ?? '',
    e.chainSeq === null ? '' : String(e.chainSeq),
    String(e.hashV),
    hashTime(e.at),
    e.actorKind,
    e.actorId ?? '',
    e.fieldId ?? '',
    e.oldValueText ?? 'null',
    e.newValueText ?? 'null',
    e.note === null ? '' : JSON.stringify(e.note),
  ];
}

/**
 * The text whose SHA-256 (lowercase hex) is the entry's hash, from one row of activity/log.csv (header → cell).
 * v1: prev | at | actor_kind | actor_id | action | field_id | old | new | note;
 * v2: "v2" | the same | org_id | sheet_id | item_id | chain_key | chain_seq.
 */
export function activityHashInput(row: Readonly<Record<string, string>>): string {
  const cell = (k: string) => {
    const v = row[k];
    if (v === undefined) throw new Error(`log.csv has no column ${k}`);
    return unescapeFormula(v);
  };
  const noteJson = cell('note_json');
  const note = noteJson === '' ? '' : (JSON.parse(noteJson) as string);
  const v1 = [
    cell(HASH_INPUT_HEADERS.prevHash),
    cell('at_utc'),
    cell('actor_kind'),
    cell('actor_id'),
    cell(HASH_INPUT_HEADERS.action),
    cell('field_id'),
    cell('old_value_json'),
    cell('new_value_json'),
    note,
  ];
  if (cell('hash_v') === '1') return v1.join('|');
  return [
    'v2',
    ...v1,
    cell('org_id'),
    cell('sheet_id'),
    cell('item_id'),
    cell(HASH_INPUT_HEADERS.chainKey),
    cell('chain_seq'),
  ].join('|');
}

/** The recipe in words, for activity/method.txt. */
export const HASH_RECIPE = [
  'How to recompute a hash from activity/log.csv',
  'Every input of an entry\'s hash is in its row: "Previous hash", "Action", "Chain" and the columns from org_id to',
  'note_json at the end of the row, each exactly as the database hashed it. Read the file as UTF-8 CSV (RFC 4180).',
  'A cell the export starts with an apostrophe because a spreadsheet would run it as a formula (=, +, -, @, tab,',
  'carriage return) is read without that apostrophe; the hash columns never need one.',
  '- at_utc: the time in UTC with six decimals, as hashed.',
  '- old_value_json and new_value_json: the stored JSON exactly as PostgreSQL prints a jsonb value (keys ordered,',
  '  ", " and ": " between parts, numbers as stored), "null" when there is no value. Use the text as it is: do not',
  '  parse and print it again. Values kept out of the log read {"$restricted": …} or {"$personal": …}: the hash',
  '  covers that marker, never the value behind it.',
  '- note_json: the note as a JSON string; decode it. An empty cell means no note (the empty string).',
  '- actor_id, field_id, sheet_id, item_id, chain_seq: empty when the entry has none.',
  'hash_v 1 (entries written before 15 Nov 2026):',
  '  sha256(Previous hash|at_utc|actor_kind|actor_id|Action|field_id|old_value_json|new_value_json|note)',
  'hash_v 2:',
  '  sha256(v2|Previous hash|at_utc|actor_kind|actor_id|Action|field_id|old_value_json|new_value_json|note|',
  '         org_id|sheet_id|item_id|Chain|chain_seq)',
  'with "|" between the parts and nothing else, the text in UTF-8, the digest in lowercase hex. It must equal "Hash".',
  'Within one chain, "Previous hash" is the "Hash" of the entry before it (v1 entries in Entry order, then v2',
  'entries by chain_seq); the first entry of a chain has "genesis". This file holds the entries of the period, so',
  'the link to an entry before the period is checked by verify_activity_chain (activity/chains.csv), not here.',
].join('\n');
