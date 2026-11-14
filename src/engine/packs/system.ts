// System boards and system columns (docs/11 Core registers, docs/05 §3.1): what the sheet header and a column's lock
// say. Pure: the sheet's fields in, words out. The standards a shared register serves are the options add-ons put in
// its Standards field (an add-on adds its option to every sheet it extends); "All standards" is not one of them.
import type { Field } from '../types';
import { STANDARDS_KEY } from './extend';

const ALL = 'all';

/** The standards a shared register serves: its Standards field's options, by label, "All standards" left out. */
export function standardsOf(fields: readonly Pick<Field, 'key' | 'config'>[]): string[] {
  const f = fields.find((x) => x.key === STANDARDS_KEY);
  const options = (f?.config as { options?: unknown } | undefined)?.options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((o) =>
    o && typeof o === 'object' && typeof o.label === 'string' && o.id !== ALL ? [o.label] : [],
  );
}

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** "Used by ISO 14001 and ISO 9001", or what a register without standards yet is for. */
export function usedByText(fields: readonly Pick<Field, 'key' | 'config'>[]): string {
  const s = standardsOf(fields);
  return s.length ? `Used by ${list(s)}` : 'Used by every standard you add';
}

/** A system column's lock text: who relies on it and what people may do with it. */
export function systemColumnText(fields: readonly Pick<Field, 'key' | 'config'>[]): string {
  return `System column. ${usedByText(fields)}. You can hide or rename it, not delete it or change its type.`;
}
