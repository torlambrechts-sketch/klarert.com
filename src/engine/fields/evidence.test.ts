import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeFile, makeItem, TODAY } from '../testing/fixtures';
import { evidence, freshness } from './evidence';

const f = (id: string, validUntil: string | null) =>
  makeFile({ id, itemId: 'i-ev', fieldId: 'f-ev', validUntil });

const current = f('file-a', '2027-06-01');
const expiring = f('file-b', '2026-11-30');
const expired = f('file-c', '2026-10-01');

describe('evidence', () => {
  contract(evidence, {
    valid: [
      [[current], [current]],
      [
        [current, expiring],
        [current, expiring],
      ],
      [current, [current]],
    ],
    invalid: [[], null, 'policy.pdf', [{ id: 'x' }]],
    parse: [
      ['policy.pdf', null],
      [JSON.stringify([current]), [current]],
      ['', null],
    ],
    text: [
      [[current, expiring], '2 files · expiring'],
      [[current], '1 file · current'],
      [[expired], '1 file · expired'],
    ],
    number: [[[current, expiring], 2]],
    date: [
      [[current, expiring], '2026-11-30'],
      [[f('file-d', null)], null],
    ],
    order: [[expiring], [current]],
    empty: [
      [[], true],
      [[current], false],
    ],
  });

  it('works out freshness from the earliest valid until', () => {
    expect(freshness([], TODAY)).toBe('none');
    expect(freshness([f('x', null)], TODAY)).toBe('current');
    expect(freshness([current], TODAY)).toBe('current');
    expect(freshness([f('x', '2026-12-11')], TODAY)).toBe('expiring');
    expect(freshness([f('x', '2026-12-12')], TODAY)).toBe('current');
    expect(freshness([f('x', TODAY)], TODAY)).toBe('expiring');
    expect(freshness([current, expired], TODAY)).toBe('expired');
  });

  it('reads current file versions from ctx.files', () => {
    const field = makeField('evidence', evidence.defaultConfig(), { id: 'f-ev' });
    const old = makeFile({ id: 'file-old', itemId: 'i-ev', fieldId: 'f-ev', replacedBy: 'file-a' });
    const ctx = makeCtx({ files: [old, current] });
    expect(evidence.compute!(makeItem({}, { id: 'i-ev' }), field, ctx)).toEqual([current]);
  });

  it('drives the calendar and the evidence trigger', () => {
    expect(evidence.calendarCapable).toBe(true);
    expect(evidence.triggers).toContain('evidence_expiring');
  });
});
