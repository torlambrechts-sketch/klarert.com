import type { Ctx, Field } from '../types';
import { resolveFieldType } from './resolve';

const byPosition = (a: Field, b: Field) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/**
 * The field that decides whether an item is done (overdue, My work, progress): the first `status` field,
 * else the first label field that has a done option. Null when the sheet has neither.
 */
export function itemStatusField(
  ctx: Ctx,
  /** Fields of another sheet (a linked item's status); default: the Ctx's sheet. */
  of: Iterable<Field> = ctx.fieldsByKey.values(),
): Field | null {
  const fields = [...of].sort(byPosition);
  const status = fields.find((f) => f.type === 'status');
  if (status) return status;
  return (
    fields.find((f) => {
      const def = resolveFieldType(f.type);
      return def?.storage === 'values' && def.options?.(f.config, ctx).some((o) => o.done);
    }) ?? null
  );
}
