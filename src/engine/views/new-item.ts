// The New item dialog (docs/05 §3.7, owner decision 14 Nov 2026): which fields it asks, in what steps, and checking
// the answers. Pure; the dialog in the browser and the createItem command on the server call the same functions, so
// what the dialog lets through is what the server accepts.
//
// Phase A: the item's name, the sheet's required fields and the fields marked "Ask when adding" (`config.askWhenAdding`,
// data on the field, set in field settings or by a pack), then every other field the person may fill in under
// "More fields". Phase B: a sheet may choose one of its forms as its new-item form (`sheets.settings.newItemForm`, or
// a pack's form marked `intake`); the dialog then asks that form's questions, in its steps.
import { formEligible } from '../fields/view-support';
import { resolveFieldType } from '../fields/resolve';
import type { Ctx, Field, Item, Json } from '../types';
import { isVisible } from '../validation';
import type { FormLayout } from './config';
import {
  checkFormAnswers,
  formQuestions,
  formState,
  type FormCheck,
  type FormQuestion,
} from './form';

/** The field setting "Ask when adding": the dialog asks it although it is not required. */
export const askWhenAdding = (field: { config?: unknown }): boolean =>
  (field.config as { askWhenAdding?: unknown } | null | undefined)?.askWhenAdding === true;

/**
 * A field the person adding an item may answer: a value a form can ask for (no computed, file or link fields), and
 * not a restricted field they may not see (docs/02 §16). Never asks for what the person cannot see or edit.
 */
export const answerableOnNew = (field: Field): boolean => formEligible(field) && !field.hidden;

const asQuestion = (field: Field): FormQuestion => ({
  field,
  label: field.name,
  help: field.description?.trim() ?? '',
  required: field.required,
});

/** A sheet's form, as the dialog may use it: its id, name and layout. */
export interface IntakeForm {
  id: string;
  name: string;
  form: FormLayout;
}

export interface NewItemStep {
  /** The step's title (the form's "start a new step here" title); null for an untitled step. */
  title: string | null;
  questions: FormQuestion[];
}

export interface NewItemPlan {
  /** The form the dialog renders (Phase B), or null for the standard dialog. */
  form: { id: string; name: string } | null;
  /** One step for the standard dialog and a form without steps. */
  steps: NewItemStep[];
  /** "More fields", folded (the standard dialog only). */
  more: FormQuestion[];
  /** The name question's label: the form's, else "Name". */
  nameLabel: string;
  /** The group the form puts new items in, when it names one. */
  groupId: string | null;
  /** The form's title and description, shown above the questions. */
  title: string | null;
  description: string | null;
}

/** The standard dialog: required and "Ask when adding" fields in field order, the rest under More fields. */
export function standardPlan(fields: Field[]): NewItemPlan {
  const ordered = [...fields].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
  );
  const asked: FormQuestion[] = [];
  const more: FormQuestion[] = [];
  for (const f of ordered) {
    if (!answerableOnNew(f)) continue;
    (f.required || askWhenAdding(f) ? asked : more).push(asQuestion(f));
  }
  return {
    form: null,
    steps: [{ title: null, questions: asked }],
    more,
    nameLabel: 'Name',
    groupId: null,
    title: null,
    description: null,
  };
}

/**
 * The sheet's new-item form (Phase B): the form chosen in Sheet settings (`sheets.settings.newItemForm`, a form's
 * view id), none when the sheet chose the standard dialog (`false`), else a form a pack marked as its intake form
 * (`intake` on the form, the first in tab order). A choice whose form was deleted since falls back to the standard
 * dialog, never to another form.
 */
export function chosenIntake(
  setting: string | false | null | undefined,
  forms: IntakeForm[],
): IntakeForm | null {
  if (setting === false) return null;
  if (typeof setting === 'string') return forms.find((f) => f.id === setting) ?? null;
  return forms.find((f) => f.form.intake === true) ?? null;
}

/** Whether a form can be the new-item form now: it exists and is not closed (a draft is fine: nobody outside sees it). */
export function intakeUsable(form: IntakeForm | null | undefined, now: Date): form is IntakeForm {
  return !!form && formState(form.form, now, 0) !== 'closed';
}

/**
 * The questions of a form as the dialog asks them: the form's labels, help, required and order, without fields the
 * person may not see, split into steps where a question starts a new step (`step` on the question).
 */
export function intakePlan(intake: IntakeForm, fields: Field[]): NewItemPlan {
  const asked = formQuestions({ ...intake.form, access: 'internal' }, fields).filter((q) =>
    answerableOnNew(q.field),
  );
  const starts = new Map(
    intake.form.fields.filter((q) => q.step !== undefined).map((q) => [q.key, q.step!.trim()]),
  );
  const steps: NewItemStep[] = [{ title: null, questions: [] }];
  for (const q of asked) {
    const title = starts.get(q.field.key);
    const cur = steps[steps.length - 1]!;
    if (title !== undefined && cur.questions.length > 0)
      steps.push({ title: title || null, questions: [q] });
    else {
      if (title !== undefined && cur.questions.length === 0 && steps.length > 1)
        cur.title = title || null;
      cur.questions.push(q);
    }
  }
  return {
    form: { id: intake.id, name: intake.name },
    steps,
    more: [],
    nameLabel: intake.form.nameLabel?.trim() || 'Name',
    groupId: intake.form.groupId ?? null,
    title: intake.form.title?.trim() || null,
    description: intake.form.description?.trim() || null,
  };
}

/**
 * What the dialog asks on this sheet: the chosen new-item form when it can be used (Phase B), else the standard
 * dialog (Phase A), so a deleted or closed form falls back.
 */
export function newItemPlan(
  fields: Field[],
  intake: IntakeForm | null | undefined,
  now: Date,
): NewItemPlan {
  return intakeUsable(intake, now) ? intakePlan(intake, fields) : standardPlan(fields);
}

/**
 * The sheet's forms as Sheet settings › New item form offers them (docs/05 §3.7): "Internal · 3 steps · Draft", closed
 * or not, and whether a pack marked it as the intake form. Forms in tab order.
 */
export function newItemFormChoices(
  forms: readonly IntakeForm[],
  fields: Field[],
  now: Date,
): { id: string; name: string; summary: string; closed: boolean; intake: boolean }[] {
  return forms.map((f) => {
    const steps = intakePlan(f, fields).steps.length;
    const state = formState(f.form, now, 0);
    return {
      id: f.id,
      name: f.name,
      summary: [
        (f.form.access ?? 'public') === 'public' ? 'Public' : 'Internal',
        steps > 1 ? `${steps} steps` : 'One page',
        state === 'draft' ? 'Draft' : state === 'closed' ? 'Closed' : 'Open',
      ].join(' · '),
      closed: state === 'closed',
      intake: f.form.intake === true,
    };
  });
}

/** Every question of a plan: the steps' and More fields. */
export const planQuestions = (plan: NewItemPlan): FormQuestion[] => [
  ...plan.steps.flatMap((s) => s.questions),
  ...plan.more,
];

function probe(ctx: Ctx, values: Record<string, Json>): Item {
  const now = ctx.now.toISOString();
  return {
    id: 'new',
    sheetId: ctx.sheet.id,
    groupId: '',
    seq: 0,
    displayId: '',
    name: '',
    values,
    position: 'a0',
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** The answers as values (by field id), normalised by each type; answers a type cannot read are left out. */
export function answerValues(
  questions: FormQuestion[],
  answers: Record<string, unknown>,
  ctx: Ctx,
): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const q of questions) {
    const raw = answers[q.field.id];
    if (raw === undefined || raw === null || raw === '') continue;
    const v = resolveFieldType(q.field.type)?.normalize(raw, q.field.config, ctx);
    if (v !== null && v !== undefined) out[q.field.id] = v as Json;
  }
  return out;
}

/** The questions shown with these answers: a field hidden by its visibility rule (docs/03 §6) is not asked. */
export function shownQuestions(
  questions: FormQuestion[],
  answers: Record<string, unknown>,
  ctx: Ctx,
): FormQuestion[] {
  const item = probe(ctx, answerValues(questions, answers, ctx));
  return questions.filter((q) => isVisible(q.field, item, ctx));
}

/**
 * Check the dialog's answers: the name, then each answer with the field registry and the generic rules (required,
 * min/max, pattern), as the forms do (`checkFormAnswers`). The same call runs in the dialog (per step and on
 * Create) and in the createItem command.
 */
export function checkNewItem(
  questions: FormQuestion[],
  name: string,
  answers: Record<string, unknown>,
  ctx: Ctx,
  nameLabel = 'Name',
): FormCheck {
  return checkFormAnswers(questions, name, answers, ctx, nameLabel);
}

/** The values a new item starts with in the dialog: each asked field's default (docs/03 §2), then the view's. */
export function startingAnswers(
  questions: FormQuestion[],
  defaults: Record<string, Json>,
  given: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const asked = new Set(questions.map((q) => q.field.id));
  const out: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(defaults)) if (asked.has(id)) out[id] = v;
  for (const [id, v] of Object.entries(given ?? {})) out[id] = v;
  return out;
}

/** Answers that differ from where the dialog started: closing then asks "Discard this item?". */
export function hasAnswers(
  name: string,
  answers: Record<string, unknown>,
  start: Record<string, unknown>,
): boolean {
  if (name.trim() !== '') return true;
  const keys = new Set([...Object.keys(answers), ...Object.keys(start)]);
  for (const k of keys) {
    const a = answers[k];
    const b = start[k];
    const blank = (v: unknown) =>
      v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (blank(a) && blank(b)) continue;
    if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  }
  return false;
}

// ───────────────────────── missing required ─────────────────────────

export { MISSING_KEY, missingRequired } from '../conditions';

/** A field name inside a sentence: "Due date" → "due date", acronyms kept ("CIA rating"). */
export const inSentence = (name: string): string =>
  name.length > 1 && name[1] === name[1]!.toUpperCase() && name[1] !== name[1]!.toLowerCase()
    ? name
    : name.charAt(0).toLowerCase() + name.slice(1);

/** "Missing: owner, due date" (empty when nothing is missing). */
export const missingText = (missing: Field[]): string =>
  missing.length ? `Missing: ${missing.map((f) => inSentence(f.name)).join(', ')}` : '';
