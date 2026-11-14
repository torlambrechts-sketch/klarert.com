// Where management review inputs come from (docs/11 Audit outputs): the ISO/IEC 27001 and ISO 9001 packs' sheets,
// named by pack ref so renaming a sheet or a field changes nothing. When both are installed, each input comes from the
// first pack listed that has it. Data, not code: another pack can be added here as one more entry.
// The compilation itself is the pure compileManagementReview (src/engine/audit/management-review.ts).
import type { ReviewSectionKey, ReviewSourceKey } from '@/engine/audit/management-review';

export interface ReviewPackSource {
  /** The pack key (pack_installs.pack_key). */
  pack: string;
  /** Sheet refs of the pack per source. */
  sheets: Partial<Record<ReviewSourceKey, string>>;
  /** Field keys (per source) of the item's main date. */
  dateFields: Partial<Record<ReviewSourceKey, string>>;
  /** Field keys (per source) of a short fact to group by. */
  detailFields: Partial<Record<ReviewSourceKey, string>>;
  /** Group refs of the context sheet that hold interested parties. */
  partyGroups: string[];
  /** Group refs of the context sheet that hold internal and external issues. */
  issueGroups: string[];
  /** The management review sheet: where "Create the review" adds an item. */
  review: {
    source: 'reviews';
    groupRef: string;
    /** Checkbox field keys ticked for each section that has data. */
    checks: Partial<Record<ReviewSectionKey, string[]>>;
  };
}

export const REVIEW_PACK_SOURCES: ReviewPackSource[] = [
  {
    pack: 'iso-27001',
    sheets: {
      reviews: 'review',
      context: 'scope',
      nonconformities: 'nc',
      risks: 'risk',
      treatments: 'treatment',
      audits: 'audit',
      findings: 'finding',
      incidents: 'incident',
      training: 'training',
    },
    dateFields: { reviews: 'meeting_date', audits: 'audit_date', nonconformities: 'found_on' },
    detailFields: { risks: 'level' },
    partyGroups: ['scope.parties'],
    issueGroups: ['scope.internal', 'scope.external'],
    review: {
      source: 'reviews',
      groupRef: 'review.planned',
      checks: {
        previous_actions: ['in_actions'],
        issues: ['in_changes'],
        parties: ['in_parties', 'in_feedback'],
        nonconformities: ['in_performance'],
        monitoring: ['in_performance'],
        audits: ['in_performance'],
        risks: ['in_risks'],
        opportunities: ['in_improve'],
      },
    },
  },
  {
    pack: 'iso-9001',
    sheets: {
      reviews: 'review',
      context: 'context',
      nonconformities: 'nc',
      risks: 'risk',
      audits: 'audit',
      findings: 'finding',
      training: 'competence',
      feedback: 'complaint',
    },
    dateFields: {
      reviews: 'meeting_date',
      audits: 'audit_date',
      nonconformities: 'found_on',
      feedback: 'received_on',
    },
    detailFields: { risks: 'level', feedback: 'kind' },
    partyGroups: ['context.parties'],
    issueGroups: ['context.internal', 'context.external'],
    review: {
      source: 'reviews',
      groupRef: 'review.planned',
      checks: {
        previous_actions: ['in_actions'],
        issues: ['in_changes'],
        parties: ['in_feedback'],
        nonconformities: ['in_nc'],
        monitoring: ['in_monitoring'],
        audits: ['in_audits'],
        risks: ['in_risks'],
        opportunities: ['in_improve'],
      },
    },
  },
];
