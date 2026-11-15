import { beforeAll, describe, expect, it } from 'vitest';
import { matchesAll } from '../conditions';
import { computeWidget, type DashboardData, type SheetSource } from '../dashboards';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem, sheet } from '../testing/fixtures';
import type { Sheet } from '../types';
import { isDoneOf, keysOf, textOf, valueOf } from '../values';
import { IMPLEMENTATION_OPTIONS, LIBRARY_KEYS } from './pack';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

// A requirement library's empty implementation status reads and counts as "Not started" (owner decision 15 Nov 2026):
// a library adopted a minute ago said "No value 32 of 32" and "Not started 0". Nothing is written into the items.

const library: Sheet = {
  ...sheet,
  isLibrary: true,
  name: 'ISO/IEC 27001:2022 requirements',
  itemLabel: 'Requirement',
  framework: { key: 'iso-27001', version: '2022', refFieldKey: 'ref' },
};
const status = makeField(
  'status',
  { options: IMPLEMENTATION_OPTIONS.map((o) => ({ ...o })) },
  { key: LIBRARY_KEYS.status, id: 'f-status', name: 'Implementation status' },
);
const items = [
  makeItem({}, { id: 'r1' }),
  makeItem({ 'f-status': null }, { id: 'r2' }),
  makeItem({ 'f-status': 'opt_planned' }, { id: 'r3' }),
  makeItem({ 'f-status': 'opt_implemented' }, { id: 'r4' }),
];

const sourceOf = (s: Sheet): SheetSource => {
  const ctx = makeCtx({ fields: [status], items }, { sheet: s });
  return { sheet: s, fields: [status], items, ctx };
};
const dataOf = (src: SheetSource): DashboardData => ({
  today: '2026-11-15',
  timeZone: 'Europe/London',
  months: 6,
  sheet: (id) => (id === src.sheet.id ? src : undefined),
  sheets: () => [src],
  changes: [],
  evidence: [],
  runs: [],
});

describe('an unset implementation status in a requirement library', () => {
  const { ctx } = sourceOf(library);

  it('reads as Not started, and is not done', () => {
    for (const id of ['r1', 'r2']) {
      const it = items.find((x) => x.id === id)!;
      expect(valueOf(it, status, ctx)).toBe('opt_not_started');
      expect(textOf(it, status, ctx)).toBe('Not started');
      expect(keysOf(it, status, ctx)).toEqual(['opt_not_started']);
      expect(isDoneOf(it, status, ctx)).toBe(false);
    }
    // a status someone set reads as set
    expect(textOf(items[2]!, status, ctx)).toBe('Planned');
    // nothing is written
    expect(items[0]!.values).toEqual({});
    expect(items[1]!.values).toEqual({ 'f-status': null });
  });

  it('counts as Not started in filters and in the Implementation status widget', () => {
    const notStarted = [{ fieldKey: 'status', op: 'is_any_of', value: ['opt_not_started'] }];
    expect(items.filter((it) => matchesAll(notStarted, it, ctx)).map((i) => i.id)).toEqual([
      'r1',
      'r2',
    ]);
    const src = sourceOf(library);
    const bars = computeWidget(
      {
        id: 'w',
        type: 'by_option',
        title: 'Implementation status',
        sheetId: library.id,
        fieldKey: 'status',
      },
      dataOf(src),
    );
    expect(bars).toMatchObject({
      kind: 'bars',
      total: 4,
      bars: [
        { label: 'Not started', value: 2 },
        { label: 'Planned', value: 1 },
        { label: 'Partially', value: 0 },
        { label: 'Implemented', value: 1 },
      ],
    });
    expect((bars as { bars: { label: string }[] }).bars.map((b) => b.label)).not.toContain(
      'No value',
    );
  });

  it('stays empty on any other sheet, and in a library field that is not the implementation status', () => {
    const other = sourceOf(sheet);
    expect(valueOf(items[0]!, status, other.ctx)).toBeNull();
    expect(textOf(items[0]!, status, other.ctx)).toBe('');
    const bars = computeWidget(
      { id: 'w', type: 'by_option', title: 'Status', sheetId: sheet.id, fieldKey: 'status' },
      dataOf(other),
    );
    expect((bars as { bars: { label: string; value: number }[] }).bars.at(-1)).toMatchObject({
      label: 'No value',
      value: 2,
    });
    const priority = makeField(
      'status',
      { options: IMPLEMENTATION_OPTIONS.map((o) => ({ ...o })) },
      { key: 'priority', id: 'f-priority' },
    );
    expect(valueOf(items[0]!, priority, ctx)).toBeNull();
  });
});
