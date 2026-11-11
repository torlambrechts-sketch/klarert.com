// Ordering keys (fractional-indexing), stable field keys and ID prefix suggestions (docs/02 §3).
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** Key strictly between a and b (null = open end). */
export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  return generateNKeysBetween(a, b, n);
}

/** docs/02 §3: re-key a group only when a key grows past 50 characters. */
export const needsRekey = (key: string) => key.length > 50;

/** "Due date" → "due_date"; de-duplicated with _2, _3 … (^[a-z][a-z0-9_]{0,39}$). */
export function fieldKeyFromName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let stem = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!stem) stem = 'field';
  else if (!/^[a-z]/.test(stem)) stem = `f_${stem}`;
  stem = stem.slice(0, 36).replace(/_+$/, '');
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Suggested ID prefix from a sheet name (^[A-Z0-9]{1,6}-$, unique per workspace):
 * initials of up to three words ("Corrective actions" → "CA-"), else the first letters of one word ("Risks" → "RIS-").
 */
export function suggestIdPrefix(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.join('');
  const first = words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join('') : letters.slice(0, 3);
  const stem = (first || 'IT').slice(0, 5);
  if (!used.has(`${stem}-`)) return `${stem}-`;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${stem.slice(0, 6 - String(n).length)}${n}-`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem.slice(0, 3)}X-`;
}
