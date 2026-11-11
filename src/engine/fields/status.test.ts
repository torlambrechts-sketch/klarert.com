import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { status } from './status';

describe('status', () => {
  contract(status, {
    valid: [
      ['opt_done', 'opt_done'],
      ['Working on it', 'opt_wip'],
      ['  stuck ', 'opt_stuck'],
    ],
    invalid: ['Unknown', 42, null, ''],
    parse: [
      ['Done', 'opt_done'],
      ['NOT STARTED', 'opt_todo'],
      ['opt_wip', 'opt_wip'],
      ['', null],
    ],
    text: [
      ['opt_done', 'Done'],
      ['opt_missing', ''],
    ],
    number: [['opt_done', null]],
    order: ['opt_todo', 'opt_done'],
    done: [
      ['opt_done', true],
      ['opt_wip', false],
      [null, false],
    ],
  });

  it('is a kanban lane field with renamable options stored by id', () => {
    const cfg = status.defaultConfig();
    cfg.options[3]!.label = 'Closed';
    expect(status.kanbanCapable).toBe(true);
    expect(status.toText('opt_done', cfg, undefined as never)).toBe('Closed');
  });
});
