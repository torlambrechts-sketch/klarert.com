import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, NOW } from '../testing/fixtures';
import { ai, type AiConfig, type AiValue } from './ai';
import { installFieldTypes } from './resolve';
import { status } from './status';
import { text } from './text';

installFieldTypes([text, status]);

const summary = makeField('text', {}, { key: 'summary' });
const state = makeField('status', status.defaultConfig(), { key: 'state' });
const ctx = makeCtx({ fields: [summary, state] });
const cfg: AiConfig = { targetFieldKey: 'summary' };
const at = NOW.toISOString();
const proposed = (proposal: AiValue['proposal']): AiValue => ({
  proposal,
  source: '',
  model: '',
  status: 'proposed',
  by: null,
  at,
});
const accepted: AiValue = {
  proposal: 'Replace guard',
  source: 'name',
  model: 'claude',
  status: 'accepted',
  by: 'u-maria',
  at: '2026-11-10T09:00:00.000Z',
};

describe('ai', () => {
  contract(ai, {
    config: cfg,
    ctx,
    valid: [
      ['Replace guard', proposed('Replace guard')],
      [accepted, accepted],
      [
        { proposal: 'Train staff', model: 'claude' },
        { ...proposed('Train staff'), model: 'claude' },
      ],
    ],
    invalid: [
      null,
      '',
      { status: 'proposed' },
      { proposal: 'x', status: 'maybe' },
      { proposal: '  ' },
    ],
    parse: [
      ['Replace guard', proposed('Replace guard')],
      [JSON.stringify(accepted), accepted],
      ['  Train staff\t', proposed('Train staff')],
    ],
    text: [
      [proposed('Replace guard'), 'Proposed: Replace guard'],
      [accepted, 'Accepted: Replace guard'],
    ],
    number: [[accepted, null]],
    date: [[accepted, null]],
    order: [proposed('Zebra'), accepted],
    empty: [
      [proposed(''), true],
      [accepted, false],
    ],
  });

  it('shows the proposal as the target field shows it, with the status as its option', () => {
    expect(ai.toText(proposed('opt_done'), { targetFieldKey: 'state' }, ctx)).toBe(
      'Proposed: Done',
    );
    expect(ai.toText(proposed(['a', 'b']), { targetFieldKey: '' }, ctx)).toBe('Proposed: a, b');
    expect(ai.options!(cfg, ctx).map((o) => o.id)).toEqual(['proposed', 'accepted', 'rejected']);
    expect(ai.kind).toBe('option');
    expect(ai.formAllowed).toBe(false);
  });
});
