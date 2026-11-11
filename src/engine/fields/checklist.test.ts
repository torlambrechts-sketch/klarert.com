import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { checklist, checklistProgress, countNo, type ChecklistConfig } from './checklist';

const cfg: ChecklistConfig = {
  lines: [
    { id: 'l1', text: 'Guard fitted', noteOnNo: true },
    { id: 'l2', text: 'Signs visible', noteOnNo: false },
    { id: 'l3', text: 'Exit clear', noteOnNo: true },
    { id: 'l4', text: 'Log signed', noteOnNo: false },
  ],
};
const v = (answers: Record<string, { a: 'yes' | 'no' | 'na'; note?: string }>) => ({ answers });

describe('checklist', () => {
  contract(checklist, {
    config: cfg,
    valid: [
      [v({ l1: { a: 'yes' } }), v({ l1: { a: 'yes' } })],
      [['yes', 'No', 'N/A'], v({ l1: { a: 'yes' }, l2: { a: 'no' }, l3: { a: 'na' } })],
      [{ answers: { l2: 'Yes', gone: { a: 'no' } } }, v({ l2: { a: 'yes' } })],
      [v({ l1: { a: 'no', note: 'Missing' } }), v({ l1: { a: 'no', note: 'Missing' } })],
    ],
    invalid: [null, { answers: {} }, [], ['maybe'], ['yes', 'yes', 'yes', 'yes', 'yes'], 'yes'],
    parse: [
      [
        'Yes; No; N/A; Yes',
        v({ l1: { a: 'yes' }, l2: { a: 'no' }, l3: { a: 'na' }, l4: { a: 'yes' } }),
      ],
      ['yes, yes', v({ l1: { a: 'yes' }, l2: { a: 'yes' } })],
      ['{"answers":{"l3":{"a":"no"}}}', v({ l3: { a: 'no' } })],
      ['', null],
    ],
    text: [
      [v({ l1: { a: 'yes' }, l2: { a: 'no' }, l3: { a: 'na' } }), '1 yes, 1 no, 1 n/a, 1 open'],
    ],
    number: [
      [v({ l1: { a: 'yes' }, l2: { a: 'no' } }), 50],
      [v({ l1: { a: 'yes' }, l2: { a: 'yes' }, l3: { a: 'na' } }), 100],
      [v({ l3: { a: 'na' } }), null],
    ],
    order: [v({ l1: { a: 'no' } }), v({ l1: { a: 'yes' } })],
  });

  it('scores yes / (yes + no) and tracks progress as answered / lines', () => {
    const val = v({ l1: { a: 'yes' }, l2: { a: 'no' }, l3: { a: 'yes' } });
    expect(checklist.toNumber(val, cfg, makeCtx())).toBeCloseTo(66.67, 1);
    expect(checklistProgress(val, cfg)).toEqual({ answered: 3, lines: 4, pct: 75 });
    expect(checklistProgress(null, cfg)).toEqual({ answered: 0, lines: 4, pct: 0 });
    expect(countNo(val, cfg)).toBe(1);
  });

  it('warns when a No has no note on a line that asks for one', () => {
    const field = makeField('checklist', cfg);
    const issues = checklist.validate(
      v({ l1: { a: 'no' }, l2: { a: 'no' } }),
      field,
      makeItem(),
      makeCtx(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'note_required', level: 'warning' });
    expect(
      checklist.validate(v({ l1: { a: 'no', note: 'Ordered' } }), field, makeItem(), makeCtx()),
    ).toEqual([]);
  });

  it('supports the checklist_no trigger', () => {
    expect(checklist.triggers).toContain('checklist_no');
  });
});
