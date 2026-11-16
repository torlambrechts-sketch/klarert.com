// The words of the public product site: `/` (signed-out visitors), `/platform`, `/frameworks` and the sign-in pages'
// side panel. Every claim here is backed by the docs: docs/01 (product), docs/02 (activity log, retention),
// docs/04 (automations, approvals, test mode), docs/05 (views, forms, Design), docs/09 (security), docs/11 (packs,
// audit outputs), docs/12 (frameworks, SoA, licensing: the standards are named, their text is never quoted) and
// docs/13 (apps). Numbers come from the code (src/lib/site/facts.ts), never from here.
// The owner edits the copy here; content.test.ts keeps it tied to the catalogue and the copy rules.
import type { SiteSetCopy } from '@/engine/packs/site-catalogue';
import { BRAND, SITE_URL, SUPPORT_EMAIL } from '@/lib/brand';

// The name, wordmark and descriptor live in src/lib/brand.ts (the app, the emails and two-step read them too).
export { BRAND };

export const SITE = {
  url: SITE_URL,
  /** The home page's title and the site name in shares: "Keptrow — the compliance spreadsheet". */
  title: BRAND.descriptor,
  description:
    'Run your management system in one shared spreadsheet: registers, automations and an activity log you can verify, hosted in the EU.',
} as const;

export const LINKS = {
  home: '/',
  platform: '/platform',
  frameworks: '/frameworks',
  signIn: '/login',
  createAccount: '/login?mode=signup',
  privacy: '/privacy',
  terms: '/terms',
} as const;

/** The header's page links (Sign in and Create account sit beside them). */
export const NAV: readonly { href: string; label: string }[] = [
  { href: LINKS.platform, label: 'Platform' },
  { href: LINKS.frameworks, label: 'Frameworks' },
];

export const HERO = {
  title: 'Run your management system in one shared spreadsheet',
  lead: `${BRAND.product} keeps your registers, actions and evidence in sheets your whole team works in. Automations keep the work moving, and every change is written to an activity log you can verify.`,
} as const;

/** The hero's stats row: `key` names a fact from src/lib/site/facts.ts, which gives the value. */
export const STATS: readonly { key: string; label: string }[] = [
  { key: 'fieldTypes', label: 'field types' },
  { key: 'frameworks', label: 'frameworks in the catalogue' },
  { key: 'region', label: 'where your data is hosted' },
  { key: 'loopGuard', label: 'automation loop guard' },
];

/**
 * The band under the hero: what the catalogue ships (templates/packs/*.json). `pack` is the catalogue key the name
 * stands for; Corrective actions is the Nonconformities and CAPA register of the shared registers and its CAPA app
 * (docs/13).
 */
export const STANDARDS: readonly { name: string; pack: string }[] = [
  { name: 'ISO/IEC 27001', pack: 'iso-27001' },
  { name: 'ISO 9001', pack: 'iso-9001' },
  { name: 'ISO 14001', pack: 'iso-14001' },
  { name: 'ISO 45001', pack: 'iso-45001' },
  { name: 'GDPR', pack: 'gdpr' },
  { name: 'NIS2', pack: 'nis2' },
  { name: 'Supplier management', pack: 'supplier-management' },
  { name: 'Corrective actions', pack: 'core' },
];

export const STANDARDS_BAND = { label: 'Ready-made sets for' } as const;

/** A section head: the pill label, the h2 and the lead. */
export type SectionHead = { pill: string; title: string; lead: string };

export type Feature = { key: string; title: string; body: string };

export const PROBLEM: SectionHead & { items: readonly Feature[] } = {
  pill: 'The problem',
  title: 'Compliance work does not fit in a folder of files',
  lead: 'Most management systems live in spreadsheets, inboxes and shared drives. The work gets done, but nobody can show it without a week of searching.',
  items: [
    {
      key: 'scattered',
      title: 'Scattered spreadsheets',
      body: 'One file per standard, so the same risk is typed in three places and the copies drift apart.',
    },
    {
      key: 'inbox',
      title: 'Evidence in inboxes',
      body: 'Certificates and reports sit in email threads. Nobody knows which version is current or when it expires.',
    },
    {
      key: 'audit',
      title: 'Audits rebuilt each year',
      body: 'Who changed what, and when, is pieced together from memory before every audit.',
    },
  ],
};

export const PLATFORM_INTRO: SectionHead = {
  pill: 'Platform',
  title: 'One place for registers, work and proof',
  lead: 'Every register is a sheet your team works in. Automations keep it moving, and the activity log keeps the record.',
};

/** The landing page's platform cards; each links to its section on /platform (`key` is the anchor). */
export const FEATURES: readonly Feature[] = [
  {
    key: 'sheets',
    title: 'Every register is a sheet',
    body: 'Risks, incidents, suppliers, documents and actions each live in a sheet with groups, items and field types for status, people, dates, evidence and formulas.',
  },
  {
    key: 'automations',
    title: 'Automations: when, if, then',
    body: 'When a field changes, a date arrives or someone presses a button, set a value, notify a person or create a follow-up. Every run is in the run log.',
  },
  {
    key: 'activity',
    title: 'An activity log you can verify',
    body: 'Every change is written to the activity log in the same transaction, hash-chained per item. Verify recomputes the chain.',
  },
  {
    key: 'soa',
    title: 'Statement of applicability',
    body: 'Adopt a requirement library and record applicability, justification and implementation status. The statement of applicability is a view of it.',
  },
  {
    key: 'evidence',
    title: 'Evidence with an expiry',
    body: 'Files keep their versions and a SHA-256 fingerprint. Evidence knows when it was collected and when it stops being valid.',
  },
  {
    key: 'roles',
    title: 'Read-only access for your auditor',
    body: 'Invite an auditor with an end date. They read sheets, evidence and the logs, cannot change anything, and their access ends by itself.',
  },
];

/** "How it fits together": the path from a standard to an audit pack, in the product's own concepts. */
export const FLOW: SectionHead & {
  steps: readonly { key: string; title: string; body: string }[];
} = {
  pill: 'How it fits together',
  title: 'From a standard to an audit pack',
  lead: 'A standard adds its requirement library and its columns to the shared registers. Your work happens in the registers, and the record builds itself.',
  steps: [
    { key: 'standard', title: 'Standard', body: 'ISO/IEC 27001, GDPR, NIS2 …' },
    { key: 'library', title: 'Requirement library', body: 'Applicability and status' },
    { key: 'registers', title: 'Shared registers', body: 'Risks, incidents, documents' },
    { key: 'automations', title: 'Automations', body: 'When, if, then' },
    { key: 'log', title: 'Activity log', body: 'Hash-chained per item' },
    { key: 'pack', title: 'Audit pack', body: 'Registers, evidence, log' },
  ],
};

export const FRAMEWORKS_TEASER: SectionHead = {
  pill: 'Frameworks',
  title: 'Ready-made sets for the standards you work to',
  lead: 'Each set adds its registers, requirement library, forms and automations as sheets you can change. A risk, an incident or a document is recorded once and counts for every standard that uses it.',
};

export const LICENCE_NOTE =
  'Requirement libraries describe each requirement in our own words and never include the text of the standards.';

export const TRUST_INTRO: SectionHead = {
  pill: 'Trust',
  title: 'Built to be checked',
  lead: 'The facts an auditor or a security review asks for first.',
};

export const TRUST: readonly Feature[] = [
  {
    key: 'eu',
    title: 'Hosted in the EU',
    body: 'Your data and the app stay in the EU, in Frankfurt.',
  },
  {
    key: 'trail',
    title: 'An audit trail you can verify',
    body: 'The activity log is append-only and hash-chained, so a changed entry shows.',
  },
  {
    key: 'two-step',
    title: 'Two-step sign-in',
    body: 'Sign in with an authenticator app, and require it for everyone in a workspace.',
  },
  {
    key: 'by-id',
    title: 'Data stored by id',
    body: 'Options, people and links are stored by id, so renaming one never rewrites a value.',
  },
];

export const CLOSING = {
  title: 'Start with your first sheet',
  lead: 'Create an account, set up a workspace and invite your team.',
} as const;

// ── /platform ──

export const PLATFORM_PAGE = {
  title: 'The platform',
  lead: `Everything ${BRAND.product} does today, in plain words. Each part is built on the same sheets, the same automations and the same activity log.`,
  description:
    'Sheets with 58 field types, forms, automations, approvals, a hash-chained activity log, the statement of applicability, evidence with expiry, retention, roles and EU hosting.',
} as const;

export type PlatformFeature = {
  /** The anchor (`/platform#sheets`) and the illustration's key. */
  key: string;
  pill: string;
  title: string;
  body: string;
  points: readonly string[];
};

export const PLATFORM_FEATURES: readonly PlatformFeature[] = [
  {
    key: 'sheets',
    pill: 'Sheets',
    title: 'Sheets with 58 field types',
    body: 'A sheet holds fields, groups and items, and an item can have its own sub-items. Field types cover text, numbers, status, people, dates and timelines, files and evidence, links between sheets, lookups, formulas, buttons and more.',
    points: [
      'Views: Table, Board, Calendar, Forms and Insights',
      'Filters, sorting and saved views, personal or shared',
      'Options, people and links stored by id, shown by name',
    ],
  },
  {
    key: 'forms',
    pill: 'Forms',
    title: 'Forms, inside and outside the workspace',
    body: 'Collect items with a form for your team or a public link for anyone. A public form says how the answers are used, and its thank-you page shows a reference, never the answers.',
    points: [
      'Public links you can regenerate or disable, and a QR code',
      'Opening and closing dates and a limit on answers',
      'Spam checks and a limit on answers per minute from one address',
    ],
  },
  {
    key: 'automations',
    pill: 'Automations',
    title: 'Automations: when, if, then',
    body: 'When a field changes, a date arrives, a form is sent or someone presses a button, and the conditions match, then set a value, notify a person, ask for an update, create an item or send a webhook.',
    points: [
      'A run log with the outcome of every step',
      'A loop guard stops chains after three levels',
      'Test mode runs everything except the effects',
    ],
  },
  {
    key: 'approvals',
    pill: 'Approvals',
    title: 'Approvals and workflow',
    body: 'Send an item through ordered approval steps. Approvers are named people, a people field, a job role or a team, and each step can need any one or all of them.',
    points: [
      'A time limit per step and what happens on rejection',
      'Lock the item on approval, and block approving your own item',
      'My work lists everything that needs your approval',
    ],
  },
  {
    key: 'activity',
    pill: 'Activity log',
    title: 'An activity log you can verify, and the audit pack',
    body: 'Every change is written to the activity log in the same transaction as the change itself, hash-chained per item. Verify recomputes the chain and says whether it is intact.',
    points: [
      'Append-only: restoring an old value writes a new entry',
      'The audit pack: registers, the evidence index and the log with every chain checked',
      'Every export is logged: what, who, when and the filters used',
    ],
  },
  {
    key: 'soa',
    pill: 'Requirement libraries',
    title: 'Statement of applicability and requirement libraries',
    body: 'Adopt a framework and get its requirement library as a sheet: one item per requirement, with applicability, justification, implementation status, owner and evidence. The statement of applicability is a view of it, ready to export.',
    points: [
      'Link controls to requirements; cross-walks show what else a requirement satisfies',
      'Coverage of the requirements in scope',
      'Edition status: a withdrawn edition says so and names its successor',
    ],
  },
  {
    key: 'evidence',
    pill: 'Files and evidence',
    title: 'Files and evidence with an expiry',
    body: 'Upload files to an item. A SHA-256 fingerprint is computed before and after the upload, and replacing a file keeps the old version.',
    points: [
      'Evidence records its source, when it was collected and until when it is valid',
      'Current, expiring within 30 days or expired, in words',
      'Up to 25 MB per file',
    ],
  },
  {
    key: 'retention',
    pill: 'Retention',
    title: 'Retention and GDPR erasure',
    body: 'Mark fields that hold personal data and set retention rules per sheet. Items that reach their date wait in a review queue until someone approves, postpones with a reason or places a legal hold.',
    points: [
      'Personal data is masked in the activity log',
      'Erasure leaves the hash chain intact',
      'A daily check, and Check now when you need it',
    ],
  },
  {
    key: 'roles',
    pill: 'Roles',
    title: 'Roles, restricted sheets and the auditor',
    body: 'Owners, admins, editors and viewers, plus an auditor role that reads sheets, evidence and the logs until an end date and then loses access by itself.',
    points: [
      'Restrict a folder or a sheet to chosen people',
      'Restrict a field: everyone else sees "Restricted", never the value',
      'Auditors cannot edit, comment or run buttons',
    ],
  },
  {
    key: 'security',
    pill: 'Sign-in and hosting',
    title: 'Two-step sign-in and EU hosting',
    body: 'Sign in with a password or an email link, then a code from an authenticator app. An owner can require two-step sign-in for everyone in the workspace.',
    points: [
      'Database and app in Frankfurt, EU',
      'Every table protected by row level security',
      'Fonts served from our own domain; no analytics or trackers',
    ],
  },
  {
    key: 'apps',
    pill: 'Apps',
    title: 'Apps over your sheets',
    body: 'An app gives one job a few clear screens over the sheets you already have. The CAPA app has Report a problem, My actions and the items waiting for your check.',
    points: [
      'Screens are forms, views, items, dashboards and the workflow',
      'Built from the same sheets, so nothing is copied',
      'Works on a phone',
    ],
  },
  {
    key: 'design',
    pill: 'Design',
    title: 'The Design area: a map of how data flows',
    body: 'See what feeds each sheet, the automations and approvals that act on it and what leaves it, with the health of each step in words.',
    points: [
      'A list and a map for every sheet and for the whole workspace',
      'What leaves the workspace: destinations, fields and personal data',
      'A data-flow record to print for your auditor',
    ],
  },
];

// ── /frameworks ──

export const FRAMEWORKS_PAGE = {
  title: 'Frameworks and ready-made sets',
  lead: 'Every set in the catalogue, what it adds and what it shares. A set installs as ordinary sheets, forms and automations you can change.',
  description:
    'Ready-made sets for ISO/IEC 27001, ISO 9001, ISO 14001, ISO 45001, GDPR, NIS2 and supplier management, on shared registers, with requirement libraries in our own words.',
  foundationTitle: 'The base every set builds on',
  librariesTitle: 'Requirement libraries',
  librariesLead:
    'The editions in the catalogue. A library holds the reference numbers and short titles only; the purpose, guidance, audit questions and typical evidence are our own words. Buy the standard for the requirements.',
} as const;

/** The site's words for each pack of the catalogue: its group on /frameworks and a one-line summary. */
export const SET_COPY: Record<string, SiteSetCopy> = {
  core: {
    category: 'foundation',
    line: 'The registers every standard builds on, from risks and documents to incidents, nonconformities and suppliers. Each is recorded once and counts for every standard that uses it.',
  },
  'iso-27001': {
    category: 'security-privacy',
    line: 'An information security management system: scope and context, the risk treatment plan, and Annex A links on your shared registers.',
  },
  gdpr: {
    category: 'security-privacy',
    line: 'Records of processing, data subject requests with their deadline, personal data breaches with the 72-hour clock, and DPIAs.',
  },
  nis2: {
    category: 'security-privacy',
    line: 'A scope self-check per legal entity, the risk-management measures as controls, and incident reports with their deadlines.',
  },
  'iso-9001': {
    category: 'quality-environment-safety',
    line: 'Processes, customer feedback and complaints, with quality objectives, risks and nonconformities in the shared registers.',
  },
  'iso-14001': {
    category: 'quality-environment-safety',
    line: 'Environmental aspects and their significance, monitoring results, and compliance obligations in the Legal register.',
  },
  'iso-45001': {
    category: 'quality-environment-safety',
    line: 'Hazard identification and risk assessment with the hierarchy of controls, worker consultation, and injuries and near misses as incidents.',
  },
  'supplier-management': {
    category: 'supply-chain-improvement',
    line: 'Supplier approval and reviews, a library of supplier requirements, and a check per supplier and requirement kept in step for you.',
  },
};

// ── sign-in pages ──

export const AUTH_PANEL = {
  title: 'Your management system, in one shared spreadsheet',
  points: [
    'Hosted in Frankfurt, EU',
    'Every change in an activity log you can verify',
    'Two-step sign-in with an authenticator app',
  ],
} as const;

/** The one contact address the public pages give (owner decision, 16 Nov 2026). */
export const CONTACT = { email: SUPPORT_EMAIL } as const;

/** The pages search engines may index; everything else is noindex (root layout). */
export const PUBLIC_PATHS = ['/', LINKS.privacy, LINKS.terms] as const;

/** The pages the sitemap lists: the public pages plus the product pages (sitemap.ts reads this). */
export const SITEMAP_PATHS = [
  '/',
  LINKS.platform,
  LINKS.frameworks,
  LINKS.privacy,
  LINKS.terms,
] as const;
