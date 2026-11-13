import { describe, expect, it } from 'vitest';
import { coverageOf, coverageText, isCovered, type CoverageInput } from './coverage';

const row = (r: Partial<CoverageInput>): CoverageInput => ({
  applicability: null,
  implemented: false,
  controls: [],
  evidence: 0,
  ...r,
});

describe('coverage', () => {
  it('a requirement is covered by an implemented control or current evidence', () => {
    expect(isCovered(row({}))).toBe(false);
    expect(isCovered(row({ controls: [{ done: false }] }))).toBe(false);
    expect(isCovered(row({ controls: [{ done: false }, { done: true }] }))).toBe(true);
    expect(isCovered(row({ controls: [{ done: null }] }))).toBe(true);
    expect(isCovered(row({ evidence: 1 }))).toBe(true);
    expect(isCovered(row({ implemented: true }))).toBe(false);
  });

  it('a requirement that does not apply is never covered', () => {
    expect(isCovered(row({ applicability: 'not_applicable', evidence: 2 }))).toBe(false);
  });

  it('rolls up: the share of requirements in scope that are covered', () => {
    const c = coverageOf([
      row({ applicability: 'applicable', controls: [{ done: true }] }),
      row({ applicability: 'applicable', implemented: true }),
      row({ applicability: 'not_applicable', implemented: true, evidence: 1 }),
      row({ evidence: 1 }),
    ]);
    expect(c).toEqual({
      total: 4,
      applicable: 2,
      notApplicable: 1,
      undecided: 1,
      covered: 2,
      implemented: 1,
      percent: 66,
    });
    expect(coverageText(c)).toBe('66% covered · 2 applicable · 1 not applicable · 1 to decide');
  });

  it('says so when nothing is in scope or there is nothing at all', () => {
    const none = coverageOf([row({ applicability: 'not_applicable' })]);
    expect(none.percent).toBeNull();
    expect(coverageText(none)).toBe('Nothing in scope · 0 applicable · 1 not applicable');
    expect(coverageText(coverageOf([]))).toBe('No requirements');
  });
});
