// The decisions in the demo's requirement libraries: applicability (with the reason when something does not apply),
// implementation status, owner, when it was last reviewed, and the evidence files on a requirement. What counts as
// covered (docs/12 Coverage) is a requirement in scope with current evidence or an implemented control linked to it;
// the links come from the registers (content/*.ts), the evidence from here. The targets: ISO 9001:2015 about 70%,
// ISO/IEC 27001:2022 about 55%, the rest earlier on.
import type { DemoClock } from '../clock';
import type { PersonRef } from '../people';

export interface LibraryPlan {
  /** `<key>@<version>` */
  framework: string;
  owner: PersonRef;
  /** Refs that do not apply, with the reason (the SoA's justification). */
  notApplicable: Record<string, string>;
  /** Refs decided as applicable; `'*'` = every other requirement. */
  applicable: string[] | '*';
  implemented: string[];
  partial: string[];
  planned: string[];
  /** Current evidence files (count as coverage). */
  evidence: { ref: string; name: string; lines: string[]; validInDays?: number | null }[];
  /** Evidence that expired (does not count). */
  expired?: { ref: string; name: string; lines: string[]; expiredDaysAgo: number }[];
  /** Days ago the requirements were last reviewed. */
  reviewedDaysAgo: number;
}

const doc = (title: string, ...lines: string[]) => [title, ...lines];

export function libraryPlans(c: DemoClock): LibraryPlan[] {
  void c;
  return [
    {
      framework: 'iso-9001@2015',
      owner: 'priya',
      notApplicable: {
        '8.3':
          'We make parts to our customers’ drawings and specifications. We do not design products, so design and development does not apply.',
      },
      applicable: '*',
      implemented: [
        '4.1',
        '4.2',
        '4.3',
        '4.4',
        '5.1',
        '5.1.1',
        '5.1.2',
        '5.2',
        '5.3',
        '6.1',
        '6.2',
        '7.1.2',
        '7.1.3',
        '7.1.5',
        '7.2',
        '7.3',
        '7.5',
        '7.5.1',
        '7.5.3',
        '8.1',
        '8.2',
        '8.4',
        '8.5',
        '8.6',
        '8.7',
        '9.1',
        '9.1.2',
        '9.2',
        '9.3',
        '10.2',
      ],
      partial: ['6.3', '7.1', '7.1.1', '7.1.4', '7.4', '7.5.2', '9.1.1', '9.1.3', '10.1'],
      planned: ['7.1.6', '9.3.1', '9.3.2', '9.3.3', '10.3'],
      evidence: [
        {
          ref: '5.1',
          name: 'leadership-commitment-minutes.pdf',
          lines: doc(
            'Board minutes: quality system commitment',
            'The board reviewed the quality objectives and resources.',
            'Owner: Hannah Whitfield',
          ),
        },
        {
          ref: '5.1.1',
          name: 'quality-roles-briefing.pdf',
          lines: doc(
            'Leading the quality system',
            'Monthly quality briefing led by the managing director.',
          ),
        },
        {
          ref: '5.1.2',
          name: 'customer-focus-review.pdf',
          lines: doc('Customer focus review', 'Key account scorecards reviewed every quarter.'),
        },
        {
          ref: '5.2',
          name: 'QP-001-quality-policy-v4.pdf',
          lines: doc(
            'QP-001 Quality policy, version 4',
            'We make precision parts right first time, on time.',
            'Approved by the managing director.',
          ),
          validInDays: 225,
        },
        {
          ref: '5.3',
          name: 'organisation-chart-and-responsibilities.pdf',
          lines: doc(
            'Organisation chart and quality responsibilities',
            'Quality manager: Priya Raman. Production manager: Ellie Chambers.',
          ),
        },
        {
          ref: '6.2',
          name: 'quality-objectives-plan.pdf',
          lines: doc(
            'Quality objectives and plans',
            'On-time delivery 96%, customer ppm below 450, scrap below 1.8% of sales.',
          ),
        },
        {
          ref: '7.1.2',
          name: 'skills-matrix-leeds.pdf',
          lines: doc('Skills matrix, Leeds', 'Setters, operators and inspectors by cell.'),
          validInDays: 20,
        },
        {
          ref: '7.1.3',
          name: 'maintenance-plan.pdf',
          lines: doc('Planned maintenance', 'Preventive maintenance for every CNC machine.'),
        },
        {
          ref: '7.2',
          name: 'training-records-summary.pdf',
          lines: doc('Training records summary', 'Competence sign-offs by role.'),
        },
        {
          ref: '7.3',
          name: 'induction-awareness-pack.pdf',
          lines: doc(
            'Induction: quality awareness',
            'Policy, objectives and what a nonconformity means for the customer.',
          ),
        },
        {
          ref: '7.5',
          name: 'document-control-index.pdf',
          lines: doc(
            'Document control index',
            'Every controlled document with its owner and version.',
          ),
        },
        {
          ref: '7.5.1',
          name: 'documented-information-list.pdf',
          lines: doc('What we document', 'Procedures, work instructions and records we keep.'),
        },
        {
          ref: '7.5.3',
          name: 'document-control-procedure.pdf',
          lines: doc('Control of documents and records', 'Approval, distribution, retention.'),
        },
        {
          ref: '9.1',
          name: 'kpi-dashboard-export.pdf',
          lines: doc(
            'Quality KPIs, last 12 months',
            'On-time delivery, ppm, scrap and supplier performance.',
          ),
        },
      ],
      expired: [
        {
          ref: '7.4',
          name: 'communication-plan-old.pdf',
          lines: doc(
            'Communication plan (old)',
            'Replaced by the monthly briefing; needs an update.',
          ),
          expiredDaysAgo: 40,
        },
      ],
      reviewedDaysAgo: 30,
    },
    {
      framework: 'iso-9001@2026',
      owner: 'priya',
      notApplicable: {},
      applicable: ['4.1', '4.2', '4.3', '4.4', '5.1', '5.2', '6.1.1', '6.1.2', '6.1.3'],
      implemented: [],
      partial: ['6.1.1', '6.1.2'],
      planned: ['6.1.3'],
      evidence: [],
      reviewedDaysAgo: 6,
    },
    {
      framework: 'iso-27001@2022',
      owner: 'daniel',
      notApplicable: {
        'A.8.4':
          'We do not develop software, so there is no source code to protect. CNC programs are covered by change control (A.8.32).',
        'A.8.25':
          'We do not develop software; bought systems are covered by supplier and cloud controls.',
        'A.8.28': 'We do not write software.',
        'A.8.29':
          'We do not develop software; acceptance of bought systems is part of change control.',
        'A.8.31': 'No in-house development, so no separate development and test environments.',
        'A.8.33': 'No in-house development or test data.',
      },
      applicable: '*',
      implemented: [
        '4.1',
        '4.2',
        '4.3',
        '4.4',
        '5.1',
        '5.2',
        '5.3',
        '6.1',
        '6.1.1',
        '6.1.2',
        '6.1.3',
        '7.1',
        '7.2',
        '7.3',
        '7.5',
        '7.5.1',
        '7.5.3',
        '8.1',
        '8.2',
      ],
      partial: ['6.2', '6.3', '7.4', '7.5.2', '8.3', '9.1', '9.2', '9.2.1', '9.2.2', '10.2'],
      planned: ['9.3', '9.3.1', '9.3.2', '9.3.3', '10.1'],
      evidence: [
        ['4.1', 'isms-context-analysis.pdf'],
        ['4.2', 'interested-parties-security-needs.pdf'],
        ['4.3', 'isms-scope-statement.pdf'],
        ['4.4', 'isms-process-map.pdf'],
        ['5.1', 'board-isms-commitment.pdf'],
        ['5.2', 'ISP-001-information-security-policy-v3.pdf'],
        ['5.3', 'security-roles-raci.pdf'],
        ['6.1', 'risk-method.pdf'],
        ['6.1.1', 'risk-and-opportunity-plan.pdf'],
        ['6.1.2', 'risk-assessment-report.pdf'],
        ['6.1.3', 'risk-treatment-plan-export.pdf'],
        ['7.1', 'isms-budget.pdf'],
        ['7.2', 'security-competence-matrix.pdf'],
        ['7.3', 'awareness-campaign-results.pdf'],
        ['7.5', 'isms-document-register.pdf'],
        ['7.5.1', 'isms-documentation-list.pdf'],
        ['7.5.3', 'isms-document-control.pdf'],
        ['8.1', 'operational-security-calendar.pdf'],
        ['8.2', 'risk-assessment-run-q3.pdf'],
      ].map(([ref, name]) => ({
        ref: ref!,
        name: name!,
        lines: doc(
          name!.replace(/\.pdf$/, '').replace(/-/g, ' '),
          `Evidence for ISO/IEC 27001 clause ${ref}.`,
        ),
        validInDays: ref === '6.1.2' ? 12 : null,
      })),
      reviewedDaysAgo: 45,
    },
    {
      framework: 'iso-14001@2026',
      owner: 'grace',
      notApplicable: {},
      applicable: [
        '4.1',
        '4.2',
        '4.3',
        '4.4',
        '5.1',
        '5.2',
        '5.3',
        '6.1',
        '6.1.1',
        '6.1.2',
        '6.1.3',
        '6.1.4',
        '6.2',
        '6.2.1',
        '8.1',
        '8.2',
      ],
      implemented: ['4.1', '4.2', '5.2', '8.2'],
      partial: ['4.3', '6.1.2', '6.1.3', '8.1'],
      planned: ['6.2', '6.2.1'],
      evidence: [
        {
          ref: '5.2',
          name: 'HSE-001-policy-v5.pdf',
          lines: doc('HSE-001 Health, safety and environment policy', 'Version 5.'),
          validInDays: 18,
        },
        {
          ref: '4.1',
          name: 'environmental-context.pdf',
          lines: doc('Environmental context', 'Energy, effluent and customer expectations.'),
        },
        {
          ref: '4.2',
          name: 'environmental-interested-parties.pdf',
          lines: doc(
            'Interested parties (environment)',
            'Neighbours, the Environment Agency, customers.',
          ),
        },
        {
          ref: '8.2',
          name: 'spill-response-plan.pdf',
          lines: doc('Spill response plan', 'Coolant and oil spills at both sites.'),
        },
        {
          ref: '6.1.3',
          name: 'compliance-obligations-list.pdf',
          lines: doc('Compliance obligations', 'Consents, permits and duty of care.'),
        },
      ],
      reviewedDaysAgo: 60,
    },
    {
      framework: 'iso-45001@2018',
      owner: 'grace',
      notApplicable: {},
      applicable: [
        '4.1',
        '4.2',
        '4.3',
        '4.4',
        '5.1',
        '5.2',
        '5.3',
        '5.4',
        '6.1',
        '6.1.1',
        '6.1.2',
        '6.1.3',
        '8.1',
        '8.1.1',
        '8.1.2',
        '8.2',
      ],
      implemented: ['5.2', '5.4', '6.1.2', '8.2'],
      partial: ['4.3', '6.1', '8.1.2'],
      planned: ['6.1.3', '8.1.4'],
      evidence: [
        {
          ref: '5.2',
          name: 'HSE-001-policy-v5-ohs.pdf',
          lines: doc('HSE-001 policy (OH&S part)', 'Version 5.'),
          validInDays: 18,
        },
        {
          ref: '8.2',
          name: 'emergency-plan-leeds.pdf',
          lines: doc('Emergency plan, Leeds', 'Fire, spill, first aid.'),
        },
        {
          ref: '6.1.2',
          name: 'hira-method.pdf',
          lines: doc('Hazard identification method', 'Task-based, with worker participation.'),
        },
        {
          ref: '5.4',
          name: 'safety-committee-terms.pdf',
          lines: doc(
            'Safety committee terms of reference',
            'Elected representatives from both sites.',
          ),
        },
      ],
      reviewedDaysAgo: 75,
    },
    {
      framework: 'gdpr@2016',
      owner: 'tomasz',
      notApplicable: {
        'Art. 22': 'We make no decisions about people by automated means alone.',
        'Art. 47': 'We do not use binding corporate rules.',
        'Art. 48': 'No transfers on the order of a non-EU court or authority.',
      },
      applicable: [
        'Art. 5',
        'Art. 6',
        'Art. 9',
        'Art. 12',
        'Art. 13',
        'Art. 15',
        'Art. 17',
        'Art. 24',
        'Art. 28',
        'Art. 30',
        'Art. 32',
        'Art. 33',
        'Art. 35',
        'Art. 37',
      ],
      implemented: ['Art. 30', 'Art. 28', 'Art. 33', 'Art. 37'],
      partial: ['Art. 5', 'Art. 13', 'Art. 32', 'Art. 35'],
      planned: ['Art. 24'],
      evidence: [
        {
          ref: 'Art. 37',
          name: 'dpo-appointment-letter.pdf',
          lines: doc(
            'Appointment of the data protection officer',
            'Tomasz Nowak, from the start of the year.',
          ),
        },
        {
          ref: 'Art. 13',
          name: 'privacy-notice-staff.pdf',
          lines: doc('Privacy notice for staff', 'What we collect, why and for how long.'),
        },
      ],
      reviewedDaysAgo: 50,
    },
    {
      framework: 'nis2@2022',
      owner: 'daniel',
      notApplicable: {},
      applicable: [
        'Art. 20(1)',
        'Art. 20(2)',
        'Art. 21(1)',
        'Art. 21(2)(a)',
        'Art. 21(2)(b)',
        'Art. 21(2)(c)',
        'Art. 21(2)(d)',
        'Art. 23(1)',
        'Art. 2(1)',
        'Art. 3(2)',
        'Art. 27(2)',
      ],
      implemented: ['Art. 20(2)', 'Art. 21(2)(b)', 'Art. 21(2)(c)'],
      partial: ['Art. 21(1)', 'Art. 21(2)(a)', 'Art. 21(2)(d)'],
      planned: ['Art. 20(1)', 'Art. 27(2)'],
      evidence: [
        {
          ref: 'Art. 20(2)',
          name: 'board-cyber-training-certificates.pdf',
          lines: doc('Board cyber security training', 'Completed by the directors.'),
        },
      ],
      reviewedDaysAgo: 20,
    },
  ];
}
