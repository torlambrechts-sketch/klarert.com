// Form view (docs/05 §3.3, FR-25): which fields a form shows, in what order, and checking answers before submit.
// Pure; the same code checks the builder in the browser and the public submit on the server.
import { basicCtx } from '../context';
import { formEligible, publicFormEligible } from '../fields/view-support';
import { resolveFieldType } from '../fields/resolve';
import type { Ctx, Field, Item, Json, Sheet } from '../types';
import { validateItem } from '../validation';
import type {
  FormAccess,
  FormLayout,
  FormStatus,
  LegalBasis,
  PrivacyNotice,
} from './config';

export interface FormQuestion {
  field: Field;
  label: string;
  help: string;
  required: boolean;
}

/** A form's status and access as stored (absent: draft, public). */
export const formStatus = (form: FormLayout | undefined): FormStatus => form?.status ?? 'draft';
export const formAccess = (form: FormLayout | undefined): FormAccess => form?.access ?? 'public';

/** Whether a field may be on a form with this access: public forms never ask for files or the directory. */
export const fieldAllowedOn = (field: Field, access: FormAccess) =>
  access === 'public' ? publicFormEligible(field) : formEligible(field);

/** Fields that may be put on a form, in field order. */
export const formFieldChoices = (fields: Field[], access: FormAccess = 'internal') =>
  fields.filter((f) => fieldAllowedOn(f, access));

/** A new form: a draft with every eligible field, required where the field is required. */
export function defaultFormLayout(fields: Field[], access: FormAccess = 'public'): FormLayout {
  return {
    status: 'draft',
    access,
    fields: formFieldChoices(fields, access).map((f) => ({
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
  const access = formAccess(layout);
  for (const q of layout.fields) {
    const f = byKey.get(q.key);
    if (!f) out.push(`Field "${q.key}" no longer exists.`);
    else if (!formEligible(f)) out.push(`${f.name} cannot be filled in on a form.`);
    else if (!fieldAllowedOn(f, access))
      out.push(`${f.name} cannot be asked on a public form. Make the form internal or remove it.`);
    if (seen.has(q.key)) out.push(`${f?.name ?? q.key} is on the form twice.`);
    seen.add(q.key);
  }
  const asked = new Set(layout.fields.map((q) => q.key));
  for (const p of layout.prefill ?? []) {
    const f = byKey.get(p.key);
    if (!f) out.push(`Hidden value: field "${p.key}" no longer exists.`);
    else if (!formEligible(f)) out.push(`${f.name} cannot hold a hidden value.`);
    else if (asked.has(p.key)) out.push(`${f.name} is asked on the form and cannot also be hidden.`);
  }
  const opens = layout.opensAt ? Date.parse(layout.opensAt) : null;
  const closes = layout.closesAt ? Date.parse(layout.closesAt) : null;
  if (opens !== null && Number.isNaN(opens)) out.push('Enter a valid opening time.');
  if (closes !== null && Number.isNaN(closes)) out.push('Enter a valid closing time.');
  if (opens !== null && closes !== null && closes <= opens)
    out.push('The closing time must be after the opening time.');
  return out;
}

/** The questions a form shows, in layout order; fields deleted since or not allowed are skipped. */
export function formQuestions(layout: FormLayout | undefined, fields: Field[]): FormQuestion[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const access = formAccess(layout);
  const out: FormQuestion[] = [];
  for (const q of layout?.fields ?? []) {
    const field = byKey.get(q.key);
    if (!field || !fieldAllowedOn(field, access) || out.some((x) => x.field.id === field.id))
      continue;
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

/** The Ctx a public form works in: the sheet and the form's fields, no directory and no other items. */
export function formCtx(input: {
  sheet: Sheet;
  fields: Field[];
  timeZone: string;
  now: Date;
  newId: (prefix: string) => string;
}): Ctx {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: input.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(input.now);
  const ctx = basicCtx({
    today,
    now: input.now,
    timeZone: input.timeZone,
    userId: '',
    sheet: input.sheet,
    newId: input.newId,
  });
  return { ...ctx, fieldsByKey: new Map(input.fields.map((f) => [f.key, f])) };
}

// ───────────────────────── state, notice, version ─────────────────────────

/** What a form takes right now (mirrors _form_state in 0022_forms_v1.sql, which decides on submit). */
export type FormState = 'draft' | 'open' | 'closed' | 'scheduled' | 'full';

export function formState(form: FormLayout | undefined, now: Date, responses: number): FormState {
  const status = formStatus(form);
  if (status === 'closed') return 'closed';
  if (status !== 'open') return 'draft';
  if (formAccess(form) === 'public' && !noticeReviewed(form?.notice)) return 'draft';
  const opens = form?.opensAt ? Date.parse(form.opensAt) : NaN;
  const closes = form?.closesAt ? Date.parse(form.closesAt) : NaN;
  if (!Number.isNaN(opens) && opens > now.getTime()) return 'scheduled';
  if (!Number.isNaN(closes) && closes <= now.getTime()) return 'closed';
  if (form?.maxResponses && responses >= form.maxResponses) return 'full';
  return 'open';
}

export const FORM_STATE_LABEL: Record<FormState, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  scheduled: 'Not open yet',
  full: 'Full',
};

const NOTICE_PARTS: [keyof PrivacyNotice, string][] = [
  ['purpose', 'the purpose'],
  ['legalBasis', 'the legal basis'],
  ['recipients', 'who receives the answers'],
  ['retention', 'how long answers are kept'],
  ['rights', 'people’s rights and a contact'],
];

/** What a privacy notice still lacks (empty when complete). */
export function noticeProblems(notice: PrivacyNotice | undefined): string[] {
  const missing = NOTICE_PARTS.filter(([k]) => {
    const v = notice?.[k];
    return typeof v !== 'string' || v.trim() === '';
  }).map(([, label]) => label);
  return missing.length ? [`The privacy notice needs ${missing.join(', ')}.`] : [];
}

/** The notice's version (1 for a new one). */
export const noticeVersion = (notice: PrivacyNotice | undefined) => notice?.version ?? 1;

/** Reviewed by an owner or admin, in this version, and complete. */
export const noticeReviewed = (notice: PrivacyNotice | undefined): boolean =>
  !!notice &&
  noticeProblems(notice).length === 0 &&
  notice.reviewedVersion !== undefined &&
  notice.reviewedVersion === noticeVersion(notice);

const STAMPS = ['version', 'reviewedVersion', 'reviewedAt', 'reviewedBy'] as const;
/** The words of a notice, without its version and review stamp. */
export function noticeContent(notice: PrivacyNotice | undefined): Omit<PrivacyNotice, (typeof STAMPS)[number]> {
  const out: Record<string, unknown> = { ...(notice ?? {}) };
  for (const k of STAMPS) delete out[k];
  return out as Omit<PrivacyNotice, (typeof STAMPS)[number]>;
}

/**
 * The notice as it will be stored after an edit (mirrors the database): changed words make a new version, which is
 * not reviewed until someone reviews it again.
 */
export function nextNotice(before: PrivacyNotice | undefined, after: PrivacyNotice): PrivacyNotice {
  if (!before) return { ...after, version: after.version ?? 1 };
  const changed = canonical(noticeContent(before)) !== canonical(noticeContent(after));
  if (!changed) return { ...after, version: noticeVersion(before) };
  const content = noticeContent(after);
  return { ...content, version: noticeVersion(before) + 1 };
}

/** Problems that keep a form from opening (empty when it may open). */
export function openProblems(form: FormLayout, fields: Field[]): string[] {
  const out = formLayoutProblems(form, fields);
  if (formAccess(form) === 'public') {
    out.push(...noticeProblems(form.notice));
    if (noticeProblems(form.notice).length === 0 && !noticeReviewed(form.notice))
      out.push('An owner or admin must mark the privacy notice as reviewed.');
  }
  return out;
}

/** Whether the person filling in the public form must tick a consent box. */
export const needsConsent = (form: FormLayout | undefined): boolean =>
  formAccess(form) === 'public' && form?.notice?.legalBasis === ('consent' satisfies LegalBasis);

/** JSON with sorted keys: the same form always reads the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * A short hash of what a form asks and how it is set up (FNV-1a, 32 bit, hex), without the review stamp. Equal
 * fingerprints: saving would not change the form, so no new version.
 */
export function formFingerprint(name: string, form: FormLayout): string {
  const { notice, ...rest } = form;
  const text = canonical({ name, ...rest, notice: notice ? noticeContent(notice) : undefined });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ───────────────────────── privacy warnings ─────────────────────────

const SPECIAL =
  /\b(health|medical|injur\w*|illness|sick\w*|disab\w*|diagnos\w*|religio\w*|belief|ethnic\w*|race|racial|trade union|union member\w*|sexual\w*|sex life|orientation|biometric|genetic|criminal|convictions?|political)\b/i;
const PERSONAL = /\b(name|e-?mail|phone|mobile|address|date of birth|birthday|national id|passport)\b/i;

/**
 * Plain-words warnings for the builder: the form collects names or contact details, or may collect health or other
 * special-category data. Reads the questions as asked (label, help and the field's name).
 */
export function privacyWarnings(questions: FormQuestion[], nameLabel: string): string[] {
  const text = (q: FormQuestion) => `${q.label} ${q.help} ${q.field.name}`;
  const out: string[] = [];
  const personal =
    PERSONAL.test(nameLabel) ||
    questions.some((q) => q.field.type === 'email' || q.field.type === 'phone' || PERSONAL.test(text(q)));
  if (personal)
    out.push('This form collects names or contact details. Ask only for what you need.');
  const special = questions.filter((q) => SPECIAL.test(text(q)) || SPECIAL.test(nameLabel));
  if (special.length || SPECIAL.test(nameLabel))
    out.push(
      `This form may collect health or other special-category data${
        special.length ? ` (${special.map((q) => q.label).join(', ')})` : ''
      }. Don’t include health data unless needed.`,
    );
  return out;
}

// ───────────────────────── duplicate and copy ─────────────────────────

/** A form as a fresh copy: a draft, the notice kept but not reviewed. Links are never copied (they are rows). */
export function asNewCopy(form: FormLayout): FormLayout {
  const { notice, ...rest } = form;
  return {
    ...rest,
    status: 'draft',
    ...(notice ? { notice: { ...noticeContent(notice), version: 1 } } : {}),
  };
}

/**
 * A form for another sheet of the workspace: questions and hidden values are matched by field key (rule 5); the
 * ones the target lacks, or cannot ask with this access, are left out and listed. The group is the target's first
 * unless a group with the same name exists.
 */
export function mapFormToSheet(
  form: FormLayout,
  source: { fields: Field[]; groups: { id: string; name: string }[] },
  target: { fields: Field[]; groups: { id: string; name: string }[] },
): { form: FormLayout; missing: string[] } {
  const byKey = new Map(target.fields.map((f) => [f.key, f]));
  const srcName = new Map(source.fields.map((f) => [f.key, f.name]));
  const access = formAccess(form);
  const missing: string[] = [];
  const fields = form.fields.filter((q) => {
    const f = byKey.get(q.key);
    const ok = !!f && fieldAllowedOn(f, access);
    if (!ok) missing.push(srcName.get(q.key) ?? q.key);
    return ok;
  });
  const prefill = (form.prefill ?? []).filter((p) => {
    const f = byKey.get(p.key);
    const ok = !!f && formEligible(f) && f.type === source.fields.find((s) => s.key === p.key)?.type;
    if (!ok) missing.push(`${srcName.get(p.key) ?? p.key} (hidden value)`);
    return ok;
  });
  const groupName = source.groups.find((g) => g.id === form.groupId)?.name;
  const group = groupName ? target.groups.find((g) => g.name === groupName) : undefined;
  const copy = asNewCopy({ ...form, fields, prefill: prefill.length ? prefill : undefined });
  return { form: { ...copy, groupId: group?.id ?? null }, missing };
}
