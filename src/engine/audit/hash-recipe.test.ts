// An auditor recomputes every activity log hash from the audit pack's log.csv alone (security review 9.1 item 3).
// The expected hashes were made by the database's own activity_hash (v1) and activity_hash_v2 on the local stack;
// supabase/tests/0056_audit_hash_recipe.sql asserts the same inputs give the same hashes, so this fixture and the SQL
// cannot drift apart.
import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import { activityHashInput, hashTime, HASH_COLUMNS } from './hash-recipe';
import { activityTable, type ActivityEntry } from './pack';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const ORG = 'e0000000-0000-4000-8000-000000000003';
const SHEET = '50000000-0000-4000-8000-000000000004';
const ITEM = '10000000-0000-4000-8000-000000000005';
const USER = 'a1b2c3d4-0000-4000-8000-000000000001';

/** Inputs as the API returns them, and the hashes the database computed for them. */
const FIXTURE: { entry: ActivityEntry; v1: string; v2: string }[] = [
  {
    // a value change with a note: key order, number scale, Unicode, pipes, quotes and a line break
    entry: {
      id: 1,
      orgId: ORG,
      sheetId: SHEET,
      itemId: ITEM,
      chainKey: ITEM,
      chainSeq: 7,
      hashV: 2,
      at: '2026-11-15T10:11:12.123456+00:00',
      actorKind: 'user',
      actorId: USER,
      action: 'value.changed',
      fieldId: 'f0000000-0000-4000-8000-000000000002',
      oldValue: { a: [1, 'x'], b: 1.5, 10: null },
      newValue: 'Ålesund – “quoted” | pipe',
      oldValueText: '{"a": [1, "x"], "b": 1.50, "10": null}',
      newValueText: '"Ålesund – “quoted” | pipe"',
      note: 'Comment with | pipe, "quotes" and a line\nbreak',
      prevHash: 'genesis',
      hash: '5bbb5148b5e59be6d1320a95b65e3e8a5e6bfa527caf6c8d1c447b70f752081f',
    },
    v1: '6cf1addc86c9b74bf9a5b160c8b1fd354b15ea4a23af3c34abbb0a240380d7b1',
    v2: '5bbb5148b5e59be6d1320a95b65e3e8a5e6bfa527caf6c8d1c447b70f752081f',
  },
  {
    // a sheet chain entry by an automation: no actor id, field, old value, item or note; an offset other than UTC
    entry: {
      id: 2,
      orgId: ORG,
      sheetId: SHEET,
      itemId: null,
      chainKey: `sheet:${SHEET}`,
      chainSeq: 1,
      hashV: 2,
      at: '2026-11-15T23:59:59+01:00',
      actorKind: 'automation',
      actorId: null,
      action: 'item.created',
      fieldId: null,
      oldValue: null,
      newValue: { name: 'R-1', values: { x: -3, y: 0.0001, z: true } },
      oldValueText: null,
      newValueText: '{"name": "R-1", "values": {"x": -3, "y": 0.0001, "z": true}}',
      note: null,
      prevHash: 'ab12',
      hash: 'b970a821c7ab3e2e09bfd7e55bee2e015932184f2699d37f0446798081d09f03',
    },
    v1: 'c62905be1eb89f6c15287519660a896580eb974d48441e8d6d2c94c2cb546917',
    v2: 'b970a821c7ab3e2e09bfd7e55bee2e015932184f2699d37f0446798081d09f03',
  },
  {
    // a v1 entry on the workspace chain: a JSON null old value, a personal-data marker and a masked note (0065)
    entry: {
      id: 3,
      orgId: ORG,
      sheetId: null,
      itemId: null,
      chainKey: `sheet:${ORG}`,
      chainSeq: 12,
      hashV: 1,
      at: '2026-01-02T03:04:05.1+00:00',
      actorKind: 'user',
      actorId: USER,
      action: 'workflow.decided',
      fieldId: null,
      oldValue: null,
      newValue: { $personal: '00ff' },
      oldValueText: 'null',
      newValueText: '{"$personal": "00ff"}',
      note: '{"$personal": "abcd"}',
      prevHash: 'cd34',
      hash: '385ea3a4d83e4f2108e46e7212f7775329264253be960f57e22465a2cc138412',
    },
    v1: '385ea3a4d83e4f2108e46e7212f7775329264253be960f57e22465a2cc138412',
    v2: '35772fc6bf9815d0870bb1fa101a5002bdf00bdecb34a06026b0a5f6c6dd5e44',
  },
];

const names = { person: () => 'Maria', item: () => 'R-1', sheet: () => 'Risks', field: () => 'F' };

function csvRows(): Record<string, string>[] {
  const csv = toCsv(
    activityTable(
      FIXTURE.map((f) => f.entry),
      names,
      'Europe/Oslo',
    ),
    { bom: true },
  );
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
  });
  expect(parsed.errors).toEqual([]);
  return parsed.data;
}

describe('recomputing activity hashes from log.csv', () => {
  it('log.csv carries every hashed input', () => {
    const header = Object.keys(csvRows()[0]!);
    for (const c of [...HASH_COLUMNS, 'Previous hash', 'Action', 'Chain', 'Hash'])
      expect(header).toContain(c);
  });

  it('each row recomputes to its Hash with the version it names', () => {
    for (const row of csvRows()) expect(sha256(activityHashInput(row))).toBe(row.Hash);
  });

  it('v1 and v2 both match what the database computes for the same row', () => {
    csvRows().forEach((row, i) => {
      expect(sha256(activityHashInput({ ...row, hash_v: '1' }))).toBe(FIXTURE[i]!.v1);
      expect(sha256(activityHashInput({ ...row, hash_v: '2' }))).toBe(FIXTURE[i]!.v2);
    });
  });

  it('a changed cell no longer matches', () => {
    const row = csvRows()[0]!;
    expect(
      sha256(activityHashInput({ ...row, old_value_json: '{"a":[1,"x"],"b":1.5,"10":null}' })),
    ).not.toBe(row.Hash);
    expect(sha256(activityHashInput({ ...row, chain_seq: '8' }))).not.toBe(row.Hash);
  });

  it('hashTime keeps microseconds and converts any offset to UTC', () => {
    expect(hashTime('2026-11-15T10:11:12.123456+00:00')).toBe('2026-11-15T10:11:12.123456Z');
    expect(hashTime('2026-11-15 10:11:12.1+00')).toBe('2026-11-15T10:11:12.100000Z');
    expect(hashTime('2026-11-15T23:59:59+01:00')).toBe('2026-11-15T22:59:59.000000Z');
    expect(hashTime('2026-01-01T00:30:00.000001-05:30')).toBe('2026-01-01T06:00:00.000001Z');
    expect(hashTime('2026-12-31T23:59:59.999999Z')).toBe('2026-12-31T23:59:59.999999Z');
    expect(() => hashTime('yesterday')).toThrow();
  });
});
