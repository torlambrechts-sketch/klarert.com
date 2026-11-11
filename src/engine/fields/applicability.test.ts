import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { applicability, applicabilityState } from './applicability';

const yes = { applicable: true, reason: '' };
const no = { applicable: false, reason: 'No card payments' };

describe('applicability', () => {
  contract(applicability, {
    valid: [
      [yes, yes],
      [no, no],
      ['Not applicable', { applicable: false, reason: '' }],
      ['applicable', yes],
      [false, { applicable: false, reason: '' }],
    ],
    invalid: [null, '', 'maybe', { reason: 'x' }, 7],
    parse: [
      ['Applicable', yes],
      ['Not applicable: No card payments', no],
      ['N/A — No card payments', no],
      ['{"applicable":true,"reason":""}', yes],
    ],
    text: [
      [yes, 'Applicable'],
      [no, 'Not applicable — No card payments'],
    ],
    number: [[yes, null]],
    order: [yes, no],
    done: [
      [yes, true],
      [no, true],
      [null, false],
    ],
  });

  it('requires a reason when not applicable', () => {
    const field = makeField('applicability', applicability.defaultConfig());
    const ctx = makeCtx();
    const item = makeItem();
    expect(
      applicability.validate({ applicable: false, reason: ' ' }, field, item, ctx)[0]?.code,
    ).toBe('reason_required');
    expect(applicability.validate(no, field, item, ctx)).toEqual([]);
    expect(applicability.validate(yes, field, item, ctx)).toEqual([]);
    const lax = makeField('applicability', { reasonRequiredWhenNot: false });
    expect(applicability.validate({ applicable: false, reason: '' }, lax, item, ctx)).toEqual([]);
  });

  it('exposes Applicable / Not applicable options for field_becomes', () => {
    expect(
      applicability.options!(applicability.defaultConfig(), makeCtx()).map((o) => o.id),
    ).toEqual(['applicable', 'not_applicable']);
    expect(applicabilityState(no)).toBe('not_applicable');
  });
});
