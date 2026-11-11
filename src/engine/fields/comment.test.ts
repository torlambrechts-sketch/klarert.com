import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { comment } from './comment';

const NOW = '2026-11-11T12:00:00.000Z';
const stored = { text: 'Checked with supplier', by: 'u-james', at: '2026-11-10T09:00:00Z' };

describe('comment', () => {
  contract(comment, {
    valid: [
      ['Waiting for the supplier', { text: 'Waiting for the supplier', by: 'u-maria', at: NOW }],
      [stored, stored],
      [{ text: '  trimmed ' }, { text: 'trimmed', by: 'u-maria', at: NOW }],
    ],
    invalid: ['', '   ', null, { text: '' }, ['a']],
    parse: [
      ['Called the site', { text: 'Called the site', by: 'u-maria', at: NOW }],
      [JSON.stringify(stored), stored],
      ['  Pasted from Excel  ', { text: 'Pasted from Excel', by: 'u-maria', at: NOW }],
    ],
    text: [
      [stored, 'Checked with supplier — James, 10 Nov'],
      [{ text: 'Old note', by: 'u-gone', at: '2026-01-02T10:00:00Z' }, 'Old note — 2 Jan'],
    ],
    order: [stored, { ...stored, text: 'Done' }],
    empty: [
      [{ text: ' ', by: 'u-maria', at: NOW }, true],
      [stored, false],
    ],
  });

  it('stamps the author and time from the context', () => {
    const ctx = makeCtx({}, { userId: 'u-vic', now: new Date('2026-11-12T23:30:00Z') });
    expect(comment.normalize('Late note', {}, ctx)).toEqual({
      text: 'Late note',
      by: 'u-vic',
      at: '2026-11-12T23:30:00.000Z',
    });
  });

  it('shows the day in the user time zone', () => {
    const v = { text: 'Late', by: 'u-maria', at: '2026-11-11T23:30:00Z' };
    expect(comment.toText(v, {}, makeCtx({}, { timeZone: 'Europe/Berlin' }))).toBe(
      'Late — Maria, 12 Nov',
    );
  });
});
