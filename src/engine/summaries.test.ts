import { describe, expect, it } from 'vitest';
import './fields/registry';
import {
  autoSummary,
  columnSummaries,
  defaultSummary,
  summarise,
  summaryOptions,
  type Summary,
} from './summaries';
import { makeCtx, makeField, makeFile, makeItem } from './testing/fixtures';

const status = makeField('status', {
  options: [
    { id: 'opt_todo', label: 'Not started', color: 'grey' },
    { id: 'opt_done', label: 'Done', color: 'green', done: true },
  ],
});
const num = makeField('number', { unit: '', decimals: 2 });
const pct = makeField('percent', { bar: true });
const due = makeField('date', { relative: true });
const check = makeField('check', {});
const owner = makeField('people', { multiple: true });
const ev = makeField('evidence', { validDays: 365, multiple: true, accept: [] });
const link = makeField('link', { targetSheetId: 's-x', multiple: true, inverseFieldId: null });
const txt = makeField('text', {});

const items = [
  makeItem({
    [status.id]: 'opt_done',
    [num.id]: 2,
    [pct.id]: 50,
    [due.id]: '2026-11-01',
    [check.id]: true,
    [owner.id]: ['u-maria'],
    [txt.id]: 'a',
  }),
  makeItem({
    [status.id]: 'opt_todo',
    [num.id]: 4,
    [pct.id]: 100,
    [due.id]: '2026-11-05',
    [owner.id]: ['u-maria', 'u-james'],
  }),
  makeItem({ [status.id]: 'opt_todo', [num.id]: 9, [due.id]: '2026-12-24' }),
  makeItem({}),
];
const ctx = makeCtx({
  fields: [status, num, pct, due, check, owner, ev, link, txt],
  items,
  links: { [`${items[0]!.id}:${link.id}`]: ['x1', 'x2'], [`${items[1]!.id}:${link.id}`]: ['x3'] },
  files: [
    makeFile({ itemId: items[0]!.id, fieldId: ev.id, validUntil: '2026-10-01' }),
    makeFile({ itemId: items[1]!.id, fieldId: ev.id, validUntil: '2026-11-20' }),
    makeFile({ itemId: items[2]!.id, fieldId: ev.id, validUntil: '2027-06-01' }),
  ],
});

const valueOf = (s: Summary) => (s.kind === 'value' ? s.value : undefined);

describe('summaries', () => {
  it('picks the default per kind, with average for percent', () => {
    expect(defaultSummary(num, ctx)).toBe('sum');
    expect(defaultSummary(pct, ctx)).toBe('average');
    expect(defaultSummary(status, ctx)).toBe('distribution');
    expect(defaultSummary(due, ctx)).toBe('range');
    expect(summaryOptions(num, ctx)).toEqual([
      'sum',
      'average',
      'median',
      'min',
      'max',
      'count_filled',
    ]);
  });

  it('computes number functions', () => {
    expect(summarise(num, items, ctx).text).toBe('15');
    expect(valueOf(summarise(num, items, ctx, 'average'))).toBe(5);
    // the average reads with one decimal
    const scores = [20, 12, 9, 8].map((n) => makeItem({ [num.id]: n }));
    expect(summarise(num, scores, ctx, 'average').text).toBe('12.3');
    expect(valueOf(summarise(num, items, ctx, 'median'))).toBe(4);
    expect(valueOf(summarise(num, items, ctx, 'max'))).toBe(9);
    expect(summarise(pct, items, ctx).text).toBe('75');
    expect(summarise(num, items, ctx, 'count_filled').text).toBe('3 of 4 filled');
  });

  it('shows a distribution of options with empties last', () => {
    const s = summarise(status, items, ctx);
    expect(s.kind).toBe('segments');
    if (s.kind !== 'segments') return;
    expect(s.segments.map((x) => [x.label, x.count])).toEqual([
      ['Not started', 2],
      ['Done', 1],
      ['Empty', 1],
    ]);
  });

  it('dates: range and overdue (not done items only)', () => {
    expect(summarise(due, items, ctx).text).toBe('1 Nov 2026 – 24 Dec 2026');
    expect(summarise(due, items, ctx, 'count_overdue').text).toBe('1 overdue');
  });

  it('booleans, people, files, links and text', () => {
    expect(summarise(check, items, ctx).text).toBe('25% checked');
    expect(summarise(check, items, ctx, 'count_checked').text).toBe('1 checked');
    expect(summarise(owner, items, ctx).text).toBe('2 of 4 filled');
    const people = summarise(owner, items, ctx, 'distinct');
    expect(people.kind === 'people' && people.ids).toHaveLength(2);
    expect(summarise(ev, items, ctx, 'count_with_files').text).toBe('3 of 4');
    const f = summarise(ev, items, ctx);
    expect(f.kind === 'segments' && f.segments.map((x) => [x.id, x.count])).toEqual([
      ['current', 1],
      ['expiring', 1],
      ['expired', 1],
      ['', 1],
    ]);
    expect(summarise(link, items, ctx).text).toBe('3 links');
    expect(summarise(link, items, ctx, 'items_with_links').text).toBe('2 with links');
    expect(summarise(txt, items, ctx).text).toBe('1 of 4 filled');
  });

  it('falls back to the default for an option the kind does not offer', () => {
    expect(summarise(num, items, ctx, 'distribution').fn).toBe('sum');
  });

  it('shows number, option, date, people and file summaries by default (docs/18 C6), others only when chosen', () => {
    expect(autoSummary(pct, ctx)).toBe('average');
    expect(autoSummary(status, ctx)).toBe('distribution');
    expect(autoSummary(due, ctx)).toBe('range');
    expect(autoSummary(txt, ctx)).toBeNull();
    expect(autoSummary(owner, ctx)).toBe('distinct');
    expect(autoSummary(ev, ctx)).toBe('count_with_files');
    const fields = [status, num, pct, due, txt, owner];
    expect(columnSummaries(fields, undefined, undefined, ctx)).toEqual({
      [status.key]: 'distribution',
      [num.key]: 'sum',
      [pct.key]: 'average',
      [due.key]: 'range',
      [owner.key]: 'distinct',
    });
    // a chosen function wins, a switched-off column has none
    expect(
      columnSummaries(fields, { [txt.key]: 'count_filled', [num.key]: 'max' }, [due.key], ctx),
    ).toEqual({
      [status.key]: 'distribution',
      [num.key]: 'max',
      [pct.key]: 'average',
      [txt.key]: 'count_filled',
      [owner.key]: 'distinct',
    });
  });
});
