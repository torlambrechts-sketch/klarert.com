import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { phone } from './phone';

describe('phone', () => {
  contract(phone, {
    valid: [
      ['07700 900123', '+447700900123'],
      ['+44 7700 900123', '+447700900123'],
      ['+1 212 555 0100', '+12125550100'],
      ['tel:0113 496 0000', '+441134960000'],
    ],
    invalid: ['call me', '123', '', null, {}],
    parse: [
      ['7700900123', '+447700900123'],
      ['00447700900123', '+447700900123'],
      ['(0113) 496-0000', '+441134960000'],
    ],
    text: [
      ['+447700900123', '07700 900123'],
      ['+12125550100', '+1 212 555 0100'],
    ],
    order: ['+12125550100', '+447700900123'],
    empty: [
      ['', true],
      ['+447700900123', false],
    ],
  });

  it('uses the configured default country', () => {
    const us = { defaultCountry: 'US' };
    expect(phone.normalize('212 555 0100', us, makeCtx())).toBe('+12125550100');
    expect(phone.toText('+12125550100', us, makeCtx())).toBe('(212) 555-0100');
    expect(phone.toText('+447700900123', us, makeCtx())).toBe('+44 7700 900123');
  });
});
