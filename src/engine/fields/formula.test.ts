import { beforeAll, describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import type { Field, Json } from '../types';
import { date } from './date';
import { type FormulaConfig, formula, formulaKind } from './formula';
import { number } from './number';
import { installFieldTypes } from './resolve';
import { status } from './status';
import { text } from './text';

beforeAll(() => installFieldTypes([text, number, date, status, formula]));

const fx = (key: string, expr: string, result: FormulaConfig['result'] = 'auto') =>
  makeField<FormulaConfig>('formula', { expr, result }, { key });

describe('formula', () => {
  contract(formula, {
    valid: [
      [12, 12],
      ['2026-11-11', '2026-11-11'],
      [true, true],
      ['High', 'High'],
    ],
    invalid: ['', null, Infinity, { a: 1 }],
    parse: [
      ['1,234.5', 1234.5],
      ['TRUE', true],
      ['High risk', 'High risk'],
    ],
    text: [
      [1234.567, '1,234.57'],
      ['2026-11-11', '11 Nov 2026'],
      [true, 'Yes'],
      [false, 'No'],
      ['#DIV0', '#DIV0'],
      ['Open', 'Open'],
    ],
    number: [
      [12, 12],
      ['12', null],
      [null, null],
    ],
    date: [
      ['2026-11-11', '2026-11-11'],
      [20261111, null],
      ['soon', null],
    ],
    order: [3, 12],
    empty: [
      ['', true],
      [0, false],
      [false, false],
    ],
  });

  it('maps the result type to a value kind', () => {
    expect(formulaKind({ expr: '', result: 'auto' })).toBe('text');
    expect(formulaKind({ expr: '', result: 'date' })).toBe('date');
    expect(formulaKind({ expr: '', result: 'boolean' })).toBe('boolean');
    expect(formula.kind).toBe('number');
  });
});

describe('formula compute', () => {
  const likelihood = makeField('number', { unit: '', decimals: 0 }, { key: 'likelihood' });
  const impact = makeField('number', { unit: '', decimals: 0 }, { key: 'impact' });
  const due = makeField('date', { relative: true }, { key: 'due' });
  const title = makeField('text', {}, { key: 'title' });
  const state = makeField(
    'status',
    {
      options: [
        { id: 'opt_open', label: 'Open', color: 'orange' },
        { id: 'opt_done', label: 'Done', color: 'green', done: true },
      ],
    },
    { key: 'state' },
  );
  const baseFields = [likelihood, impact, due, title, state];

  const values = (v: Record<string, Json>): Record<string, Json> =>
    Object.fromEntries(Object.entries(v).map(([k, x]) => [`f-${k}`, x]));

  function compute(
    expr: string,
    v: Record<string, Json> = {},
    extra: Field[] = [],
    result: FormulaConfig['result'] = 'auto',
  ) {
    const field = fx('calc', expr, result);
    const ctx = makeCtx({ fields: [...baseFields, ...extra, field] });
    const item = makeItem(values(v), { name: 'Fire door', displayId: 'CA-007', groupId: 'g-open' });
    return formula.compute!(item, field, ctx);
  }

  it.each<[string, Record<string, Json>, unknown]>([
    ['{likelihood} * {impact}', { likelihood: 4, impact: 3 }, 12],
    ['{likelihood} * {impact}', { likelihood: 4 }, 0],
    ['DAYS({due}, TODAY())', { due: '2026-11-20' }, 9],
    ['ADDDAYS({due}, 7)', { due: '2026-11-20' }, '2026-11-27'],
    [
      '{title} & " – " & {state}',
      { title: 'Check extinguishers', state: 'opt_done' },
      'Check extinguishers – Done',
    ],
    ['IF({state} = "Done", "Closed", "Open")', { state: 'opt_open' }, 'Open'],
    ['{id} & ": " & {name} & " (" & {group} & ")"', {}, 'CA-007: Fire door (Open)'],
    ['EMPTY({due})', {}, true],
    ['{title}', {}, null],
    ['', {}, null],
    ['{likelihood} / {impact}', { likelihood: 4, impact: 0 }, '#DIV0'],
    ['{title} * 2', { title: 'abc' }, '#ERR'],
    ['1 +', {}, '#ERR'],
  ])('%s with %j → %j', (expr, v, expected) => {
    expect(compute(expr, v)).toEqual(expected);
  });

  it('pins the result type', () => {
    expect(compute('"12"', {}, [], 'number')).toBe(12);
    expect(compute('{likelihood}', { likelihood: 3 }, [], 'text')).toBe('3');
    expect(compute('{likelihood} > 2', { likelihood: 3 }, [], 'boolean')).toBe(true);
    expect(compute('{title}', { title: 'x' }, [], 'date')).toBe('#ERR');
  });

  it('gives #REF for an unknown field', () => {
    expect(compute('{missing} + 1')).toBe('#REF');
  });

  it('uses the nested formula result', () => {
    const score = fx('score', '{likelihood} * {impact}');
    expect(compute('IF({score} > 10, "High", "Low")', { likelihood: 4, impact: 3 }, [score])).toBe(
      'High',
    );
    const when = fx('when', 'ADDDAYS({due}, 1)');
    expect(compute('DAYS({when}, {due})', { due: '2026-11-20' }, [when])).toBe(1);
  });

  it('gives #LOOP for a cycle a → b → a and for a self-reference', () => {
    const a = fx('a', '{b} + 1');
    const b = fx('b', '{a} + 1');
    const self = fx('self', '{self} * 2');
    const ctx = makeCtx({ fields: [a, b, self] });
    const item = makeItem();
    expect(formula.compute!(item, a, ctx)).toBe('#LOOP');
    expect(formula.compute!(item, b, ctx)).toBe('#LOOP');
    expect(formula.compute!(item, self, ctx)).toBe('#LOOP');
  });

  it('allows four formula-to-formula hops and stops at five', () => {
    const chain = (n: number) =>
      Array.from({ length: n }, (_, i) => fx(`c${i}`, i === n - 1 ? '1' : `{c${i + 1}} + 1`));
    const ok = chain(5);
    expect(formula.compute!(makeItem(), ok[0]!, makeCtx({ fields: ok }))).toBe(5);
    const deep = chain(6);
    expect(formula.compute!(makeItem(), deep[0]!, makeCtx({ fields: deep }))).toBe('#LOOP');
  });

  it('reads as a number for number triggers', () => {
    const v = compute('{likelihood} * {impact}', { likelihood: 4, impact: 4 });
    expect(formula.toNumber(v as number, formula.defaultConfig(), makeCtx())).toBe(16);
    expect(formula.triggers).toEqual(['number_above', 'number_below', 'date_arrives']);
    expect(formula.formAllowed).toBe(false);
  });
});
