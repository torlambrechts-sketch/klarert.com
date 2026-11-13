import { describe, expect, it } from 'vitest';
import {
  compileManagementReview,
  REVIEW_ITEMS_MAX,
  REVIEW_SECTION_KEYS,
  reviewSummary,
  type ReviewRow,
  type ReviewSource,
} from './management-review';

let seq = 0;
const row = (r: Partial<ReviewRow> = {}): ReviewRow => {
  seq += 1;
  return {
    id: `i-${seq}`,
    sheetId: 's',
    displayId: `X-${seq}`,
    name: `Item ${seq}`,
    group: 'Open',
    status: '',
    done: false,
    overdue: false,
    createdAt: '2026-03-01T10:00:00Z',
    updatedAt: '2026-03-01T10:00:00Z',
    ...r,
  };
};
const source = (rows: ReviewRow[], name = 'Sheet'): ReviewSource => ({
  sheetId: 's',
  sheetName: name,
  rows,
});

const period = { from: '2026-01-01', to: '2026-06-30', timeZone: 'Europe/London' };
const before = '2025-10-01T10:00:00Z';

describe('management review inputs', () => {
  it('has every section, in order, and says when no sheet feeds one', () => {
    const r = compileManagementReview({ ...period, sources: {} });
    expect(r.sections.map((s) => s.key)).toEqual([...REVIEW_SECTION_KEYS]);
    expect(r.sections.every((s) => !s.available)).toBe(true);
    expect(r.periodLabel).toBe('1 Jan 2026 to 30 Jun 2026');
    expect(r.summary).toContain('- No sheet holds this yet.');
  });

  it('nonconformities: raised and closed in the period, open and overdue now', () => {
    const r = compileManagementReview({
      ...period,
      sources: {
        nonconformities: source([
          row({ status: 'Open' }),
          row({ status: 'Open', overdue: true, createdAt: before, updatedAt: before }),
          row({
            status: 'Closed',
            done: true,
            createdAt: before,
            updatedAt: '2026-02-01T09:00:00Z',
          }),
          row({ status: 'Closed', done: true, createdAt: before, updatedAt: before }),
        ]),
      },
    });
    const nc = r.sections.find((s) => s.key === 'nonconformities')!;
    expect(nc.facts).toEqual([
      '1 nonconformity raised in the period',
      '1 closed in the period',
      '2 open now, 1 overdue',
    ]);
    expect(nc.items).toHaveLength(2);
    const prev = r.sections.find((s) => s.key === 'previous_actions')!;
    expect(prev.facts).toEqual(['1 action from before the period still open, 1 overdue']);
    const opp = r.sections.find((s) => s.key === 'opportunities')!;
    expect(opp.facts).toEqual([
      '1 overdue item to follow up',
      '1 closed nonconformity to learn from',
    ]);
  });

  it('splits the context sheet into issues and interested parties by group ref', () => {
    const r = compileManagementReview({
      ...period,
      partyGroupRefs: ['scope.parties'],
      sources: {
        context: source([
          row({ group: 'Internal issues', groupRef: 'scope.internal' }),
          row({
            group: 'External issues',
            groupRef: 'scope.external',
            createdAt: before,
            updatedAt: '2026-04-01T09:00:00Z',
          }),
          row({ group: 'External issues', createdAt: before, updatedAt: before }),
          row({ group: 'Interested parties', groupRef: 'scope.parties' }),
        ]),
      },
    });
    const scoped = compileManagementReview({
      ...period,
      partyGroupRefs: ['scope.parties'],
      issueGroupRefs: ['scope.internal', 'scope.external'],
      sources: {
        context: source([
          row({ group: 'Internal issues', groupRef: 'scope.internal' }),
          row({ group: 'Scope statement', groupRef: 'scope.scope' }),
        ]),
      },
    });
    expect(scoped.sections.find((s) => s.key === 'issues')!.items).toHaveLength(1);
    const issues = r.sections.find((s) => s.key === 'issues')!;
    expect(issues.facts).toEqual(['1 issue added and 1 changed in the period, 3 in all']);
    expect(issues.items.map((i) => i.note)).toEqual([
      'Internal issues · added',
      'External issues · changed',
    ]);
    const parties = r.sections.find((s) => s.key === 'parties')!;
    expect(parties.facts).toEqual([
      '1 interested party added and 0 changed in the period, 1 in all',
    ]);
  });

  it('risks by level, treatment progress, audits in the period and monitoring numbers', () => {
    const r = compileManagementReview({
      ...period,
      monitoring: [{ label: 'ISO/IEC 27001:2022', value: '62% covered' }],
      sources: {
        risks: source([
          row({ detail: 'High' }),
          row({ detail: 'High', createdAt: before, updatedAt: before, overdue: true }),
          row({ detail: 'Low', createdAt: before, updatedAt: before }),
          row({ detail: 'Low', done: true, createdAt: before, updatedAt: before }),
        ]),
        treatments: source([row({ done: true }), row({ overdue: true })]),
        audits: source([
          row({ date: '2026-05-10', done: true, createdAt: before, updatedAt: before }),
          row({ date: '2026-09-10', createdAt: before, updatedAt: before }),
        ]),
        findings: source([row(), row({ done: true, createdAt: before, updatedAt: before })]),
        incidents: source([row(), row({ done: true, createdAt: before, updatedAt: before })]),
        training: source([row({ done: true }), row({ overdue: true }), row()]),
      },
    });
    const risks = r.sections.find((s) => s.key === 'risks')!;
    expect(risks.facts).toEqual([
      '4 risks, 3 open, 1 identified in the period',
      'Open risks by level: High 2, Low 1',
      '1 risk past the review date',
      'Treatment actions: 1 done, 1 open, 1 overdue',
    ]);
    const audits = r.sections.find((s) => s.key === 'audits')!;
    expect(audits.facts).toEqual([
      '1 audit in the period, 1 done',
      '1 finding raised in the period, 1 open now',
    ]);
    const monitoring = r.sections.find((s) => s.key === 'monitoring')!;
    expect(monitoring.facts).toEqual([
      'ISO/IEC 27001:2022: 62% covered',
      '1 security incident reported in the period, 1 open now',
      'Training: 1 of 3 completed, 1 overdue',
    ]);
  });

  it('earlier reviews are those dated before the period', () => {
    const r = compileManagementReview({
      ...period,
      sources: {
        reviews: source([
          row({ date: '2025-12-01', done: true, status: 'Held' }),
          row({ date: '2026-06-01' }),
        ]),
      },
    });
    const prev = r.sections.find((s) => s.key === 'previous_actions')!;
    expect(prev.facts).toEqual(['1 earlier review, 1 held']);
    expect(prev.items[0]!.note).toBe('Held');
  });

  it('caps the listed items but counts all of them, and the summary fits an update', () => {
    const many = Array.from({ length: REVIEW_ITEMS_MAX + 5 }, () => row({ status: 'Open' }));
    const r = compileManagementReview({
      ...period,
      sources: { nonconformities: source(many) },
    });
    const nc = r.sections.find((s) => s.key === 'nonconformities')!;
    expect(nc.items).toHaveLength(REVIEW_ITEMS_MAX);
    expect(nc.more).toBe(5);
    expect(r.summary).toContain('and 20 more');
    expect(reviewSummary('x', r.sections, 200).length).toBeLessThanOrEqual(200);
  });
});
