// Form view (docs/05 §3.3, FR-25): which fields a form shows, in what order, and checking answers before submit.
// Pure; the same code checks the builder in the browser and the public submit on the server.
import { formEligible } from '../fields/view-support';
import { resolveFieldType } from '../fields/resolve';
import type { Ctx, Field, Item, Json } from '../types';
import { validateItem } from '../validation';
import type { FormLayout } from './config';

export interface FormQuestion {
  field: Field;
  label: string;
  help: string;
  required: boolean;
}

/** Fields that may be put on a form, in field order. */
export const formFieldChoices = (fields: Field[]) => fields.filter(formEligible);

/** A new form: every eligible field, required where the field is required. */
export function defaultFormLayout(fields: Field[]): FormLayout {
  return {
    fields: formFieldChoices(fields).map((f) => ({
      key: f.key,
      required: f.required || undefined,
    })),
  };
}

/** Problems that stop a layout from being saved. */
export function formLayoutProblems(layout: FormLayout, fields: Field[]): string[] {
  const out: string[] = [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const seen = new Set<string>();
  for (const q of layout.fields) {
    const f = byKey.get(q.key);
    if (!f) out.push(`Field "${q.key}" no longer exists.`);
    else if (!formEligible(f)) out.push(`${f.name} cannot be filled in on a form.`);
    if (seen.has(q.key)) out.push(`${f?.name ?? q.key} is on the form twice.`);
    seen.add(q.key);
  }
  return out;
}

/** The questions a form shows, in layout order; fields deleted since or not allowed are skipped. */
export function formQuestions(layout: FormLayout | undefined, fields: Field[]): FormQuestion[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: FormQuestion[] = [];
  for (const q of layout?.fields ?? []) {
    const field = byKey.get(q.key);
    if (!field || !formEligible(field) || out.some((x) => x.field.id === field.id)) continue;
    out.push({
      field,
      label: q.label?.trim() || field.name,
      help: q.help?.trim() || field.description?.trim() || '',
      required: q.required ?? field.required,
    });
  }
  return out;
}

export interface FormCheck {
  /** field id → normalised value, ready for create_item / submit_form. */
  values: Record<string, Json>;
  /** field id ("__name" for the name) → message. */
  errors: Record<string, string>;
}

const blank = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/**
 * Normalise and check the answers with the field registry: values the type accepts, then the same generic and type
 * rules a cell edit runs (required as set on the form, min/max, pattern, status rules).
 */
export function checkFormAnswers(
  questions: FormQuestion[],
  name: string,
  answers: Record<string, unknown>,
  ctx: Ctx,
  nameLabel = 'Name',
): FormCheck {
  const values: Record<string, Json> = {};
  const errors: Record<string, string> = {};
  if (!name.trim()) errors.__name = `${nameLabel} is required.`;
  else if (name.trim().length > 500) errors.__name = `${nameLabel} can be at most 500 characters.`;
  for (const q of questions) {
    const def = resolveFieldType(q.field.type);
    const raw = answers[q.field.id];
    if (!def || blank(raw)) continue;
    const v = def.normalize(raw, q.field.config, ctx);
    if (v === null) errors[q.field.id] = `This is not a valid ${q.label.toLowerCase()}.`;
    else values[q.field.id] = v as Json;
  }
  const now = ctx.now.toISOString();
  const probe: Item = {
    id: 'form',
    sheetId: ctx.sheet.id,
    groupId: '',
    seq: 0,
    displayId: '',
    name,
    values,
    position: 'a0',
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
  const asAsked = questions.map((q) => ({ ...q.field, name: q.label, required: q.required }));
  const byKey = new Map(questions.map((q) => [q.field.key, q.field.id]));
  const { issues } = validateItem(probe, asAsked, ctx, { skipCommentRules: true });
  for (const i of issues) {
    const id = byKey.get(i.fieldKey);
    if (i.level === 'error' && id && !errors[id]) errors[id] = i.message;
  }
  for (const id of Object.keys(errors)) delete values[id];
  return { values, errors };
}
