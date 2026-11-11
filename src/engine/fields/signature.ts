import { z } from 'zod';
import type { Json } from '../types';
import { base, cmpNumber, emptyLast, findPersonId, formatDate, isoDateInZone, parseJson } from './helpers';

export interface SignatureValue {
  by: string;
  at: string;
  meaning: string;
  hash: string;
}

export interface SignatureConfig {
  meaning: string;
  clearOnChange: boolean;
}

const isInstant = (s: string) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));

const valueSchema = z.object({
  by: z.string().min(1),
  at: z.string().refine(isInstant, 'Use an ISO date and time'),
  meaning: z.string().min(1).max(80),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

const isEmpty = (v: SignatureValue | null) => !v || !v.by;

/** Canonical JSON (sorted keys) so equal values compare and hash equal. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** The text whose SHA-256 is the signature hash: the item's values without the signature itself. */
export function signaturePayload(values: Record<string, Json>, signatureFieldId: string): string {
  const rest = { ...values };
  delete rest[signatureFieldId];
  return stableStringify(rest);
}

/** True when the signature must be cleared: clearOnChange is on and any other value changed. */
export function shouldClearSignature(
  prevValues: Record<string, Json>,
  nextValues: Record<string, Json>,
  signatureFieldId: string,
  cfg: SignatureConfig,
): boolean {
  if (!cfg.clearOnChange) return false;
  return signaturePayload(prevValues, signatureFieldId) !== signaturePayload(nextValues, signatureFieldId);
}

export const signature = base<SignatureValue, SignatureConfig>({
  id: 'signature',
  label: 'Signature',
  family: 'compliance',
  description: 'A sign-off with a meaning, such as Approved, tied to the values at signing.',
  storage: 'values',
  kind: 'signature',
  valueSchema,
  configSchema: z.object({ meaning: z.string().min(1).max(80), clearOnChange: z.boolean() }),
  defaultConfig: () => ({ meaning: 'Approved', clearOnChange: true }),
  defaultWidth: 170,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input, cfg, ctx) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const o = input as Record<string, unknown>;
    const by = findPersonId(o.by, ctx);
    const r = valueSchema.safeParse({ ...o, by, meaning: o.meaning ?? cfg.meaning });
    return r.success ? { by: r.data.by, at: r.data.at, meaning: r.data.meaning, hash: r.data.hash } : null;
  },
  parseText: (t, cfg, ctx) => {
    const j = parseJson(t.trim());
    return j === undefined ? null : signature.normalize(j, cfg, ctx);
  },
  isEmpty,
  toText: (v, _cfg, ctx) => {
    if (isEmpty(v)) return '';
    const name = ctx.people.get(v!.by)?.name;
    const on = formatDate(isoDateInZone(v!.at, ctx.timeZone));
    return name ? `${v!.meaning} by ${name} on ${on}` : `${v!.meaning} on ${on}`;
  },
  toDate: (v, _cfg, ctx) => (isEmpty(v) ? null : isoDateInZone(v!.at, ctx.timeZone)),
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpNumber(Date.parse(x.at), Date.parse(y.at))),
});
