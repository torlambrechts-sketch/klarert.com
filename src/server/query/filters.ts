// Server-side filters for sheets above 2 000 items (docs/03 §4, docs/02 §2): view conditions → a parameterised SQL
// WHERE clause on `items i`, run by filter_item_ids (0009_views_forms.sql) as the caller under RLS.
// Values never enter the SQL text: they go into one jsonb array bound as $1 and are read as ($1->>n) / ($1->n).
// Field ids are inlined only after a uuid check. Conditions on calculated columns (and other shapes SQL cannot read
// the way the engine does) come back in `clientOnly`; the browser applies them to the loaded items.
// Pure (no server-only import) so it is unit-tested; the command that runs it lives in src/server/commands/views.ts.
import { conditionProblem, SPECIAL_KEYS } from '@/engine/conditions';
import { addDays } from '@/engine/fields/helpers';
import { itemStatusField } from '@/engine/fields/item-status';
import { resolveFieldType } from '@/engine/fields/resolve';
import { sqlShape, type SqlShape } from '@/engine/fields/view-support';
import type { Condition, Ctx, Field, Json } from '@/engine/types';
import { kindOf } from '@/engine/values';

export interface FilterSql {
  /** Boolean SQL over `items i`; "true" when nothing runs on the server. */
  where: string;
  /** Bound as $1 (a jsonb array). */
  params: Json[];
  /** Conditions the server cannot evaluate; apply them to loaded items (matchesAll). */
  clientOnly: Condition[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const str = (v: Json | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: Json | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : null;
const list = (v: Json | undefined): string[] =>
  Array.isArray(v) ? v.map(String) : v === null || v === undefined || v === '' ? [] : [String(v)];
const pair = (v: Json | undefined): [Json, Json] | null =>
  Array.isArray(v) && v.length === 2 ? [v[0]!, v[1]!] : null;

class Params {
  readonly values: Json[] = [];
  private add(v: Json) {
    this.values.push(v);
    return this.values.length - 1;
  }
  /** A text parameter. */
  text(v: string) {
    return `($1->>${this.add(v)})`;
  }
  numeric(v: number) {
    return `($1->>${this.add(v)})::numeric`;
  }
  /** A text[] parameter. */
  texts(v: string[]) {
    return `array(select jsonb_array_elements_text($1->${this.add(v)}))`;
  }
}

/** Option keys whose rank compares to the condition value (ordered at_least / at_most). */
function rankedKeys(field: Field, op: string, value: Json | undefined, ctx: Ctx): string[] {
  const def = resolveFieldType(field.type)!;
  if (!def.rank || !def.options) return [];
  const theirs = def.rank(def.normalize(value, field.config, ctx) ?? str(value), field.config);
  if (theirs === null) return [];
  return def
    .options(field.config, ctx)
    .filter((o) => {
      const r = def.rank!(def.normalize(o.id, field.config, ctx), field.config);
      return r !== null && (op === 'at_least' ? r >= theirs : r <= theirs);
    })
    .map((o) => o.id);
}

function doneKeys(field: Field, ctx: Ctx): string[] {
  const def = resolveFieldType(field.type)!;
  return (def.options?.(field.config, ctx) ?? [])
    .filter((o) => def.isDone?.(def.normalize(o.id, field.config, ctx), field.config))
    .map((o) => o.id);
}

function textSql(op: string, col: string, value: Json | undefined, p: Params): string | null {
  const t = `lower(coalesce(${col}, ''))`;
  switch (op) {
    case 'is':
      return `${t} = lower(${p.text(str(value))})`;
    case 'is_not':
      return `${t} <> lower(${p.text(str(value))})`;
    case 'contains':
      return `strpos(${t}, lower(${p.text(str(value))})) > 0`;
    case 'not_contains':
      return `strpos(${t}, lower(${p.text(str(value))})) = 0`;
    case 'starts_with':
      return `starts_with(${t}, lower(${p.text(str(value))}))`;
    case 'is_empty':
      return `coalesce(${col}, '') = ''`;
    case 'is_not_empty':
      return `coalesce(${col}, '') <> ''`;
    default:
      return null;
  }
}

function numberSql(op: string, col: string, raw: string, value: Json | undefined, p: Params) {
  const n = `(case when jsonb_typeof(${raw}) = 'number' then (${col})::numeric end)`;
  if (op === 'between') {
    const pr = pair(value);
    const lo = pr ? num(pr[0]) : null;
    const hi = pr ? num(pr[1]) : null;
    if (lo === null || hi === null) return 'false';
    return `${n} >= ${p.numeric(Math.min(lo, hi))} and ${n} <= ${p.numeric(Math.max(lo, hi))}`;
  }
  const b = num(value);
  if (b === null) return 'false';
  const ops: Record<string, string> = {
    eq: '=',
    neq: '<>',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  };
  if (!ops[op]) return null;
  // like the engine: an empty value is "not equal" to any number
  if (op === 'neq') return `coalesce(${n} <> ${p.numeric(b)}, true)`;
  return `${n} ${ops[op]} ${p.numeric(b)}`;
}

function dateSql(
  op: string,
  d: string,
  value: Json | undefined,
  p: Params,
  ctx: Ctx,
  notDone: string | null,
): string | null {
  const target = str(value) === 'today' ? ctx.today : str(value);
  const cmp: Record<string, string> = {
    is: '=',
    before: '<',
    after: '>',
    on_or_before: '<=',
    on_or_after: '>=',
  };
  if (cmp[op]) return `${d} ${cmp[op]} ${p.text(target)}`;
  switch (op) {
    case 'between': {
      const pr = pair(value);
      if (!pr) return 'false';
      const [lo, hi] = [str(pr[0]), str(pr[1])].sort();
      return `${d} >= ${p.text(lo!)} and ${d} <= ${p.text(hi!)}`;
    }
    case 'is_today':
      return `${d} = ${p.text(ctx.today)}`;
    case 'next_days': {
      const n = num(value);
      if (n === null) return 'false';
      return `${d} >= ${p.text(ctx.today)} and ${d} <= ${p.text(addDays(ctx.today, n))}`;
    }
    case 'last_days': {
      const n = num(value);
      if (n === null) return 'false';
      return `${d} <= ${p.text(ctx.today)} and ${d} >= ${p.text(addDays(ctx.today, -n))}`;
    }
    case 'overdue':
      return `${d} < ${p.text(ctx.today)}${notDone ? ` and ${notDone}` : ''}`;
    case 'is_empty':
      return `coalesce(${d}, '') = ''`;
    case 'is_not_empty':
      return `coalesce(${d}, '') <> ''`;
    default:
      return null;
  }
}

/** SQL for "the item is not done" (overdue), or null when the sheet has no status (nothing is ever done). */
function notDoneSql(ctx: Ctx, p: Params): string | null | false {
  const status = itemStatusField(ctx);
  if (!status) return null;
  const shape = sqlShape(status);
  if (shape !== 'string' && shape !== 'number') return false;
  const keys = doneKeys(status, ctx);
  if (keys.length === 0) return null;
  return `not coalesce(i.values->>'${status.id}' = any(${p.texts(keys)}), false)`;
}

function fieldSql(cond: Condition, field: Field, shape: SqlShape, ctx: Ctx, p: Params) {
  const { op, value } = cond;
  const kind = kindOf(field, ctx);
  const raw = `i.values->'${field.id}'`;
  const col = `i.values->>'${field.id}'`;
  const emptyIds = `(case when jsonb_typeof(${raw}) = 'array' then jsonb_array_length(${raw}) else 0 end) = 0`;

  if (shape === 'links' || shape === 'files') {
    const rows =
      shape === 'links'
        ? `from item_links l where l.field_id = '${field.id}' and l.from_item = i.id`
        : `from files f where f.field_id = '${field.id}' and f.item_id = i.id and f.replaced_by is null`;
    if (op === 'has_any' || op === 'has_files') return `exists (select 1 ${rows})`;
    if (op === 'has_none') return `not exists (select 1 ${rows})`;
    if (shape === 'links' && op === 'includes_item') {
      const id = str(value);
      return UUID.test(id)
        ? `exists (select 1 ${rows} and l.to_item = ${p.text(id)}::uuid)`
        : 'false';
    }
    if (shape === 'links' && (op === 'count_gt' || op === 'count_lt')) {
      const n = num(value);
      if (n === null) return 'false';
      return `(select count(*) ${rows}) ${op === 'count_gt' ? '>' : '<'} ${p.numeric(n)}`;
    }
    return null; // freshness and expiry follow the engine's file rules: client only
  }

  switch (kind) {
    case 'text':
      return shape === 'string' ? textSql(op, col, value, p) : null;
    case 'number':
      if (shape !== 'number') return null;
      if (op === 'is_empty') return `${col} is null`;
      if (op === 'is_not_empty') return `${col} is not null`;
      return numberSql(op, col, raw, value, p);
    case 'date':
    case 'daterange': {
      // daterange compares the end (docs/03 §4)
      const d = shape === 'date' ? col : shape === 'range' ? `(${raw}->>'end')` : null;
      if (!d) return null;
      const notDone = op === 'overdue' ? notDoneSql(ctx, p) : null;
      if (notDone === false) return null;
      return dateSql(op, d, value, p, ctx, notDone);
    }
    case 'option':
    case 'ordered': {
      if (shape !== 'string' && shape !== 'number') return null;
      if (op === 'is_empty') return `coalesce(${col}, '') = ''`;
      if (op === 'is_not_empty') return `coalesce(${col}, '') <> ''`;
      const anyOf = (keys: string[]) => `coalesce(${col} = any(${p.texts(keys)}), false)`;
      if (op === 'is_any_of') return anyOf(list(value));
      if (op === 'is_none_of') return `not ${anyOf(list(value))}`;
      if (op === 'is_done') return anyOf(doneKeys(field, ctx));
      if (op === 'is_not_done') return `not ${anyOf(doneKeys(field, ctx))}`;
      if (op === 'at_least' || op === 'at_most') return anyOf(rankedKeys(field, op, value, ctx));
      return null;
    }
    case 'multi':
    case 'people': {
      if (shape !== 'ids') return null;
      if (op === 'is_empty') return emptyIds;
      if (op === 'is_not_empty') return `not ${emptyIds}`;
      if (op === 'includes_me') return `${raw} ? ${p.text(ctx.userId)}`;
      const want = list(value).map((w) => (w === 'me' ? ctx.userId : w));
      const anyOf = `coalesce(${raw} ?| ${p.texts(want)}, false)`;
      if (op === 'has_any_of' || op === 'includes_any_of') return anyOf;
      if (op === 'has_none_of' || op === 'excludes') return `not ${anyOf}`;
      if (op === 'has_all_of') return want.length ? `${raw} ?& ${p.texts(want)}` : 'false';
      return null;
    }
    case 'boolean':
      if (shape !== 'bool') return null;
      if (op === 'is_checked') return `${col} = ${p.text('true')}`;
      if (op === 'is_not_checked') return `coalesce(${col}, '') <> ${p.text('true')}`;
      return null;
    default:
      return null;
  }
}

function specialSql(cond: Condition, p: Params): string | null {
  if (cond.fieldKey === '__group') {
    const ids = list(cond.value);
    const anyOf = `coalesce(i.group_id::text = any(${p.texts(ids)}), false)`;
    if (cond.op === 'is_any_of') return anyOf;
    if (cond.op === 'is_none_of') return `not ${anyOf}`;
    return 'false';
  }
  const col = cond.fieldKey === '__name' ? 'i.name' : 'i.display_id';
  return textSql(cond.op, col, cond.value, p);
}

/**
 * Build the WHERE clause for these conditions (AND). Invalid conditions (deleted field, wrong operator) are dropped,
 * as on the client.
 */
export function buildFilterSql(conds: Condition[], ctx: Ctx): FilterSql {
  const p = new Params();
  const parts: string[] = [];
  const clientOnly: Condition[] = [];
  for (const cond of conds) {
    if (conditionProblem(cond, ctx)) continue;
    let sql: string | null;
    if (cond.fieldKey in SPECIAL_KEYS) sql = specialSql(cond, p);
    else {
      const field = ctx.fieldsByKey.get(cond.fieldKey)!;
      const def = resolveFieldType(field.type);
      const shape = sqlShape(field);
      sql =
        def && UUID.test(field.id) && shape && def.storage !== 'computed'
          ? fieldSql(cond, field, shape, ctx, p)
          : null;
    }
    if (sql === null) clientOnly.push(cond);
    else parts.push(`coalesce((${sql}), false)`);
  }
  return { where: parts.length ? parts.join(' and ') : 'true', params: p.values, clientOnly };
}
