// Value tokens and value labels for actions (docs/04 §5). Pure; shared by the action planners.
import { addDays } from '../fields/helpers';
import type { Ctx, Field, Json } from '../types';
import { defOf } from '../values';
import type { Actor } from './types';

/** Value tokens (docs/04 §5): $today, $in:N (days), $actor, $empty, or a literal for the field type. */
export function resolveValueToken(
  raw: Json | undefined,
  ctx: Ctx,
  actor: Actor,
): { ok: true; value: Json | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: true, value: raw };
  const t = raw.trim();
  if (t === '$empty') return { ok: true, value: null };
  if (t === '$today') return { ok: true, value: ctx.today };
  const m = t.match(/^\$in:(-?\d{1,4})$/);
  if (m) return { ok: true, value: addDays(ctx.today, Number(m[1])) };
  if (t === '$actor') {
    return actor.kind === 'user' && actor.id
      ? { ok: true, value: actor.id }
      : { ok: false, message: 'No person started this change, so there is no one to use.' };
  }
  return { ok: true, value: raw };
}

/** How a raw value reads for the field ("Done", "11 Nov 2026", "empty"). */
export function valueLabel(field: Field, raw: Json | null, ctx: Ctx): string {
  if (raw === null) return 'empty';
  const def = defOf(field);
  const v = def.normalize(raw, field.config, ctx);
  const text = v === null ? '' : def.toText(v, field.config, ctx);
  return text || String(raw);
}

