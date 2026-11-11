import { z } from 'zod';
import { base, cmpNumber, cmpText, emptyLast, isBlank } from './helpers';
import type { FieldTypeDef } from './types';

export type AutoIdConfig = Record<string, never>;

const clean = (input: unknown): string | null => {
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  if (typeof input !== 'string') return null;
  const t = input.trim();
  return t && t.length <= 40 && !/\s/.test(t) ? t : null;
};

/** "CA-012" → ["CA-", 12]; the prefix is fixed per sheet, so sorting by the number follows items.seq. */
const split = (id: string): [string, number | null] => {
  const m = id.match(/^(.*?)(\d+)$/);
  return m ? [m[1]!, Number(m[2])] : [id, null];
};

const cmpId = (a: string, b: string) => {
  const [pa, na] = split(a);
  const [pb, nb] = split(b);
  if (na !== null && nb !== null && pa.toLowerCase() === pb.toLowerCase()) return cmpNumber(na, nb);
  return cmpText(a, b);
};

export const autoid: FieldTypeDef<string, AutoIdConfig> = base<string, AutoIdConfig>({
  id: 'autoid',
  label: 'Auto ID',
  family: 'computed',
  description: 'The item ID the sheet gives each item, such as CA-012.',
  storage: 'computed',
  kind: 'text',
  valueSchema: z.string().min(1),
  configSchema: z.object({}) as unknown as z.ZodType<AutoIdConfig>,
  defaultConfig: () => ({}),
  defaultWidth: 100,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: [],
  normalize: clean,
  parseText: clean,
  compute: (item) => item.displayId || null,
  isEmpty: isBlank,
  toText: (v) => v ?? '',
  compare: (a, b) => emptyLast(a, b, isBlank, cmpId),
});
