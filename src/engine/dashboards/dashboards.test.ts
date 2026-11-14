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
import { monthPoints } from './history';
import { plural } from './shared';

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
const risk = makeField('riskmatrix', FIELD_TYPES.riskmatrix.defaultConfig(), {
  key: 'risk',
  id: 'f-risk',
  name: 'Risk',
  position: 'a4',
});
const fields = [status, due, found, notes, risk];

const items = [
  makeItem(
    { 'f-status': 'opt_wip', 'f-due': '2026-11-01', 'f-notes': 'urgent', 'f-risk': { l: 2, i: 4 } },
    { id: 'i1', createdAt: '2026-08-10T09:00:00Z' },
  ),
  makeItem(
    { 'f-status': 'opt_wip', 'f-due': '2026-12-01', 'f-risk': { l: 2, i: 4 } },
    { id: 'i2', createdAt: '2026-09-05T09:00:00Z' },
  ),
  makeItem(
    { 'f-status': 'opt_done', 'f-due': '2026-10-01', 'f-risk': { l: 5, i: 5 } },
    { id: 'i3', createdAt: '2026-06-01T09:00:00Z' },
  ),
  makeItem({ 'f-due': '2026-11-10' }, { id: 'i4', createdAt: '2026-11-01T09:00:00Z' }),
];
const ctx = makeCtx({ fields, items });
const source: SheetSource = { sheet, fields, items, ctx };

const data: DashboardData = {
  today: '2026-11-11',
  timeZone: 'Europe/London',
  months: 6,
  sheet: (id) => (id === sheet.id ? source : undefined),
  sheets: () => [source],
  // i3 was "Working on it" until 20 Oct
  changes: [{ itemId: 'i3', fieldId: 'f-status', old: 'opt_wip', date: '2026-10-20' }],
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

  it('scope: a count says "of N" against the items in scope, and every kind reads only those', () => {
    // the rows of a shared register tagged with one standard: here the items in progress (i1, i2)
    const scope = [{ fieldKey: 'status', op: 'is_any_of', value: ['opt_wip'] }];
    const overdueOnes = [{ fieldKey: 'notes', op: 'contains', value: 'urg' }];
    expect(computeWidget(w({ conditions: overdueOnes }), data)).toMatchObject({
      value: 1,
      caption: 'of 4 actions in Corrective actions',
    });
    expect(computeWidget(w({ scope, conditions: overdueOnes }), data)).toMatchObject({
      value: 1,
      caption: 'of 2 actions in Corrective actions',
    });
    const bars = computeWidget(w({ type: 'by_option', fieldKey: 'status', scope }), data);
    expect(bars).toMatchObject({
      kind: 'bars',
      total: 2,
      caption: '2 actions in Corrective actions',
    });
    expect(computeWidget(w({ type: 'overdue', fieldKey: 'due', scope }), data)).toMatchObject({
      value: 1,
      caption: 'of 2 open items · Due date has passed',
    });
    const look = (id: string) => (id === sheet.id ? { fields, ctx } : undefined);
    expect(widgetProblem(w({ type: 'evidence_status', scope }), look)).toBe(
      'This widget does not use conditions.',
    );
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

  it('key_figures: done share and open items per month, from the change history', () => {
    const r = computeWidget(w({ type: 'key_figures', sheetId: null }), data);
    if (r.kind !== 'figures') throw new Error('figures expected');
    expect(r.period).toBe('Jun 2026 to Nov 2026');
    const [done, open] = r.figures;
    expect(done!.series.map((p) => [p.label, p.value])).toEqual([
      ['Jun', 0],
      ['Jul', 0],
      ['Aug', 0],
      ['Sep', 0],
      ['Oct', 33],
      ['Nov', 25],
    ]);
    expect(done).toMatchObject({
      display: '25%',
      delta: { direction: 'up', text: '25 pts', tone: 'good' },
    });
    expect(done!.note).toBe('Across 1 sheet · 1 of 4 items done');
    expect(open!.label).toBe('Open in Corrective actions');
    expect(open!.series.map((p) => p.value)).toEqual([1, 1, 2, 3, 2, 3]);
    expect(open!.delta).toMatchObject({ direction: 'up', text: '200%', tone: 'crit' });
  });

  it('key_figures: one sheet shows done, open and added', () => {
    const r = computeWidget(w({ type: 'key_figures' }), { ...data, months: 3 });
    if (r.kind !== 'figures') throw new Error('figures expected');
    expect(r.figures.map((f) => [f.key, f.display])).toEqual([
      ['done', '25%'],
      ['open', '3'],
      ['added', '2'],
    ]);
    const none = computeWidget(w({ type: 'key_figures', sheetId: null }), {
      ...data,
      sheets: () => [],
    });
    expect(none).toMatchObject({ kind: 'figures', figures: [] });
  });

  it('monthPoints: month ends, oldest first, ending today', () => {
    const p = monthPoints('2026-11-11', 12);
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({ date: '2025-12-31', label: 'Dec' });
    expect(p[2]).toEqual({ date: '2026-02-28', label: 'Feb' });
    expect(p[11]).toEqual({ date: '2026-11-11', label: 'Nov' });
  });

  it('done_by_sheet: share of items done per sheet with a status field', () => {
    const r = computeWidget(w({ type: 'done_by_sheet', sheetId: null }), data);
    expect(r).toMatchObject({
      kind: 'rows',
      meta: '1 sheet',
      rows: [{ label: 'Corrective actions', sub: '1 of 4 actions done', value: '25%', fill: 25 }],
    });
  });

  it('risk_heatmap: items per cell and per level, highest impact first', () => {
    const r = computeWidget(w({ type: 'risk_heatmap', fieldKey: 'risk' }), data);
    if (r.kind !== 'heatmap') throw new Error('heatmap expected');
    expect(r.total).toBe(3);
    expect(r.axes).toEqual({ x: 'Likelihood', y: 'Impact' });
    expect(r.rows[0]![4]).toMatchObject({ x: 5, y: 5, count: 1, level: 'Critical' });
    expect(r.rows[1]![1]).toMatchObject({ x: 2, y: 4, count: 2, level: 'Medium' });
    expect(r.levels.map((l) => [l.label, l.count])).toEqual([
      ['Low', 0],
      ['Medium', 2],
      ['High', 0],
      ['Critical', 1],
    ]);
    expect(widgetFieldChoices('risk_heatmap', fields, ctx).map((f) => f.key)).toEqual(['risk']);
    const look = (id: string) => (id === sheet.id ? { fields, ctx } : undefined);
    expect(widgetProblem(w({ type: 'risk_heatmap' }), look)).toBe('Choose a risk matrix field.');
  });

  it('follow_up: overdue per sheet, evidence and failed runs', () => {
    const r = computeWidget(w({ type: 'follow_up', sheetId: null }), data);
    if (r.kind !== 'rows') throw new Error('rows expected');
    expect(r.rows.map((x) => [x.label, x.value, x.sub])).toEqual([
      ['Corrective actions overdue', '2', '2 of 3 open · by due date'],
      ['Evidence expiring in 30 days', '1', 'Of 4 current files'],
      ['Evidence expired', '1', 'Renew or replace these files'],
      ['Automation runs failed', '1', 'Last 30 days, from the run log'],
    ]);
    expect(r.meta).toBe('4 need attention');
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
      ['key_figures', null],
      ['done_by_sheet', null],
      ['risk_heatmap', 'risk'],
      ['follow_up', null],
    ]);
    expect(new Set(out.map((x) => x.id)).size).toBe(out.length);
    for (const x of out) expect(WIDGET_TYPES[x.type]).toBeDefined();
  });

  it('uses items by status when no sheet has a risk matrix, and skips what cannot be computed', () => {
    const f = [status, due];
    const c = makeCtx({ fields: f });
    const out = defaultWidgets([{ sheet, fields: f, ctx: c }], (p) => p + Math.random());
    expect(out.map((x) => [x.type, x.fieldKey ?? null])).toEqual([
      ['key_figures', null],
      ['done_by_sheet', null],
      ['by_option', 'status'],
      ['follow_up', null],
    ]);
    const bare = defaultWidgets(
      [{ sheet, fields: [notes], ctx: makeCtx({ fields: [notes] }) }],
      (p) => p + Math.random(),
    );
    expect(bare.map((x) => x.type)).toEqual(['key_figures', 'follow_up']);
  });
});

describe('plural', () => {
  it('says entries, nonconformities, processes, days and runs', () => {
    expect(plural(2, 'entry')).toBe('2 entries');
    expect(plural(3, 'nonconformity')).toBe('3 nonconformities');
    expect(plural(1, 'nonconformity')).toBe('1 nonconformity');
    expect(plural(5, 'day')).toBe('5 days');
    expect(plural(2, 'process')).toBe('2 processes');
    expect(plural(0, 'run')).toBe('0 runs');
  });
});
