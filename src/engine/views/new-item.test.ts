import { beforeAll, describe, expect, it } from 'vitest';
import { matches } from '../conditions';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import type { FormLayout } from './config';
import {
  answerableOnNew,
  askWhenAdding,
  checkNewItem,
  chosenIntake,
  hasAnswers,
  inSentence,
  intakePlan,
  intakeUsable,
  MISSING_KEY,
  missingRequired,
  missingText,
  newItemPlan,
  planQuestions,
  shownQuestions,
  standardPlan,
  startingAnswers,
  type IntakeForm,
} from './new-item';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const status = makeField(
  'status',
  {
    options: [
      { id: 'opt_open', label: 'Open', color: 'orange' },
      { id: 'opt_done', label: 'Done', color: 'green', done: true },
    ],
  },
  { key: 'status', name: 'Status', position: 'a0' },
);
const what = makeField(
  'longtext',
  {},
  {
    key: 'details',
    name: 'What was found',
    description: 'Say what you saw, not who did it.',
    position: 'a1',
    required: true,
  },
);
const owner = makeField(
  'people',
  { multiple: false },
  {
    key: 'owner',
    name: 'Owner',
    position: 'a2',
    required: true,
  },
);
const due = makeField(
  'date',
  { askWhenAdding: true },
  {
    key: 'due_date',
    name: 'Due date',
    position: 'a3',
  },
);
const note = makeField('text', {}, { key: 'note', name: 'Note', position: 'a4' });
const score = makeField(
  'formula',
  { expression: '1 + 1' },
  {
    key: 'score',
    name: 'Score',
    position: 'a5',
    required: true,
  },
);
const secret = makeField(
  'text',
  {},
  {
    key: 'cost',
    name: 'Cost',
    position: 'a6',
    required: true,
    restrictedTo: { userIds: [], roles: ['admin'] },
    hidden: true,
  },
);
const reason = makeField(
  'text',
  {},
  {
    key: 'reason',
    name: 'Why it is done',
    position: 'a7',
    required: true,
    visibility: { fieldKey: 'status', op: 'is_any_of', value: ['opt_done'] },
  },
);
const fields = [note, status, what, owner, due, score, secret, reason];
const ctx = makeCtx({ fields });

describe('the standard New item dialog (Phase A)', () => {
  it('asks the name, the required fields and the fields marked "Ask when adding", in field order', () => {
    const plan = standardPlan(fields);
    expect(plan.form).toBeNull();
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.questions.map((q) => q.field.key)).toEqual([
      'details',
      'owner',
      'due_date',
      'reason',
    ]);
    // the rest is folded under More fields
    expect(plan.more.map((q) => q.field.key)).toEqual(['status', 'note']);
    expect(plan.nameLabel).toBe('Name');
  });

  it('uses the item panel’s label and help, and marks required questions', () => {
    const q = standardPlan(fields).steps[0]!.questions[0]!;
    expect(q).toMatchObject({
      label: 'What was found',
      help: 'Say what you saw, not who did it.',
      required: true,
    });
    expect(standardPlan(fields).steps[0]!.questions[2]!.required).toBe(false);
  });

  it('never asks a computed field or a restricted field the person cannot see', () => {
    expect(answerableOnNew(score)).toBe(false);
    expect(answerableOnNew(secret)).toBe(false);
    expect(answerableOnNew({ ...secret, hidden: false })).toBe(true);
    const keys = planQuestions(standardPlan(fields)).map((q) => q.field.key);
    expect(keys).not.toContain('score');
    expect(keys).not.toContain('cost');
  });

  it('reads "Ask when adding" from the field config (data, not code)', () => {
    expect(askWhenAdding(due)).toBe(true);
    expect(askWhenAdding(note)).toBe(false);
    expect(askWhenAdding({ config: { askWhenAdding: 'yes' } })).toBe(false);
    expect(askWhenAdding({ config: null })).toBe(false);
  });

  it('asks a field hidden by its visibility rule only when it shows', () => {
    const qs = planQuestions(standardPlan(fields));
    expect(shownQuestions(qs, {}, ctx).map((q) => q.field.key)).not.toContain('reason');
    expect(shownQuestions(qs, { [status.id]: 'opt_done' }, ctx).map((q) => q.field.key)).toContain(
      'reason',
    );
  });

  it('checks the answers like a form: the name, required answers, then each type', () => {
    const plan = standardPlan(fields);
    const qs = planQuestions(plan);
    const empty = checkNewItem(qs, ' ', {}, ctx);
    expect(empty.errors).toEqual({
      __name: 'Name is required.',
      [what.id]: 'What was found is required.',
      [owner.id]: 'Owner is required.',
    });
    // a required field its visibility rule hides is not required
    expect(empty.errors[reason.id]).toBeUndefined();
    const shown = checkNewItem(qs, 'Guard missing', { [status.id]: 'opt_done' }, ctx);
    expect(shown.errors[reason.id]).toBe('Why it is done is required.');

    const ok = checkNewItem(
      qs,
      'Guard missing on press 3',
      { [what.id]: 'Guard was off', [owner.id]: ['u-maria'], [due.id]: '2026-11-20' },
      ctx,
    );
    expect(ok.errors).toEqual({});
    expect(ok.values).toEqual({
      [what.id]: 'Guard was off',
      [owner.id]: ['u-maria'],
      [due.id]: '2026-11-20',
    });
    const bad = checkNewItem(
      qs,
      'X',
      { [what.id]: 'x', [owner.id]: ['u-maria'], [due.id]: 'not a date' },
      ctx,
    );
    expect(bad.errors[due.id]).toBe('This is not a valid due date.');
  });

  it('starts from the fields’ defaults and what the view gives (a Kanban lane, a Calendar day)', () => {
    const qs = planQuestions(standardPlan(fields));
    expect(
      startingAnswers(qs, { [due.id]: '2026-11-18', [score.id]: 2 }, { [status.id]: 'opt_done' }),
    ).toEqual({ [due.id]: '2026-11-18', [status.id]: 'opt_done' });
  });

  it('knows when closing would lose answers', () => {
    const start = { [due.id]: '2026-11-18' };
    expect(hasAnswers('', start, start)).toBe(false);
    expect(hasAnswers('', { ...start, [note.id]: '' }, start)).toBe(false);
    expect(hasAnswers('A', start, start)).toBe(true);
    expect(hasAnswers('', { [due.id]: '2026-11-19' }, start)).toBe(true);
    expect(hasAnswers('', { ...start, [owner.id]: ['u-maria'] }, start)).toBe(true);
  });
});

const intakeLayout: FormLayout = {
  status: 'draft',
  access: 'internal',
  nameLabel: 'The problem, in one line',
  title: 'Report a nonconformity',
  fields: [
    { key: 'details', label: 'What did you find?', required: true },
    { key: 'cost' },
    { key: 'due_date', step: 'When' },
    { key: 'note', step: '' },
    { key: 'status' },
  ],
  intake: true,
};
const intake: IntakeForm = { id: 'v-intake', name: 'Report a nonconformity', form: intakeLayout };

describe('a sheet’s new-item form (Phase B)', () => {
  it('asks the form’s questions in its steps, with its labels and name question', () => {
    const plan = intakePlan(intake, fields);
    expect(plan.form).toEqual({ id: 'v-intake', name: 'Report a nonconformity' });
    expect(plan.nameLabel).toBe('The problem, in one line');
    expect(plan.title).toBe('Report a nonconformity');
    expect(plan.more).toEqual([]);
    expect(plan.steps.map((s) => [s.title, s.questions.map((q) => q.field.key)])).toEqual([
      [null, ['details']],
      ['When', ['due_date']],
      [null, ['note', 'status']],
    ]);
    expect(plan.steps[0]!.questions[0]!.label).toBe('What did you find?');
  });

  it('leaves out a restricted field the person cannot see, even when the form asks it', () => {
    expect(planQuestions(intakePlan(intake, fields)).map((q) => q.field.key)).not.toContain('cost');
  });

  it('is the chosen form, none when the sheet chose the standard dialog, else a pack’s intake form', () => {
    const other: IntakeForm = { id: 'v-2', name: 'Other', form: { fields: [] } };
    expect(chosenIntake(undefined, [other, intake])?.id).toBe('v-intake');
    expect(chosenIntake('v-2', [other, intake])?.id).toBe('v-2');
    expect(chosenIntake(false, [other, intake])).toBeNull();
    // a chosen form that was deleted falls back to the standard dialog, never to another form
    expect(chosenIntake('v-gone', [other, intake])).toBeNull();
    expect(chosenIntake(undefined, [other])).toBeNull();
  });

  it('falls back to the standard dialog when the form is closed', () => {
    const now = new Date('2026-11-14T10:00:00Z');
    expect(intakeUsable(intake, now)).toBe(true);
    expect(intakeUsable({ ...intake, form: { ...intakeLayout, status: 'open' } }, now)).toBe(true);
    const closed = { ...intake, form: { ...intakeLayout, status: 'closed' as const } };
    expect(intakeUsable(closed, now)).toBe(false);
    const past = {
      ...intake,
      form: { ...intakeLayout, status: 'open' as const, closesAt: '2026-11-13T00:00:00Z' },
    };
    expect(intakeUsable(past, now)).toBe(false);
    expect(intakeUsable(null, now)).toBe(false);
    expect(newItemPlan(fields, closed, now).form).toBeNull();
    expect(newItemPlan(fields, intake, now).form?.id).toBe('v-intake');
  });

  it('checks a form’s questions as the form asks them (its own required)', () => {
    const qs = planQuestions(intakePlan(intake, fields));
    const r = checkNewItem(qs, 'Guard missing', {}, ctx, 'The problem, in one line');
    // Owner is required on the sheet but not on this form: the form decides what it asks
    expect(r.errors).toEqual({ [what.id]: 'What did you find? is required.' });
    expect(checkNewItem(qs, '', {}, ctx, 'The problem, in one line').errors.__name).toBe(
      'The problem, in one line is required.',
    );
  });
});

describe('missing required', () => {
  it('lists the required fields an item leaves empty, by what the person may see and what shows', () => {
    const item = makeItem({ [what.id]: 'Guard was off' });
    expect(missingRequired(item, fields, ctx).map((f) => f.key)).toEqual(['owner']);
    const done = makeItem({ [status.id]: 'opt_done' });
    expect(missingRequired(done, fields, ctx).map((f) => f.key)).toEqual([
      'details',
      'owner',
      'reason',
    ]);
    // computed fields and restricted ones the person cannot see never count
    expect(missingRequired(done, fields, ctx).map((f) => f.key)).not.toContain('score');
    expect(missingRequired(done, fields, ctx).map((f) => f.key)).not.toContain('cost');
  });

  it('says what is missing in words', () => {
    expect(missingText([owner, due])).toBe('Missing: owner, due date');
    expect(missingText([])).toBe('');
    expect(inSentence('CIA rating')).toBe('CIA rating');
    expect(inSentence('Owner')).toBe('owner');
    expect(inSentence('X')).toBe('x');
  });

  it('is a condition filters, dashboards and automations can use', () => {
    const missing = makeItem({ [what.id]: 'x' });
    const complete = makeItem({ [what.id]: 'x', [owner.id]: ['u-maria'] });
    const yes = { fieldKey: MISSING_KEY, op: 'is_checked' };
    const no = { fieldKey: MISSING_KEY, op: 'is_not_checked' };
    expect(matches(yes, missing, ctx)).toBe(true);
    expect(matches(yes, complete, ctx)).toBe(false);
    expect(matches(no, complete, ctx)).toBe(true);
    expect(matches({ fieldKey: MISSING_KEY, op: 'is' }, missing, ctx)).toBe(false);
  });
});
