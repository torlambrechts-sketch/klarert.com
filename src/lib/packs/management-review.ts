// Where management review inputs come from (docs/11 Audit outputs): the ISO/IEC 27001 pack's sheets, the ISO 9001
// add-on's customer feedback and the Core registers,
// named by pack ref so renaming a sheet or a field changes nothing. When both are installed, each input comes from the
// first pack listed that has it. Data, not code: another pack can be added here as one more entry.
// The compilation itself is the pure compileManagementReview (src/engine/audit/management-review.ts).
import type { ReviewSectionKey, ReviewSourceKey } from '@/engine/audit/management-review';

export interface ReviewPackSource {
  /** The pack key (pack_installs.pack_key). */
  pack: string;
  /** Sheet refs of the pack per source; `<pack>:<sheet>` for another install's sheet (an add-on over Core). */
  sheets: Partial<Record<ReviewSourceKey, string>>;
  /** Field keys (per source) of the item's main date. */
  dateFields: Partial<Record<ReviewSourceKey, string>>;
  /** Field keys (per source) of a short fact to group by. */
  detailFields: Partial<Record<ReviewSourceKey, string>>;
  /** Group refs of the context sheet that hold interested parties. */
  partyGroups: string[];
  /** Group refs of the context sheet that hold internal and external issues. */
  issueGroups: string[];
  /** The management review sheet: where "Create the review" adds an item (groupRef `<pack>:<sheet>.<group>` too). */
  review: {
    source: 'reviews';
    groupRef: string;
    /** Checkbox field keys ticked for each section that has data. */
    checks: Partial<Record<ReviewSectionKey, string[]>>;
  };
}

export const REVIEW_PACK_SOURCES: ReviewPackSource[] = [
  {
    // 2.0.0 is an add-on to the Core registers: the review, nonconformities, risks, audits, incidents and training
    // are Core's sheets (the ISO 27001 tag marks its items); context and treatment are its own
    pack: 'iso-27001',
    sheets: {
      reviews: 'core:reviews',
      context: 'scope',
      nonconformities: 'core:nc',
      risks: 'core:risk',
      treatments: 'treatment',
      audits: 'core:audits',
      incidents: 'core:incidents',
      training: 'core:training',
    },
    dateFields: { reviews: 'meeting_date', audits: 'start', nonconformities: 'iso27001_found_on' },
    detailFields: { risks: 'against_appetite' },
    partyGroups: ['scope.parties'],
    issueGroups: ['scope.internal', 'scope.external'],
    review: {
      source: 'reviews',
      groupRef: 'core:reviews.planned',
      checks: {
        previous_actions: ['iso27001_in_actions'],
        issues: ['iso27001_in_changes'],
        parties: ['iso27001_in_parties', 'iso27001_in_feedback'],
        nonconformities: ['iso27001_in_performance'],
        monitoring: ['iso27001_in_performance'],
        audits: ['iso27001_in_performance'],
        risks: ['iso27001_in_risks'],
        opportunities: ['iso27001_in_improve'],
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
      // 1.1.0: context and interested parties (an older install has no such sheet: the input reads "no data")
      context: 'context',
      nonconformities: 'nc',
      risks: 'risk',
      audits: 'audits',
      incidents: 'incidents',
      training: 'training',
    },
    dateFields: {
      reviews: 'meeting_date',
      audits: 'start',
      incidents: 'occurred_on',
      nonconformities: 'found_on',
    },
    detailFields: { risks: 'against_appetite' },
    partyGroups: ['context.parties'],
    issueGroups: ['context.internal', 'context.external'],
    review: {
      source: 'reviews',
      groupRef: 'reviews.planned',
      // 1.1.0: the review inputs as checkboxes on Management reviews
      checks: {
        previous_actions: ['input_actions'],
        issues: ['input_issues'],
        parties: ['input_parties'],
        nonconformities: ['input_nonconformities'],
        monitoring: ['input_monitoring', 'input_objectives'],
        audits: ['input_audits'],
        risks: ['input_risks'],
        opportunities: ['input_improvement'],
      },
    },
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
