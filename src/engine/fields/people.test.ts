import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { people } from './people';

describe('people', () => {
  contract(people, {
    valid: [
      [['u-james'], ['u-james']],
      ['me', ['u-maria']],
      [
        ['james@example.com', 'Maria Pereira', 'u-james'],
        ['u-james', 'u-maria'],
      ],
      [['u-nobody', 'u-vic'], ['u-vic']],
    ],
    invalid: [[], 'Nobody', ['u-nobody'], '', null, 42],
    parse: [
      ['Maria Pereira, James Okafor', ['u-maria', 'u-james']],
      ['vic@example.com; maria@example.com', ['u-vic', 'u-maria']],
      ['James Okafor', ['u-james']],
      ['', null],
    ],
    text: [
      [['u-maria', 'u-james'], 'Maria Pereira, James Okafor'],
      [['u-gone', 'u-vic'], 'Vic Viewer'],
      [[], ''],
    ],
    number: [[['u-maria'], null]],
    date: [[['u-maria'], null]],
    order: [['u-james'], ['u-maria']],
    empty: [
      [[], true],
      [['u-maria'], false],
    ],
  });

  it('keeps only the first person when the field is single', () => {
    const ctx = makeCtx();
    expect(people.normalize(['u-james', 'u-maria'], { multiple: false }, ctx)).toEqual(['u-james']);
    expect(people.parseText('me, James Okafor', { multiple: false }, ctx)).toEqual(['u-maria']);
    const field = makeField('people', { multiple: false });
    expect(
      people.validate(['u-james', 'u-maria'], field, makeItem(), ctx).map((i) => i.code),
    ).toEqual(['people_single']);
  });

  it('resolves "me" to the injected user and warns about people who left', () => {
    const ctx = makeCtx({}, { userId: 'u-james' });
    expect(people.normalize('me', people.defaultConfig(), ctx)).toEqual(['u-james']);
    const field = makeField('people', { multiple: true });
    expect(people.validate(['u-gone'], field, makeItem(), ctx)).toEqual([
      expect.objectContaining({ code: 'people_unknown', level: 'warning' }),
    ]);
    expect(people.triggers).toEqual(['field_changed', 'field_becomes']);
  });
});
