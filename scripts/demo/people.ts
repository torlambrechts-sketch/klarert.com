// The people of the demo workspace. All fictional, with example.com addresses (a domain reserved for examples, so no
// mail reaches anyone). Only the demo login (demo@meridian.example, `.example` is reserved too) has a password, and it
// is a read-only viewer (owner decision 17 Nov 2026): visitors of the live site sign in with it. The owner,
// Hannah Whitfield (owner@meridian.example), holds the workspace and is who the seed acts as for the owner's part; she
// and the others are signed out and blocked from signing in when the seed finishes. An optional admin login of the
// owner's own (DEMO_ADMIN_EMAIL) is added by scripts/demo/index.ts and is not one of these people.

/** The demo login: a viewer, the one person here who signs in. */
export const DEMO_EMAIL = 'demo@meridian.example';
/** The workspace's owner: never signs in, the seed acts as her. */
export const OWNER_EMAIL = 'owner@meridian.example';

export type PersonRef =
  'hannah' | 'priya' | 'daniel' | 'grace' | 'tomasz' | 'ellie' | 'marcus' | 'ruth' | 'visitor';

export interface DemoPerson {
  ref: PersonRef;
  name: string;
  initials: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer' | 'auditor';
  /** The job title, matched by the packs' "tell the quality manager" automations (docs/04). */
  jobTitle: string;
  team: string;
  color: 'blue' | 'teal' | 'orange' | 'purple' | 'green' | 'pink' | 'yellow' | 'grey';
  /** Auditor access ends this many days from today. */
  endsInDays?: number;
}

export const PEOPLE: readonly DemoPerson[] = [
  {
    ref: 'hannah',
    name: 'Hannah Whitfield',
    initials: 'HW',
    email: OWNER_EMAIL,
    role: 'owner',
    jobTitle: 'Top management',
    team: 'Leadership',
    color: 'purple',
  },
  {
    ref: 'priya',
    name: 'Priya Raman',
    initials: 'PR',
    email: 'priya.raman@example.com',
    role: 'admin',
    jobTitle: 'Quality manager',
    team: 'Quality',
    color: 'blue',
  },
  {
    ref: 'daniel',
    name: 'Daniel Osei',
    initials: 'DO',
    email: 'daniel.osei@example.com',
    role: 'admin',
    jobTitle: 'Information security officer',
    team: 'IT',
    color: 'teal',
  },
  {
    ref: 'grace',
    name: 'Grace McAllister',
    initials: 'GM',
    email: 'grace.mcallister@example.com',
    role: 'editor',
    jobTitle: 'HSE manager',
    team: 'HSE',
    color: 'green',
  },
  {
    ref: 'tomasz',
    name: 'Tomasz Nowak',
    initials: 'TN',
    email: 'tomasz.nowak@example.com',
    role: 'editor',
    jobTitle: 'Data protection officer',
    team: 'Legal and privacy',
    color: 'orange',
  },
  {
    ref: 'ellie',
    name: 'Ellie Chambers',
    initials: 'EC',
    email: 'ellie.chambers@example.com',
    role: 'editor',
    jobTitle: 'Production manager',
    team: 'Operations',
    color: 'pink',
  },
  {
    ref: 'marcus',
    name: 'Marcus Bell',
    initials: 'MB',
    email: 'marcus.bell@example.com',
    role: 'editor',
    jobTitle: 'Purchasing lead',
    team: 'Operations',
    color: 'yellow',
  },
  {
    ref: 'ruth',
    name: 'Ruth Adeyemi',
    initials: 'RA',
    email: 'ruth.adeyemi@example.com',
    role: 'auditor',
    jobTitle: 'External auditor',
    team: 'Quality',
    color: 'grey',
    endsInDays: 45,
  },
  {
    // the demo login: reads everything a viewer may, changes nothing (docs/17, docs/09 §15)
    ref: 'visitor',
    name: 'Sam Carter',
    initials: 'SC',
    email: DEMO_EMAIL,
    role: 'viewer',
    jobTitle: 'Non-executive director',
    team: 'Leadership',
    color: 'blue',
  },
];

/** The job roles the packs' automations name; the ones nobody holds stay empty (their messages go nowhere). */
export const JOB_ROLES = [
  'Top management',
  'Quality manager',
  'Information security officer',
  'HSE manager',
  'Environmental manager',
  'Data protection officer',
  'Production manager',
  'Purchasing lead',
  'External auditor',
] as const;

export const person = (ref: PersonRef): DemoPerson => PEOPLE.find((p) => p.ref === ref)!;
/** The person's display name, as people fields take it. */
export const nameOf = (ref: PersonRef) => person(ref).name;
