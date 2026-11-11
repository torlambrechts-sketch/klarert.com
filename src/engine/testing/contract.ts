// Table-driven contract checks every field type test runs (docs/03 §9). Type-specific rules go in the
// type's own test file next to this call.
import { expect, it } from 'vitest';
import type { AnyFieldType } from '../fields/types';
import type { Ctx } from '../types';
import { makeCtx } from './fixtures';

export interface ContractCases {
  /** [input, expected normalised value] */
  valid: [unknown, unknown][];
  /** inputs that normalise to null */
  invalid: unknown[];
  /** [pasted text, expected value]; at least three, one Excel/Sheets-style */
  parse: [string, unknown][];
  /** [value, text] */
  text: [unknown, string][];
  /** [value, number | null] */
  number?: [unknown, number | null][];
  /** [value, ISO date | null] */
  date?: [unknown, string | null][];
  /** two non-empty values with a < b */
  order: [unknown, unknown];
  /** [value, isEmpty] */
  empty?: [unknown, boolean][];
  /** [value, isDone] */
  done?: [unknown, boolean][];
  config?: unknown;
  ctx?: Ctx;
}

export function contract(def: AnyFieldType, cases: ContractCases) {
  const cfg = cases.config ?? def.defaultConfig();
  const ctx = cases.ctx ?? makeCtx();

  it('has a valid default config', () => {
    expect(def.configSchema.safeParse(def.defaultConfig()).success).toBe(true);
  });

  it.each(cases.valid)('normalises %j', (input, expected) => {
    const v = def.normalize(input, cfg, ctx);
    expect(v).toEqual(expected);
    if (v !== null) expect(def.valueSchema.safeParse(v).success).toBe(true);
  });

  it.each(cases.invalid.map((x) => [x]))('rejects %j', (input) => {
    expect(def.normalize(input, cfg, ctx)).toBeNull();
  });

  it.each(cases.parse)('parses text %j', (text, expected) => {
    expect(def.parseText(text, cfg, ctx)).toEqual(expected);
  });

  it.each(cases.text)('shows %j as %j', (v, text) => {
    expect(def.toText(v, cfg, ctx)).toBe(text);
  });

  if (cases.number) {
    it.each(cases.number)('toNumber(%j) = %j', (v, n) => {
      expect(def.toNumber(v, cfg, ctx)).toBe(n);
    });
  }

  if (cases.date) {
    it.each(cases.date)('toDate(%j) = %j', (v, d) => {
      expect(def.toDate(v, cfg, ctx)).toBe(d);
    });
  }

  it('sorts values and puts empties last', () => {
    const [a, b] = cases.order;
    expect(def.compare(a, b, cfg, ctx)).toBeLessThan(0);
    expect(def.compare(b, a, cfg, ctx)).toBeGreaterThan(0);
    expect(def.compare(a, a, cfg, ctx)).toBe(0);
    expect(def.compare(null, a, cfg, ctx)).toBeGreaterThan(0);
    expect(def.compare(a, null, cfg, ctx)).toBeLessThan(0);
    expect(def.compare(null, null, cfg, ctx)).toBe(0);
  });

  it('treats null as empty', () => {
    expect(def.isEmpty(null)).toBe(true);
    expect(def.toText(null, cfg, ctx)).toBe('');
  });

  if (cases.empty) {
    it.each(cases.empty)('isEmpty(%j) = %j', (v, e) => {
      expect(def.isEmpty(v)).toBe(e);
    });
  }

  if (cases.done) {
    it.each(cases.done)('isDone(%j) = %j', (v, d) => {
      expect(def.isDone?.(v, cfg)).toBe(d);
    });
  }
}
