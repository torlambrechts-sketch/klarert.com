// Planning an item write (docs/02 §4 step 3): normalise every input through its field type, stamp values that need
// the server's word (signatures), clear values that depend on the rest (signature clearOnChange), then validate the
// item as it would be and decide what blocks. Pure: the clock, the user and the hash function are injected.
import { addDays } from './fields/helpers';
import { resolveFieldType } from './fields/resolve';
import type { Ctx, Field, Issue, Item, Json, StatusRule } from './types';
import { validateItem } from './validation';

export interface Rejected {
  fieldId: string;
  reason: string;
}

export interface ValuePlan {
  /** For set_item_values: field id → new value, or null to clear. Only real changes. */
  patch: Record<string, Json | null>;
  /** The item as it will be. */
  next: Item;
  /** Keys of the fields whose value changes. */
  changedKeys: string[];
  rejected: Rejected[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isBlankInput = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Normalise `input` (field id → raw input) against the item; inputs for non-value fields are rejected. */
export function planValues(
  item: Item,
  fields: Field[],
  input: Record<string, unknown>,
  ctx: Ctx,
  hash: (s: string) => string,
): ValuePlan {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const rejected: Rejected[] = [];
  const nextValues: Record<string, Json> = { ...item.values };
  const stamped: Field[] = [];

  for (const [fieldId, raw] of Object.entries(input)) {
    const field = byId.get(fieldId);
    const def = field && resolveFieldType(field.type);
    if (!field || !def) {
      rejected.push({ fieldId, reason: 'This field no longer exists.' });
      continue;
    }
    if (def.storage !== 'values') {
      rejected.push({ fieldId, reason: `${field.name} cannot be set here.` });
      continue;
    }
    if (isBlankInput(raw)) {
      delete nextValues[fieldId];
      continue;
    }
    const v = def.normalize(raw, field.config, ctx);
    if (v === null || v === undefined || def.isEmpty(v)) {
      rejected.push({ fieldId, reason: `This is not a valid ${field.name.toLowerCase()}.` });
      continue;
    }
    nextValues[fieldId] = v as Json;
    if (def.stamp) stamped.push(field);
  }
  for (const field of stamped) {
    const def = resolveFieldType(field.type)!;
    nextValues[field.id] = def.stamp!(nextValues[field.id], field, nextValues, ctx, hash) as Json;
  }
  for (const field of fields) {
    const def = resolveFieldType(field.type);
    if (!def?.onItemChange || field.id in input) continue;
    const r = def.onItemChange(item.values, nextValues, field, ctx);
    if (r === undefined) continue;
    if (r === null) delete nextValues[field.id];
    else nextValues[field.id] = r as Json;
  }

  const patch: Record<string, Json | null> = {};
  const changedKeys: string[] = [];
  for (const field of fields) {
    const before = item.values[field.id];
    const after = nextValues[field.id];
    if (same(before, after)) continue;
    patch[field.id] = after === undefined ? null : after;
    changedKeys.push(field.key);
  }
  return { patch, next: { ...item, values: nextValues }, changedKeys, rejected };
}

export interface WriteCheck {
  /** Errors the change introduces; any of them blocks the write. */
  blocking: Issue[];
  /** Status rules that need a comment (docs/03 §6). */
  commentRequired: StatusRule[];
}

const issueKey = (i: Issue) => `${i.fieldKey}\u0000${i.code}\u0000${i.message}`;

/**
 * Validate a change: only errors that the change introduces block it, so an unrelated empty required field never
 * blocks editing another cell. Clearing a required field, a status rule, a justification that becomes required and
 * a duplicate unique value all block.
 */
export function checkWrite(
  before: Item,
  after: Item,
  fields: Field[],
  changedKeys: string[],
  ctx: Ctx,
  opts: { isUnique?: (field: Field, value: unknown) => boolean; automation?: boolean } = {},
): WriteCheck {
  const o = { changedKeys, isUnique: opts.isUnique, skipCommentRules: opts.automation };
  const was = validateItem(before, fields, ctx, o);
  const now = validateItem(after, fields, ctx, o);
  const old = new Set(was.issues.filter((i) => i.level === 'error').map(issueKey));
  const blocking = now.issues.filter((i) => i.level === 'error' && !old.has(issueKey(i)));
  // a `fromDone` rule asks only when the field leaves a done value (reopening a done sub-item needs a comment)
  const wasDone = (rule: StatusRule) => {
    const field = fields.find((f) => f.key === rule.whenFieldKey);
    const def = field && resolveFieldType(field.type);
    return !!field && !!def?.isDone?.((before.values[field.id] ?? null) as never, field.config);
  };
  return {
    blocking,
    commentRequired: now.commentRequired.filter((r) => !r.fromDone || wasDone(r)),
  };
}

/** Issues for a new item: only the values given are checked; empty required fields do not block (docs/03 §2). */
export function checkCreate(
  item: Item,
  fields: Field[],
  ctx: Ctx,
  opts: { isUnique?: (field: Field, value: unknown) => boolean } = {},
): WriteCheck {
  const given = new Set(Object.keys(item.values));
  const keys = fields.filter((f) => given.has(f.id)).map((f) => f.key);
  const r = validateItem(item, fields, ctx, { changedKeys: keys, isUnique: opts.isUnique });
  return {
    blocking: r.issues.filter(
      (i) => i.level === 'error' && i.code !== 'required' && keys.includes(i.fieldKey),
    ),
    commentRequired: r.commentRequired,
  };
}

/** Default value tokens (docs/03 §2): `today`, `me`, `in N days`; anything else is normalised as typed. */
export function resolveDefaultToken(raw: unknown, ctx: Ctx): unknown {
  if (typeof raw !== 'string') return raw;
  const t = raw.trim().toLowerCase();
  if (t === 'today') return ctx.today;
  if (t === 'me') return ctx.userId;
  const m = t.match(/^in (\d{1,4}) days?$/);
  if (m) return addDays(ctx.today, Number(m[1]));
  return raw;
}

/** Values a new item starts with: each value field's `config.default`, normalised. */
export function defaultValues(fields: Field[], ctx: Ctx): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const field of fields) {
    const def = resolveFieldType(field.type);
    const raw = (field.config as { default?: unknown } | null)?.default;
    if (!def || def.storage !== 'values' || isBlankInput(raw)) continue;
    const v = def.normalize(resolveDefaultToken(raw, ctx), field.config, ctx);
    if (v !== null && v !== undefined && !def.isEmpty(v)) out[field.id] = v as Json;
  }
  return out;
}

/**
 * The values of a duplicate (docs/18 §5, `duplicateItems`): the original's name and stored values, checked as a new
 * item. Links, files and protected values live elsewhere and are not copied. A value that no longer passes its type,
 * or a unique value already taken (`isTaken`), is left out; a copy that would break a blocking rule is refused with
 * the reason. Pure.
 */
export function planDuplicate(
  item: Item,
  fields: Field[],
  ctx: Ctx,
  opts: {
    position: string;
    now: string;
    hash: (s: string) => string;
    isTaken?: (fieldId: string) => boolean;
  },
): { ok: true; values: Record<string, Json> } | { ok: false; message: string } {
  const blank: Item = {
    id: '00000000-0000-0000-0000-000000000000',
    sheetId: item.sheetId,
    groupId: item.groupId,
    seq: 0,
    displayId: '',
    name: item.name,
    values: defaultValues(fields, ctx),
    position: opts.position,
    locked: false,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
  const stored = Object.fromEntries(
    fields
      .filter((f) => resolveFieldType(f.type)?.storage === 'values')
      .filter((f) => item.values[f.id] !== undefined && item.values[f.id] !== null)
      .map((f) => [f.id, item.values[f.id]]),
  );
  const first = planValues(blank, fields, stored, ctx, opts.hash);
  const rejected = new Set(first.rejected.map((r) => r.fieldId));
  const plan = rejected.size
    ? planValues(
        blank,
        fields,
        Object.fromEntries(Object.entries(stored).filter(([id]) => !rejected.has(id))),
        ctx,
        opts.hash,
      )
    : first;
  const values: Record<string, Json> = {};
  for (const [id, v] of Object.entries(plan.next.values))
    if (!opts.isTaken?.(id)) values[id] = v as Json;
  const check = checkCreate({ ...plan.next, values }, fields, ctx);
  if (check.blocking.length > 0)
    return { ok: false, message: check.blocking.map((i) => i.message).join(' ') };
  return { ok: true, values };
}
