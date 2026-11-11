import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { role } from './role';

describe('role', () => {
  contract(role, {
    valid: [
      ['r-cm', 'r-cm'],
      ['Head of IT', 'r-it'],
      ['  compliance MANAGER ', 'r-cm'],
    ],
    invalid: ['CEO', 'r-unknown', '', null, 3],
    parse: [
      ['Compliance manager', 'r-cm'],
      ['HEAD OF IT', 'r-it'],
      ['r-it', 'r-it'],
      ['', null],
    ],
    text: [
      ['r-cm', 'Compliance manager'],
      ['r-gone', ''],
    ],
    number: [['r-cm', null]],
    date: [['r-cm', null]],
    order: ['r-cm', 'r-it'],
    empty: [
      ['', true],
      ['r-cm', false],
    ],
  });

  it('lists workspace job roles as options and shows renames', () => {
    const ctx = makeCtx();
    expect(role.options?.({}, ctx).map((o) => o.label)).toEqual([
      'Compliance manager',
      'Head of IT',
    ]);
    ctx.jobRoles.set('r-cm', { id: 'r-cm', name: 'Compliance lead' });
    expect(role.toText('r-cm', {}, ctx)).toBe('Compliance lead');
    expect(role.triggers).toEqual(['field_changed']);
  });
});
