import { z } from 'zod';
import type { Field } from '../types';
import { base, cmpNumber, cmpText, emptyLast, issue, parseNumber } from './helpers';

export interface MoneyValue {
  amount: number;
  currency: string;
}
export interface ValueConfig {
  currency: string;
  allowOther: boolean;
}

const CODE = /^[A-Z]{3}$/;
const SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP', $: 'USD' };

const isEmpty = (v: MoneyValue | null) => !v || typeof v.amount !== 'number' || !Number.isFinite(v.amount);

/** "€1,200", "1,200.50 USD", "GBP 30", "-£5" → amount and the currency it names, if any. */
function parseMoney(text: string): { amount: number; code?: string } | null {
  let t = text.trim();
  let code: string | undefined;
  const m = t.match(/(^|[^A-Za-z])([A-Za-z]{3})(?![A-Za-z])/);
  if (m) {
    code = m[2]!.toUpperCase();
    t = t.replace(m[2]!, '');
  }
  for (const [sym, c] of Object.entries(SYMBOLS)) {
    if (t.includes(sym)) {
      code ??= c;
      t = t.replace(sym, '');
    }
  }
  const amount = parseNumber(t.replace(/\s+/g, ''));
  return amount === null ? null : { amount, code };
}

function normalize(input: unknown, cfg: ValueConfig): MoneyValue | null {
  let amount: number | null = null;
  let code: string | undefined;
  if (typeof input === 'number') amount = Number.isFinite(input) ? input : null;
  else if (typeof input === 'string') {
    const p = parseMoney(input);
    if (p) ({ amount, code } = p);
  } else if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    amount = parseNumber(o.amount);
    if (typeof o.currency === 'string') code = o.currency.trim().toUpperCase();
  }
  if (amount === null) return null;
  const currency = cfg.allowOther ? (code ?? cfg.currency) : cfg.currency;
  return CODE.test(currency) ? { amount, currency } : null;
}

export const value = base<MoneyValue, ValueConfig>({
  id: 'value',
  label: 'Value',
  family: 'basic',
  description: 'An amount of money in a currency.',
  storage: 'values',
  kind: 'number',
  valueSchema: z.object({ amount: z.number().finite(), currency: z.string().regex(CODE) }),
  configSchema: z.object({ currency: z.string().regex(CODE), allowOther: z.boolean() }),
  defaultConfig: () => ({ currency: 'EUR', allowOther: false }),
  defaultWidth: 120,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize,
  parseText: (t, cfg) => normalize(t, cfg),
  validate: (v, field: Field<ValueConfig>) =>
    v && !field.config.allowOther && v.currency !== field.config.currency
      ? [issue(field, 'currency', `Amounts in this field must be in ${field.config.currency}.`)]
      : [],
  isEmpty,
  toText: (v) => {
    if (isEmpty(v)) return '';
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: v!.currency }).format(v!.amount);
    } catch {
      return `${v!.amount} ${v!.currency}`;
    }
  },
  toNumber: (v) => (isEmpty(v) ? null : v!.amount),
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpNumber(x.amount, y.amount) || cmpText(x.currency, y.currency)),
});
