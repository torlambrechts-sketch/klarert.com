import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { riskLevel, riskmatrix, riskStep } from './riskmatrix';

describe('riskmatrix', () => {
  contract(riskmatrix, {
    valid: [
      [
        { l: 4, i: 5 },
        { l: 4, i: 5 },
      ],
      [
        { l: '2', i: '3' },
        { l: 2, i: 3 },
      ],
      ['4x5', { l: 4, i: 5 }],
      ['L1 I1', { l: 1, i: 1 }],
    ],
    invalid: [null, '', { l: 6, i: 1 }, { l: 0, i: 3 }, '4x', { l: 2.5, i: 2 }, 20],
    parse: [
      ['4x5', { l: 4, i: 5 }],
      ['3 × 2', { l: 3, i: 2 }],
      ['L4 I5', { l: 4, i: 5 }],
      ['{"l":2,"i":2}', { l: 2, i: 2 }],
    ],
    text: [
      [{ l: 4, i: 5 }, '20 · Critical'],
      [{ l: 2, i: 2 }, '4 · Low'],
      [{ l: 3, i: 3 }, '9 · Medium'],
    ],
    number: [
      [{ l: 4, i: 5 }, 20],
      [{ l: 1, i: 3 }, 3],
    ],
    order: [
      { l: 2, i: 2 },
      { l: 3, i: 4 },
    ],
  });

  it('bands the score Low ≤ 4 < Medium ≤ 9 < High ≤ 15 < Critical', () => {
    const bands = [4, 9, 15];
    expect([1, 4, 5, 9, 10, 15, 16, 25].map((s) => riskLevel(s, bands))).toEqual([
      'Low',
      'Low',
      'Medium',
      'Medium',
      'High',
      'High',
      'Critical',
      'Critical',
    ]);
  });

  it('respects the matrix size', () => {
    const cfg = { ...riskmatrix.defaultConfig(), size: 3 };
    expect(riskmatrix.normalize('4x2', cfg, makeCtx())).toBeNull();
    expect(riskmatrix.normalize('3x3', cfg, makeCtx())).toEqual({ l: 3, i: 3 });
  });

  it('places values on the heatmap grid with their band', () => {
    const cfg = riskmatrix.defaultConfig();
    const m = riskmatrix.matrix!;
    expect(m.size(cfg)).toBe(5);
    expect(m.cell({ l: 2, i: 4 })).toEqual({ x: 2, y: 4 });
    expect(m.cell(null)).toBeNull();
    expect(m.level(1, 1, cfg)).toEqual({ rank: 1, label: 'Low' });
    expect(m.level(4, 5, cfg)).toEqual({ rank: 4, label: 'Critical' });
  });

  it('maps each level to a step of the Table meter', () => {
    expect((['Low', 'Medium', 'High', 'Critical'] as const).map(riskStep)).toEqual([1, 2, 3, 4]);
  });
});
