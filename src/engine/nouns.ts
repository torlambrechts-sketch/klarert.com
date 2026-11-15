// Counting a sheet's items in words (owner decision 15 Nov 2026): "3 DPIAs", "2 interested parties", "1 risk". The noun
// is the sheet's item label (data); acronyms keep their capitals, other words read in lower case. A label with no
// plural ("Feedback", "Evidence") or no label at all counts "items" instead, never "3 feedbacks". The English rules
// live here, once, with tests (src/engine/nouns.test.ts); components and widgets call these. Pure.

/** Nouns with no plural: a sheet whose items are called this counts "items". */
const UNCOUNTED = new Set([
  'advice',
  'compliance',
  'correspondence',
  'data',
  'documentation',
  'equipment',
  'evidence',
  'feedback',
  'guidance',
  'information',
  'knowledge',
  'legislation',
  'maintenance',
  'personnel',
  'research',
  'software',
  'staff',
  'training',
]);

/** An acronym or a word with capitals inside ("DPIA", "KPIs", "eQMS"): kept as written. */
const keepsCase = (word: string) => /^[A-Z0-9]{2,}s?$/.test(word) || /.[A-Z]/.test(word);

/** A label as it reads inside a sentence: "Supplier review" → "supplier review", "DPIA" stays "DPIA". */
export function nounInText(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .map((w) => (keepsCase(w) ? w : w.toLowerCase()))
    .join(' ');
}

/** The plural of a word (the last word of a label): "party" → "parties", "process" → "processes", "DPIA" → "DPIAs". */
function pluralWord(word: string): string {
  if (keepsCase(word)) return /s$/.test(word) ? word : `${word}s`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** The noun for a sheet's items, singular or plural, or null when it has none that counts ("Feedback", "Item"). */
function itemNoun(label: string | null | undefined, many: boolean): string | null {
  const text = nounInText(label ?? '');
  const last = text.split(' ').at(-1) ?? '';
  if (!last || last.toLowerCase() === 'item' || UNCOUNTED.has(last.toLowerCase())) return null;
  if (!many) return text;
  return `${text.slice(0, text.length - last.length)}${pluralWord(last)}`;
}

/** The plural noun of a sheet's items: "DPIAs", "interested parties"; "items" when it has none that counts. */
export const itemsWord = (label: string | null | undefined): string =>
  itemNoun(label, true) ?? 'items';

/** A count of a sheet's items: "1 DPIA", "3 DPIAs", "0 CAPAs", "3 items" for a sheet of feedback. */
export function countItems(n: number, label: string | null | undefined): string {
  const noun = itemNoun(label, n !== 1);
  return `${n} ${noun ?? (n === 1 ? 'item' : 'items')}`;
}
