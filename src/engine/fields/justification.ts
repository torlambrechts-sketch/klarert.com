import { z } from 'zod';
import type { Ctx, Item, Json } from '../types';
import { base, cmpText, emptyLast, isBlank, issue } from './helpers';
import { applicabilityState } from './applicability';
import { stableStringify } from './signature';

export interface JustificationConfig {
  whenFieldKey: string | null;
  whenValues: Json[];
}

const MAX = 2000;

function normalizeText(input: unknown): string | null {
  if (typeof input === 'number' && Number.isFinite(input)) input = String(input);
  if (typeof input !== 'string') return null;
  const t = input.replace(/\r\n?/g, '\n').trim();
  return t === '' || t.length > MAX ? null : t;
}

/** Whether the referenced field currently holds one of whenValues, i.e. a justification is required. */
export function justificationRequired(cfg: JustificationConfig, item: Item, ctx: Ctx): boolean {
  const f = cfg.whenFieldKey ? ctx.fieldsByKey.get(cfg.whenFieldKey) : undefined;
  if (!f) return false;
  const raw = item.values[f.id];
  if (raw === undefined || raw === null) return false;
  const token = f.type === 'applicability' ? applicabilityState(raw) : null;
  return cfg.whenValues.some(
    (w) =>
      w === token ||
      stableStringify(w) === stableStringify(raw) ||
      (Array.isArray(raw) && raw.some((x) => stableStringify(x) === stableStringify(w))),
  );
}

export const justification = base<string, JustificationConfig>({
  id: 'justification',
  label: 'Justification',
  family: 'compliance',
  description: 'A written reason, required while another field has a chosen value.',
  storage: 'values',
  kind: 'text',
  valueSchema: z.string().min(1).max(MAX),
  configSchema: z.object({ whenFieldKey: z.string().min(1).nullable(), whenValues: z.array(z.json()) }),
  defaultConfig: () => ({ whenFieldKey: 'applicability', whenValues: ['not_applicable'] }),
  defaultWidth: 200,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input) => normalizeText(input),
  parseText: (t) => normalizeText(t),
  validate: (v, field, item, ctx) =>
    isBlank(v) && justificationRequired(field.config, item, ctx)
      ? [issue(field, 'justification_required', `Add a justification in ${field.name}.`)]
      : [],
  isEmpty: (v) => isBlank(v),
  toText: (v) => v ?? '',
  compare: (a, b) => emptyLast(a, b, isBlank, cmpText),
});
