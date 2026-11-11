import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { value } from './value';

const eur = (amount: number) => ({ amount, currency: 'EUR' });

describe('value', () => {
  contract(value, {
    valid: [
      [1200, eur(1200)],
      ['€1,200.50', eur(1200.5)],
      [{ amount: '30', currency: 'EUR' }, eur(30)],
      ['100 USD', eur(100)],
    ],
    invalid: ['abc', '', null, { currency: 'EUR' }, NaN],
    parse: [
      ['€1,200.00', eur(1200)],
      ['1200', eur(1200)],
      ['EUR 99.99', eur(99.99)],
    ],
    text: [
      [eur(1200), '€1,200.00'],
      [{ amount: 5, currency: 'GBP' }, '£5.00'],
    ],
    number: [
      [eur(1200), 1200],
      [null, null],
    ],
    order: [eur(10), eur(200)],
    empty: [
      [eur(0), false],
      [null, true],
    ],
  });

  it('keeps another currency only when allowOther is on', () => {
    const cfg = { currency: 'EUR', allowOther: true };
    expect(value.normalize('£30', cfg, makeCtx())).toEqual({ amount: 30, currency: 'GBP' });
    expect(value.normalize('30 usd', cfg, makeCtx())).toEqual({ amount: 30, currency: 'USD' });
    expect(value.normalize(30, cfg, makeCtx())).toEqual(eur(30));
    expect(value.normalize({ amount: 1, currency: 'EURO' }, cfg, makeCtx())).toBeNull();
  });

  it('flags a stored amount in another currency', () => {
    const field = makeField('value', { currency: 'EUR', allowOther: false });
    expect(value.validate({ amount: 1, currency: 'USD' }, field, makeItem(), makeCtx())).toHaveLength(1);
    expect(value.validate(eur(1), field, makeItem(), makeCtx())).toEqual([]);
  });
});
