// What a requirement library's empty implementation status reads as (owner decision 15 Nov 2026): "Not started", in
// the cells, the item panel, the Insights and dashboard widgets, the coverage and the statement of applicability. A
// newly adopted library has no status on any requirement, and "No value 32 of 32" with "Not started 0" said the
// opposite of the truth. Nothing is written: the projection (values/index.ts valueOf) reads it so, and the first
// status someone sets is the first one stored. Pure.
import type { Ctx, Field } from '../types';
import { IMPLEMENTATION_OPTIONS, LIBRARY_KEYS } from './pack';

const NOT_STARTED = IMPLEMENTATION_OPTIONS[0].id;

/** The option an unset value of this field reads as, or null: only a library sheet's implementation status. */
export function unsetValueOf(field: Field, ctx: Ctx): string | null {
  const sheet = ctx.sheet;
  if (!sheet?.framework || field.sheetId !== sheet.id) return null;
  if (field.key !== LIBRARY_KEYS.status || field.type !== 'status') return null;
  const options = (field.config as { options?: { id: string }[] } | null)?.options ?? [];
  return options.some((o) => o.id === NOT_STARTED) ? NOT_STARTED : null;
}
