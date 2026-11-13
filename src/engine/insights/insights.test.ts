import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem, sheet } from '../testing/fixtures';
import type { Field, Item } from '../types';
import { parseViewConfig } from '../views/config';
import {
  insightsLayoutSchema,
  layoutProblems,
  parseInsightsLayout,
  type InsightsLayout,
  type InsightWidget,
} from './config';
import { defaultLayout } from './default';
import {
  addRow,
  addWidget,
  duplicateWidget,
  moveRow,
  moveToAdjacentRow,
  moveToRow,
  moveWithinRow,
  openSlots,
  placeForNew,
  removeRow,
  removeWidget,
  replaceWidget,
  setRowLayout,
  setSpan,
  stepSpan,
  type Edit,
} from './layout';
import { computeWidget, INSIGHT_WIDGETS, widgetTitle } from './registry';
import { groupFields, type InsightsData, type InsightSource } from './source';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const statusCfg = FIELD_TYPES.status.defaultConfig();
const opt = (label: string) => statusCfg.options.find((o) => o.label === label)!.id;
const f = {
  status: makeField('status', statusCfg, { key: 'status', name: 'Status', position: 'a1' }),
  due: makeField('date', { relative: true }, { key: 'due', name: 'Due date', position: 'a2' }),
  owner: makeField('people', { multiple: true }, { key: 'owner', name: 'Owner', position: 'a3' }),
  cost: makeField(
    'number',
    { unit: '', decimals: 0 },
    { key: 'cost', name: 'Cost', position: 'a4' },
  ),
  ok: makeField('check', {}, { key: 'ok', name: 'Checked', position: 'a5' }),
  notes: makeField('text', {}, { key: 'notes', name: 'Notes', position: 'a6' }),
};
const fields: Field[] = Object.values(f);
const items: Item[] = [
  // overdue, working
  makeItem(
    {
      [f.status.id]: opt('Working on it'),
      [f.due.id]: '2026-11-01',
      [f.owner.id]: ['u-maria'],
      [f.cost.id]: 10,
    },
    { id: 'a', name: 'Alpha' },
  ),
  // done, past date: not overdue
  makeItem(
    {
      [f.status.id]: opt('Done'),
      [f.due.id]: '2026-10-20',
      [f.owner.id]: ['u-james'],
      [f.cost.id]: 30,
      [f.ok.id]: true,
    },
    { id: 'b', name: 'Beta' },
  ),
  // due within 30 days
  makeItem(
    {
      [f.status.id]: opt('Working on it'),
      [f.due.id]: '2026-11-20',
      [f.owner.id]: ['u-maria'],
      [f.cost.id]: 5,
    },
    { id: 'c', name: 'Gamma' },
  ),
  // far off, no status
  makeItem({ [f.due.id]: '2027-02-03' }, { id: 'd', name: 'Delta' }),
];
const ctx = makeCtx({ fields, items });
const source = (over: Partial<InsightSource> = {}): InsightSource => ({
  sheet,
  fields,
  items,
  allItems: items,
  ctx,
  current: true,
  ...over,
});
const OTHER = '00000000-0000-4000-8000-000000000001';
const data = (
  over: Partial<InsightSource> = {},
  others: Record<string, InsightSource | 'loading'> = {},
): InsightsData => ({
  current: source(over),
  sheet: (id) => others[id] ?? null,
});
const w = (over: Partial<InsightWidget>): InsightWidget => ({
  id: 'w1',
  type: 'kpi',
  span: 6,
  filter: 'all',
  ...over,
});

describe('layout config', () => {
  const valid: InsightsLayout = {
    rows: [{ id: 'r1', height: 's', widgets: [w({}), w({ id: 'w2', type: 'note', text: 'Hi' })] }],
  };

  it('accepts a layout within the limits', () => {
    expect(insightsLayoutSchema.safeParse(valid).success).toBe(true);
    expect(layoutProblems(valid)).toEqual([]);
  });

  it('refuses more than 12 rows, 4 widgets a row, rows wider than 12 and long notes', () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, widgets: [] }));
    expect(layoutProblems({ rows })).toEqual(['A layout holds at most 12 rows.']);
    const five = Array.from({ length: 5 }, (_, i) => w({ id: `w${i}`, span: 3 }));
    expect(layoutProblems({ rows: [{ id: 'r', widgets: five }] })).toContain(
      'A row holds at most 4 widgets.',
    );
    expect(
      layoutProblems({ rows: [{ id: 'r', widgets: [w({ span: 8 }), w({ id: 'x', span: 6 })] }] }),
    ).toEqual(['The widgets of a row are wider than the row.']);
    expect(
      layoutProblems({
        rows: [{ id: 'r', widgets: [w({ type: 'note', text: 'x'.repeat(2001) })] }],
      }),
    ).toEqual(['Keep a note under 2000 characters.']);
  });

  it('refuses unknown widget types, widths and filters', () => {
    expect(insightWidgetFails({ type: 'pie' })).toBe(true);
    expect(insightWidgetFails({ span: 5 })).toBe(true);
    expect(insightWidgetFails({ filter: 'late' })).toBe(true);
    expect(insightWidgetFails({ src: 'not-a-sheet' })).toBe(true);
    expect(insightWidgetFails({ columns: ['a', 'b', 'c', 'd'] })).toBe(true);
  });

  it('reads stored layouts leniently: broken widgets dropped, overfull rows cut', () => {
    expect(parseInsightsLayout(undefined)).toBeNull();
    expect(parseInsightsLayout({ rows: 'x' })).toBeNull();
    const l = parseInsightsLayout({
      rows: [
        {
          id: 'r1',
          widgets: [
            w({ span: 8 }),
            { id: 'bad', type: 'pie' },
            w({ id: 'w3', span: 6 }),
            w({ id: 'w4', span: 4 }),
          ],
        },
        { id: 'r2', layout: [4, 4, 4], widgets: [] },
        { widgets: [] },
      ],
    });
    expect(l?.rows.map((r) => r.widgets.map((x) => x.id))).toEqual([['w1'], []]);
    expect(l?.rows[1]?.layout).toEqual([4, 4, 4]);
  });

  it('is part of the view config, and a broken layout does not lose the view', () => {
    expect(parseViewConfig({ insights: valid }).insights).toEqual(valid);
    const cfg = parseViewConfig({
      hidden: ['x'],
      insights: { rows: [{ id: 'r', widgets: [w({ type: 'nope' as never })] }] },
    });
    expect(cfg.hidden).toEqual(['x']);
    expect(cfg.insights).toEqual({ rows: [{ id: 'r', widgets: [] }] });
  });
});

function insightWidgetFails(over: Record<string, unknown>) {
  return !insightsLayoutSchema.safeParse({ rows: [{ id: 'r', widgets: [{ ...w({}), ...over }] }] })
    .success;
}

describe('field hooks', () => {
  it('groups by options, people and checkboxes, never text or numbers', () => {
    expect(groupFields(source()).map((x) => x.key)).toEqual(['status', 'owner', 'ok']);
  });
});

describe('kpi', () => {
  it('counts the items of each filter', () => {
    const n = (filter: InsightWidget['filter']) => computeWidget(w({ filter }), data());
    expect(n('all')).toMatchObject({ kind: 'figure', value: 4, caption: 'items', alert: false });
    expect(n('open')).toMatchObject({ value: 3, caption: 'of 4 items' });
    expect(n('done')).toMatchObject({ value: 1 });
    expect(n('overdue')).toMatchObject({ value: 1, alert: true });
    expect(n('soon')).toMatchObject({ value: 1 });
  });

  it('sums and averages a number field', () => {
    expect(computeWidget(w({ agg: 'sum', num: 'cost' }), data())).toMatchObject({
      value: 45,
      display: '45',
      caption: 'Cost · 4 items',
    });
    expect(computeWidget(w({ agg: 'avg', num: 'cost' }), data())).toMatchObject({ value: 15 });
    expect(widgetTitle(w({ agg: 'avg', num: 'cost' }), data())).toBe('Average cost');
    expect(widgetTitle(w({ filter: 'overdue' }), data())).toBe('Overdue');
  });

  it('dated filters match nothing on a sheet without dates', () => {
    const noDates = fields.filter((x) => x.key !== 'due');
    const s = { fields: noDates, ctx: makeCtx({ fields: noDates, items }) };
    expect(computeWidget(w({ filter: 'overdue' }), data(s))).toMatchObject({ value: 0 });
  });

  it('reads the view items of this sheet and all items of another', () => {
    const d = data({ items: items.slice(0, 2) }, { [OTHER]: source({ current: false }) });
    expect(computeWidget(w({}), d)).toMatchObject({ value: 2 });
    expect(computeWidget(w({ src: OTHER }), d)).toMatchObject({ value: 4 });
    expect(computeWidget(w({ src: '00000000-0000-4000-8000-000000000002' }), d)).toEqual({
      kind: 'unavailable',
    });
    expect(computeWidget(w({ src: OTHER }), data({}, { [OTHER]: 'loading' }))).toEqual({
      kind: 'loading',
    });
  });
});

describe('bars', () => {
  it('keeps option order, zero options included, and filters the Table from this sheet', () => {
    const r = computeWidget(w({ type: 'bars', by: 'status' }), data());
    if (r.kind !== 'bars') throw new Error('bars expected');
    expect(r.slices.map((s) => [s.label, s.value])).toEqual([
      ['Not started', 0],
      ['Working on it', 2],
      ['Stuck', 0],
      ['Done', 1],
    ]);
    expect(r.slices[1]).toMatchObject({ key: opt('Working on it'), color: 'orange' });
    expect(r).toMatchObject({ max: 2, filterable: true, fieldKey: 'status' });
  });

  it('people go largest first by name, monochrome, top N', () => {
    const r = computeWidget(w({ type: 'bars', by: 'owner', top: 1 }), data());
    if (r.kind !== 'bars') throw new Error('bars expected');
    expect(r.slices).toEqual([
      { key: 'u-maria', label: 'Maria Pereira', value: 2, count: 2, color: null, shade: 0 },
    ]);
  });

  it('checkboxes count empty as not ticked; sums by group', () => {
    const r = computeWidget(w({ type: 'bars', by: 'ok', agg: 'sum', num: 'cost' }), data());
    if (r.kind !== 'bars') throw new Error('bars expected');
    expect(r.slices.map((s) => [s.label, s.value])).toEqual([
      ['Ticked', 30],
      ['Not ticked', 15],
    ]);
  });

  it('defaults to the status field and says when nothing can group', () => {
    expect(widgetTitle(w({ type: 'bars' }), data())).toBe('By status');
    const plain = [f.notes];
    const r = computeWidget(
      w({ type: 'bars' }),
      data({ fields: plain, ctx: makeCtx({ fields: plain }) }),
    );
    expect(r).toEqual({
      kind: 'message',
      message: 'This sheet has no status, dropdown, people or checkbox field to group by.',
    });
  });

  it('another sheet does not filter this Table', () => {
    const r = computeWidget(
      w({ type: 'bars', src: OTHER }),
      data({}, { [OTHER]: source({ current: false }) }),
    );
    expect(r).toMatchObject({ kind: 'bars', filterable: false });
  });
});

describe('donut', () => {
  it('shares of the total with percentages', () => {
    const r = computeWidget(w({ type: 'donut', by: 'owner' }), data());
    if (r.kind !== 'donut') throw new Error('donut expected');
    expect(r.total).toBe(3);
    expect(r.caption).toBe('items');
    expect(r.slices.map((s) => [s.label, s.percent])).toEqual([
      ['Maria Pereira', 67],
      ['James Okafor', 33],
    ]);
  });
});

describe('cols', () => {
  it('items per month of the date field, oldest first, last N months', () => {
    const r = computeWidget(w({ type: 'cols', date: 'due' }), data());
    if (r.kind !== 'columns') throw new Error('columns expected');
    expect(r.columns.map((c) => [c.label, c.value])).toEqual([
      ['Oct 26', 1],
      ['Nov 26', 2],
      ['Feb 27', 1],
    ]);
    expect(r.columns[1]?.name).toBe('Nov 2026');
    const last = computeWidget(w({ type: 'cols', top: 1 }), data());
    expect(last.kind === 'columns' && last.columns.map((c) => c.key)).toEqual(['2027-02']);
    expect(widgetTitle(w({ type: 'cols' }), data())).toBe('By month · due date');
  });

  it('says when no item has a date in range', () => {
    expect(
      computeWidget(w({ type: 'cols', filter: 'done', top: 0 }), data({ items: [items[3]!] })),
    ).toEqual({
      kind: 'message',
      message: 'No dates in range.',
    });
  });
});

describe('progress', () => {
  it('share done and the split by status', () => {
    const r = computeWidget(w({ type: 'progress' }), data());
    if (r.kind !== 'progress') throw new Error('progress expected');
    expect(r).toMatchObject({ percent: 25, done: 1, total: 4, fieldName: 'Status' });
    expect(r.segments.map((s) => [s.label, s.value])).toEqual([
      ['Working on it', 2],
      ['Done', 1],
    ]);
  });

  it('needs a status field', () => {
    const plain = [f.due];
    expect(
      computeWidget(
        w({ type: 'progress' }),
        data({ fields: plain, ctx: makeCtx({ fields: plain }) }),
      ),
    ).toEqual({ kind: 'message', message: 'This sheet has no status field.' });
  });
});

describe('list', () => {
  it('sorted by date, default columns status · date · owner, "+n more"', () => {
    const r = computeWidget(w({ type: 'list', top: 2 }), data());
    if (r.kind !== 'list') throw new Error('list expected');
    expect(r.columns.map((c) => c.key)).toEqual(['status', 'due', 'owner']);
    expect(r.rows.map((x) => x.name)).toEqual(['Beta', 'Alpha']);
    expect(r.rows[1]?.cells[0]).toMatchObject({
      text: 'Working on it',
      option: { color: 'orange' },
    });
    expect(r.rows[1]?.cells[1]?.text).toBe('1 Nov 2026');
    expect(r.rows[1]?.cells[2]?.text).toBe('Maria Pereira');
    expect(r.more).toBe(2);
    expect(r).toMatchObject({ current: true, sheetId: sheet.id });
  });

  it('chosen columns, unknown keys skipped; filter in the title', () => {
    const r = computeWidget(
      w({ type: 'list', filter: 'overdue', columns: ['cost', 'gone'] }),
      data(),
    );
    if (r.kind !== 'list') throw new Error('list expected');
    expect(r.columns).toEqual([{ key: 'cost', name: 'Cost' }]);
    expect(r.rows.map((x) => x.name)).toEqual(['Alpha']);
    expect(widgetTitle(w({ type: 'list', filter: 'overdue' }), data())).toBe('Overdue');
  });
});

describe('note', () => {
  it('shows its text and reads no sheet', () => {
    expect(
      computeWidget(w({ type: 'note', text: ' Target: 0 overdue \n', src: OTHER }), data()),
    ).toEqual({
      kind: 'note',
      text: 'Target: 0 overdue',
    });
    expect(widgetTitle(w({ type: 'note', title: 'Targets' }), data())).toBe('Targets');
  });
});

describe('registry', () => {
  it('has a type for every id, with a label and an editor', () => {
    for (const [id, def] of Object.entries(INSIGHT_WIDGETS)) {
      expect(def.id).toBe(id);
      expect(def.label).toMatch(/^[A-Z][a-z]+( [a-z]+)?$/);
    }
  });
});

describe('default layout', () => {
  let n = 0;
  const newId = (p: string) => `${p}${++n}`;

  it('key figures, status and months, owner and overdue items, from the fields', () => {
    const l = defaultLayout(source(), newId);
    expect(insightsLayoutSchema.safeParse(l).success).toBe(true);
    expect(l.rows.map((r) => r.widgets.map((x) => `${x.type}:${x.span}:${x.title ?? ''}`))).toEqual(
      [
        ['kpi:3:Total items', 'kpi:3:Completed', 'kpi:3:Overdue', 'kpi:3:Due in 30 days'],
        ['bars:6:', 'cols:6:'],
        ['bars:6:By owner', 'list:6:Overdue · oldest first'],
      ],
    );
    expect(l.rows[0]?.height).toBe('s');
  });

  it('a sheet with only text fields gets one figure', () => {
    const plain = [f.notes];
    const l = defaultLayout({ sheet, fields: plain, ctx: makeCtx({ fields: plain }) }, newId);
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0]?.widgets).toMatchObject([{ type: 'kpi', span: 12, title: 'Total items' }]);
  });
});

describe('layout edits', () => {
  let n = 0;
  const newId = (p: string) => `${p}n${++n}`;
  const base = (): InsightsLayout => ({
    rows: [
      { id: 'r1', widgets: [w({ id: 'a', span: 6 }), w({ id: 'b', span: 6 })] },
      { id: 'r2', widgets: [w({ id: 'c', span: 4 })] },
    ],
  });
  const done = (e: Edit) => {
    if (!e.ok) throw new Error(e.error);
    return e.layout;
  };
  const ids = (l: InsightsLayout) =>
    l.rows.map((r) => r.widgets.map((x) => `${x.id}${x.span}`).join(' '));

  it('adds rows with a column plan whose places show as slots', () => {
    const l = done(addRow(base(), [4, 4, 4], newId));
    expect(l.rows[2]).toMatchObject({ height: 'm', layout: [4, 4, 4], widgets: [] });
    expect(openSlots(l.rows[2]!)).toEqual([4, 4, 4]);
    expect(openSlots(l.rows[1]!)).toEqual([8]);
    expect(openSlots(l.rows[0]!)).toEqual([]);
    const full = { rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, widgets: [] })) };
    expect(addRow(full, null, newId)).toEqual({
      ok: false,
      error: 'A layout holds at most 12 rows.',
    });
  });

  it('applies a row layout to its widgets, refusing when there are too many', () => {
    expect(ids(done(setRowLayout(base(), 'r1', [8, 4])))[0]).toBe('a8 b4');
    expect(setRowLayout(base(), 'r1', [12])).toEqual({
      ok: false,
      error: 'This row has 2 widgets. Remove or move 1 first.',
    });
  });

  it('resizes within the room of the row', () => {
    expect(ids(done(stepSpan(base(), 'c', 1)))[1]).toBe('c6');
    expect(ids(done(stepSpan(base(), 'c', -1)))[1]).toBe('c3');
    expect(stepSpan(base(), 'a', 1).ok).toBe(false);
    expect(ids(done(setSpan(base(), 'c', 12)))[1]).toBe('c12');
  });

  it('moves widgets left/right, between rows and rows up/down', () => {
    expect(ids(done(moveWithinRow(base(), 'a', 1)))[0]).toBe('b6 a6');
    // the row above is full
    expect(moveToAdjacentRow(base(), 'c', -1, newId).ok).toBe(false);
    const roomy = done(setSpan(done(setSpan(base(), 'a', 3)), 'b', 3));
    expect(ids(done(moveToAdjacentRow(roomy, 'c', -1, newId)))).toEqual(['a3 b3 c4', '']);
    expect(ids(done(moveToRow(roomy, 'c', 'r1', 0, newId)))).toEqual(['c4 a3 b3', '']);
    // below the last row starts a new one
    expect(ids(done(moveToAdjacentRow(base(), 'c', 1, newId)))).toEqual(['a6 b6', '', 'c4']);
    expect(ids(done(moveToRow(base(), 'b', 'r2', 0, newId)))).toEqual(['a6', 'b6 c4']);
    expect(done(moveRow(base(), 'r2', -1)).rows.map((x) => x.id)).toEqual(['r2', 'r1']);
    expect(done(removeRow(base(), 'r1')).rows.map((x) => x.id)).toEqual(['r2']);
  });

  it('adds, duplicates, replaces and removes widgets', () => {
    expect(placeForNew(base())).toEqual({ rowId: 'r2', span: 8 });
    expect(ids(done(addWidget(base(), 'r2', w({ id: 'd', span: 8 }), newId)))[1]).toBe('c4 d8');
    expect(addWidget(base(), 'r1', w({ id: 'd', span: 3 }), newId).ok).toBe(false);
    const added = done(addWidget(base(), null, w({ id: 'd', type: 'kpi' }), newId));
    expect(added.rows[2]).toMatchObject({ height: 's' });
    expect(ids(done(duplicateWidget(base(), 'c', newId)))[1]).toMatch(/^c4 wn\d+4$/);
    expect(duplicateWidget(base(), 'a', newId).ok).toBe(false);
    expect(
      done(replaceWidget(base(), w({ id: 'c', span: 4, title: 'New' }))).rows[1]?.widgets[0]?.title,
    ).toBe('New');
    expect(replaceWidget(base(), w({ id: 'a', span: 12 })).ok).toBe(false);
    expect(ids(done(removeWidget(base(), 'a')))[0]).toBe('b6');
  });
});
