import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { IMPLEMENTATION_OPTIONS, LIBRARY_KEYS } from '../frameworks/pack';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import type { Field } from '../types';
import { csvCell, toCsv } from './csv';
import {
  activityTable,
  chainSummary,
  chainTable,
  evidenceTable,
  filesToInclude,
  inPeriod,
  logValueText,
  packReadme,
  registerTable,
  uniqueNames,
  zipName,
  type ChainResult,
} from './pack';
import { buildSoa, soaCsv, soaHtml, soaTable, SOA_COLUMNS, type SoaHeader } from './soa';

describe('csv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded')).toBe('" padded"');
  });

  it('defuses cells a spreadsheet would run as a formula, but not numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('+44 20')).toBe("'+44 20");
    expect(csvCell('-3')).toBe('-3');
    expect(csvCell('-2.5')).toBe('-2.5');
  });

  it('ends rows with CRLF and can start with a BOM', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('a,b\r\n1,2\r\n');
    expect(toCsv([['a']], { bom: true }).charCodeAt(0)).toBe(0xfeff);
  });
});

function library() {
  const k = LIBRARY_KEYS;
  const ref = makeField('text', {}, { key: k.ref, name: 'Ref' });
  const applicable = makeField('applicability', {}, { key: k.applicable, name: 'Applicable' });
  const justification = makeField(
    'justification',
    { whenFieldKey: k.applicable, whenValues: ['not_applicable'] },
    { key: k.justification, name: 'Justification' },
  );
  const status = makeField(
    'status',
    { options: IMPLEMENTATION_OPTIONS.map((o) => ({ ...o })) },
    { key: k.status, name: 'Implementation status' },
  );
  const owner = makeField('people', { multiple: false }, { key: k.owner, name: 'Owner' });
  const evidence = makeField(
    'evidence',
    { validDays: 365, multiple: true, accept: [] },
    { key: k.evidence, name: 'Evidence' },
  );
  const reviewed = makeField('date', {}, { key: k.lastReviewed, name: 'Last reviewed' });
  const fields = [ref, applicable, justification, status, owner, evidence, reviewed];
  const a510 = makeItem(
    {
      [ref.id]: 'A.5.10',
      [applicable.id]: { applicable: true },
      [status.id]: 'opt_implemented',
      [owner.id]: ['u-maria'],
      [reviewed.id]: '2026-10-01',
    },
    { name: 'Acceptable use of information' },
  );
  const a52 = makeItem(
    {
      [ref.id]: 'A.5.2',
      [applicable.id]: { applicable: false },
      [justification.id]: 'No such roles here',
      [status.id]: 'opt_planned',
    },
    { name: 'Information security roles' },
  );
  const c41 = makeItem({ [ref.id]: '4.1' }, { name: 'Context' });
  return { fields, items: [a510, a52, c41], ref, status, owner, a510, a52, c41 };
}

const header: SoaHeader = {
  workspace: 'Meridian',
  framework: 'ISO/IEC 27001:2022',
  licence: 'Titles only.',
  generatedAt: '2026-11-11T12:00:00Z',
  generatedBy: 'Maria Pereira',
  timeZone: 'Europe/London',
  scope: 'Statement of applicability',
};

describe('statement of applicability', () => {
  it('one row per requirement in reference order, with the SoA columns', () => {
    const lib = library();
    const ctx = makeCtx({ fields: lib.fields, items: lib.items });
    const soa = buildSoa({
      fields: lib.fields,
      items: lib.items,
      ctx,
      refFieldKey: 'ref',
      evidence: new Map([[lib.a510.id, [{ name: 'aup.pdf', href: '/x' }]]]),
      linked: new Map([
        [lib.a510.id, [{ displayId: 'CTL-1', name: 'AUP', sheetName: 'Controls' }]],
      ]),
    });
    expect(soa.rows.map((r) => r.ref)).toEqual(['4.1', 'A.5.2', 'A.5.10']);
    const a510 = soa.rows[2]!;
    expect(a510).toMatchObject({
      title: 'Acceptable use of information',
      applicability: 'applicable',
      status: 'Implemented',
      implemented: true,
      owner: 'Maria Pereira',
      linked: ['CTL-1 AUP (Controls)'],
    });
    expect(soa.rows[1]).toMatchObject({
      applicability: 'not_applicable',
      justification: 'No such roles here',
    });
    expect(soa.counts).toEqual({
      total: 3,
      applicable: 1,
      notApplicable: 1,
      undecided: 1,
      implemented: 1,
    });
    const table = soaTable(soa);
    expect(table[0]).toEqual([...SOA_COLUMNS]);
    expect(table[3]![6]).toBe('aup.pdf </x>');
  });

  it('narrows to the SoA view filters', () => {
    const lib = library();
    const ctx = makeCtx({ fields: lib.fields, items: lib.items });
    const soa = buildSoa({
      fields: lib.fields,
      items: lib.items,
      ctx,
      refFieldKey: 'ref',
      filters: [{ fieldKey: 'ref', op: 'starts_with', value: 'A.' }],
      evidence: new Map(),
      linked: new Map(),
    });
    expect(soa.rows.map((r) => r.ref)).toEqual(['A.5.2', 'A.5.10']);
  });

  it('a restricted field reads Restricted and counts nothing', () => {
    const lib = library();
    const ctx = makeCtx(
      { fields: lib.fields, items: lib.items },
      { canSee: (f: Field) => f.id !== lib.status.id && f.id !== lib.owner.id },
    );
    const soa = buildSoa({
      fields: lib.fields,
      items: lib.items,
      ctx,
      refFieldKey: 'ref',
      evidence: new Map(),
      linked: new Map(),
    });
    expect(soa.rows[2]!.status).toBe('Restricted');
    expect(soa.rows[2]!.owner).toBe('Restricted');
    expect(soa.counts.implemented).toBe(0);
  });

  it('CSV has the header block, then the table; HTML escapes and prints', () => {
    const lib = library();
    const ctx = makeCtx({ fields: lib.fields, items: lib.items });
    const soa = buildSoa({
      fields: lib.fields,
      items: lib.items,
      ctx,
      refFieldKey: 'ref',
      evidence: new Map(),
      linked: new Map(),
    });
    const csv = soaCsv(soa, header).replace('﻿', '').split('\r\n');
    expect(csv[0]).toBe('Statement of applicability');
    expect(csv[1]).toBe('Workspace,Meridian');
    expect(csv[5]).toBe('Generated,"11 Nov 2026, 12:00 by Maria Pereira"');
    expect(csv[7]).toBe(SOA_COLUMNS.join(','));
    const html = soaHtml(soa, { ...header, workspace: '<b>Meridian</b>' });
    expect(html).toContain('&lt;b&gt;Meridian&lt;/b&gt;');
    expect(html).not.toContain('<script');
    expect(html).toContain('3 requirements · 1 applicable');
  });
});

describe('audit pack tables', () => {
  it('periods are whole days in the time zone', () => {
    const p = { from: '2026-01-01', to: '2026-03-31' };
    expect(inPeriod('2026-03-31T22:30:00Z', p, 'Europe/London')).toBe(true);
    // 23:30 UTC on 31 Mar is 1 Apr in London (summer time)
    expect(inPeriod('2026-03-31T23:30:00Z', p, 'Europe/London')).toBe(false);
    expect(inPeriod('2025-12-31T23:59:00Z', p, 'Europe/London')).toBe(false);
  });

  it('zip names are safe and unique', () => {
    expect(zipName('Risks / 2026: "final"')).toBe('Risks - 2026- -final-');
    expect(zipName('..')).toBe('file');
    expect(uniqueNames(['Risks', 'risks', 'Docs'])).toEqual(['Risks', 'risks (2)', 'Docs']);
  });

  it('registers leave out the fields the person may not see', () => {
    const notes = makeField('text', {}, { name: 'Notes' });
    const secret = makeField('text', {}, { name: 'Salary', hidden: true });
    const it = makeItem({ [notes.id]: 'ok' }, { name: 'Row' });
    const ctx = makeCtx({ fields: [notes, secret], items: [it] });
    const t = registerTable([it], [notes, secret], ctx, () => 'Open');
    expect(t[0]).toEqual(['ID', 'Name', 'Group', 'Notes', 'Created', 'Last changed']);
    expect(t[1]!.slice(0, 4)).toEqual([it.displayId, 'Row', 'Open', 'ok']);
  });

  it('files fit under the limits, smallest first', () => {
    const files = [
      { fileId: 'a', sizeBytes: 60 },
      { fileId: 'b', sizeBytes: 30 },
      { fileId: 'c', sizeBytes: 200 },
      { fileId: 'd', sizeBytes: 50 },
    ];
    expect([...filesToInclude(files, { perFile: 100, total: 100 })].sort()).toEqual(['b', 'd']);
  });

  it('the evidence index lists hashes and whether the file is in the pack', () => {
    const t = evidenceTable(
      [
        {
          fileId: 'f1',
          filename: 'policy.pdf',
          sizeBytes: 2048,
          sha256: 'ab'.repeat(32),
          mimeType: 'application/pdf',
          uploadedBy: 'Maria Pereira',
          uploadedAt: '2026-05-01T10:00:00Z',
          validUntil: '2027-05-01',
          item: { displayId: 'A-1', name: 'Policy' },
          sheetName: 'Library',
          fieldName: 'Evidence',
          zipPath: 'evidence/A-1/policy.pdf',
        },
      ],
      'Europe/London',
    );
    expect(t[1]).toContain('2.0 KB');
    expect(t[1]).toContain('ab'.repeat(32));
    expect(t[1]![11]).toBe('evidence/A-1/policy.pdf');
  });

  it('the log extract masks restricted values', () => {
    expect(logValueText({ $restricted: 'abc' })).toBe('"Restricted"');
    expect(logValueText({ values: { f1: { $restricted: 'x' }, f2: 'open' } })).toBe(
      '{"values":{"f1":"Restricted","f2":"open"}}',
    );
    expect(logValueText({ values: { f1: { $personal: 'x' } } })).toBe(
      '{"values":{"f1":"Personal data"}}',
    );
    expect(logValueText('text')).toBe('text');
    const t = activityTable(
      [
        {
          id: 7,
          at: '2026-05-01T10:00:00Z',
          chainKey: 'i-1',
          itemId: 'i-1',
          sheetId: 's-1',
          actorKind: 'user',
          actorId: 'u-maria',
          action: 'value.changed',
          fieldId: 'f-1',
          oldValue: null,
          newValue: 'x',
          note: null,
          prevHash: 'genesis',
          hash: 'h1',
        },
      ],
      {
        person: () => 'Maria Pereira',
        item: () => 'R-1 Risk',
        sheet: () => 'Risks',
        field: () => 'Notes',
      },
      'Europe/London',
    );
    expect(t[1]).toEqual([
      '7',
      '1 May 2026, 11:00',
      'Risks',
      'R-1 Risk',
      'Maria Pereira',
      'value.changed',
      'Notes',
      '',
      'x',
      '',
      'i-1',
      'genesis',
      'h1',
    ]);
  });

  it('reports each chain and sums them up', () => {
    const results: ChainResult[] = [
      { chainKey: 'i-1', label: 'R-1', sheetName: 'Risks', ok: true, entries: 4, lastHash: 'h' },
      { chainKey: 'i-2', label: 'R-2', sheetName: 'Risks', ok: false, entries: 2, firstBadId: 9 },
      { chainKey: 'i-3', label: 'R-3', sheetName: 'Risks', ok: null, entries: 0, error: 'denied' },
    ];
    expect(chainSummary(results)).toEqual({ chains: 3, ok: 1, broken: 1, failed: 1, entries: 6 });
    const t = chainTable(results);
    expect(t.map((r) => r[3])).toEqual(['Result', 'ok', 'broken', 'not checked: denied']);
    expect(t[2]![5]).toBe('9');
  });

  it('the read me says what is in the pack and how chains were checked', () => {
    const text = packReadme({
      workspace: 'Meridian',
      scope: 'Folder ISMS',
      period: { from: '2026-01-01', to: '2026-12-31' },
      generatedAt: '2026-11-11T12:00:00Z',
      generatedBy: 'Maria',
      timeZone: 'Europe/London',
      files: ['README.txt'],
      registers: 3,
      evidence: { listed: 4, included: 2 },
      entries: 10,
      chains: { chains: 5, ok: 5, broken: 0, failed: 0, entries: 30 },
      soa: ['ISO/IEC 27001:2022'],
      leftOut: ['1 sheet you cannot open'],
    });
    expect(text).toContain('Scope: Folder ISMS');
    expect(text).toContain('5 checked, 5 ok, 0 broken');
    expect(text).toContain('sha256(prev_hash');
    expect(text).toContain('- 1 sheet you cannot open');
  });
});
