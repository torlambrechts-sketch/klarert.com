import { describe, expect, it } from 'vitest';
import { referencedKeys } from './index';
import { type Node, parse } from './parser';

/** Fully parenthesised form of an AST, to check precedence and associativity. */
function show(n: Node): string {
  switch (n.type) {
    case 'num':
      return String(n.value);
    case 'str':
      return JSON.stringify(n.value);
    case 'bool':
      return n.value ? 'TRUE' : 'FALSE';
    case 'ref':
      return `{${n.key}}`;
    case 'neg':
      return `(-${show(n.arg)})`;
    case 'binary':
      return `(${show(n.left)} ${n.op} ${show(n.right)})`;
    case 'call':
      return `${n.name}(${n.args.map(show).join(', ')})`;
  }
}

const ok = (src: string) => {
  const r = parse(src);
  if (!r.ok) throw new Error(r.message);
  return show(r.ast);
};

describe('parse', () => {
  it.each([
    ['1 + 2 * 3', '(1 + (2 * 3))'],
    ['(1 + 2) * 3', '((1 + 2) * 3)'],
    ['1 - 2 - 3', '((1 - 2) - 3)'],
    ['8 / 4 / 2', '((8 / 4) / 2)'],
    ['-2 * 3', '((-2) * 3)'],
    ['--1', '(-(-1))'],
    ['1 + 2 = 3', '((1 + 2) = 3)'],
    ['"a" & 1 + 2', '("a" & (1 + 2))'],
    ['{a} & {b} = "xy"', '(({a} & {b}) = "xy")'],
    ['if(true, 1, 2)', 'IF(TRUE, 1, 2)'],
    ['Round({x} / 3, 2)', 'ROUND(({x} / 3), 2)'],
    ['concat()', 'CONCAT()'],
    ['today()', 'TODAY()'],
    ['false', 'FALSE'],
    ['10 % 3 >= 1', '((10 % 3) >= 1)'],
  ])('%j → %s', (src, expected) => {
    expect(ok(src)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['1 +', 'ends too early'],
    ['(1 + 2', 'ends too early'],
    ['1 2', 'Unexpected number 2'],
    ['FOO(1)', 'Unknown function FOO'],
    ['IF(1)', 'IF takes 2 to 3 arguments, not 1'],
    ['NOT(1, 2)', 'NOT takes 1 argument, not 2'],
    ['TODAY(1)', 'TODAY takes 0 arguments, not 1'],
    ['MIN()', 'MIN takes at least 1 argument, not 0'],
    ['ROUND', 'ends too early'],
    ['ROUND 2', 'Expected "("'],
    [') + 1', 'Unexpected ")"'],
    ['* 2', 'Unexpected "*"'],
  ])('rejects %j', (src, message) => {
    const r = parse(src);
    expect(r).toMatchObject({ ok: false, error: '#ERR' });
    if (!r.ok) expect(r.message).toContain(message);
  });
});

describe('referencedKeys', () => {
  it('lists field keys once, without name/id/group', () => {
    expect(referencedKeys('{a} + {b} * {a} & {name} & {ID} & {group} & { c }')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('works while the formula is still being typed', () => {
    expect(referencedKeys('IF({status} = "Done", {due')).toEqual(['status']);
  });
});
