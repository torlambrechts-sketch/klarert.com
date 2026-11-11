import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { country, countryCodes } from './country';

describe('country', () => {
  contract(country, {
    valid: [
      ['GB', 'GB'],
      ['no', 'NO'],
      ['United Kingdom', 'GB'],
      ['Norway', 'NO'],
      ['Saint Lucia', 'LC'],
      ['Turkey', 'TR'],
      ['UK', 'GB'],
    ],
    invalid: ['Atlantis', 'XK', 'EU', 'ZZ', 'GBR', '', null, 44],
    parse: [
      ['Germany', 'DE'],
      [' united states ', 'US'],
      ['Côte d’Ivoire', 'CI'],
      ['Bosnia and Herzegovina', 'BA'],
      ['', null],
    ],
    text: [
      ['GB', 'United Kingdom'],
      ['NO', 'Norway'],
      ['QQ', ''],
    ],
    number: [['GB', null]],
    date: [['GB', null]],
    order: ['NO', 'GB'],
    empty: [
      ['', true],
      ['GB', false],
    ],
  });

  it('knows exactly the 249 assigned ISO 3166-1 codes', () => {
    const codes = countryCodes();
    expect(codes).toHaveLength(249);
    expect(codes).toContain('AX');
    expect(codes).not.toContain('UK');
    expect(codes).not.toContain('EU');
    expect(country.options?.({}, makeCtx())[0]).toEqual({
      id: 'AF',
      label: 'Afghanistan',
      color: 'navy',
    });
  });

  it('flags a stored code that is not a country', () => {
    const field = makeField('country', {});
    expect(country.validate('QQ', field, makeItem(), makeCtx()).map((i) => i.code)).toEqual([
      'country_unknown',
    ]);
    expect(country.validate('GB', field, makeItem(), makeCtx())).toEqual([]);
  });
});
