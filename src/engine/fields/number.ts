import { z } from 'zod';
import { base, cmpNumber, emptyLast, formatNumber, parseNumber } from './helpers';

export interface NumberConfig {
  unit: string;
  decimals: number;
  /**
   * Optional meter bands (docs/03): three ascending thresholds that split values into four steps, shown in the Table
   * as a four-bar meter beside the number. Without bands the number shows alone.
   */
  bands?: [number, number, number];
  /**
   * With bands: whether a rising value is good (true), bad (false) or neither (unset). Colours the Table's trend
   * line; the line's words say rising or falling either way.
   */
  higherIsBetter?: boolean;
}

export type MeterStep = 1 | 2 | 3 | 4;

/** The step of a value on a four-step meter: step 1 ≤ b0 < step 2 ≤ b1 < step 3 ≤ b2 < step 4. */
export function meterStep(value: number, bands: readonly [number, number, number]): MeterStep {
  if (value <= bands[0]) return 1;
  if (value <= bands[1]) return 2;
  if (value <= bands[2]) return 3;
  return 4;
}

const bandsSchema = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(([a, b, c]) => a < b && b < c, 'Meter bands go up: each one higher than the last.');

const isEmpty = (v: number | null) => v === null || v === undefined || Number.isNaN(v);

export const number = base<number, NumberConfig>({
  id: 'number',
  label: 'Number',
  family: 'basic',
  description: 'A number, with an optional unit.',
  storage: 'values',
  kind: 'number',
  valueSchema: z.number().finite(),
  configSchema: z.object({
    unit: z.string().max(12),
    decimals: z.number().int().min(0).max(6),
    bands: bandsSchema.optional(),
    higherIsBetter: z.boolean().optional(),
  }),
  defaultConfig: () => ({ unit: '', decimals: 2 }),
  defaultWidth: 84,
  formAllowed: true,
  publicConfigKeys: ['unit', 'decimals', 'bands', 'higherIsBetter'],
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize: (input) => parseNumber(input),
  parseText: (t) => parseNumber(t),
  isEmpty,
  toText: (v, cfg) =>
    isEmpty(v) ? '' : `${formatNumber(v!, cfg.decimals)}${cfg.unit ? ` ${cfg.unit}` : ''}`,
  toNumber: (v) => (isEmpty(v) ? null : v),
  compare: (a, b) => emptyLast(a, b, isEmpty, cmpNumber),
  trend: (cfg) =>
    cfg.bands
      ? {
          higherIs:
            cfg.higherIsBetter === true
              ? 'better'
              : cfg.higherIsBetter === false
                ? 'worse'
                : 'neutral',
        }
      : null,
});
