import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { team } from './team';

describe('team', () => {
  contract(team, {
    valid: [
      ['t-it', 't-it'],
      ['Quality', 't-quality'],
      [' it ', 't-it'],
    ],
    invalid: ['Finance', 't-unknown', '', null, ['t-it']],
    parse: [
      ['Quality', 't-quality'],
      ['QUALITY', 't-quality'],
      ['t-it', 't-it'],
      ['', null],
    ],
    text: [
      ['t-quality', 'Quality'],
      ['t-gone', ''],
    ],
    number: [['t-it', null]],
    date: [['t-it', null]],
    order: ['t-it', 't-quality'],
    empty: [
      ['', true],
      ['t-it', false],
    ],
  });

  it('lists workspace teams as options and puts deleted teams with the empties', () => {
    const ctx = makeCtx();
    expect(team.options?.({}, ctx).map((o) => o.id)).toEqual(['t-quality', 't-it']);
    expect(team.compare('t-gone', 't-it', {}, ctx)).toBeGreaterThan(0);
    expect(team.kind).toBe('option');
  });
});
