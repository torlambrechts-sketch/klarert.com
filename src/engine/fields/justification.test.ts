import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { applicability } from './applicability';
import { justification } from './justification';
import { installFieldTypes } from './resolve';
import { status } from './status';

describe('justification', () => {
  contract(justification, {
    valid: [
      ['Out of scope', 'Out of scope'],
      ['  We do not process card data.\r\nSee DPIA. ', 'We do not process card data.\nSee DPIA.'],
      [2026, '2026'],
    ],
    invalid: ['', '   ', null, 'x'.repeat(2001), {}],
    parse: [
      ['Out of scope', 'Out of scope'],
      ['line one\nline two', 'line one\nline two'],
      ['"quoted"', '"quoted"'],
    ],
    text: [['Out of scope', 'Out of scope']],
    number: [['12', null]],
    order: ['Alpha', 'beta'],
    empty: [
      ['', true],
      ['x', false],
    ],
  });

  installFieldTypes([applicability, status]);
  const app = makeField('applicability', applicability.defaultConfig(), {
    key: 'applicability',
    id: 'f-app',
  });
  const st = makeField('status', status.defaultConfig(), { key: 'status', id: 'f-st' });
  const ctx = makeCtx({ fields: [app, st] });
  const field = makeField('justification', justification.defaultConfig(), {
    name: 'Justification',
  });

  it('is required while the item is not applicable', () => {
    const na = makeItem({ 'f-app': { applicable: false, reason: '' } });
    const issues = justification.validate(null, field, na, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'justification_required', level: 'error' });
    expect(justification.validate('Out of scope', field, na, ctx)).toEqual([]);
  });

  it('is not required while applicable or unset', () => {
    expect(
      justification.validate(
        null,
        field,
        makeItem({ 'f-app': { applicable: true, reason: '' } }),
        ctx,
      ),
    ).toEqual([]);
    expect(justification.validate(null, field, makeItem(), ctx)).toEqual([]);
  });

  it('works with any field and value list', () => {
    const f = makeField('justification', { whenFieldKey: 'status', whenValues: ['opt_stuck'] });
    expect(justification.validate(null, f, makeItem({ 'f-st': 'opt_stuck' }), ctx)[0]?.code).toBe(
      'justification_required',
    );
    expect(justification.validate(null, f, makeItem({ 'f-st': 'opt_done' }), ctx)).toEqual([]);
  });
});
