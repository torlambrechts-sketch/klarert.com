// The words of /standards/iso-9001, the product page for ISO 9001 buyers. The voice and the claims follow
// docs/15 (messaging brief: §6 ISO 9001, §8 FAQ, §10 claims) and docs/16 (front page: example data, frame). What the
// standard installs, the edition status and the numbers come from the catalogue at build time
// (src/lib/site/standard.ts), never from here. ISO text is never quoted: clause numbers and our own one-line
// descriptions only (docs/12 Licensing). Screenshots come from the fictional example workspace Meridian Components Ltd
// (pnpm seed:demo, scripts/screenshots.ts) and are captioned as such.
import { BRAND } from '@/lib/brand';
import { LINKS } from './content';

/** The catalogue key of the ISO 9001 standard (templates/packs/iso-9001.json). */
export const ISO9001_PACK = 'iso-9001';

export const ISO9001_PATH = '/standards/iso-9001';

/** Sign-up with the standard named, so the choice can be carried through when that is built (docs/15 §9). */
export const ISO9001_SIGNUP = `${LINKS.createAccount}&standard=${ISO9001_PACK}`;

export const EXAMPLE_CAPTION = 'Example workspace: Meridian Components Ltd';

export const ISO9001_PAGE = {
  title: 'ISO 9001',
  description:
    'ISO 9001 quality registers you can change: processes, complaints, external providers, calibration, documents and CAPA, with the ISO 9001:2026 requirement library, coverage and an activity log your auditor can verify. Free while in early access.',
  hero: {
    eyebrow: 'ISO 9001 quality management',
    title: 'ISO 9001 quality registers, ready to change',
    lead: 'Processes, complaints, external providers, calibration and corrective actions in one shared spreadsheet, with the ISO 9001:2026 requirement library and a setup checklist that starts with "Decide what applies".',
    cta: 'Start with ISO 9001',
    secondary: 'See what it installs',
    reassurance: 'Free while in early access. No card needed. Hosted in Frankfurt, EU.',
  },
  install: {
    pill: 'What you get',
    title: 'What you get when you install ISO 9001',
    lead: 'One step installs ordinary sheets you can change, on the shared registers, with example items marked "Example:" and a setup checklist. Choose Recommended to start small or Everything for the full set.',
    sheetsTitle: 'Its own sheets',
    registersTitle: 'Added to your shared registers',
    formsTitle: 'Forms',
    workflowsTitle: 'Approval workflows',
    automationsTitle: 'Automations',
    automationsNote:
      'Automations that notify people start in test mode: they log what they would do until you switch them on.',
    setupTitle: 'Setup checklist',
    libraryTitle: 'Requirement library',
    dashboardTitle: 'Dashboard',
  },
  library: {
    pill: 'Clause by clause',
    title: 'Every clause as an item you can answer',
    lead: 'The requirement library lists ISO 9001 by clause number, with a purpose, guidance, audit questions and typical evidence in our own words. You decide what applies, say why when something does not, and record how far each requirement is in place.',
    points: [
      'Applicable or not, with the justification an auditor asks for',
      'Implementation status, owner, evidence and the date it was last reviewed',
      'Coverage: the share of requirements in scope with an implemented control or current evidence',
      'Link a process, a document or a nonconformity to the clauses it answers',
    ],
    clausesTitle: 'The clauses, in our words',
    licence:
      'The library holds clause numbers and short titles only. The purpose, guidance, audit questions and evidence are our own words. Buy the standard for the requirements.',
  },
  processes: {
    pill: 'Quality processes',
    title: 'The work of a quality system, on one set of registers',
    lead: 'Each process is a sheet your team works in. Status, owners and dates keep it moving; the activity log keeps the record.',
  },
  shared: {
    pill: 'Record it once',
    title: 'One record counts for every standard',
    lead: 'ISO 9001 adds its columns and views to the shared registers. When you add ISO 14001, ISO 45001 or ISO/IEC 27001, they use the same risks, nonconformities, documents and suppliers, so your second standard is a smaller job than your first.',
    usedBy: 'Also used by',
  },
  edition: {
    pill: 'ISO 9001:2026',
    title: 'Moving from ISO 9001:2015 to the 2026 edition',
    lead: 'Both editions are in the catalogue. Keep working in the 2015 library while you are certified to it, adopt the 2026 edition alongside, and move your answers when you are ready.',
    steps: [
      {
        title: 'Adopt ISO 9001:2026 alongside',
        body: 'Both libraries live side by side. "Also satisfies" shows how each 2015 requirement maps to the new edition.',
      },
      {
        title: 'Preview the move',
        body: 'Where a new requirement is the same as one old requirement, your applicability, justification, status, owner and review date are copied, and its control links repeated. Everything else is listed for review, with the reason.',
      },
      {
        title: 'Move, then work in the new edition',
        body: 'The move is one step and goes into the activity log. The 2015 library stays read-only, with its history and evidence.',
      },
    ],
    statusTitle: 'Edition status in the catalogue',
    checked: 'Edition status checked',
  },
  audit: {
    pill: 'Audit day',
    title: 'Give your auditor something they can check',
    lead: 'On audit day you hand over read-only access, the requirement library and an audit pack, not a folder of screenshots.',
    points: [
      {
        title: 'Auditor access that ends by itself',
        body: 'Invite your auditor with an end date. They read sheets, evidence and the logs, cannot change anything, and lose access on that date.',
      },
      {
        title: 'An activity log you can verify',
        body: 'Every change is written in the same transaction, hash-chained per item. Verify recomputes the chain and says "Audit trail intact"; a changed entry shows.',
      },
      {
        title: 'The audit pack',
        body: 'One file with every register as CSV, an evidence index with SHA-256 fingerprints and the log with every chain checked. Every export is logged.',
      },
    ],
  },
  own: {
    pill: 'Your own requirements',
    title: 'Your customers’ quality requirements, next to ISO 9001',
    lead: 'Add a customer’s supplier quality manual or your internal rules as your own framework. It gets the same library, coverage and links to your controls as ISO 9001.',
    points: [
      'Paste the requirements from Excel or start from a blank list',
      'Map each one to an ISO 9001 clause yourself: equivalent, partial or related',
      `The screens say "Not reviewed by ${BRAND.product}": the wording is yours`,
    ],
  },
  faq: {
    pill: 'Questions',
    title: 'Questions before you start',
  },
  closing: {
    title: 'Start with ISO 9001',
    lead: 'Create your workspace, install ISO 9001 and replace the first example with your own.',
  },
} as const;

/** The clause groups of ISO 9001 in our own words (docs/12 Licensing: never the standard's text). */
export const CLAUSES: readonly { ref: string; title: string; line: string }[] = [
  {
    ref: '4',
    title: 'Context',
    line: 'Know your organisation, who expects what from it, and what your quality system covers.',
  },
  {
    ref: '5',
    title: 'Leadership',
    line: 'Top management owns the system: a policy, customer focus and clear roles.',
  },
  {
    ref: '6',
    title: 'Planning',
    line: 'Act on risks and opportunities, set quality objectives and plan changes.',
  },
  {
    ref: '7',
    title: 'Support',
    line: 'People, equipment, calibration, knowledge, awareness and controlled documents.',
  },
  {
    ref: '8',
    title: 'Operation',
    line: 'From customer requirements and providers to production, release and nonconforming output.',
  },
  {
    ref: '9',
    title: 'Performance evaluation',
    line: 'Measure, ask your customers, audit yourself and review the system.',
  },
  {
    ref: '10',
    title: 'Improvement',
    line: 'Correct what went wrong, remove the cause and keep improving.',
  },
];

export type ProcessKey =
  | 'capa'
  | 'audits'
  | 'review'
  | 'providers'
  | 'calibration'
  | 'documents'
  | 'complaints'
  | 'objectives';

/** The core quality processes, each with a screenshot (`shot`, a file of public/site/screens). */
export const PROCESSES: readonly {
  key: ProcessKey;
  title: string;
  shot: string;
  alt: string;
  lines: readonly string[];
}[] = [
  {
    key: 'capa',
    title: 'Nonconformities and CAPA',
    shot: 'capa-item-panel',
    alt: 'A nonconformity open in the item panel, with its stages, owner, due date and the activity log',
    lines: [
      'Contain, find the cause, act and check the fix worked, as stages on one item.',
      'A quality nonconformity closed without an effectiveness check goes back to verification.',
      'With the CAPA app, anyone can report a problem from a phone.',
    ],
  },
  {
    key: 'audits',
    title: 'Internal audits',
    shot: 'internal-audits',
    alt: 'The Internal audits sheet with audits planned, in progress and completed',
    lines: [
      'Plan the audit programme with a lead, scope and dates for each audit.',
      'Link each audit to the clauses it covers and record how many findings it raised.',
      'Raise findings as nonconformities on the same register, with an owner and a due date.',
    ],
  },
  {
    key: 'review',
    title: 'Management review',
    shot: 'management-review',
    alt: 'A management review item with its inputs ticked and the decisions recorded',
    lines: [
      'The app compiles the review inputs for a period: audits, nonconformities, feedback, objectives and risks.',
      'Hold the meeting, record the decisions and add the actions they lead to.',
    ],
  },
  {
    key: 'providers',
    title: 'Suppliers and external providers',
    shot: 'supplier-evaluation',
    alt: 'External providers with their category, criticality, score and next evaluation date',
    lines: [
      'Evaluate each provider against your criteria, with a score and a next evaluation date.',
      'Approval goes through owner evaluation and quality approval.',
      'Keep their certificates as evidence, with the date each one stops being valid.',
    ],
  },
  {
    key: 'calibration',
    title: 'Calibration',
    shot: 'calibration',
    alt: 'Measuring equipment with interval, last and next calibration dates and status',
    lines: [
      'Every gauge with its range, interval, last and next calibration and its certificate.',
      'Once you switch the automations on, the owner hears 30 days ahead and a missed date marks the gauge due.',
    ],
  },
  {
    key: 'documents',
    title: 'Documents and approvals',
    shot: 'document-approvals',
    alt: 'Documents and policies with their ID, version, status and an approval waiting for a decision',
    lines: [
      'Every controlled document with its ID, version, owner and next review date.',
      'Approval through a workflow: the author cannot approve their own document, and approving needs a version note.',
    ],
  },
  {
    key: 'complaints',
    title: 'Complaints and customer feedback',
    shot: 'complaints',
    alt: 'Customer feedback and complaints with kind, customer, seriousness and status',
    lines: [
      'Complaints, praise, suggestions and survey results in one sheet, with the date an answer is due.',
      'A complaint that needs corrective action raises a nonconformity.',
    ],
  },
  {
    key: 'objectives',
    title: 'Objectives and KPIs',
    shot: 'objectives',
    alt: 'Quality objectives with KPI, target, latest result and status',
    lines: [
      'Quality objectives with a KPI, a target and the latest result.',
      'Every result you enter is in the item’s activity log, so the trend is on record.',
      'An objective that goes off track asks for an action.',
    ],
  },
];

/** The other screenshots of the page, by section. */
export const SHOTS = {
  hero: {
    shot: 'iso-9001-library',
    alt: 'The ISO 9001:2015 requirement library in the Table, with applicability, status and evidence by clause',
  },
  library: {
    shot: 'frameworks-coverage',
    alt: 'Workspace admin, Frameworks: adopted libraries with their coverage',
  },
  edition: {
    shot: 'edition-move-preview',
    alt: 'The preview of moving from ISO 9001:2015 to ISO 9001:2026, with the answers it copies and the requirements to review',
  },
  audit: { shot: 'audit-pack', alt: 'Audit outputs with the audit pack and the exports list' },
  own: {
    shot: 'own-framework',
    alt: 'A requirement of Acme customer quality requirements mapped to an ISO 9001 clause',
  },
} as const;

export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Will this get us certified to ISO 9001?',
    a: `We help you prepare; a certification body certifies. ${BRAND.product} keeps your registers, decisions, evidence and their history in one place, so the audit is about your system rather than about finding things. Whether you pass is the auditor’s decision.`,
  },
  {
    q: 'Which edition does it use?',
    a: 'ISO 9001 installs with the ISO 9001:2026 library. The ISO 9001:2015 library is in the catalogue too, marked withdrawn, for organisations certified to it during the transition. Adopt both and move your answers across when you are ready.',
  },
  {
    q: 'We keep our quality system in Excel. Can we bring it?',
    a: 'Yes. Paste straight from Excel into a sheet or import a CSV file, and add the columns you already use. You gain one copy instead of many, and a record of every change.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing while in early access, and no card is needed. Paid plans will come with notice, and we will publish them first.',
  },
  {
    q: 'Where is our data, and who can see it?',
    a: 'In Frankfurt, EU. Every table has row level security, sheets and fields can be restricted to named people, two-step sign-in can be required for everyone, and there are no third-party analytics or trackers.',
  },
  {
    q: 'How long does it take to set up?',
    a: 'A workspace takes a few minutes. Installing ISO 9001 is one step. Its setup checklist moves as fast as your own decisions, starting with deciding what applies.',
  },
  {
    q: 'We work with a consultant. How does that fit?',
    a: 'Invite them to your workspace with the role they need. A consultant with many clients can set up the same registers in each client workspace, save that setup and reuse it.',
  },
  {
    q: 'Does it include the text of ISO 9001?',
    a: 'No. The library holds clause numbers and short titles, and describes each requirement in our own words. Buy the standard for the requirements themselves.',
  },
];
