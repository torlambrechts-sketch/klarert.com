import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { meta, metaKind, type MetaConfig } from './meta';

const by: MetaConfig = { which: 'updated_by' };

describe('meta', () => {
  contract(meta, {
    valid: [
      ['2026-11-11T14:20:00Z', '2026-11-11T14:20:00.000Z'],
      ['2026-11-11T14:20:00+01:00', '2026-11-11T13:20:00.000Z'],
      ['2026-11-01T09:00:00.000Z', '2026-11-01T09:00:00.000Z'],
    ],
    invalid: ['2026-11-11', 'yesterday', null, 42],
    parse: [
      ['2026-11-11T14:20:00Z', '2026-11-11T14:20:00.000Z'],
      ['2026-11-11 14:20:00Z', '2026-11-11T14:20:00.000Z'],
      [' 2026-06-30T23:30:00Z ', '2026-06-30T23:30:00.000Z'],
    ],
    text: [
      ['2026-11-11T14:20:00Z', '11 Nov 2026, 14:20'],
      ['2026-06-30T23:30:00Z', '1 Jul 2026, 00:30'],
    ],
    number: [['2026-11-11T14:20:00Z', null]],
    date: [
      ['2026-06-30T23:30:00Z', '2026-07-01'],
      [null, null],
    ],
    order: ['2026-11-01T09:00:00Z', '2026-11-11T09:00:00Z'],
  });

  describe('created_by / updated_by', () => {
    contract(meta, {
      config: by,
      valid: [
        ['u-james', 'u-james'],
        ['maria@example.com', 'u-maria'],
        ['me', 'u-maria'],
      ],
      invalid: ['nobody', null, ''],
      parse: [
        ['James Okafor', 'u-james'],
        ['JAMES@EXAMPLE.COM', 'u-james'],
        ['u-vic', 'u-vic'],
      ],
      text: [
        ['u-james', 'James Okafor'],
        ['u-gone', ''],
      ],
      date: [['u-james', null]],
      order: ['u-james', 'u-maria'],
    });
  });

  it('reads the item columns and filters as a date or as people', () => {
    const ctx = makeCtx();
    const item = makeItem({}, { createdBy: 'u-james', updatedAt: '2026-11-10T09:00:00Z' });
    const f = (which: MetaConfig['which']) => makeField<MetaConfig>('meta', { which });
    expect(meta.compute!(item, f('created_by'), ctx)).toBe('u-james');
    expect(meta.compute!(item, f('updated_at'), ctx)).toBe('2026-11-10T09:00:00Z');
    expect(meta.compute!(makeItem({}, { updatedBy: null }), f('updated_by'), ctx)).toBeNull();
    expect(metaKind({ which: 'created_at' })).toBe('date');
    expect(metaKind(by)).toBe('people');
  });
});
