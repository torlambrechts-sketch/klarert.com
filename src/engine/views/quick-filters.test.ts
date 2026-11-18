import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { makeCtx, makeField, makeFile, makeItem } from '../testing/fixtures';
import {
  alertOptions,
  keyFigures,
  applyColumnFilters,
  applyQuickView,
  columnFilterCount,
  filterChoices,
  filterFields,
  quickViewCounts,
  quickViews,
  toggleColumnFilter,
  filterByKeys,
  ownersOf,
  quickFilter,
  statusChoices,
  statusFilterField,
} from './quick-filters';

const status = makeField('status', {
  options: [
    { id: 'todo', label: 'Not started', color: 'grey' },
    { id: 'doing', label: 'Working on it', color: 'orange' },
    { id: 'done', label: 'Done', color: 'green', done: true },
  ],
});
const owner = makeField('people', { multiple: true });
const items = [
  makeItem({ [status.id]: 'todo', [owner.id]: ['u-maria'] }),
  makeItem({ [status.id]: 'done', [owner.id]: ['u-maria', 'u-james'] }),
  makeItem({ [status.id]: 'todo' }),
];
const ctx = makeCtx({ fields: [status, owner], items });

describe('quick filters', () => {
  it('uses the item status field and counts its options', () => {
    expect(statusFilterField(ctx)?.id).toBe(status.id);
    expect(statusChoices(items, ctx).map((c) => [c.option.id, c.count])).toEqual([
      ['todo', 2],
      ['doing', 0],
      ['done', 1],
    ]);
  });

  it('lists owners by how many items they own', () => {
    expect(ownersOf(items, ctx)).toEqual(['u-maria', 'u-james']);
  });

  it('filters by status and owner together; nothing chosen keeps every item', () => {
    expect(quickFilter(items, new Set(), new Set(), ctx)).toHaveLength(3);
    expect(quickFilter(items, new Set(), new Set(['todo']), ctx)).toHaveLength(2);
    expect(quickFilter(items, new Set(['u-maria']), new Set(['todo']), ctx)).toEqual([items[0]]);
    expect(filterByKeys(items, null, new Set(['x']), ctx)).toHaveLength(3);
  });
});

describe('quick views (View ▾ and Filter ▾)', () => {
  const st = makeField('status', {
    options: [
      { id: 'todo', label: 'Not started', color: 'grey' },
      { id: 'stuck', label: 'Stuck', color: 'red' },
      { id: 'done', label: 'Done', color: 'green', done: true },
    ],
  });
  const who = makeField('people', { multiple: true });
  const due = makeField('date', { relative: true });
  const ev = makeField('evidence', {});
  // today is 2026-11-11
  const a = makeItem({ [st.id]: 'stuck', [who.id]: ['u-maria'], [due.id]: '2026-11-01' });
  const b = makeItem({ [st.id]: 'todo', [who.id]: ['u-james'], [due.id]: '2026-11-15' });
  const c = makeItem({ [st.id]: 'done', [who.id]: ['u-maria'], [due.id]: '2026-11-01' });
  const d = makeItem({ [st.id]: 'todo', [due.id]: '2026-11-30' });
  const all = [a, b, c, d];
  const world = makeCtx({
    fields: [st, who, due, ev],
    items: all,
    files: [makeFile({ itemId: b.id, fieldId: ev.id })],
  });

  it('offers the views the sheet can answer, Needs action for the "!" options', () => {
    expect(quickViews(world).map((v) => v.label)).toEqual([
      'Main table',
      'My items',
      'Overdue',
      'Due in 7 days',
      'Needs action',
      'Missing evidence',
    ]);
    expect(alertOptions(world).map((o) => o.id)).toContain('stuck');
    expect(quickViews(makeCtx({ fields: [] })).map((v) => v.id)).toEqual(['all']);
  });

  it('matches My items, Overdue (not done), Due in 7 days, the alert status and Missing evidence', () => {
    const ids = (v: Parameters<typeof applyQuickView>[1]) =>
      applyQuickView(all, v, world).map((i) => i.id);
    expect(ids('all')).toEqual([a.id, b.id, c.id, d.id]);
    expect(ids('mine')).toEqual([a.id, c.id]);
    expect(ids('overdue')).toEqual([a.id]);
    expect(ids('week')).toEqual([b.id]);
    expect(ids('alert')).toEqual([a.id]);
    expect(ids('evidence')).toEqual([a.id, c.id, d.id]);
  });

  it('counts each view', () => {
    expect(Object.fromEntries(quickViewCounts(all, world))).toEqual({
      all: 4,
      mine: 2,
      overdue: 1,
      week: 1,
      alert: 1,
      evidence: 3,
    });
  });

  it('gives up to five key figures', () => {
    expect(keyFigures(all, world).map((f) => [f.label, f.value])).toEqual([
      ['Items', 4],
      ['Open', 3],
      ['Overdue', 1],
      ['Needs action', 1],
      ['Missing evidence', 3],
    ]);
    expect(keyFigures(all, makeCtx({ fields: [] })).map((f) => f.id)).toEqual(['items']);
  });

  it('filters by options: any within a field, every field together; toggling drops empty fields', () => {
    let f = toggleColumnFilter({}, st.id, 'todo');
    expect(applyColumnFilters(all, f, world).map((i) => i.id)).toEqual([b.id, d.id]);
    f = toggleColumnFilter(f, who.id, 'u-james');
    expect(applyColumnFilters(all, f, world).map((i) => i.id)).toEqual([b.id]);
    expect(columnFilterCount(f)).toBe(2);
    f = toggleColumnFilter(toggleColumnFilter(f, st.id, 'todo'), who.id, 'u-james');
    expect(f).toEqual({});
  });

  it('lists a column per option and people field with counts', () => {
    expect(filterFields(world).map((f) => f.id)).toEqual([st.id, who.id]);
    expect(filterChoices(all, st, world).map((c) => [c.label, c.count])).toEqual([
      ['Not started', 2],
      ['Stuck', 1],
      ['Done', 1],
    ]);
    expect(filterChoices(all, who, world).map((c) => [c.label, c.count])).toEqual([
      ['Maria Pereira', 2],
      ['James Okafor', 1],
    ]);
  });
});
