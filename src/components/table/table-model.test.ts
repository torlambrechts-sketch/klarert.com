import { describe, expect, it } from 'vitest';
import '@/engine/fields/registry';
import { groups, makeField, makeItem } from '@/engine/testing/fixtures';
import {
  buildLayout,
  cardFields,
  endsCard,
  fitWidths,
  rowHeight,
  positionAt,
  positionsAtEnd,
  rangeOf,
  step,
  tableColumns,
} from './table-model';

const a = makeItem({}, { id: 'a', position: 'a1', groupId: 'g-open', name: 'B' });
const b = makeItem({}, { id: 'b', position: 'a0', groupId: 'g-open', name: 'A' });
const c = makeItem({}, { id: 'c', position: 'a0', groupId: 'g-closed', name: 'C' });

describe('buildLayout', () => {
  it('flattens groups into cards: title, column header, items, add row, a gap between cards', () => {
    const l = buildLayout({ groups, items: [a, b, c], collapsed: new Set(), canAdd: true });
    expect(l.rows.map((r) => r.kind)).toEqual([
      'group',
      'header',
      'item',
      'item',
      'add',
      'gap',
      'group',
      'header',
      'item',
      'add',
    ]);
    expect(l.rows.map((_, i) => endsCard(l.rows, i))).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(l.rows.filter((r) => r.kind === 'group').map((r) => r.key)).toEqual([
      'g:g-open',
      'g:g-closed',
    ]);
    expect(l.flat.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(l.index.get('c')).toBe(2);
    const keys = l.rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('collapses groups: the title stays with its count, header, items and add row go', () => {
    const l = buildLayout({
      groups,
      items: [a, b, c],
      collapsed: new Set(['g-open']),
      canAdd: true,
    });
    expect(l.rows.map((r) => r.kind)).toEqual(['group', 'gap', 'group', 'header', 'item', 'add']);
    expect(endsCard(l.rows, 0)).toBe(true);
    expect(l.rows[0]).toMatchObject({ kind: 'group', count: 2, collapsed: true });
    expect(l.flat.map((i) => i.id)).toEqual(['c']);
    // the items of a collapsed group are still known (select all, drop at the end)
    expect(l.byGroup.get('g-open')!.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('adds summary rows only when a column shows its summary, never for collapsed groups', () => {
    const off = buildLayout({ groups, items: [a, b, c], collapsed: new Set(), canAdd: true });
    expect(off.rows.some((r) => r.kind === 'summary')).toBe(false);
    const on = buildLayout({
      groups,
      items: [a, b, c],
      collapsed: new Set(['g-closed']),
      canAdd: true,
      summaries: true,
    });
    expect(on.rows.map((r) => r.kind)).toEqual([
      'group',
      'header',
      'item',
      'item',
      'add',
      'summary',
      'gap',
      'group',
    ]);
    const summary = on.rows.find((r) => r.kind === 'summary')!;
    expect(summary.kind === 'summary' && summary.items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('hides the add row for viewers and filters to one group', () => {
    const l = buildLayout({ groups, items: [a, b, c], collapsed: new Set(), canAdd: false });
    expect(l.rows.some((r) => r.kind === 'add')).toBe(false);
    const one = buildLayout({
      groups,
      items: [a, b, c],
      collapsed: new Set(),
      canAdd: true,
      onlyGroup: 'g-closed',
    });
    expect(one.rows.map((r) => r.kind)).toEqual(['group', 'header', 'item', 'add']);
    expect(one.flat.map((i) => i.id)).toEqual(['c']);
  });

  it('keeps empty groups with their title and add row', () => {
    const l = buildLayout({ groups, items: [c], collapsed: new Set(), canAdd: true });
    expect(l.rows.map((r) => r.kind)).toEqual([
      'group',
      'header',
      'add',
      'gap',
      'group',
      'header',
      'item',
      'add',
    ]);
    expect(l.rows[0]).toMatchObject({ count: 0 });
  });

  it('sorts inside groups with a comparator', () => {
    const l = buildLayout({
      groups,
      items: [a, b, c],
      collapsed: new Set(),
      canAdd: true,
      compare: (x, y) => y.name.localeCompare(x.name),
    });
    expect(l.flat.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('column widths', () => {
  it('shares leftover space across columns in proportion, keeping the total exact', () => {
    const w = fitWidths([100, 200, 100], 400, 1200);
    expect(w).toEqual([200, 400, 200]);
    expect(fitWidths([100, 100, 100], 0, 400)).toEqual([133, 133, 134]);
    expect(w.reduce((x, y) => x + y, 0) + 400).toBe(1200);
  });

  it('keeps widths when the columns do not fit (the table scrolls)', () => {
    expect(fitWidths([300, 300], 400, 800)).toEqual([300, 300]);
    expect(fitWidths([], 400, 1200)).toEqual([]);
  });

  it('has taller rows when comfortable', () => {
    expect(rowHeight('item')).toBe(52);
    expect(rowHeight('item', 'compact')).toBe(40);
    expect(rowHeight('header')).toBe(34);
  });
});

describe('phone cards', () => {
  it('group cards under the same titles as the table (no summaries, collapsible)', () => {
    const l = buildLayout({
      groups,
      items: [a, b, c],
      collapsed: new Set(['g-closed']),
      canAdd: true,
      headers: false,
    });
    expect(l.rows.map((r) => r.kind)).toEqual(['group', 'item', 'item', 'add', 'gap', 'group']);
  });

  it('show the first visible value fields, without the owner and computed fields', () => {
    const owner = makeField('people', { multiple: true }, { id: 'f-owner' });
    const status = makeField('status', {}, { id: 'f-status' });
    const formula = makeField('formula', { expr: '1', result: 'number' }, { id: 'f-formula' });
    const due = makeField('date', {}, { id: 'f-due' });
    const notes = makeField('text', {}, { id: 'f-notes' });
    const prio = makeField('dropdown', {}, { id: 'f-prio' });
    const fields = [owner, status, formula, due, notes, prio];
    expect(cardFields(fields, new Set(), 'f-owner').map((f) => f.id)).toEqual([
      'f-status',
      'f-due',
      'f-notes',
    ]);
    expect(cardFields(fields, new Set(['f-due']), 'f-owner', 2).map((f) => f.id)).toEqual([
      'f-status',
      'f-notes',
    ]);
    expect(cardFields(fields, new Set(), null, 1).map((f) => f.id)).toEqual(['f-owner']);
  });
});

describe('columns and positions', () => {
  it('lists the name then the visible fields', () => {
    const f1 = makeField('text', {}, { id: 'f1' });
    const f2 = makeField('text', {}, { id: 'f2' });
    expect(
      tableColumns([f1, f2], new Set(['f1'])).map((c) => (c.kind === 'name' ? 'name' : c.field.id)),
    ).toEqual(['name', 'f2']);
  });
  it('computes fractional keys between neighbours', () => {
    const list = [b, a]; // a0, a1
    const top = positionAt(list, 0);
    const mid = positionAt(list, 1);
    const end = positionAt(list, 2);
    expect(top < 'a0').toBe(true);
    expect(mid > 'a0' && mid < 'a1').toBe(true);
    expect(end > 'a1').toBe(true);
    const keys = positionsAtEnd(list, 3);
    expect(keys[0]! > 'a1' && keys[1]! > keys[0]! && keys[2]! > keys[1]!).toBe(true);
  });
});

describe('selection', () => {
  it('normalises ranges and steps with wrapping Tab', () => {
    expect(rangeOf({ row: 3, col: 1 }, { row: 1, col: 4 })).toEqual({
      top: 1,
      bottom: 3,
      left: 1,
      right: 4,
    });
    expect(step({ row: 0, col: 0 }, 'up', 5, 3)).toEqual({ row: 0, col: 0 });
    expect(step({ row: 0, col: 2 }, 'tab', 5, 3)).toEqual({ row: 1, col: 0 });
    expect(step({ row: 1, col: 0 }, 'shifttab', 5, 3)).toEqual({ row: 0, col: 2 });
    expect(step({ row: 4, col: 2 }, 'tab', 5, 3)).toBeNull();
  });
});
