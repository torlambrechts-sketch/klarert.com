import { describe, expect, it } from 'vitest';
import { type FormulaEnv, type FormulaResult, coerceResult, evaluateFormula, formulaError, parseFormula } from './index';

const refs: Record<string, FormulaResult> = {
  likelihood: 4,
  impact: 3,
  score_text: '12',
  title: 'Fire door',
  due: '2026-11-20',
  raised: '2026-11-01',
  blank: '',
  done: true,
  broken: formulaError('#REF'),
};

const env: FormulaEnv = {
  today: '2026-11-11',
  ref: (key) => refs[key] ?? formulaError('#REF', key),
};

const run = (src: string) => evaluateFormula(src, env);

describe('evaluateFormula', () => {
  it.each<[string, FormulaResult]>([
    // literals and arithmetic
    ['12.5', 12.5],
    ['"text"', 'text'],
    ['"say \\"hi\\""', 'say "hi"'],
    ['TRUE', true],
    ['false', false],
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 4 - 3', 3],
    ['7 / 2', 3.5],
    ['10 % 3', 1],
    ['-3 + 5', 2],
    ['-(2 + 3) * 2', -10],
    ['2 * -3', -6],
    // references
    ['{likelihood} * {impact}', 12],
    ['{score_text} + 1', 13],
    ['{blank} + 5', 5],
    ['{title} & " (" & {likelihood} & ")"', 'Fire door (4)'],
    // + concatenates if either side is text
    ['"A" + 1', 'A1'],
    ['{title} + "!"', 'Fire door!'],
    ['TRUE + 1', 2],
    ['1 & 2', '12'],
    // comparisons
    ['{likelihood} * {impact} > 10', true],
    ['3 = 3', true],
    ['3 <> 3', false],
    ['2 <= 2', true],
    ['2 >= 3', false],
    ['"10" > 9', true],
    ['"abc" < "abd"', true],
    ['{due} > {raised}', true],
    ['{blank} = ""', true],
    ['{title} = "Fire door"', true],
    ['TRUE = TRUE', true],
    // logic
    ['IF({likelihood} > 3, "High", "Low")', 'High'],
    ['IF(FALSE, 1)', ''],
    ['IF(0, 1, 2)', 2],
    ['IF("", 1, 2)', 2],
    ['AND(TRUE, 1, "x")', true],
    ['AND(TRUE, 0)', false],
    ['OR(FALSE, {done})', true],
    ['NOT({done})', false],
    // functions
    ['ROUND(2.345, 2)', 2.35],
    ['ROUND(1.005, 2)', 1.01],
    ['ROUND(-2.5)', -3],
    ['ROUND(1234.5, -2)', 1200],
    ['ABS(-4)', 4],
    ['MIN(3, 1, 2)', 1],
    ['MAX(3, {blank}, 9)', 9],
    ['MAX({blank})', ''],
    ['TODAY()', '2026-11-11'],
    ['DAYS({due}, TODAY())', 9],
    ['DAYS({raised}, {due})', -19],
    ['DAYS({blank}, TODAY())', ''],
    ['ADDDAYS({due}, 14)', '2026-12-04'],
    ['ADDDAYS("2026-12-31", 1)', '2027-01-01'],
    ['ADDDAYS({blank}, 3)', ''],
    ['CONCAT("a", 1, TRUE)', 'a1TRUE'],
    ['concat()', ''],
    ['LEN({title})', 9],
    ['LEN(123)', 3],
    ['EMPTY({blank})', true],
    ['EMPTY({title})', false],
    ['if(empty({blank}), "none", "some")', 'none'],
  ])('%s → %j', (src, expected) => {
    expect(run(src)).toEqual(expected);
  });

  it.each<[string, string]>([
    ['{nope}', '#REF'],
    ['{nope} + 1', '#REF'],
    ['ROUND({broken}, 2)', '#REF'],
    ['1 / 0', '#DIV0'],
    ['5 % 0', '#DIV0'],
    ['{likelihood} / ({impact} - 3)', '#DIV0'],
    ['"abc" * 2', '#ERR'],
    ['{title} - 1', '#ERR'],
    ['-"x"', '#ERR'],
    ['1 +', '#ERR'],
    ['FOO(1)', '#ERR'],
    ['NOT(1, 2)', '#ERR'],
    ['DAYS("soon", TODAY())', '#ERR'],
    ['ADDDAYS(TODAY(), "x")', '#ERR'],
    ['ABS("x")', '#ERR'],
    ['1 / 0 + {nope}', '#DIV0'],
  ])('%s → %s', (src, code) => {
    expect(run(src)).toMatchObject({ error: code });
  });

  it('IF only evaluates the branch it takes', () => {
    expect(run('IF(TRUE, 1, 1 / 0)')).toBe(1);
    expect(run('IF(FALSE, {nope}, "ok")')).toBe('ok');
    expect(run('IF({nope}, 1, 2)')).toMatchObject({ error: '#REF' });
  });

  it('accepts a parsed AST and an empty formula', () => {
    const parsed = parseFormula('{likelihood} + 1');
    expect(parsed.ok && evaluateFormula(parsed.ast, env)).toBe(5);
    expect(evaluateFormula('   ', env)).toBe('');
  });

  it('never throws on hostile input', () => {
    for (const src of ['constructor()', '__proto__', '{a}{b}', '"\\', 'IF(', ')))', 'process.exit()']) {
      expect(() => run(src)).not.toThrow();
    }
  });
});

describe('coerceResult', () => {
  it.each<[FormulaResult, Parameters<typeof coerceResult>[1], FormulaResult]>([
    ['12', 'auto', 12],
    ['2026-11-11', 'auto', '2026-11-11'],
    [true, 'auto', true],
    ['text', 'auto', 'text'],
    ['', 'number', ''],
    [true, 'number', 1],
    ['3.5', 'number', 3.5],
    [12, 'text', '12'],
    [false, 'text', 'FALSE'],
    ['2026-11-11', 'date', '2026-11-11'],
    [1, 'boolean', true],
    ['', 'boolean', ''],
  ])('%j as %s → %j', (v, type, expected) => {
    expect(coerceResult(v, type)).toEqual(expected);
  });

  it.each<[FormulaResult, Parameters<typeof coerceResult>[1]]>([
    ['abc', 'number'],
    ['2026-13-01', 'date'],
    [5, 'date'],
  ])('%j as %s → #ERR', (v, type) => {
    expect(coerceResult(v, type)).toMatchObject({ error: '#ERR' });
  });
});
