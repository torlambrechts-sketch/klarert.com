// Copying a sheet gives every field, group, view and the sheet itself a new id. Automations, view configs, field
// configs and sheet settings refer to those ids inside JSON; rekeyIds swaps them. Pure.
import type { Json } from './types';

/**
 * Replace every string value and every object key that equals an old id with its new id, at any depth.
 * Other strings are left alone (field keys like {due_date} are stable and need no change).
 */
export function rekeyIds<T extends Json | undefined | null>(
  value: T,
  ids: ReadonlyMap<string, string>,
): T {
  const walk = (v: Json): Json => {
    if (typeof v === 'string') return ids.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: { [key: string]: Json } = {};
      for (const [k, inner] of Object.entries(v)) out[ids.get(k) ?? k] = walk(inner);
      return out;
    }
    return v;
  };
  return (value === undefined || value === null ? value : walk(value)) as T;
}
