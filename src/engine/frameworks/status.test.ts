import { describe, expect, it } from 'vitest';
import {
  dayMonthYear,
  editionBadge,
  monthYear,
  replacedWarning,
  statusIsStale,
  successorId,
} from './status';
import type { EditionInfo } from './types';

const base: EditionInfo = {
  status: 'current',
  supersededBy: null,
  transitionEnds: null,
  revisionStage: null,
  revisionExpected: null,
  statusNote: null,
  statusCheckedOn: '2026-11-14',
};

describe('edition status', () => {
  it('formats dates as the UI writes them', () => {
    expect(monthYear('2029-04-30')).toBe('Apr 2029');
    expect(dayMonthYear('2026-11-04')).toBe('4 Nov 2026');
  });

  it('a withdrawn edition says what replaces it and when the transition ends', () => {
    const e = {
      ...base,
      status: 'withdrawn' as const,
      supersededBy: 'iso-14001@2026',
      transitionEnds: '2029-04-30',
    };
    expect(editionBadge(e, 'ISO 14001:2026')).toEqual({
      tone: 'replaced',
      text: 'Withdrawn · replaced by ISO 14001:2026 · transition ends Apr 2029',
    });
    expect(editionBadge(e, null)?.text).toContain('replaced by iso-14001@2026');
    expect(successorId(e)).toEqual({ key: 'iso-14001', version: '2026' });
  });

  it('a revision in progress names the stage and when it is expected', () => {
    const e = {
      ...base,
      status: 'revision-in-progress' as const,
      revisionStage: 'DIS',
      revisionExpected: '2027',
    };
    expect(editionBadge(e, null)).toEqual({
      tone: 'revision',
      text: 'Revision in progress (DIS) · expected 2027',
    });
  });

  it('a current edition has no badge', () => {
    expect(editionBadge(base, null)).toBeNull();
  });

  it('is stale after 120 days, or when dated in the future', () => {
    expect(statusIsStale(base, '2027-03-14')).toBe(false);
    expect(statusIsStale(base, '2027-03-15')).toBe(true);
    expect(statusIsStale(base, '2026-11-13')).toBe(true);
    expect(statusIsStale({ statusCheckedOn: 'nope' }, '2026-11-14')).toBe(true);
  });

  it('warns before a replaced edition is adopted and recommends the new one when it is in the catalogue', () => {
    const e = {
      ...base,
      title: 'ISO 14001:2015',
      status: 'withdrawn' as const,
      supersededBy: 'iso-14001@2026',
      transitionEnds: '2029-04-30',
    };
    const text = replacedWarning(e, { title: 'ISO 14001:2026', inCatalogue: true })!;
    expect(text).toMatch(/^ISO 14001:2015 is withdrawn and replaced by ISO 14001:2026\./);
    expect(text).toContain('Apr 2029');
    expect(text).toContain('We recommend adopting ISO 14001:2026 instead');
    expect(replacedWarning({ ...base, title: 'X' }, null)).toBeNull();
  });
});
