import { describe, expect, it } from 'vitest';
import { tokenize } from './tokenizer';

const kinds = (src: string) => {
  const r = tokenize(src);
  if (!r.ok) throw new Error(r.message);
  return r.tokens.map((t) => {
    switch (t.type) {
      case 'num':
        return t.value;
      case 'str':
        return `"${t.value}"`;
      case 'ref':
        return `{${t.key}}`;
      case 'ident':
        return `id:${t.name}`;
      case 'op':
        return t.op;
      case 'punct':
        return t.value;
    }
  });
};

describe('tokenize', () => {
  it.each<[string, unknown[]]>([
    ['1 + 2', [1, '+', 2]],
    ['12.5*.5', [12.5, '*', 0.5]],
    ['{likelihood} * {impact}', ['{likelihood}', '*', '{impact}']],
    ['{ due date }', ['{due date}']],
    ['"a" & "b"', ['"a"', '&', '"b"']],
    ['"say \\"hi\\""', ['"say "hi""']],
    ['a<=b>=c<>d', ['id:a', '<=', 'id:b', '>=', 'id:c', '<>', 'id:d']],
    ['IF(x, 1, 2)', ['id:IF', '(', 'id:x', ',', 1, ',', 2, ')']],
    ['10 % 3 - -1', [10, '%', 3, '-', '-', 1]],
    ['', []],
  ])('%j', (src, expected) => {
    expect(kinds(src)).toEqual(expected);
  });

  it.each([
    ['"open', 'closing quote'],
    ['{open', 'closing }'],
    ['{ }', 'Empty field reference'],
    ['1 # 2', 'Unexpected "#"'],
    ['1 ! 2', 'Unexpected "!"'],
  ])('rejects %j', (src, message) => {
    const r = tokenize(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(message);
  });

  it('records positions', () => {
    const r = tokenize('1 + {a}');
    expect(r.ok && r.tokens.map((t) => t.pos)).toEqual([0, 2, 4]);
  });
});
