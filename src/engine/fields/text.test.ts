import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { text } from './text';

describe('text', () => {
  contract(text, {
    valid: [
      ['Press guard', 'Press guard'],
      ['  two   spaces  ', 'two spaces'],
      [42, '42'],
    ],
    invalid: ['', '   ', null, {}, 'x'.repeat(501)],
    parse: [
      ['Fix guard', 'Fix guard'],
      ['line\tone', 'line one'],
      ['"quoted"', '"quoted"'],
    ],
    text: [['Fix', 'Fix']],
    number: [['12', null]],
    order: ['apple', 'Banana'],
    empty: [
      ['', true],
      ['x', false],
    ],
  });

  it('keeps 500 characters and refuses more', () => {
    const ctx = makeCtx();
    expect(text.normalize('x'.repeat(500), {}, ctx)).toHaveLength(500);
    expect(text.normalize('x'.repeat(501), {}, ctx)).toBeNull();
  });
});
