import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import { z } from 'zod';
import { base, cmpText, emptyLast, isBlank } from './helpers';

export interface PhoneConfig {
  defaultCountry: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

const country = (cfg: PhoneConfig) => cfg.defaultCountry.toUpperCase() as CountryCode;

// isPossible, not isValid: reserved ranges such as Ofcom's 07700 900xxx are real-looking test numbers.
function clean(input: unknown, cfg: PhoneConfig): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const t = String(input).trim().replace(/^tel:/i, '');
  if (!t || /[a-z]/i.test(t)) return null;
  try {
    const p = parsePhoneNumberFromString(t, country(cfg));
    return p && p.isPossible() && E164.test(p.number) ? p.number : null;
  } catch {
    return null;
  }
}

export const phone = base<string, PhoneConfig>({
  id: 'phone',
  label: 'Phone',
  family: 'basic',
  description: 'A phone number, stored in international format.',
  storage: 'values',
  kind: 'text',
  valueSchema: z.string().regex(E164),
  configSchema: z.object({ defaultCountry: z.string().regex(/^[A-Za-z]{2}$/) }),
  defaultConfig: () => ({ defaultCountry: 'GB' }),
  defaultWidth: 140,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input, cfg) => clean(input, cfg),
  parseText: (t, cfg) => clean(t, cfg),
  isEmpty: isBlank,
  // National format for the field's country; numbers from elsewhere keep their country code.
  toText: (v, cfg) => {
    if (!v) return '';
    const p = parsePhoneNumberFromString(v);
    if (!p) return v;
    let home: string | undefined;
    try {
      home = getCountryCallingCode(country(cfg));
    } catch {
      home = undefined;
    }
    return p.countryCallingCode === home ? p.formatNational() : p.formatInternational();
  },
  compare: (a, b) => emptyLast(a, b, isBlank, cmpText),
});
