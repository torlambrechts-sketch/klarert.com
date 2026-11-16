import { z } from 'zod';
import { base, cmpText, emptyLast, isBlank, issue } from './helpers';
import type { FieldTypeDef, LabelOption } from './types';

export type CountryConfig = Record<string, never>;

// Codes Intl names that are not assigned ISO 3166-1 alpha-2 countries (reserved, grouping or private use).
const NOT_ISO = new Set([
  'AC',
  'CP',
  'CQ',
  'DG',
  'EA',
  'IC',
  'TA',
  'EU',
  'EZ',
  'UN',
  'QO',
  'XA',
  'XB',
  'XK',
  'ZZ',
]);
// Common English names Intl does not use.
const ALIASES: Record<string, string> = {
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  usa: 'US',
  'united states of america': 'US',
  turkey: 'TR',
  'czech republic': 'CZ',
  'ivory coast': 'CI',
  swaziland: 'SZ',
  macedonia: 'MK',
  holland: 'NL',
  'the netherlands': 'NL',
  'democratic republic of the congo': 'CD',
  'dr congo': 'CD',
  'republic of the congo': 'CG',
  'russian federation': 'RU',
  'viet nam': 'VN',
};

interface Tables {
  codes: string[];
  names: Map<string, string>;
  lookup: Map<string, string>;
}

const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bst\.?(?=\s)/g, 'saint')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

let tables: Tables | undefined;

/** Built once from Intl: the 249 assigned codes, their English names, and a name/alias → code index. */
function getTables(): Tables {
  if (tables) return tables;
  const long = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const short = new Intl.DisplayNames(['en'], { type: 'region', style: 'short', fallback: 'none' });
  const codes: string[] = [];
  const names = new Map<string, string>();
  const lookup = new Map<string, string>();
  const deprecated: [string, string][] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = long.of(code);
      if (!name || NOT_ISO.has(code)) continue;
      const canonical = Intl.getCanonicalLocales(`und-${code}`)[0]?.slice(4);
      if (canonical !== code) {
        if (canonical) deprecated.push([code, canonical]);
        continue;
      }
      codes.push(code);
      names.set(code, name);
      lookup.set(key(name), code);
      const s = short.of(code);
      if (s) lookup.set(key(s), code);
    }
  }
  // Old codes such as UK map to their current code, but only as input.
  for (const [old, current] of deprecated) if (names.has(current)) lookup.set(key(old), current);
  for (const [alias, code] of Object.entries(ALIASES)) lookup.set(key(alias), code);
  tables = { codes, names, lookup };
  return tables;
}

function normalize(input: unknown): string | null {
  if (typeof input !== 'string' || isBlank(input)) return null;
  const t = input.trim();
  const { names, lookup } = getTables();
  if (/^[a-z]{2}$/i.test(t)) {
    const upper = t.toUpperCase();
    if (names.has(upper)) return upper;
  }
  return lookup.get(key(t)) ?? null;
}

const nameOf = (v: string | null) => (v === null ? '' : (getTables().names.get(v) ?? ''));

export const country: FieldTypeDef<string, CountryConfig> = base<string, CountryConfig>({
  id: 'country',
  label: 'Country',
  family: 'choice',
  description: 'A country, stored as its two-letter ISO code and shown by its English name.',
  storage: 'values',
  kind: 'option',
  valueSchema: z.string().regex(/^[A-Z]{2}$/),
  configSchema: z.object({}) as z.ZodType<CountryConfig>,
  defaultConfig: () => ({}),
  defaultWidth: 140,
  formAllowed: true,
  publicConfigKeys: [],
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input) => normalize(input),
  validate: (v, field) =>
    v !== null && !getTables().names.has(v)
      ? [issue(field, 'country_unknown', 'This is not a known country code.')]
      : [],
  parseText: (text) => normalize(text),
  toText: (v) => nameOf(v),
  compare: (a, b) =>
    emptyLast(
      a,
      b,
      (v) => isBlank(nameOf(v)),
      (x, y) => cmpText(nameOf(x), nameOf(y)),
    ),
  options: (): LabelOption[] => {
    const { codes, names } = getTables();
    return codes
      .map((id) => ({ id, label: names.get(id) ?? id, color: 'navy' }))
      .sort((x, y) => cmpText(x.label, y.label));
  },
});

/** All assigned ISO 3166-1 alpha-2 codes, for tests and pickers. */
export const countryCodes = (): readonly string[] => getTables().codes;
