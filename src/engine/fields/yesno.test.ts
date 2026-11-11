import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { yesno } from './yesno';

describe('yesno', () => {
  contract(yesno, {
    valid: [
      ['yes', 'yes'],
      ['No', 'no'],
      ['N/A', 'na'],
      [true, 'yes'],
      [false, 'no'],
    ],
    invalid: ['maybe', '', null, 2, ['yes']],
    parse: [
      ['TRUE', 'yes'],
      ['Y', 'yes'],
      ['n/a', 'na'],
      ['0', 'no'],
    ],
    text: [
      ['yes', 'Yes'],
      ['na', 'N/A'],
    ],
    order: ['yes', 'no'],
    empty: [
      ['no', false],
      [null, true],
    ],
    done: [
      ['yes', true],
      ['no', false],
      ['na', true],
      [null, false],
    ],
  });

  it('drops N/A when allowNA is off', () => {
    const cfg = { allowNA: false };
    expect(yesno.normalize('N/A', cfg, makeCtx())).toBeNull();
    expect(yesno.options!(cfg, makeCtx()).map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(yesno.options!({ allowNA: true }, makeCtx()).map((o) => o.color)).toEqual(['green', 'red', 'grey']);
  });
});
