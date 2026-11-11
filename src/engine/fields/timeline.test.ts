import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { timeline } from './timeline';

const nov = { start: '2026-11-01', end: '2026-11-20' };

describe('timeline', () => {
  contract(timeline, {
    valid: [
      [nov, nov],
      [{ start: '01/11/2026', end: '2026-11-20' }, nov],
      ['2026-11-11', { start: '2026-11-11', end: '2026-11-11' }],
      [{ start: '2026-11-01' }, { start: '2026-11-01', end: '2026-11-01' }],
    ],
    invalid: [
      { start: '2026-11-20', end: '2026-11-01' },
      'next week',
      '',
      null,
      { start: 'x', end: '2026-11-01' },
    ],
    parse: [
      ['1 Nov 2026 – 20 Nov 2026', nov],
      ['2026-11-01/2026-11-20', nov],
      ['01/11/2026 - 20/11/2026', nov],
      ['1 Nov 2026 to 20 Nov 2026', nov],
    ],
    text: [
      [nov, '1 Nov 2026 – 20 Nov 2026'],
      [{ start: '2026-11-11', end: '2026-11-11' }, '11 Nov 2026'],
    ],
    date: [
      [nov, '2026-11-20'],
      [null, null],
    ],
    order: [nov, { start: '2026-12-01', end: '2026-12-02' }],
  });

  it('rejects an end before the start', () => {
    expect(timeline.parseText('20 Nov 2026 – 1 Nov 2026', {}, makeCtx())).toBeNull();
    const field = makeField('timeline', {});
    const bad = { start: '2026-11-20', end: '2026-11-01' };
    expect(timeline.validate(bad, field, makeItem(), makeCtx())[0]?.code).toBe('end_before_start');
    expect(timeline.valueSchema.safeParse(bad).success).toBe(false);
  });

  it('round-trips its own text', () => {
    const ctx = makeCtx();
    expect(timeline.parseText(timeline.toText(nov, {}, ctx), {}, ctx)).toEqual(nov);
  });
});
