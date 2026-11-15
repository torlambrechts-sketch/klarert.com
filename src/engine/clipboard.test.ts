import { describe, expect, it } from 'vitest';
import './fields/registry';
import { copyRange, parseTsv, planClear, planPaste, toTsv, type GridColumn } from './clipboard';
import { makeCtx, makeField, makeItem } from './testing/fixtures';

const status = makeField('status', {
  options: [
    { id: 'opt_todo', label: 'Not started', color: 'grey' },
    { id: 'opt_done', label: 'Done', color: 'green', done: true },
  ],
});
const due = makeField('date', { relative: true }, { name: 'Due date' });
const owner = makeField('people', { multiple: true }, { name: 'Owner' });
const score = makeField('number', { unit: '', decimals: 2 }, { name: 'Score', required: true });
const formula = makeField('formula', { expr: '1+1', result: 'auto' }, { name: 'Calc' });
const fields = [status, due, owner, score, formula];
const ctx = makeCtx({ fields });
const columns: GridColumn[] = [
  { kind: 'name' },
  ...fields.map((field) => ({ kind: 'field' as const, field })),
];

describe('TSV', () => {
  it('round-trips tabs, line breaks and quotes', () => {
    const rows = [
      ['a', 'b\tc'],
      ['line\nbreak', 'say "hi"'],
    ];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });
  it('reads Excel output with CRLF and a trailing newline', () => {
    expect(parseTsv('x\ty\r\n1\t2\r\n')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });
});

describe('copy', () => {
  it('copies names and display text', () => {
    const a = makeItem({ [status.id]: 'opt_done', [due.id]: '2026-11-20' }, { name: 'Fix guard' });
    const tsv = copyRange([a], columns, { top: 0, left: 0, bottom: 0, right: 2 }, ctx);
    expect(tsv).toBe('Fix guard\tDone\t20 Nov 2026');
  });

  describe('formula escaping (SA-11, as CSV exports)', () => {
    const note = makeField('text', {}, { name: 'Note' });
    const n = makeField('number', { unit: '', decimals: 0 }, { name: 'Count' });
    const cols: GridColumn[] = [
      { kind: 'name' },
      { kind: 'field', field: note },
      { kind: 'field', field: n },
    ];
    const c = makeCtx({ fields: [note, n] });
    const copy = (name: string, text: string, count: number | null = null) =>
      copyRange(
        [makeItem({ [note.id]: text, ...(count === null ? {} : { [n.id]: count }) }, { name })],
        cols,
        { top: 0, left: 0, bottom: 0, right: 2 },
        c,
      );

    it.each([
      ['=HYPERLINK("https://evil","Open")', `"'=HYPERLINK(""https://evil"",""Open"")"`],
      ['+cmd|calc', "'+cmd|calc"],
      ['-2+3', "'-2+3"],
      ['@SUM(A1)', "'@SUM(A1)"],
    ])('puts an apostrophe before %s', (text, cell) => {
      expect(copy('Plain', text).split('\t')[1]).toBe(cell);
    });

    it('escapes names too, and leaves plain text and plain numbers as they are', () => {
      expect(copy('=1+1', 'fine', -3)).toBe("'=1+1\tfine\t-3");
      expect(copy('A', '-3', 4)).toBe('A\t-3\t4');
      expect(copy('A', '+44', null)).toBe('A\t+44\t');
    });

    it('pastes a copied cell back as the value it had', () => {
      const item = makeItem({}, { name: 'A' });
      const r = planPaste(
        copy('=1+1', '=HYPERLINK("x")'),
        [item],
        cols,
        { top: 0, left: 0, bottom: 0, right: 1 },
        c,
        { canEdit: () => true },
      );
      expect(r.names.get(item.id)).toBe('=1+1');
      expect(r.values.get(item.id)?.[note.id]).toBe('=HYPERLINK("x")');
    });
  });
});

describe('paste', () => {
  const a = makeItem({}, { name: 'A' });
  const b = makeItem({}, { name: 'B' });
  const canEdit = () => true;

  it('parses each cell through its type and reports skipped cells', () => {
    const text = 'Done\t20/11/2026\tMaria Pereira\nnot started\tsoon\tme';
    const r = planPaste(text, [a, b], columns, { top: 0, left: 1, bottom: 0, right: 1 }, ctx, {
      canEdit,
    });
    expect(r.values.get(a.id)).toEqual({
      [status.id]: 'opt_done',
      [due.id]: '2026-11-20',
      [owner.id]: ['u-maria'],
    });
    expect(r.values.get(b.id)).toEqual({ [status.id]: 'opt_todo', [owner.id]: ['u-maria'] });
    expect(r.written).toBe(5);
    expect(r.message).toBe('5 cells pasted, 1 skipped: not a date');
  });

  it('fills a range from a single cell and accepts an Excel serial date', () => {
    const r = planPaste('46346', [a, b], columns, { top: 0, left: 2, bottom: 1, right: 2 }, ctx, {
      canEdit,
    });
    expect(r.values.get(a.id)).toEqual({ [due.id]: '2026-11-20' });
    expect(r.values.get(b.id)).toEqual({ [due.id]: '2026-11-20' });
  });

  it('skips read-only columns, locked items and empty required cells, and renames', () => {
    const r = planPaste(
      'New name\t\t\t\t\t2',
      [a],
      columns,
      { top: 0, left: 0, bottom: 0, right: 0 },
      ctx,
      {
        canEdit,
      },
    );
    expect(r.names.get(a.id)).toBe('New name');
    expect(r.skipped).toEqual(['Score is required', 'read-only column']);
    const empty = planPaste('\t', [a], columns, { top: 0, left: 3, bottom: 0, right: 3 }, ctx, {
      canEdit,
    });
    expect(empty.values.get(a.id)).toEqual({ [owner.id]: null });
    expect(empty.skipped).toEqual(['Score is required']);
    const locked = planPaste('Done', [a], columns, { top: 0, left: 1, bottom: 0, right: 1 }, ctx, {
      canEdit: () => false,
    });
    expect(locked.message).toBe('0 cells pasted, 1 skipped: item locked');
  });
});

describe('clear', () => {
  it('clears filled cells and keeps required ones and names', () => {
    const a = makeItem({ [status.id]: 'opt_done', [score.id]: 3 }, { name: 'A' });
    const r = planClear(
      [a],
      columns,
      { top: 0, left: 0, bottom: 0, right: 5 },
      { canEdit: () => true },
    );
    expect(r.values.get(a.id)).toEqual({ [status.id]: null });
    expect(r.skipped).toEqual(['a name is required', 'Score is required']);
    expect(r.message).toBe('1 cell cleared, 2 skipped: a name is required; Score is required');
  });
});
