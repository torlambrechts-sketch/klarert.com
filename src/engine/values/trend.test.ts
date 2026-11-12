import { describe, expect, it } from 'vitest';
import '../fields/registry';
import { makeCtx, makeField, NOW } from '../testing/fixtures';
import {
  buildTrend,
  groupChanges,
  trendFields,
  trendLabel,
  trendOf,
  trendPolarity,
  trendSince,
  type TrendChange,
} from './trend';

const ch = (at: string, oldValue: unknown, newValue: unknown, over: Partial<TrendChange> = {}) =>
  ({ itemId: 'i1', fieldId: 'f1', at, oldValue, newValue, ...over }) as TrendChange;
const n = (v: unknown) => (typeof v === 'number' ? v : null);

describe('trend', () => {
  const risk = makeField('riskmatrix', {
    size: 5,
    bands: [4, 9, 15],
    likelihoodLabels: [],
    impactLabels: [],
  });
  const plain = makeField('number', { unit: '', decimals: 0 });
  const banded = makeField('number', { unit: '', decimals: 0, bands: [1, 2, 3] });
  const better = makeField('number', {
    unit: '',
    decimals: 0,
    bands: [1, 2, 3],
    higherIsBetter: true,
  });

  it('knows which fields get a trend and which way is good', () => {
    expect(trendPolarity(risk)).toBe('worse');
    expect(trendPolarity(plain)).toBeNull();
    expect(trendPolarity(banded)).toBe('neutral');
    expect(trendPolarity(better)).toBe('better');
    expect(trendPolarity(makeField('text', {}))).toBeNull();
    expect(trendFields([risk, plain, banded]).map((f) => f.id)).toEqual([risk.id, banded.id]);
  });

  it('starts the window twelve months back', () => {
    expect(trendSince(NOW)).toBe('2025-11-11T12:00:00.000Z');
  });

  it('groups changes per item and field, oldest first, keeping the newest', () => {
    const rows = [
      ch('2026-03-01T00:00:00Z', 2, 3),
      ch('2026-01-01T00:00:00Z', 1, 2),
      ch('2026-05-01T00:00:00Z', 3, 4),
      ch('2026-02-01T00:00:00Z', null, 9, { itemId: 'i2' }),
    ];
    const g = groupChanges(rows, 2);
    expect(g.get('i1|f1')!.map((c) => c.newValue)).toEqual([3, 4]);
    expect(g.get('i2|f1')!.map((c) => c.newValue)).toEqual([9]);
  });

  it('builds points oldest to current and adds a current value not yet logged', () => {
    const t = buildTrend(
      [ch('2026-01-01T00:00:00Z', 12, 15), ch('2026-02-01T00:00:00Z', 15, 16)],
      20,
      n,
      'worse',
    );
    expect(t.points).toEqual([12, 15, 16, 20]);
    expect(t.direction).toBe('up');
    expect(t.tone).toBe('bad');
    expect(trendLabel(t)).toBe('Trend: 12 → 20, rising');
  });

  it('does not repeat the current value and skips empty values', () => {
    const t = buildTrend(
      [
        ch('2026-01-01T00:00:00Z', null, 9),
        ch('2026-02-01T00:00:00Z', 9, null),
        ch('2026-03-01T00:00:00Z', null, 4),
      ],
      4,
      n,
      'worse',
    );
    expect(t.points).toEqual([9, 4]);
    expect(t.direction).toBe('down');
    expect(t.tone).toBe('good');
  });

  it('is level and neutral when it ends where it started, or for neutral fields', () => {
    expect(buildTrend([ch('a', 3, 5), ch('b', 5, 3)], 3, n, 'worse')).toMatchObject({
      direction: 'flat',
      tone: 'neutral',
    });
    expect(buildTrend([ch('a', 3, 5)], 5, n, 'neutral')).toMatchObject({
      direction: 'up',
      tone: 'neutral',
    });
    expect(buildTrend([ch('a', 3, 5)], 5, n, 'better').tone).toBe('good');
  });

  it('has a single point without history and caps the points', () => {
    expect(buildTrend([], 7, n, 'worse').points).toEqual([7]);
    const many = Array.from({ length: 20 }, (_, i) =>
      ch(`t${String(i).padStart(2, '0')}`, i, i + 1),
    );
    expect(buildTrend(many, 20, n, 'worse', 12).points).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it('reads risk scores through the field type', () => {
    const ctx = makeCtx({ fields: [risk] });
    const g = groupChanges([
      ch('2026-01-01T00:00:00Z', { l: 2, i: 2 }, { l: 3, i: 3 }, { fieldId: risk.id }),
    ]);
    const t = trendOf(g, 'i1', risk, { l: 4, i: 5 }, ctx)!;
    expect(t.points).toEqual([4, 9, 20]);
    expect(t.tone).toBe('bad');
    expect(trendOf(g, 'i1', plain, 3, ctx)).toBeNull();
  });
});
