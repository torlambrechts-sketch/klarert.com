// Where management review inputs come from (docs/11 Audit outputs): the ISO/IEC 27001 pack's sheets, the ISO 9001
// add-on's customer feedback and the Core registers,
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
    // ISO 9001 2.0.0 is an add-on to the Core registers: its own sheet feeds customer feedback; reviews,
    // nonconformities, risks, audits and training come from the Core entry below
    pack: 'iso-9001',
    sheets: { feedback: 'complaint' },
    dateFields: { feedback: 'received_on' },
    detailFields: { feedback: 'kind' },
    partyGroups: [],
    issueGroups: [],
    review: { source: 'reviews', groupRef: 'review.planned', checks: {} },
  },
  {
    // the Core registers (docs/11 Core registers): the shared registers every add-on builds on, listed last so a
    // standard pack's own sheet wins where it has one
    pack: 'core',
    sheets: {
      reviews: 'reviews',
      nonconformities: 'nc',
      risks: 'risk',
      audits: 'audits',
      incidents: 'incidents',
      training: 'training',
    },
    dateFields: { reviews: 'meeting_date', audits: 'start', incidents: 'occurred_on' },
    detailFields: { risks: 'against_appetite' },
    partyGroups: [],
    issueGroups: [],
    review: { source: 'reviews', groupRef: 'reviews.planned', checks: {} },
  },
];

/**
 * A sheet or group of a review source by ref: the pack's own (`review`), or `<pack>:<ref>` of another live install
 * (an add-on's review over the Core registers, `core:reviews`).
 */
export function resolveReviewRef(
  own: Record<string, string>,
  installs: ReadonlyMap<string, Record<string, string>>,
  kind: 'sheet' | 'group',
  ref: string,
): string | undefined {
  const colon = ref.indexOf(':');
  if (colon < 0) return own[`${kind}:${ref}`];
  return installs.get(ref.slice(0, colon))?.[`${kind}:${ref.slice(colon + 1)}`];
}
