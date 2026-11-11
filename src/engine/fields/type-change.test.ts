import { describe, expect, it } from 'vitest';
import './registry';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { FIELD_TYPE_IDS } from './registry';
import {
  convertValue,
  inPlaceTargets,
  planTypeChange,
  summarizeConversion,
  typeChangeMode,
} from './type-change';

describe('type change compatibility (docs/03 §5)', () => {
  it('allows the listed families in place', () => {
    expect(typeChangeMode('text', 'email')).toBe('in_place');
    expect(typeChangeMode('number', 'rating')).toBe('in_place');
    expect(typeChangeMode('status', 'severity')).toBe('in_place');
    expect(typeChangeMode('dropdown', 'multiselect')).toBe('in_place');
    expect(typeChangeMode('date', 'timeline')).toBe('in_place');
    expect(typeChangeMode('timeline', 'date')).toBe('copy');
    expect(typeChangeMode('check', 'yesno')).toBe('in_place');
    expect(typeChangeMode('link', 'requirement')).toBe('in_place');
    expect(typeChangeMode('severity', 'text')).toBe('in_place');
  });
  it('refuses computed types and offers copy otherwise', () => {
    expect(typeChangeMode('formula', 'text')).toBe('none');
    expect(typeChangeMode('text', 'formula')).toBe('none');
    expect(typeChangeMode('number', 'date')).toBe('copy');
    expect(typeChangeMode('evidence', 'text')).toBe('none');
    expect(typeChangeMode('text', 'text')).toBe('none');
  });
  it('lists in-place targets', () => {
    expect(inPlaceTargets('check', FIELD_TYPE_IDS)).toEqual(['text', 'yesno']);
  });
});

describe('planTypeChange', () => {
  const ctx = makeCtx();
  it('converts numbers to ratings, clamped, and reports the preview', () => {
    const f = makeField('number', { unit: '', decimals: 2 });
    const items = [
      makeItem({ [f.id]: 4 }),
      makeItem({ [f.id]: 12 }),
      makeItem({ [f.id]: 2.4 }),
      makeItem({}),
    ];
    const plan = planTypeChange(f, 'rating', items, ctx);
    expect([...plan.values.values()]).toEqual([4, 5, 2]);
    expect(plan.summary).toBe('3 of 3 values convert');
  });
  it('matches options by label and adds missing labels', () => {
    const f = makeField('status', {
      options: [
        { id: 'opt_a', label: 'High', color: 'blue' },
        { id: 'opt_b', label: 'Unusual', color: 'pink' },
      ],
    });
    const items = [makeItem({ [f.id]: 'opt_a' }), makeItem({ [f.id]: 'opt_b' })];
    const plan = planTypeChange(f, 'severity', items, ctx);
    const opts = (plan.config as { options: { id: string; label: string; color: string }[] })
      .options;
    expect(opts.map((o) => [o.id, o.label, o.color])).toEqual([
      ['opt_a', 'High', 'orange'],
      ['opt_b', 'Unusual', 'pink'],
    ]);
    expect([...plan.values.values()]).toEqual(['opt_a', 'opt_b']);
  });
  it('turns text into emails where it can', () => {
    const f = makeField('text', {});
    const items = [makeItem({ [f.id]: 'Maria@Example.com' }), makeItem({ [f.id]: 'not an email' })];
    const plan = planTypeChange(f, 'email', items, ctx);
    expect([...plan.values.values()]).toEqual(['maria@example.com', null]);
    expect(plan.summary).toBe('1 of 2 values convert, 1 becomes empty');
  });
  it('dates become timelines and checkboxes become yes/no', () => {
    const d = makeField('date', { relative: true });
    expect(convertValue('2026-11-20', d, 'timeline', {}, ctx)).toEqual({
      start: '2026-11-20',
      end: '2026-11-20',
    });
    const c = makeField('check', {});
    expect(convertValue(true, c, 'yesno', { allowNA: true }, ctx)).toBe('yes');
    expect(convertValue(false, c, 'yesno', { allowNA: true }, ctx)).toBe('no');
  });
  it('words the summary', () => {
    expect(summarizeConversion(40, 38)).toBe('38 of 40 values convert, 2 become empty');
    expect(summarizeConversion(0, 0)).toBe('No values to convert.');
  });
});
