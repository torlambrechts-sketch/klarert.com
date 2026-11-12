import { describe, expect, it } from 'vitest';
import { groups, makeField, makeItem } from '@/engine/testing/fixtures';
import { buildLayout, gridColumns, positionAt, positionsAtEnd, rangeOf, step } from './grid-model';

const a = makeItem({}, { id: 'a', position: 'a1', groupId: 'g-open', name: 'B' });
const b = makeItem({}, { id: 'b', position: 'a0', groupId: 'g-open', name: 'A' });
const c = makeItem({}, { id: 'c', position: 'a0', groupId: 'g-closed', name: 'C' });

describe('buildLayout', () => {
  it('lays out groups with header, items, add row, summary and gap', () => {
    const l = buildLayout({ groups, items: [a, b, c], collapsed: new Set(), canAdd: true });
    expect(l.rows.map((r) => r.kind)).toEqual([
      'group',
      'header',
      'item',
      'item',
      'add',
      'summary',
      'gap',
      'group',
      'header',
      'item',
      'add',
      'summary',
      'gap',
    ]);
    expect(l.flat.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(l.index.get('c')).toBe(2);
  });

  it('collapses groups, hides the add row for viewers and filters to one group', () => {
    const l = buildLayout({
      groups,
      items: [a, b, c],
      collapsed: new Set(['g-open']),
      canAdd: false,
    });
    expect(l.rows.map((r) => r.kind)).toEqual([
      'group',
      'gap',
      'group',
      'header',
      'item',
      'summary',
      'gap',
    ]);
    expect(l.flat.map((i) => i.id)).toEqual(['c']);
    const one = buildLayout({
      groups,
      items: [a, b, c],
      collapsed: new Set(),
      canAdd: true,
      onlyGroup: 'g-closed',
    });
    expect(one.flat.map((i) => i.id)).toEqual(['c']);
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

describe('columns and positions', () => {
  it('lists the name then the visible fields', () => {
    const f1 = makeField('text', {}, { id: 'f1' });
    const f2 = makeField('text', {}, { id: 'f2' });
    expect(
      gridColumns([f1, f2], new Set(['f1'])).map((c) => (c.kind === 'name' ? 'name' : c.field.id)),
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
