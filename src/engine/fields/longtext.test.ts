import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { firstLine, longtext } from './longtext';

describe('longtext', () => {
  contract(longtext, {
    valid: [
      ['Line one\nLine two', 'Line one\nLine two'],
      ['  padded  ', 'padded'],
      ['a\r\nb', 'a\nb'],
      [42, '42'],
    ],
    invalid: ['', '   ', null, 'x'.repeat(20001), { text: 'no' }],
    parse: [
      ['"Line one\nShe said ""hi"""', 'Line one\nShe said "hi"'],
      ['Plain cell', 'Plain cell'],
      ['Two\nlines', 'Two\nlines'],
    ],
    text: [['Line one\nLine two', 'Line one\nLine two']],
    order: ['alpha', 'beta'],
    empty: [
      ['', true],
      ['x', false],
    ],
  });

  it('keeps line breaks and accepts 20 000 characters', () => {
    expect(longtext.normalize('a\n\nb', {}, makeCtx())).toBe('a\n\nb');
    expect(longtext.normalize('x'.repeat(20000), {}, makeCtx())).toHaveLength(20000);
  });

  it('shows the first line in the grid', () => {
    expect(firstLine('One\nTwo')).toBe('One…');
    expect(firstLine('One')).toBe('One');
  });
});
