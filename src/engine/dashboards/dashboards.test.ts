import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem, sheet } from '../testing/fixtures';
import {
  computeWidget,
  defaultWidgets,
  parseDashboardConfig,
  widgetFieldChoices,
  widgetProblem,
  WIDGET_TYPES,
  type DashboardData,
  type SheetSource,
  type WidgetConfig,
} from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

// today 2026-11-11 (fixtures)
const status = makeField('status', FIELD_TYPES.status.defaultConfig(), {
  key: 'status',
  id: 'f-status',
  name: 'Status',
  position: 'a0',
});
const due = makeField(
  'date',
  { relative: true },
  { key: 'due', id: 'f-due', name: 'Due date', position: 'a1' },
);
const found = makeField(
  'date',
  { relative: false },
  { key: 'found', id: 'f-found', name: 'Found on', position: 'a2' },
);
const notes = makeField('text', {}, { key: 'notes', id: 'f-notes', position: 'a3' });
const fields = [status, due, found, notes];

const items = [
  makeItem({ 'f-status': 'opt_wip', 'f-due': '2026-11-01', 'f-notes': 'urgent' }, { id: 'i1' }),
  makeItem({ 'f-status': 'opt_wip', 'f-due': '2026-12-01' }, { id: 'i2' }),
  makeItem({ 'f-status': 'opt_done', 'f-due': '2026-10-01' }, { id: 'i3' }),
  makeItem({ 'f-due': '2026-11-10' }, { id: 'i4' }),
];
const ctx = makeCtx({ fields, items });
const source: SheetSource = { sheet, fields, items, ctx };

const data: DashboardData = {
  today: '2026-11-11',
  sheet: (id) => (id === sheet.id ? source : undefined),
  evidence: [
    { sheetId: sheet.id, validUntil: '2026-10-01' },
    { sheetId: sheet.id, validUntil: '2026-11-20' },
    { sheetId: 'other', validUntil: '2027-11-20' },
    { sheetId: 'other', validUntil: null },
  ],
  runs: [
    { sheetId: sheet.id, status: 'done', date: '2026-11-11' },
    { sheetId: sheet.id, status: 'failed', date: '2026-11-05' },
    { sheetId: 'other', status: 'done', date: '2026-11-04' },
    { sheetId: sheet.id, status: 'done', date: '2026-09-01' },
  ],
};

const w = (over: Partial<WidgetConfig>): WidgetConfig => ({
  id: 'w1',
  type: 'count',
  title: 'Widget',
  sheetId: sheet.id,
  ...over,
});

describe('widget registry', () => {
  it('count: items matching conditions', () => {
    expect(computeWidget(w({}), data)).toMatchObject({ kind: 'stat', value: 4 });
    expect(
      computeWidget(w({ conditions: [{ fieldKey: 'notes', op: 'contains', value: 'urg' }] }), data),
    ).toMatchObject({ kind: 'stat', value: 1 });
  });

  it('by_option: bars per option in order, plus "No value"', () => {
    const r = computeWidget(w({ type: 'by_option', fieldKey: 'status' }), data);
    expect(r.kind).toBe('bars');
    if (r.kind !== 'bars') return;
    expect(r.bars.map((b) => [b.label, b.value])).toEqual([
      ['Not started', 0],
      ['Working on it', 2],
      ['Stuck', 0],
      ['Done', 1],
      ['No value', 1],
    ]);
    expect(r.total).toBe(4);
  });

  it('overdue: date before today and not done', () => {
    expect(computeWidget(w({ type: 'overdue', fieldKey: 'due' }), data)).toMatchObject({
      kind: 'stat',
      value: 2,
      tone: 'crit',
    });
  });

  it('evidence_status: files by validity, all sheets or one', () => {
    const all = computeWidget(w({ type: 'evidence_status', sheetId: null }), data);
    if (all.kind !== 'bars') throw new Error('bars expected');
    expect(all.bars.map((b) => b.value)).toEqual([1, 1, 1, 1]);
    const one = computeWidget(w({ type: 'evidence_status' }), data);
    if (one.kind !== 'bars') throw new Error('bars expected');
    expect(one.total).toBe(2);
  });

  it('automation_runs: runs by status in the last N days', () => {
    const r = computeWidget(w({ type: 'automation_runs', sheetId: null, days: 8 }), data);
    if (r.kind !== 'bars') throw new Error('bars expected');
    expect(r.total).toBe(3);
    expect(r.bars.find((b) => b.key === 'failed')?.value).toBe(1);
    expect(r.caption).toBe('3 runs in the last 8 days');
  });

  it('turns missing sheets, fields and unknown types into problems', () => {
    expect(computeWidget(w({ sheetId: crypto.randomUUID() }), data).kind).toBe('problem');
    expect(computeWidget(w({ type: 'by_option', fieldKey: 'gone' }), data).kind).toBe('problem');
    expect(computeWidget(w({ type: 'nope' }), data).kind).toBe('problem');
  });

  it('checks a widget before it is saved', () => {
    const look = (id: string) => (id === sheet.id ? { fields, ctx } : undefined);
    expect(widgetProblem(w({}), look)).toBeNull();
    expect(widgetProblem(w({ type: 'by_option', fieldKey: 'notes' }), look)).toMatch(/field/);
    expect(widgetProblem(w({ type: 'overdue' }), look)).toBe('Choose a date field.');
    expect(widgetProblem(w({ type: 'count', sheetId: null }), look)).toBe('Choose a sheet.');
    expect(widgetProblem(w({ type: 'evidence_status', sheetId: null }), look)).toBeNull();
    expect(widgetFieldChoices('overdue', fields, ctx).map((f) => f.key)).toEqual(['due', 'found']);
  });
});

describe('stored config', () => {
  it('drops broken widgets and unknown shapes', () => {
    expect(parseDashboardConfig(null)).toEqual({ widgets: [] });
    expect(
      parseDashboardConfig({ widgets: [w({}), { type: 'count' }, w({ id: 'bad id!' })] }).widgets,
    ).toHaveLength(1);
  });
});

describe('default dashboard', () => {
  it('builds widgets from the sheets that exist', () => {
    let n = 0;
    const out = defaultWidgets([{ sheet, fields, ctx }], (p) => `${p}${++n}`);
    expect(out.map((x) => [x.type, x.fieldKey ?? null])).toEqual([
      ['by_option', 'status'],
      ['overdue', 'due'],
      ['evidence_status', null],
      ['automation_runs', null],
    ]);
    expect(new Set(out.map((x) => x.id)).size).toBe(out.length);
    for (const x of out) expect(WIDGET_TYPES[x.type]).toBeDefined();
  });

  it('falls back to a count for sheets without status or dates', () => {
    const c = makeCtx({ fields: [notes] });
    const out = defaultWidgets([{ sheet, fields: [notes], ctx: c }], (p) => p + Math.random());
    expect(out[0]).toMatchObject({ type: 'count', sheetId: sheet.id });
  });
});
