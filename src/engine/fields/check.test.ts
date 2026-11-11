import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { check } from './check';

describe('check', () => {
  contract(check, {
    valid: [
      [true, true],
      [false, false],
      ['yes', true],
      [0, false],
    ],
    invalid: ['maybe', '', null, 2, {}],
    parse: [
      ['TRUE', true],
      ['FALSE', false],
      ['x', true],
      ['✓', true],
      ['no', false],
      ['1', true],
    ],
    text: [
      [true, 'Yes'],
      [false, 'No'],
    ],
    number: [
      [true, 1],
      [false, 0],
      [null, null],
    ],
    order: [false, true],
    empty: [
      [false, false],
      [null, true],
    ],
    done: [
      [true, true],
      [false, false],
    ],
  });

  it('round-trips through its text, so check converts to yesno and back', () => {
    const ctx = makeCtx();
    expect(check.parseText(check.toText(true, {}, ctx), {}, ctx)).toBe(true);
    expect(check.parseText(check.toText(false, {}, ctx), {}, ctx)).toBe(false);
  });
});
