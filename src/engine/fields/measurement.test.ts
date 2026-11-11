import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, TODAY } from '../testing/fixtures';
import { measurement, onTarget } from './measurement';

const r1 = { at: '2026-10-01', v: 14 };
const r2 = { at: '2026-11-01', v: 12.5, by: 'u-maria', note: '' };

describe('measurement', () => {
  contract(measurement, {
    config: { unit: 'kg', target: 13, direction: 'down' },
    valid: [
      [
        [r2, r1],
        [r1, r2],
      ],
      [[{ at: '01/10/2026', v: '14' }], [r1]],
      [12.5, [{ at: TODAY, v: 12.5, by: 'u-maria' }]],
    ],
    invalid: [null, [], 'lots', [{ at: 'soon', v: 1 }], [{ at: '2026-11-01', v: 'x' }]],
    parse: [
      ['12.5', [{ at: TODAY, v: 12.5, by: 'u-maria' }]],
      ['2026-11-01: 12.5; 01/10/2026: 14', [r1, { at: '2026-11-01', v: 12.5 }]],
      ['[{"at":"2026-10-01","v":14}]', [r1]],
    ],
    text: [[[r1, r2], '12.5 kg']],
    number: [
      [[r1, r2], 12.5],
      [[r2, r1], 12.5],
    ],
    order: [[r2], [r1]],
  });

  it('checks the latest reading against the target', () => {
    const down = { unit: '', target: 13, direction: 'down' as const };
    expect(onTarget([r1, r2], down)).toBe(true);
    expect(onTarget([r1, r2, { at: '2026-11-05', v: 15 }], down)).toBe(false);
    expect(onTarget([r1, r2], { ...down, direction: 'up' })).toBe(false);
    expect(onTarget([r1], { ...down, target: null })).toBeNull();
    expect(onTarget(null, down)).toBeNull();
  });

  it('keeps readings sorted by date', () => {
    const v = measurement.normalize([r2, r1], measurement.defaultConfig(), makeCtx());
    expect(v?.map((x) => x.at)).toEqual(['2026-10-01', '2026-11-01']);
  });
});
