// Factory for single-option label types (status, dropdown, severity, classification, finding, workflowstep).
import { z } from 'zod';
import type { TriggerId } from '../types';
import {
  appendOption,
  base,
  cmpNumber,
  emptyLast,
  findOption,
  isBlank,
  optionSchema,
} from './helpers';
import type { FieldTypeDef, Family, LabelOption } from './types';

export interface LabelConfig {
  options: LabelOption[];
}

export const labelConfigSchema = z.object({ options: z.array(optionSchema).min(1) });

export function labelType(spec: {
  id: string;
  label: string;
  family: Family;
  description: string;
  defaultOptions: LabelOption[];
  defaultWidth: number;
  ordered?: boolean;
  /** Fixed options cannot be edited (finding). */
  fixed?: boolean;
  /**
   * People may add an option while picking a value (default: unless fixed). Off for lists only automations use
   * (workflow step), whose values no one picks.
   */
  addable?: boolean;
  kanbanCapable?: boolean;
  formAllowed?: boolean;
  triggers?: TriggerId[];
}): FieldTypeDef<string, LabelConfig> {
  const opts = (cfg: LabelConfig) => (spec.fixed ? spec.defaultOptions : cfg.options);
  const index = (v: string | null, cfg: LabelConfig) =>
    v === null ? -1 : opts(cfg).findIndex((o) => o.id === v);
  const normalize = (input: unknown, cfg: LabelConfig) => findOption(opts(cfg), input)?.id ?? null;
  return base<string, LabelConfig>({
    id: spec.id,
    label: spec.label,
    family: spec.family,
    description: spec.description,
    storage: 'values',
    kind: spec.ordered ? 'ordered' : 'option',
    valueSchema: z.string().min(1),
    configSchema: labelConfigSchema as z.ZodType<LabelConfig>,
    defaultConfig: () => ({ options: spec.defaultOptions.map((o) => ({ ...o })) }),
    defaultWidth: spec.defaultWidth,
    formAllowed: spec.formAllowed ?? true,
    // a public form shows the options (labels, colours, done) and nothing else (docs/02 §16)
    ...((spec.formAllowed ?? true) ? { publicConfigKeys: ['options'] } : {}),
    kanbanCapable: spec.kanbanCapable ?? true,
    calendarCapable: false,
    triggers: spec.triggers ?? ['field_changed', 'field_becomes'],
    normalize,
    parseText: (text, cfg) => normalize(text, cfg),
    isEmpty: (v) => isBlank(v),
    isDone: (v, cfg) => !!opts(cfg).find((o) => o.id === v)?.done,
    toText: (v, cfg) => opts(cfg).find((o) => o.id === v)?.label ?? '',
    toNumber: (v, cfg) => (spec.ordered && index(v, cfg) >= 0 ? index(v, cfg) : null),
    compare: (a, b, cfg) =>
      emptyLast(
        a,
        b,
        (v) => index(v, cfg) < 0,
        (x, y) => cmpNumber(index(x, cfg), index(y, cfg)),
      ),
    rank: spec.ordered ? (v, cfg) => (index(v, cfg) >= 0 ? index(v, cfg) : null) : undefined,
    options: (cfg) => opts(cfg),
    addOption:
      (spec.addable ?? !spec.fixed)
        ? (cfg, label, newId) => {
            const r = appendOption(cfg.options, label, newId);
            return r ? { config: { ...cfg, options: r.options }, option: r.option } : null;
          }
        : undefined,
  });
}
