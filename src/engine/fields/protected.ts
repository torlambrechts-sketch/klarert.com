import { z } from 'zod';
import type { Field } from '../types';
import { base, cmpText, emptyLast } from './helpers';
import { resolveFieldType } from './resolve';

/** undefined = the caller may not see the value. */
export type ProtectedValue = string | undefined;

export interface ProtectedConfig {
  allowedUserIds: string[];
}

function normalizeProtected(input: unknown): string | null {
  if (typeof input === 'number' && Number.isFinite(input)) input = String(input);
  if (typeof input !== 'string') return null;
  const t = input.replace(/\r\n?/g, '\n').trim();
  return t === '' ? null : t;
}

const isEmpty = (v: ProtectedValue | null) =>
  v === null || (typeof v === 'string' && v.trim() === '');
// Restricted values sort with the empties: their content must not leak through ordering.
const sortEmpty = (v: ProtectedValue | null) => v === undefined || isEmpty(v);

export const protectedText = base<ProtectedValue, ProtectedConfig>({
  id: 'protected',
  label: 'Protected text',
  family: 'compliance',
  description: 'Sensitive text only chosen people can see.',
  storage: 'protected',
  kind: 'none',
  valueSchema: z.string().min(1).optional(),
  configSchema: z.object({ allowedUserIds: z.array(z.string()) }),
  defaultConfig: () => ({ allowedUserIds: [] }),
  defaultWidth: 130,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input) => normalizeProtected(input),
  parseText: (t) => normalizeProtected(t),
  compute: (item, field, ctx) => {
    const v = ctx.protectedValue(item.id, field.id);
    return v === null ? null : v;
  },
  isEmpty,
  toText: (v) => (v === undefined ? 'Restricted' : (v ?? '')),
  compare: (a, b) => emptyLast(a, b, sortEmpty, (x, y) => cmpText(x!, y!)),
});

/** Whether a person may read (and, as an editor, write) a protected field: admins, or people the field lists. */
export function canReadProtected(
  field: Field<ProtectedConfig>,
  userId: string,
  isAdmin: boolean,
): boolean {
  if (resolveFieldType(field.type)?.storage !== 'protected') return false;
  return isAdmin || (field.config?.allowedUserIds ?? []).includes(userId);
}
