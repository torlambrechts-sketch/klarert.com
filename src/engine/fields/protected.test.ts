import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { protectedText } from './protected';

describe('protected', () => {
  contract(protectedText, {
    valid: [
      ['Whistleblower: J. Smith', 'Whistleblower: J. Smith'],
      ['  note  ', 'note'],
      [42, '42'],
    ],
    invalid: ['', '  ', null, { text: 'x' }],
    parse: [
      ['Sensitive', 'Sensitive'],
      ['two\r\nlines', 'two\nlines'],
      ['', null],
    ],
    text: [
      ['Sensitive', 'Sensitive'],
      [undefined, 'Restricted'],
    ],
    number: [['12', null]],
    order: ['Alpha', 'Beta'],
    empty: [
      ['x', false],
      [undefined, false],
    ],
  });

  it('reads the value from protected storage and shows Restricted when hidden', () => {
    const field = makeField('protected', { allowedUserIds: ['u-maria'] }, { id: 'f-pr' });
    const item = makeItem({}, { id: 'i-pr' });
    const allowed = makeCtx({ protected: { 'i-pr:f-pr': 'Secret' } });
    expect(protectedText.compute!(item, field, allowed)).toBe('Secret');
    expect(protectedText.compute!(makeItem(), field, allowed)).toBeNull();
    const hidden = makeCtx({}, { protectedValue: () => undefined });
    const v = protectedText.compute!(item, field, hidden);
    expect(v).toBeUndefined();
    expect(protectedText.toText(v, field.config, hidden)).toBe('Restricted');
  });

  it('sorts restricted values with the empties', () => {
    expect(
      protectedText.compare(undefined, 'a', { allowedUserIds: [] }, makeCtx()),
    ).toBeGreaterThan(0);
    expect(protectedText.storage).toBe('protected');
    expect(protectedText.kind).toBe('none');
  });
});
