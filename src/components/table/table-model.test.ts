import { describe, expect, it } from 'vitest';
import '@/engine/fields/registry';
import { groups, makeField, makeItem } from '@/engine/testing/fixtures';
import {
  buildLayout,
  cardFields,
  endsCard,
  trailWidth,
  rowHeight,
  positionAt,
  positionsAtEnd,
  rangeOf,
  step,
  tableColumns,
  columnId,
  columnRuns,
  GROUP_LABEL_H,
  stickyHeaders,
} from './table-model';
import { cellColumns } from '@/engine/clipboard';

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

  it('keeps empty groups compact: title and add row, no column header', () => {
    const l = buildLayout({ groups, items: [c], collapsed: new Set(), canAdd: true });
    expect(l.rows.map((r) => r.kind)).toEqual([
      'group',
      'add',
      'gap',
      'group',
      'header',
      'item',
      'add',
    ]);
    expect(l.rows[0]).toMatchObject({ count: 0 });
  });

  it('keeps the column header on the first group when every group is empty', () => {
    const l = buildLayout({
      groups,
      items: [],
      collapsed: new Set(),
      canAdd: true,
      summaries: true,
    });
    expect(l.rows.map((r) => r.kind)).toEqual([
      'group',
      'header',
      'add',
      'summary',
      'gap',
      'group',
      'add',
    ]);
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

describe('sticky column headers', () => {
  it('points every row of a card at its column header, and each header at its card end', () => {
    const l = buildLayout({ groups, items: [a, b, c], collapsed: new Set(), canAdd: true });
    const { headerOf, cardEnd } = stickyHeaders(l.rows);
    // group, header, item, item, add, gap, group, header, item, add
    expect([...headerOf]).toEqual([-1, 1, 1, 1, 1, -1, -1, 7, 7, 7]);
    expect([...cardEnd]).toEqual([
      [1, 4],
      [7, 9],
    ]);
  });

  it('has no header for a collapsed card', () => {
    const l = buildLayout({
      groups,
      items: [a, b, c],
      collapsed: new Set(['g-open']),
      canAdd: true,
    });
    const { headerOf, cardEnd } = stickyHeaders(l.rows);
    expect(l.rows.map((r) => r.kind).slice(0, 3)).toEqual(['group', 'gap', 'group']);
    expect([...headerOf].slice(0, 3)).toEqual([-1, -1, -1]);
    expect([...cardEnd.keys()]).toEqual([3]);
  });
});

describe('column widths', () => {
  it('gives the trailing column the room the columns leave in the card', () => {
    // 380 sticky + 2 borders + 684 of columns in a 1126 px card: 60 px left for "+" and "…"
    expect(trailWidth([84, 140, 150, 150, 160], 382, 1126, 44)).toBe(60);
    expect(trailWidth([], 382, 1126, 44)).toBe(744);
  });

  it('keeps the trailing column at its minimum when the columns do not fit (the table scrolls)', () => {
    expect(trailWidth([300, 300], 400, 800, 44)).toBe(44);
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
    expect(tableColumns([f1, f2], new Set(['f1'])).map(columnId)).toEqual(['name', 'f2']);
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

describe('buildLayout with sub-items', () => {
  const p1 = makeItem({}, { id: 'p1', position: 'a0', groupId: 'g-open' });
  const p2 = makeItem({}, { id: 'p2', position: 'a1', groupId: 'g-open' });
  const s1 = makeItem({}, { id: 's1', position: 'a0', parentId: 'p1', groupId: 'g-sub' });
  const s2 = makeItem({}, { id: 's2', position: 'a1', parentId: 'p1', groupId: 'g-sub' });
  const kids = new Map([['p1', [s1, s2]]]);
  const layout = (
    expanded: string[],
    extra: Partial<Parameters<typeof buildLayout>[0]['subitems'] & object> = {},
  ) =>
    buildLayout({
      groups,
      items: [p1, p2],
      collapsed: new Set(['g-closed']),
      canAdd: true,
      subitems: {
        childrenOf: (id) => kids.get(id) ?? [],
        expanded: new Set(expanded),
        canAdd: true,
        ...extra,
      },
    });

  it('collapsed parents add no rows', () => {
    const l = layout([]);
    expect(l.rows.map((r) => r.kind)).toEqual([
      'group',
      'header',
      'item',
      'item',
      'add',
      'gap',
      'group',
    ]);
    expect(l.subs).toEqual([]);
  });

  it('an expanded parent gets its sub-header, rows and add row; selection keeps to the parents', () => {
    const l = layout(['p1', 'p2']);
    expect(l.rows.map((r) => r.kind)).toEqual([
      'group',
      'header',
      'item',
      'subheader',
      'subitem',
      'subitem',
      'subadd',
      'item',
      'subempty',
      'subadd',
      'add',
      'gap',
      'group',
    ]);
    expect(l.flat.map((i) => i.id)).toEqual(['p1', 'p2']);
    expect(l.subs.map((r) => [r.item.id, r.index, r.last])).toEqual([
      ['s1', 0, false],
      ['s2', 1, true],
    ]);
    expect(l.subIndex.get('s2')).toBe(1);
    const keys = l.rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a search match opens its parent and marks the sub-item', () => {
    const l = layout([], { matched: new Map([['p1', new Set(['s2'])]]) });
    expect(l.subs.map((r) => [r.item.id, r.match])).toEqual([
      ['s1', false],
      ['s2', true],
    ]);
  });

  it('viewers get no add rows; heights are known per kind', () => {
    const l = layout(['p1'], { canAdd: false });
    expect(l.rows.some((r) => r.kind === 'subadd')).toBe(false);
    expect(rowHeight('subheader')).toBe(28);
    expect(rowHeight('subitem')).toBe(44);
    expect(rowHeight('subitem', 'compact')).toBe(36);
  });
});

describe('column groups in the table', () => {
  const owner = makeField('people', {}, { key: 'cg_owner', position: 'a0' });
  const notes = makeField('text', {}, { key: 'cg_notes', position: 'a1' });
  const score = makeField('number', {}, { key: 'cg_score', position: 'a2' });
  const due = makeField('date', { relative: true }, { key: 'cg_due', position: 'a3' });
  const fields = [owner, notes, score, due];
  const list = [{ id: 'assess', name: 'Assess', fieldKeys: ['cg_owner', 'cg_score'] }];

  it('puts a group’s columns together where its first field is', () => {
    const cols = tableColumns(fields, new Set(), { list, collapsed: new Set() });
    expect(cols.map(columnId)).toEqual(['name', owner.id, score.id, notes.id, due.id]);
  });

  it('a collapsed group is one stub column; the stub is skipped by the selection axis', () => {
    const cols = tableColumns(fields, new Set([due.id]), { list, collapsed: new Set(['assess']) });
    expect(cols.map(columnId)).toEqual(['name', 'stub:assess', notes.id]);
    const stub = cols[1]!;
    expect(stub.kind === 'stub' && stub.fields.map((f) => f.id)).toEqual([owner.id, score.id]);
    expect(cellColumns(cols).map(columnId)).toEqual(['name', notes.id]);
  });

  it('label runs: the group, then Other; none without groups', () => {
    const cols = tableColumns(fields, new Set(), { list, collapsed: new Set() });
    expect(columnRuns(cols, list).map((r) => [r.name, r.from, r.to, r.size, r.collapsed])).toEqual([
      ['Assess', 0, 1, 2, false],
      ['Other', 2, 3, 2, false],
    ]);
    const shut = tableColumns(fields, new Set(), { list, collapsed: new Set(['assess']) });
    expect(columnRuns(shut, list).map((r) => [r.name, r.from, r.to, r.collapsed])).toEqual([
      ['Assess', 0, 0, true],
      ['Other', 1, 2, false],
    ]);
    expect(columnRuns(tableColumns(fields, new Set()), [])).toEqual([]);
  });

  it('the column header grows by the label line', () => {
    expect(rowHeight('header', 'comfortable', true)).toBe(rowHeight('header') + GROUP_LABEL_H);
  });
});
