// The words of the public product site at `/` (signed-out visitors). Every claim here is backed by the docs:
// docs/01 (product), docs/02 (activity log), docs/04 (automations), docs/09 (security), docs/11 (packs, audit
// outputs) and docs/12 (frameworks, SoA, licensing: the standards are named, their text is never quoted).
// The owner edits the copy here; content.test.ts keeps the standards row tied to the catalogue.

export const BRAND = { product: 'Compliance OS', company: 'Klarert' } as const;

export const SITE = {
  url: 'https://www.klarert.com',
  title: 'Compliance OS by Klarert',
  description:
    'Run your management system in one shared spreadsheet: registers, automations and an activity log you can verify, hosted in the EU.',
} as const;

export const HERO = {
  title: 'Run your management system in one shared spreadsheet',
  lead: 'Compliance OS keeps your registers, actions and evidence in sheets your whole team works in. Automations keep the work moving, and every change is written to an activity log you can verify.',
} as const;

/**
 * The standards row: what the catalogue ships (templates/packs/*.json). `pack` is the catalogue key the name stands
 * for; Corrective actions is the Nonconformities and CAPA register of the Core registers and its CAPA app (docs/13).
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

export const STANDARDS_INTRO = {
  title: 'Ready-made sets for the standards you work to',
  lead: 'Each set adds its registers, requirement library, forms and automations as sheets you can change. A risk, an incident or a document is recorded once and counts for every standard that uses it.',
  note: 'Requirement libraries describe each requirement in our own words and never include the text of the standards.',
} as const;

export type Feature = { key: string; title: string; body: string };

export const FEATURES: readonly Feature[] = [
  {
    key: 'sheets',
    title: 'Every register is a sheet',
    body: 'Risks, incidents, suppliers, documents and actions each live in a sheet with groups, items and 58 field types: status, people, dates, evidence with an expiry, formulas and more. Work in a table, on a Kanban board or in a calendar, and collect entries with forms.',
  },
  {
    key: 'automations',
    title: 'Automations: when, if, then',
    body: 'When a field changes, a date arrives or someone presses a button, and the conditions match, then set a value, notify a person, create a follow-up or post an update. Every run is in the run log, with the outcome of each step.',
  },
  {
    key: 'activity',
    title: 'An activity log you can verify',
    body: 'Every change is written to the activity log in the same transaction, hash-chained per item. Verify recomputes the chain and says whether it is intact. The audit pack exports your registers, the evidence index and the log with every chain checked.',
  },
  {
    key: 'auditor',
    title: 'Read-only access for your auditor',
    body: 'Invite an auditor with an end date. They read sheets, evidence, the activity log and the run log, cannot change anything, and their access ends by itself. The statement of applicability is a view of your requirement library, ready to export.',
  },
];

export const TRUST_INTRO = { title: 'Built to be checked' } as const;

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

export const LINKS = {
  signIn: '/login',
  createAccount: '/login?mode=signup',
  privacy: '/privacy',
  terms: '/terms',
} as const;

/** The one contact address the public pages give (owner decision, 16 Nov 2026). */
export const CONTACT = { email: 'support@klarert.com' } as const;

/** The pages search engines may index; everything else is noindex (root layout). robots.ts and sitemap.ts read this. */
export const PUBLIC_PATHS = ['/', LINKS.privacy, LINKS.terms] as const;

/** Not pages: what crawlers fetch to render the public pages and their share card (robots.ts allows them). */
export const ROBOTS_ASSETS = ['/_next/static/', '/favicon.ico', '/opengraph-image'] as const;
