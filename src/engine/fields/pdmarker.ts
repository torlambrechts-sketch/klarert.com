import { z } from 'zod';
import { base, cmpNumber, cmpText, emptyLast, splitList } from './helpers';
import type { LabelOption } from './types';

export type PdMarkerConfig = Record<string, never>;

export interface PdCategory {
  id: string;
  label: string;
  /** Special category of personal data (GDPR art. 9/10): shown as a red chip. */
  special: boolean;
}

export const PD_CATEGORIES: readonly PdCategory[] = [
  { id: 'identity', label: 'Identity', special: false },
  { id: 'contact', label: 'Contact details', special: false },
  { id: 'financial', label: 'Financial', special: false },
  { id: 'location', label: 'Location', special: false },
  { id: 'images', label: 'Images', special: false },
  { id: 'employment', label: 'Employment', special: false },
  { id: 'health', label: 'Health', special: true },
  { id: 'biometric', label: 'Biometric', special: true },
  { id: 'beliefs', label: 'Religion or beliefs', special: true },
  { id: 'union', label: 'Trade union membership', special: true },
  { id: 'allegations', label: 'Allegations', special: false },
  { id: 'criminal', label: 'Criminal offences', special: true },
];

const OPTIONS: LabelOption[] = PD_CATEGORIES.map((c) => ({
  id: c.id,
  label: c.label,
  color: c.special ? 'red' : 'blue',
}));

const IDS = PD_CATEGORIES.map((c) => c.id);

function categoryId(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const t = x.trim().toLowerCase();
  return PD_CATEGORIES.find((c) => c.id === t || c.label.toLowerCase() === t)?.id;
}

/** Unknown entries make the whole input invalid; the result is in catalogue order, without duplicates. */
function normalizeMarkers(input: unknown): string[] | null {
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? splitList(input) : null;
  if (!parts) return null;
  const ids = new Set<string>();
  for (const p of parts) {
    const id = categoryId(p);
    if (!id) return null;
    ids.add(id);
  }
  return ids.size ? IDS.filter((id) => ids.has(id)) : null;
}

export function hasSpecialCategory(v: string[] | null): boolean {
  return (v ?? []).some((id) => PD_CATEGORIES.some((c) => c.id === id && c.special));
}

const isEmpty = (v: string[] | null) => !Array.isArray(v) || v.length === 0;
const text = (v: string[] | null) =>
  (v ?? [])
    .map((id) => PD_CATEGORIES.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join(', ');

export const pdmarker = base<string[], PdMarkerConfig>({
  id: 'pdmarker',
  label: 'Personal data marker',
  family: 'compliance',
  description: 'The categories of personal data the item holds.',
  storage: 'values',
  kind: 'multi',
  valueSchema: z.array(z.enum(IDS as [string, ...string[]])),
  configSchema: z.object({}).strict() as unknown as z.ZodType<PdMarkerConfig>,
  defaultConfig: () => ({}),
  defaultWidth: 180,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input) => normalizeMarkers(input),
  parseText: (t) => normalizeMarkers(t),
  isEmpty,
  toText: (v) => text(v),
  toNumber: (v) => (isEmpty(v) ? null : v!.length),
  compare: (a, b) => emptyLast(a, b, isEmpty, (x, y) => cmpText(text(x), text(y)) || cmpNumber(x.length, y.length)),
  options: () => OPTIONS,
});
