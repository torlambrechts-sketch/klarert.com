// The draft privacy notice and terms (owner decision, 16 Nov 2026). DRAFT, TO BE REVIEWED by a lawyer before launch.
// Every statement is a fact written down in the repo; where a fact is missing (an address, a registration number,
// a legal basis), the text holds a placeholder in square brackets instead of a guess. Sources:
// - EU hosting: docs/01 (Non-functional: Data), CLAUDE.md (Stack), docs/09 §8 (HSTS on www.keptrow.com)
// - The product is Keptrow (BRAND, docs/14); the legal entity stays a placeholder until the owner fills it in.
// - Email through Brevo in the EU: docs/09 §11 (invites) and §12 (sign-in and reset emails, security alerts)
// - No trackers or analytics: docs/01 (no third-party requests from the browser, no analytics)
// - Two-step sign-in: docs/09 §8.2
// - The activity log, retention and erasure: docs/02 §6 and §18
// - Delete my account: docs/09 §12 (option a, a nameless profile as tombstone; member names kept as access evidence)
// content.test.ts checks the rules: no exclamation marks, every placeholder listed in PLACEHOLDERS, one contact.

import { BRAND, CONTACT, LINKS } from './content';

/** A run of text: plain words, a link, or a placeholder the owner or the lawyer fills in. */
export type Inline = string | { link: string; text: string } | { placeholder: string };
export type Block = { p: Inline[] } | { list: Inline[][] };
export type LegalSection = { id: string; title: string; blocks: Block[] };
export type LegalPage = {
  title: string;
  description: string;
  path: string;
  intro: Inline[];
  sections: LegalSection[];
};

const ph = (placeholder: string): Inline => ({ placeholder });
const mail: Inline = { link: `mailto:${CONTACT.email}`, text: CONTACT.email };

/** Everything still to be filled in, in the order the pages show it. The report to the owner reads this list. */
export const PLACEHOLDERS = {
  date: 'Date of publication',
  company: 'Company legal name',
  address: 'Company address',
  registration: 'Registration number',
  dpo: 'Data protection officer, if one is appointed',
  roles: 'Controller and processor roles for workspace content',
  legalBasis: 'Legal basis for each purpose',
  dpa: 'Data processing agreements with each subprocessor',
  backups: 'How long backups are kept',
  closedWorkspace: 'What happens to a workspace and its data when its subscription ends',
  authority: 'Supervisory authority',
  plans: 'Plans, prices and payment terms',
  acceptableUse: 'Acceptable use rules',
  availability: 'Availability and support commitments',
  ending: 'How either side ends the agreement, and notice periods',
  liability: 'Limitation of liability',
  law: 'Governing law and courts',
  changes: 'How we tell you about changes to these terms',
} as const;

const P = PLACEHOLDERS;

export const PRIVACY: LegalPage = {
  title: 'Privacy notice',
  description: `How ${BRAND.product} handles personal data: what is stored, where, for how long and your rights.`,
  path: LINKS.privacy,
  intro: [
    `This notice explains what personal data ${BRAND.product} keeps, why, where it is stored and what you can do about it. Last updated: `,
    ph(P.date),
    '.',
  ],
  sections: [
    {
      id: 'who-we-are',
      title: 'Who we are',
      blocks: [
        {
          p: [
            `${BRAND.product} is made by `,
            ph(P.company),
            ' (',
            ph(P.address),
            ', registration number ',
            ph(P.registration),
            ').',
          ],
        },
        { p: ['Data protection officer: ', ph(P.dpo), '.'] },
        {
          p: [
            'Workspaces hold content that their members enter about their own organisation. Who is the controller of that content and who is the processor: ',
            ph(P.roles),
            '.',
          ],
        },
      ],
    },
    {
      id: 'what-we-collect',
      title: 'What we collect',
      blocks: [
        {
          list: [
            ['Your account: your email address, and your password if you set one.'],
            [
              'Two-step sign-in: if you turn it on, what is needed to check the codes from your authenticator app.',
            ],
            ['Your profile: your display name, your initials and a colour.'],
            [
              'Workspace content: the sheets, items, files and comments that you and the other members of a workspace enter.',
            ],
            [
              'The activity log: who changed what and when, in each workspace. It is append-only and hash-chained per item, so a changed or removed entry shows.',
            ],
            [
              'Sign-in cookies: the cookies that keep you signed in. There are no other cookies, no trackers and no analytics.',
            ],
          ],
        },
        {
          p: [
            'Values in fields that a workspace marks as personal data are kept out of the activity log in clear, so they can be erased later without breaking the chain.',
          ],
        },
      ],
    },
    {
      id: 'why',
      title: 'Why we use it',
      blocks: [
        {
          list: [
            ['To give you an account, sign you in and keep your account secure.'],
            [
              'To run the workspaces you belong to: store their content, run their automations and keep their activity log.',
            ],
            [
              'To send the emails the service needs: invites, sign-in links, password reset links and security alerts when your password or email address changes.',
            ],
          ],
        },
        { p: ['Legal basis: ', ph(P.legalBasis), '.'] },
      ],
    },
    {
      id: 'where',
      title: 'Where it is stored',
      blocks: [
        {
          p: [
            'In the EU. The database, sign-in and file storage run on Supabase in Frankfurt, Germany. The app runs on Vercel in Frankfurt (region fra1). Emails are sent through Brevo, which keeps data in the EU (France and Germany).',
          ],
        },
        {
          p: [
            'Your browser loads nothing from other sites: fonts are served by the app itself, and there are no third-party scripts.',
          ],
        },
      ],
    },
    {
      id: 'subprocessors',
      title: 'Subprocessors',
      blocks: [
        {
          list: [
            ['Supabase: database, sign-in and file storage, in Frankfurt, Germany.'],
            ['Vercel: hosts the app, in Frankfurt, Germany (fra1).'],
            [
              'Brevo: sends invites, sign-in and password reset emails and security alerts, in the EU (France and Germany).',
            ],
          ],
        },
        { p: ['Agreements: ', ph(P.dpa), '.'] },
      ],
    },
    {
      id: 'how-long',
      title: 'How long it is kept',
      blocks: [
        {
          list: [
            ['Your account and profile: until you delete your account.'],
            [
              'Workspace content: as long as the workspace keeps it. Owners and admins set retention rules per sheet; when a record is due, a person reviews it and erases, anonymises or archives it, unless it is on legal hold.',
            ],
            [
              'The activity log: it is append-only and never edited, and is kept as long as the workspace keeps it. When a record is erased, the values of its fields marked as personal data are erased from the log as well, and the log records what was erased, by whom and when, without the values. Values entered before a field was marked as personal data stay in the log.',
            ],
            ['Backups: ', ph(P.backups), '.'],
            ['When a workspace ends: ', ph(P.closedWorkspace), '.'],
          ],
        },
      ],
    },
    {
      id: 'your-rights',
      title: 'Your rights',
      blocks: [
        {
          p: [
            'You can ask for a copy of your personal data, ask us to correct it, erase it or restrict how it is used, object to its use, and ask for it in a format you can take elsewhere. Write to ',
            mail,
            '.',
          ],
        },
        {
          p: [
            'You can change your name, email address and password yourself, in Your account. Entries in the access log that were written before a change keep the name used at the time.',
          ],
        },
        {
          p: [
            'Delete my account (in Your account) erases your account and your name. What you created stays in the workspaces you were a member of, shown as made by "Former member". Your name stays in the activity log entries that record who was given access to a workspace and when, as evidence for access reviews. If you are the only owner of a workspace, make someone else owner or delete the workspace first.',
          ],
        },
        {
          p: [
            'Content about you that others entered in a workspace is managed by that workspace. Ask its owners, or write to us.',
          ],
        },
        { p: ['You can also complain to a supervisory authority: ', ph(P.authority), '.'] },
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [{ p: ['Questions about this notice or your data: ', mail, '.'] }],
    },
  ],
};

export const TERMS: LegalPage = {
  title: 'Terms',
  description: `The terms for using ${BRAND.product}.`,
  path: LINKS.terms,
  intro: [
    `These terms apply when you create an account or use ${BRAND.product}. Last updated: `,
    ph(P.date),
    '.',
  ],
  sections: [
    {
      id: 'who',
      title: 'Who we are',
      blocks: [
        {
          p: [
            `${BRAND.product} is provided by `,
            ph(P.company),
            ' (',
            ph(P.address),
            ', registration number ',
            ph(P.registration),
            ').',
          ],
        },
      ],
    },
    {
      id: 'service',
      title: 'The service',
      blocks: [
        {
          p: [
            `${BRAND.product} is a shared spreadsheet for compliance and operations work: sheets, automations and an activity log, hosted in the EU. Ready-made sets for standards describe each requirement in our own words; they do not include the text of the standards, and using them does not make you certified.`,
          ],
        },
        { p: ['Plans and prices: ', ph(P.plans), '.'] },
      ],
    },
    {
      id: 'account',
      title: 'Your account',
      blocks: [
        {
          p: [
            'Keep your sign-in details to yourself and turn on two-step sign-in. Tell the owner of your workspace and write to ',
            mail,
            ' if you think someone else has used your account.',
          ],
        },
      ],
    },
    {
      id: 'content',
      title: 'Your content',
      blocks: [
        {
          p: [
            'Your workspace content stays yours. We use it only to provide the service, as the ',
            { link: LINKS.privacy, text: 'privacy notice' },
            ' describes.',
          ],
        },
        { p: ['Acceptable use: ', ph(P.acceptableUse), '.'] },
      ],
    },
    {
      id: 'availability',
      title: 'Availability and support',
      blocks: [{ p: [ph(P.availability), '.'] }],
    },
    {
      id: 'ending',
      title: 'Ending',
      blocks: [
        { p: ['You can delete your account at any time with Delete my account, in Your account.'] },
        { p: [ph(P.ending), '.'] },
      ],
    },
    {
      id: 'liability',
      title: 'Liability',
      blocks: [{ p: [ph(P.liability), '.'] }],
    },
    {
      id: 'law',
      title: 'Law and changes',
      blocks: [
        { p: ['Governing law: ', ph(P.law), '.'] },
        { p: ['Changes to these terms: ', ph(P.changes), '.'] },
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [{ p: ['Questions about these terms: ', mail, '.'] }],
    },
  ],
};
