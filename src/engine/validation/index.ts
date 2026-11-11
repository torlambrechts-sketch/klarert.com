// Generic validation (docs/03 §1, §6): required, min/max, pattern, unique hook, then the type's own rules,
// then status rules and comment-on-value. Visibility hides fields; hidden + required = not required.
import { matches } from '../conditions';
import type { ValueKind } from '../fields/types';
import type { Ctx, Field, Issue, Item, Json, StatusRule } from '../types';
import { defOf, isEmptyOf, keysOf, kindOf, numberOf, textOf, valueOf } from '../values';

export interface ValidateOptions {
  /** Only these field keys changed (status rules fire on change). Default: all fields. */
  changedKeys?: Iterable<string>;
  /** Unique check (a SQL query in the command); return false when another item has this value. */
  isUnique?: (field: Field, value: unknown) => boolean;
  /** Skip requireComment rules (automations post "Set by automation …" instead). */
  skipCommentRules?: boolean;
}

export interface ValidationResult {
  issues: Issue[];
  /** Rules that need a comment before the change is saved (docs/03 §6). */
  commentRequired: StatusRule[];
}

const TEXT_KINDS: ValueKind[] = ['text'];
const COUNT_KINDS: ValueKind[] = ['multi', 'people', 'link', 'file'];

export function isVisible(field: Field, item: Item, ctx: Ctx): boolean {
  return field.visibility ? matches(field.visibility, item, ctx) : true;
}

const issue = (field: Field, code: string, message: string, level: Issue['level'] = 'error'): Issue => ({
  fieldKey: field.key,
  code,
  message,
  level,
});

function lengthOf(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function genericIssues(field: Field, item: Item, ctx: Ctx, opts: ValidateOptions): Issue[] {
  const out: Issue[] = [];
  const empty = isEmptyOf(item, field, ctx);
  if (field.required && empty) out.push(issue(field, 'required', `${field.name} is required.`));
  if (empty) return out;

  const kind = kindOf(field, ctx);
  const { min, max, pattern, unique, maxLength } = field.validation ?? {};
  const value = valueOf(item, field, ctx);

  if (kind === 'number' && (min !== undefined || max !== undefined)) {
    const n = numberOf(item, field, ctx);
    if (n !== null && min !== undefined && n < min) out.push(issue(field, 'min', `${field.name} must be at least ${min}.`));
    if (n !== null && max !== undefined && n > max) out.push(issue(field, 'max', `${field.name} must be at most ${max}.`));
  }
  if (TEXT_KINDS.includes(kind)) {
    const text = textOf(item, field, ctx);
    const longest = maxLength ?? max;
    if (min !== undefined && text.length < min) out.push(issue(field, 'min', `${field.name} needs at least ${min} characters.`));
    if (longest !== undefined && text.length > longest)
      out.push(issue(field, 'max', `${field.name} can be at most ${longest} characters.`));
    if (pattern && pattern.length <= 200) {
      let re: RegExp | null = null;
      try {
        re = new RegExp(pattern);
      } catch {
        re = null;
      }
      if (re && !re.test(text)) out.push(issue(field, 'pattern', `${field.name} is not in the expected format.`));
    }
  }
  if (COUNT_KINDS.includes(kind)) {
    const count = lengthOf(value);
    if (min !== undefined && count < min) out.push(issue(field, 'min', `Choose at least ${min} for ${field.name}.`));
    if (max !== undefined && count > max) out.push(issue(field, 'max', `Choose at most ${max} for ${field.name}.`));
  }
  if (unique && opts.isUnique && !opts.isUnique(field, value)) {
    out.push(issue(field, 'unique', `Another item already has this ${field.name.toLowerCase()}.`));
  }
  return out;
}

function ruleMatches(rule: StatusRule, field: Field, item: Item, ctx: Ctx): boolean {
  const keys = keysOf(item, field, ctx);
  const raw = valueOf(item, field, ctx) as Json;
  return rule.whenValues.some((w) => keys.includes(String(w)) || JSON.stringify(w) === JSON.stringify(raw));
}

/** Validate an item as it would be after a change. */
export function validateItem(item: Item, fields: Field[], ctx: Ctx, opts: ValidateOptions = {}): ValidationResult {
  const changed = opts.changedKeys ? new Set(opts.changedKeys) : null;
  const issues: Issue[] = [];
  const commentRequired: StatusRule[] = [];
  const byKey = new Map(fields.map((f) => [f.key, f]));

  for (const field of fields) {
    const def = defOf(field);
    if (def.storage === 'computed' || def.storage === 'none') continue;
    if (!isVisible(field, item, ctx)) continue;
    issues.push(...genericIssues(field, item, ctx, opts));
    issues.push(...def.validate(valueOf(item, field, ctx), field, item, ctx));

    if (changed && !changed.has(field.key)) continue;
    for (const rule of field.rules ?? []) {
      if (rule.whenFieldKey !== field.key || !ruleMatches(rule, field, item, ctx)) continue;
      const missing = (rule.require ?? [])
        .map((k) => byKey.get(k))
        .filter((f): f is Field => !!f && isEmptyOf(item, f, ctx));
      if (missing.length > 0) {
        issues.push(
          issue(
            field,
            'rule_blocked',
            rule.message ?? `Fill in ${missing.map((f) => f.name).join(' and ')} first.`,
          ),
        );
      }
      if (rule.requireComment && !opts.skipCommentRules) commentRequired.push(rule);
    }
  }
  return { issues, commentRequired };
}

/** True when nothing blocks saving (warnings allowed). */
export const canSave = (r: ValidationResult) => r.issues.every((i) => i.level !== 'error');
