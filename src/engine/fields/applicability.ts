import { z } from 'zod';
import { base, cmpNumber, emptyLast, issue, parseJson } from './helpers';
import type { LabelOption } from './types';

export interface ApplicabilityValue {
  applicable: boolean;
  reason: string;
}

export interface ApplicabilityConfig {
  reasonRequiredWhenNot: boolean;
}

export const APPLICABILITY_OPTIONS: LabelOption[] = [
  { id: 'applicable', label: 'Applicable', color: 'green', done: true },
  { id: 'not_applicable', label: 'Not applicable', color: 'grey', done: true },
];

const YES = new Set(['applicable', 'yes', 'y', 'true', '1']);
const NO = new Set(['not_applicable', 'not applicable', 'no', 'n', 'false', '0', 'n/a', 'na']);

/** "applicable" | "not_applicable" — the option id field_becomes and justification rules compare with. */
export function applicabilityState(v: unknown): 'applicable' | 'not_applicable' | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const a = (v as Record<string, unknown>).applicable;
  return a === true ? 'applicable' : a === false ? 'not_applicable' : null;
}

function fromToken(t: unknown): boolean | null {
  if (typeof t === 'boolean') return t;
  if (typeof t !== 'string') return null;
  const s = t.trim().toLowerCase();
  return YES.has(s) ? true : NO.has(s) ? false : null;
}

function normalizeApplicability(input: unknown): ApplicabilityValue | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    const applicable = fromToken(o.applicable);
    if (applicable === null) return null;
    const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
    return { applicable, reason };
  }
  if (typeof input !== 'string') {
    const a = fromToken(input);
    return a === null ? null : { applicable: a, reason: '' };
  }
  const t = input.trim();
  const whole = fromToken(t);
  if (whole !== null) return { applicable: whole, reason: '' };
  // "Not applicable: no customer data" or "Not applicable — no customer data"
  const m = t.match(/^(.+?)\s*(?::|—|–| - )\s*(.*)$/s);
  if (!m) return null;
  const a = fromToken(m[1]);
  return a === null ? null : { applicable: a, reason: m[2]!.trim() };
}

const isEmpty = (v: ApplicabilityValue | null) => applicabilityState(v) === null;

export const applicability = base<ApplicabilityValue, ApplicabilityConfig>({
  id: 'applicability',
  label: 'Applicability',
  family: 'compliance',
  description: 'Whether a requirement applies, with the reason when it does not.',
  storage: 'values',
  kind: 'option',
  valueSchema: z.object({ applicable: z.boolean(), reason: z.string() }),
  configSchema: z.object({ reasonRequiredWhenNot: z.boolean() }),
  defaultConfig: () => ({ reasonRequiredWhenNot: true }),
  defaultWidth: 150,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'field_becomes'],
  normalize: (input) => normalizeApplicability(input),
  parseText: (t) => {
    const j = t.trim().startsWith('{') ? parseJson(t.trim()) : undefined;
    return normalizeApplicability(j ?? t);
  },
  validate: (v, field) =>
    v && !v.applicable && field.config.reasonRequiredWhenNot && !v.reason.trim()
      ? [issue(field, 'reason_required', 'Give a reason why this does not apply.')]
      : [],
  isEmpty,
  isDone: (v) => !isEmpty(v),
  toText: (v) => {
    const s = applicabilityState(v);
    if (!s) return '';
    const label = APPLICABILITY_OPTIONS.find((o) => o.id === s)!.label;
    return v!.reason ? `${label} — ${v!.reason}` : label;
  },
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpNumber(x.applicable ? 0 : 1, y.applicable ? 0 : 1)),
  options: () => APPLICABILITY_OPTIONS,
});
