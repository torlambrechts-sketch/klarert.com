import { z } from 'zod';
import { base, cmpNumber, emptyLast } from './helpers';
import type { LabelOption } from './types';

export type YesNo = 'yes' | 'no' | 'na';
export interface YesNoConfig {
  allowNA: boolean;
}

const OPTIONS: LabelOption[] = [
  { id: 'yes', label: 'Yes', color: 'green', done: true },
  { id: 'no', label: 'No', color: 'red' },
  { id: 'na', label: 'N/A', color: 'grey', done: true },
];

const ALIASES: Record<string, YesNo> = {
  yes: 'yes',
  y: 'yes',
  true: 'yes',
  '1': 'yes',
  no: 'no',
  n: 'no',
  false: 'no',
  '0': 'no',
  na: 'na',
  'n/a': 'na',
  'not applicable': 'na',
};

const options = (cfg: YesNoConfig) =>
  cfg.allowNA ? OPTIONS : OPTIONS.filter((o) => o.id !== 'na');
const index = (v: YesNo | null, cfg: YesNoConfig) =>
  v === null ? -1 : options(cfg).findIndex((o) => o.id === v);

function normalize(input: unknown, cfg: YesNoConfig): YesNo | null {
  if (typeof input === 'boolean') return input ? 'yes' : 'no';
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const v = ALIASES[String(input).trim().toLowerCase()];
  return v && index(v, cfg) >= 0 ? v : null;
}

export const yesno = base<YesNo, YesNoConfig>({
  id: 'yesno',
  label: 'Yes / No',
  family: 'basic',
  description: 'Yes, No or N/A.',
  storage: 'values',
  kind: 'option',
  valueSchema: z.enum(['yes', 'no', 'na']),
  configSchema: z.object({ allowNA: z.boolean() }),
  defaultConfig: () => ({ allowNA: true }),
  defaultWidth: 90,
  formAllowed: true,
  publicConfigKeys: ['allowNA'],
  kanbanCapable: true,
  calendarCapable: false,
  triggers: ['field_changed', 'field_becomes'],
  normalize,
  parseText: (t, cfg) => normalize(t, cfg),
  isEmpty: (v) => v === null || v === undefined,
  isDone: (v, cfg) => !!options(cfg).find((o) => o.id === v)?.done,
  toText: (v, cfg) => options(cfg).find((o) => o.id === v)?.label ?? '',
  compare: (a, b, cfg) =>
    emptyLast(
      a,
      b,
      (v) => index(v, cfg) < 0,
      (x, y) => cmpNumber(index(x, cfg), index(y, cfg)),
    ),
  options: (cfg) => options(cfg).map((o) => ({ ...o })),
});
