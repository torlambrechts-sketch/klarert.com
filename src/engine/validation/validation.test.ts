import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import type { Field, Json } from '../types';
import { canSave, isVisible, validateItem } from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

function setup(fields: Field[], values: Record<string, Json>) {
  const item = makeItem(
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [fields.find((f) => f.key === k)!.id, v]),
    ),
  );
  return { item, ctx: makeCtx({ fields, items: [item] }) };
}

describe('generic validation', () => {
  it('required blocks an empty value', () => {
    const title = makeField('text', {}, { key: 'title', name: 'Title', required: true });
    const { item, ctx } = setup([title], {});
    const r = validateItem(item, [title], ctx);
    expect(r.issues).toEqual([
      expect.objectContaining({ fieldKey: 'title', code: 'required', level: 'error' }),
    ]);
    expect(canSave(r)).toBe(false);
  });

  it('min / max on numbers, text length and counts', () => {
    const cost = makeField(
      'number',
      { unit: '', decimals: 2 },
      { key: 'cost', name: 'Cost', validation: { min: 0, max: 10 } },
    );
    const code = makeField(
      'text',
      {},
      { key: 'code', name: 'Code', validation: { min: 3, maxLength: 5 } },
    );
    const owners = makeField(
      'people',
      { multiple: true },
      { key: 'owners', name: 'Owners', validation: { max: 1 } },
    );
    const fields = [cost, code, owners];
    const { item, ctx } = setup(fields, { cost: 11, code: 'ab', owners: ['u-maria', 'u-james'] });
    expect(validateItem(item, fields, ctx).issues.map((i) => `${i.fieldKey}:${i.code}`)).toEqual([
      'cost:max',
      'code:min',
      'owners:max',
    ]);
  });

  it('pattern on text kinds; invalid regexes are ignored', () => {
    const ref = makeField(
      'text',
      {},
      { key: 'ref', name: 'Ref', validation: { pattern: '^[A-Z]{2}-\\d+$' } },
    );
    const bad = makeField('text', {}, { key: 'bad', name: 'Bad', validation: { pattern: '([' } });
    const fields = [ref, bad];
    const { item, ctx } = setup(fields, { ref: 'ab-1', bad: 'x' });
    expect(validateItem(item, fields, ctx).issues.map((i) => i.code)).toEqual(['pattern']);
  });

  it('unique uses the injected hook', () => {
    const email = makeField(
      'email',
      {},
      { key: 'email', name: 'Email', validation: { unique: true } },
    );
    const { item, ctx } = setup([email], { email: 'a@b.co' });
    expect(validateItem(item, [email], ctx, { isUnique: () => false }).issues[0]?.code).toBe(
      'unique',
    );
    expect(validateItem(item, [email], ctx, { isUnique: () => true }).issues).toEqual([]);
  });

  it('status rules block closing until required fields are filled', () => {
    const rootCause = makeField(
      'longtext',
      {},
      { key: 'root_cause', name: 'Root cause', position: 'a1' },
    );
    const status = makeField('status', FIELD_TYPES.status.defaultConfig(), {
      key: 'status',
      name: 'Status',
      position: 'a0',
      rules: [
        {
          id: 'r1',
          whenFieldKey: 'status',
          whenValues: ['opt_done'],
          require: ['root_cause'],
          message: 'Add the root cause before closing.',
        },
        { id: 'r2', whenFieldKey: 'status', whenValues: ['opt_stuck'], requireComment: true },
      ],
    });
    const fields = [status, rootCause];
    let s = setup(fields, { status: 'opt_done' });
    expect(validateItem(s.item, fields, s.ctx).issues).toEqual([
      expect.objectContaining({
        code: 'rule_blocked',
        message: 'Add the root cause before closing.',
      }),
    ]);
    s = setup(fields, { status: 'opt_done', root_cause: 'Worn bearing' });
    expect(validateItem(s.item, fields, s.ctx).issues).toEqual([]);

    s = setup(fields, { status: 'opt_stuck' });
    const r = validateItem(s.item, fields, s.ctx);
    expect(r.commentRequired.map((x) => x.id)).toEqual(['r2']);
    expect(validateItem(s.item, fields, s.ctx, { skipCommentRules: true }).commentRequired).toEqual(
      [],
    );
    // rules fire only when their field changed
    expect(
      validateItem(s.item, fields, s.ctx, { changedKeys: ['root_cause'] }).commentRequired,
    ).toEqual([]);
  });

  it('a hidden field is not required', () => {
    const type = makeField(
      'dropdown',
      {
        options: [
          { id: 'opt_injury', label: 'Injury', color: 'red' },
          { id: 'opt_near', label: 'Near miss', color: 'orange' },
        ],
      },
      { key: 'type', name: 'Type', position: 'a0' },
    );
    const injury = makeField(
      'text',
      {},
      {
        key: 'injury',
        name: 'Injury details',
        required: true,
        position: 'a1',
        visibility: { fieldKey: 'type', op: 'is_any_of', value: ['opt_injury'] },
      },
    );
    const fields = [type, injury];
    let s = setup(fields, { type: 'opt_near' });
    expect(isVisible(injury, s.item, s.ctx)).toBe(false);
    expect(validateItem(s.item, fields, s.ctx).issues).toEqual([]);
    s = setup(fields, { type: 'opt_injury' });
    expect(validateItem(s.item, fields, s.ctx).issues.map((i) => i.code)).toEqual(['required']);
  });

  it('justification is required while its condition holds', () => {
    const applicability = makeField('applicability', FIELD_TYPES.applicability.defaultConfig(), {
      key: 'applicability',
      name: 'Applicability',
      position: 'a0',
    });
    const why = makeField('justification', FIELD_TYPES.justification.defaultConfig(), {
      key: 'why',
      name: 'Justification',
      position: 'a1',
    });
    const fields = [applicability, why];
    const s = setup(fields, {
      applicability: { applicable: false, reason: 'No such processes on site' },
    });
    expect(validateItem(s.item, fields, s.ctx).issues.map((i) => i.fieldKey)).toContain('why');
  });
});
