import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { calendarSpan, dayInput, laneInput } from '../fields/view-support';
import { makeCtx, makeField, makeItem, people } from '../testing/fixtures';
import type { Item } from '../types';
import { applyView, groupRows, matchesSearch, sortComparator, splitConditions } from './apply';
import { calendarEntries, entriesByDay, monthGrid, shiftMonth } from './calendar';
import { SUMMARY_LABELS } from '../summaries';
import {
  emptyConfig,
  isBuiltinViewId,
  parseViewConfig,
  sameConfig,
  setSummary,
  STORED_VIEW_TYPE,
  SUMMARY_FNS,
  toViewType,
  viewConfigSchema,
  viewTypeInput,
} from './config';
import { checkFormAnswers, defaultFormLayout, formLayoutProblems, formQuestions } from './form';
import { kanbanLanes, laneField, laneFields } from './kanban';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const statusCfg = FIELD_TYPES.status.defaultConfig();
const f = {
  title: makeField('text', {}, { key: 'title', name: 'Title', position: 'a0' }),
  status: makeField('status', statusCfg, { key: 'status', name: 'Status', position: 'a1' }),
  due: makeField('date', { relative: true }, { key: 'due', name: 'Due date', position: 'a2' }),
  period: makeField('timeline', {}, { key: 'period', name: 'Period', position: 'a3' }),
  owner: makeField('people', { multiple: true }, { key: 'owner', name: 'Owner', position: 'a4' }),
  lead: makeField('people', { multiple: false }, { key: 'lead', name: 'Lead', position: 'a5' }),
  cost: makeField(
    'number',
    { unit: '', decimals: 0 },
    { key: 'cost', name: 'Cost', position: 'a6' },
  ),
  score: makeField(
    'formula',
    { expr: '{cost} * 2', result: 'number' },
    { key: 'score', position: 'a7' },
  ),
  retain: makeField(
    'retention',
    { years: 1, fromFieldKey: 'due' },
    { key: 'retain', position: 'a8' },
  ),
  at: makeField('datetime', {}, { key: 'at', position: 'a9' }),
};
const fields = Object.values(f);
const working = statusCfg.options.find((o) => o.label === 'Working on it')!.id;
const done = statusCfg.options.find((o) => o.done)!.id;

describe('view config', () => {
  it('fills defaults and keeps what is valid', () => {
    expect(parseViewConfig({})).toEqual(emptyConfig());
    expect(parseViewConfig(null)).toEqual(emptyConfig());
    const cfg = parseViewConfig({
      filters: [{ fieldKey: 'status', op: 'is_any_of', value: ['x'] }],
      sort: [{ fieldKey: 'due', dir: 'desc' }],
      hidden: ['title'],
      labelFieldKey: 'status',
      summaries: { cost: 'average' },
      extra: true,
    });
    expect(cfg.summaries).toEqual({ cost: 'average' });
    expect(cfg.sort).toEqual([{ fieldKey: 'due', dir: 'desc' }]);
    expect(cfg).not.toHaveProperty('extra');
  });

  it('drops only the broken part of a stored config', () => {
    const cfg = parseViewConfig({
      filters: 'nope',
      summaries: { cost: 'nonsense' },
      hidden: ['a'],
      sort: [{ fieldKey: 'x' }],
      // the List's page size, from before the Table view: ignored
      pageSize: 50,
    });
    expect(cfg.filters).toEqual([]);
    expect(cfg).not.toHaveProperty('summaries');
    expect(cfg).not.toHaveProperty('pageSize');
    expect(cfg.hidden).toEqual(['a']);
    expect(cfg.sort).toEqual([]);
  });

  it('rejects bad input when validating a command', () => {
    expect(viewConfigSchema.safeParse({ summaries: { cost: 'avg' } }).success).toBe(false);
    expect(
      viewConfigSchema.safeParse({ sort: Array(6).fill({ fieldKey: 'a', dir: 'asc' }) }).success,
    ).toBe(false);
    expect(
      viewConfigSchema.safeParse({ form: { fields: [{ key: 'title', label: 'x'.repeat(201) }] } })
        .success,
    ).toBe(false);
  });

  it('compares configs ignoring hidden and summary order', () => {
    expect(
      sameConfig(
        { ...emptyConfig(), hidden: ['a', 'b'], summaries: { a: 'sum', b: 'range' } },
        { ...emptyConfig(), hidden: ['b', 'a'], summaries: { b: 'range', a: 'sum' } },
      ),
    ).toBe(true);
    expect(sameConfig(emptyConfig(), { ...emptyConfig(), summaries: { a: 'sum' } })).toBe(false);
  });

  it('turns column summaries on and off', () => {
    const on = setSummary(emptyConfig(), 'cost', 'sum');
    expect(on.summaries).toEqual({ cost: 'sum' });
    expect(setSummary(on, 'cost', 'average').summaries).toEqual({ cost: 'average' });
    const off = setSummary(on, 'cost', null);
    expect(off).not.toHaveProperty('summaries');
    expect(sameConfig(off, emptyConfig())).toBe(true);
  });

  it('offers every summary function the engine has', () => {
    expect([...SUMMARY_FNS].sort()).toEqual(Object.keys(SUMMARY_LABELS).sort());
  });

  it('knows the built-in view ids, the former List and Grid included', () => {
    expect(isBuiltinViewId('table')).toBe(true);
    expect(isBuiltinViewId('list')).toBe(true);
    expect(isBuiltinViewId('grid')).toBe(true);
    expect(isBuiltinViewId('8b1c2d3e-0000-4000-8000-000000000000')).toBe(false);
  });

  it('reads the former List and Grid types as Table and stores Table as the database accepts it', () => {
    expect(toViewType('list')).toBe('table');
    expect(toViewType('grid')).toBe('table');
    expect(toViewType('table')).toBe('table');
    expect(toViewType('kanban')).toBe('kanban');
    expect(toViewType('gallery')).toBeNull();
    expect(STORED_VIEW_TYPE.table).toBe('list');
    expect(viewTypeInput.parse('grid')).toBe('table');
    expect(viewTypeInput.safeParse('gallery').success).toBe(false);
  });
});

describe('calendar', () => {
  it('builds a Monday-first month grid', () => {
    const weeks = monthGrid(2026, 11); // 1 Nov 2026 is a Sunday
    expect(weeks[0]![0]).toEqual({ date: '2026-10-26', day: 26, inMonth: false });
    expect(weeks[0]![6]).toEqual({ date: '2026-11-01', day: 1, inMonth: true });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.at(-1)!.at(-1)!.date).toBe('2026-12-06');
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
    const feb = monthGrid(2027, 2); // 1 Feb 2027 is a Monday, 28 days
    expect(feb).toHaveLength(4);
    expect(feb[0]![0]!.date).toBe('2027-02-01');
  });

  it('moves between months across years', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('places dates, spans and computed dates', () => {
    const items = [
      makeItem({ [f.due.id]: '2026-11-11' }, { name: 'B due' }),
      makeItem({ [f.period.id]: { start: '2026-10-30', end: '2026-11-03' } }, { name: 'Span' }),
      makeItem({}, { name: 'No date' }),
    ];
    const ctx = makeCtx({ fields, items });
    expect(calendarEntries(items, f.due, ctx).map((e) => e.item.name)).toEqual(['B due']);
    const spans = calendarEntries(items, f.period, ctx);
    expect(spans).toHaveLength(1);
    const byDay = entriesByDay(spans, monthGrid(2026, 11));
    expect(byDay.get('2026-10-30')).toHaveLength(1);
    expect(byDay.get('2026-11-03')).toHaveLength(1);
    expect(byDay.get('2026-11-04')).toHaveLength(0);
    expect(calendarSpan(items[0]!, f.retain, ctx)).toEqual({
      start: '2027-11-11',
      end: '2027-11-11',
    });
    expect(calendarSpan(items[0]!, f.title, ctx)).toBeNull();
  });

  it('turns a clicked day into a value', () => {
    expect(dayInput(f.due, '2026-11-20')).toBe('2026-11-20');
    expect(dayInput(f.period, '2026-11-20')).toEqual({ start: '2026-11-20', end: '2026-11-20' });
    expect(dayInput(f.at, '2026-11-20')).toBe('2026-11-20T09:00');
    expect(dayInput(f.retain, '2026-11-20')).toBeUndefined();
  });
});

describe('kanban', () => {
  const items = [
    makeItem({ [f.status.id]: working, [f.lead.id]: ['u-james'] }, { name: 'A' }),
    makeItem({ [f.status.id]: done }, { name: 'B' }),
    makeItem({ [f.status.id]: 'gone' }, { name: 'C' }),
    makeItem({}, { name: 'D' }),
  ];
  const ctx = makeCtx({ fields, items });

  it('uses option fields and single-person fields as lanes', () => {
    expect(laneFields(fields, ctx).map((x) => x.key)).toEqual(['status', 'lead']);
    expect(laneField(fields, undefined, ctx)?.key).toBe('status');
    expect(laneField(fields, 'lead', ctx)?.key).toBe('lead');
    expect(laneField(fields, 'owner', ctx)?.key).toBe('status');
    expect(laneField([f.title], undefined, ctx)).toBeNull();
  });

  it('maps items to lanes with a lane for no value', () => {
    const lanes = kanbanLanes(f.status, items, ctx);
    expect(lanes.map((l) => l.key)).toEqual([...statusCfg.options.map((o) => o.id), null]);
    expect(lanes.find((l) => l.key === working)!.items.map((i) => i.name)).toEqual(['A']);
    expect(lanes.at(-1)!.items.map((i) => i.name)).toEqual(['C', 'D']);
    const people = kanbanLanes(f.lead, items, ctx);
    expect(people.find((l) => l.key === 'u-james')!.items.map((i) => i.name)).toEqual(['A']);
  });

  it('turns a lane into the value to save', () => {
    expect(laneInput(f.status, ctx, done)).toBe(done);
    expect(laneInput(f.status, ctx, null)).toBeNull();
    expect(laneInput(f.lead, ctx, 'u-maria')).toEqual(['u-maria']);
  });
});

describe('form layout', () => {
  const ctx = makeCtx({ fields });

  it('offers only fields people can fill in', () => {
    const layout = defaultFormLayout(fields);
    expect(layout.fields.map((q) => q.key)).toEqual([
      'title',
      'status',
      'due',
      'period',
      'owner',
      'lead',
      'cost',
      'retain',
      'at',
    ]);
    expect(formLayoutProblems(layout, fields)).toEqual([]);
  });

  it('reports fields that cannot be on a form, are gone or appear twice', () => {
    expect(
      formLayoutProblems(
        { fields: [{ key: 'score' }, { key: 'gone' }, { key: 'title' }, { key: 'title' }] },
        fields,
      ),
    ).toEqual([
      'score cannot be filled in on a form.',
      'Field "gone" no longer exists.',
      'Title is on the form twice.',
    ]);
  });

  it('shows questions in layout order with labels, help and required', () => {
    const qs = formQuestions(
      {
        fields: [
          { key: 'due', label: 'When did it happen?', required: true },
          { key: 'score' },
          { key: 'title', help: 'One line' },
        ],
      },
      fields,
    );
    expect(qs.map((q) => [q.label, q.help, q.required])).toEqual([
      ['When did it happen?', '', true],
      ['Title', 'One line', false],
    ]);
  });

  it('checks answers with the field registry', () => {
    const qs = formQuestions(
      {
        fields: [{ key: 'due', label: 'When', required: true }, { key: 'cost' }, { key: 'status' }],
      },
      fields,
    );
    const bad = checkFormAnswers(qs, ' ', { [f.cost.id]: 'lots' }, ctx, 'Incident');
    expect(bad.errors).toEqual({
      __name: 'Incident is required.',
      [f.due.id]: 'When is required.',
      [f.cost.id]: 'This is not a valid cost.',
    });
    const good = checkFormAnswers(
      qs,
      'Spill',
      { [f.due.id]: '11/11/2026', [f.cost.id]: '12', [f.status.id]: 'Done' },
      ctx,
    );
    expect(good.errors).toEqual({});
    expect(good.values).toEqual({ [f.due.id]: '2026-11-11', [f.cost.id]: 12, [f.status.id]: done });
  });
});

describe('apply a view', () => {
  const items: Item[] = [
    makeItem(
      { [f.title.id]: 'Guard rail', [f.status.id]: working, [f.cost.id]: 5 },
      { name: 'Guard', seq: 3, groupId: 'g-closed', position: 'a0' },
    ),
    makeItem(
      { [f.status.id]: done, [f.cost.id]: 50, [f.owner.id]: ['u-james'] },
      { name: 'alpha', seq: 1, position: 'a1' },
    ),
    makeItem({ [f.cost.id]: 50 }, { name: 'Beta', seq: 2, position: 'a2' }),
  ];
  const ctx = makeCtx({ fields, items });

  it('filters with AND, searches and sorts on several levels', () => {
    const out = applyView({
      items,
      fields,
      ctx,
      conditions: [{ fieldKey: 'cost', op: 'gte', value: 5 }],
      sort: [
        { fieldKey: 'cost', dir: 'desc' },
        { fieldKey: '__name', dir: 'asc' },
      ],
      search: '',
    });
    expect(out.map((i) => i.name)).toEqual(['alpha', 'Beta', 'Guard']);
    expect(
      applyView({ items, fields, ctx, conditions: [], sort: [], search: 'james' }).map(
        (i) => i.name,
      ),
    ).toEqual(['alpha']);
    expect(
      applyView({ items, fields, ctx, conditions: [], sort: [], search: 'working' }).map(
        (i) => i.name,
      ),
    ).toEqual(['Guard']);
    expect(
      applyView({
        items,
        fields,
        ctx,
        conditions: [],
        sort: [],
        search: '',
        serverIds: new Set([items[2]!.id]),
      }).map((i) => i.name),
    ).toEqual(['Beta']);
  });

  it('skips conditions that cannot run and says why', () => {
    const { valid, invalid } = splitConditions(
      [
        { fieldKey: 'gone', op: 'is', value: 'x' },
        { fieldKey: 'title', op: 'gt', value: 1 },
        { fieldKey: 'title', op: 'contains', value: 'g' },
      ],
      ctx,
    );
    expect(valid).toHaveLength(1);
    expect(
      splitConditions(
        [
          { fieldKey: 'title', op: 'contains', value: ' ' },
          { fieldKey: 'status', op: 'is_any_of', value: [] },
          { fieldKey: 'cost', op: 'between', value: [1, ''] },
          { fieldKey: 'due', op: 'overdue' },
        ],
        ctx,
      ).incomplete.map((c) => c.fieldKey),
    ).toEqual(['title', 'status', 'cost']);
    expect(invalid.map((i) => i.problem)).toEqual([
      'Field "gone" no longer exists.',
      '"gt" cannot be used on this field.',
    ]);
  });

  it('sorts by id and falls back to position', () => {
    expect(
      [...items].sort(sortComparator([{ fieldKey: '__id', dir: 'asc' }], ctx)).map((i) => i.seq),
    ).toEqual([1, 2, 3]);
    expect(
      [...items]
        .sort(sortComparator([{ fieldKey: 'gone', dir: 'asc' }], ctx))
        .map((i) => i.position),
    ).toEqual(['a0', 'a1', 'a2']);
  });

  it('groups rows in group order and skips empty groups', () => {
    const rows = groupRows([{ id: 'g-open' }, { id: 'g-empty' }, { id: 'g-closed' }], items);
    expect(rows.map((r) => [r.group.id, r.items.length])).toEqual([
      ['g-open', 2],
      ['g-closed', 1],
    ]);
    expect(matchesSearch(items[0]!, 'CA-', fields, ctx)).toBe(true);
    expect(people.length).toBeGreaterThan(0);
  });
});
