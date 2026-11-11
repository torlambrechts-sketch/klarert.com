import { describe, expect, it } from 'vitest';
import { makeCtx } from '../testing/fixtures';
import {
  CSV_LIMITS,
  columnConfig,
  csvImportable,
  detectColumnType,
  parseCsv,
  planColumns,
  rowsToItems,
} from './csv';

const table = (text: string) => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(r.message);
  return r.table;
};

describe('parseCsv', () => {
  it('reads the header and pads short rows', () => {
    const t = table('Item,Owner,Due\nFix guard,maria@example.com\n"Quoted, name",,2026-11-11\n');
    expect(t.header).toEqual(['Item', 'Owner', 'Due']);
    expect(t.rows).toEqual([
      ['Fix guard', 'maria@example.com', ''],
      ['Quoted, name', '', '2026-11-11'],
    ]);
  });

  it('names blank headers and drops empty lines', () => {
    const t = table('\uFEFF,Due,\n\na,b,c\n , , \n');
    expect(t.header).toEqual(['Name', 'Due', 'Column 3']);
    expect(t.rows).toEqual([['a', 'b', 'c']]);
  });

  it('reads semicolon and tab separated text', () => {
    expect(table('A;B\n1;2').header).toEqual(['A', 'B']);
    expect(table('A\tB\n1\t2').rows).toEqual([['1', '2']]);
  });

  it('refuses empty text', () => {
    expect(parseCsv('  \n ')).toEqual({
      ok: false,
      message: 'Paste CSV text or choose a file first.',
    });
  });

  it('refuses more than 10 000 rows', () => {
    const text = `Name\n${Array.from({ length: CSV_LIMITS.rows + 1 }, (_, i) => `r${i}`).join('\n')}`;
    const r = parseCsv(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('The file has 10,001 rows. Import at most 10,000.');
    expect(
      parseCsv(`Name\n${Array.from({ length: CSV_LIMITS.rows }, (_, i) => `r${i}`).join('\n')}`).ok,
    ).toBe(true);
  });

  it('refuses more than 100 columns', () => {
    const header = Array.from({ length: 101 }, (_, i) => `c${i}`).join(',');
    const r = parseCsv(`${header}\n`);
    expect(r).toEqual({ ok: false, message: 'The file has 101 columns. Import at most 100.' });
  });

  it('refuses more than 10 MB', () => {
    const r = parseCsv('a'.repeat(CSV_LIMITS.bytes + 1));
    expect(r).toEqual({
      ok: false,
      message: 'The file is larger than 10 MB. Split it and import the parts.',
    });
  });
});

describe('detectColumnType', () => {
  it.each([
    [['2026-11-11', '11/12/2026', '3 Jan 2027'], 'date'],
    [['2026-11-11T10:00:00Z', ''], 'date'],
    [['12', '3.5', '-4', '1,200'], 'number'],
    [['2026', '2027'], 'number'],
    [['maria@example.com', 'james@example.com'], 'email'],
    [['https://example.com', 'www.meridian.co.uk', 'example.org/path'], 'url'],
    [['yes', 'No', 'TRUE', 'false'], 'yesno'],
    [['1', '0', '1'], 'number'],
    [['Open', 'Open', 'Closed', 'Open'], 'dropdown'],
    [['Open', 'Closed', 'Open'], 'text'],
    [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'a', 'b'], 'text'],
    [['Fix the guard', 'Replace the eye-wash station'], 'text'],
    [['', '  '], 'text'],
    [['2026-11-11', 'soon'], 'text'],
  ])('%j → %s', (cells, type) => {
    expect(detectColumnType(cells)).toBe(type);
  });
});

describe('planColumns', () => {
  it('turns every column after the first into a field with its detected type', () => {
    const t = table(
      'Item,Owner email,Due,Hours,Status\nCalibrate,grace@example.com,2026-11-25,2,Open\nReplace,tom@example.com,2026-12-11,4,Open\nCheck,amy@example.com,2026-12-12,1,Open',
    );
    expect(planColumns(t)).toEqual([
      { index: 1, name: 'Owner email', type: 'email' },
      { index: 2, name: 'Due', type: 'date' },
      { index: 3, name: 'Hours', type: 'number' },
      { index: 4, name: 'Status', type: 'dropdown' },
    ]);
  });
});

describe('csvImportable', () => {
  it('allows types stored on the item and refuses links, files and computed types', () => {
    expect(csvImportable('text')).toBe(true);
    expect(csvImportable('people')).toBe(true);
    expect(csvImportable('link')).toBe(false);
    expect(csvImportable('attachment')).toBe(false);
    expect(csvImportable('formula')).toBe(false);
    expect(csvImportable('nope')).toBe(false);
  });
});

describe('columnConfig', () => {
  let n = 0;
  const newId = (p: string) => `${p}${++n}`;

  it('creates dropdown options from the distinct values, first seen first', () => {
    n = 0;
    expect(columnConfig('dropdown', ['Open', 'Closed', 'open', '', 'Closed'], newId)).toEqual({
      options: [
        { id: 'opt_1', label: 'Open', color: 'blue' },
        { id: 'opt_2', label: 'Closed', color: 'green' },
      ],
    });
  });

  it('uses the default config for other types', () => {
    expect(columnConfig('yesno', ['yes'], newId)).toEqual({ allowNA: true });
    expect(columnConfig('text', [], newId)).toEqual(expect.any(Object));
  });
});

describe('rowsToItems', () => {
  it('maps names and parses values with each type, counting cells that do not parse', () => {
    const t = table(
      'Item,Due,Hours,Status,Done\nCalibrate,2026-11-25,2,Open,yes\n,not a date,x,Closed,no\nThird,,,,',
    );
    const status = columnConfig('dropdown', ['Open', 'Closed'], (p) => `${p}${Math.random()}`) as {
      options: { id: string; label: string }[];
    };
    const { items, skippedCells } = rowsToItems(
      t,
      [
        { index: 1, fieldId: 'f-due', type: 'date', config: {} },
        { index: 2, fieldId: 'f-hours', type: 'number', config: { decimals: 2 } },
        { index: 3, fieldId: 'f-status', type: 'dropdown', config: status },
        { index: 4, fieldId: 'f-done', type: 'yesno', config: { allowNA: true } },
      ],
      makeCtx(),
    );
    expect(skippedCells).toBe(2);
    expect(items).toEqual([
      {
        name: 'Calibrate',
        values: {
          'f-due': '2026-11-25',
          'f-hours': 2,
          'f-status': status.options[0]!.id,
          'f-done': 'yes',
        },
      },
      { name: 'Untitled', values: { 'f-status': status.options[1]!.id, 'f-done': 'no' } },
      { name: 'Third', values: {} },
    ]);
  });
});
