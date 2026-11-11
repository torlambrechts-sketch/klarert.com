import { z } from 'zod';
import {
  base,
  cmpNumber,
  emptyLast,
  findOption,
  isBlank,
  optionSchema,
  splitList,
} from './helpers';
import type { FieldTypeDef, LabelOption } from './types';

export interface MultiselectConfig {
  options: LabelOption[];
}

type V = string[];

const index = (id: string, cfg: MultiselectConfig) => cfg.options.findIndex((o) => o.id === id);

/** Option ids in option order, without duplicates or unknown ids; null when nothing matches. */
function pick(parts: unknown[], cfg: MultiselectConfig): V | null {
  const ids = new Set<string>();
  for (const p of parts) {
    const o = findOption(cfg.options, p);
    if (o) ids.add(o.id);
  }
  const out = cfg.options.filter((o) => ids.has(o.id)).map((o) => o.id);
  return out.length ? out : null;
}

function normalize(input: unknown, cfg: MultiselectConfig): V | null {
  if (Array.isArray(input)) return pick(input, cfg);
  if (typeof input !== 'string' || isBlank(input)) return null;
  // A whole-string match first, so a label that contains a comma still resolves.
  const whole = findOption(cfg.options, input);
  return whole ? [whole.id] : pick(splitList(input), cfg);
}

export const multiselect: FieldTypeDef<V, MultiselectConfig> = base<V, MultiselectConfig>({
  id: 'multiselect',
  label: 'Multi-select',
  family: 'choice',
  description: 'Pick any number of options from a list you define.',
  storage: 'values',
  kind: 'multi',
  valueSchema: z.array(z.string().min(1)),
  configSchema: z.object({ options: z.array(optionSchema).min(1) }) as z.ZodType<MultiselectConfig>,
  defaultConfig: () => ({
    options: [
      { id: 'opt_1', label: 'Option 1', color: 'blue' },
      { id: 'opt_2', label: 'Option 2', color: 'purple' },
      { id: 'opt_3', label: 'Option 3', color: 'teal' },
    ],
  }),
  defaultWidth: 180,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'field_becomes'],
  normalize,
  parseText: (text, cfg) => normalize(text, cfg),
  toText: (v, cfg) =>
    (v ?? [])
      .map((id) => cfg.options.find((o) => o.id === id)?.label)
      .filter((l): l is string => !!l)
      .join(', '),
  compare: (a, b, cfg) =>
    emptyLast(a, b, isBlank, (x, y) => {
      const ix = Math.min(...x.map((id) => index(id, cfg)).filter((i) => i >= 0), Infinity);
      const iy = Math.min(...y.map((id) => index(id, cfg)).filter((i) => i >= 0), Infinity);
      return cmpNumber(ix, iy) || cmpNumber(x.length, y.length);
    }),
  options: (cfg) => cfg.options,
});
