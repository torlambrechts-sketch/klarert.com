import { z } from 'zod';

export const ROLES = ['owner', 'admin', 'editor', 'viewer', 'auditor'] as const;
export const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
  auditor: 'Auditor',
};
/** One plain sentence on what each role can do (docs/01 §4), shown beside the role choice and in the invite email. */
export const ROLE_SUMMARIES: Record<(typeof ROLES)[number], string> = {
  owner:
    'Owners can do everything, including managing members, deleting the workspace and transferring ownership.',
  admin: 'Admins manage members, roles and workspace settings, and can do everything editors can.',
  editor: 'Editors add and change items, and create sheets, fields, views and automations.',
  viewer: 'Viewers see sheets, items and activity, but cannot change anything.',
  auditor:
    'Auditors have read-only access to sheets, evidence, files and activity until their access ends.',
};

export const PROFILE_COLORS = [
  'blue',
  'navy',
  'teal',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'dark',
  'grey',
] as const;

const name = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} can be at most ${max} characters.`);

export const profileInput = z.object({
  displayName: name('Name', 80),
  initials: z
    .string()
    .trim()
    .min(1, 'Initials are required.')
    .max(3, 'Use at most 3 characters.')
    .transform((s) => s.toUpperCase()),
  color: z.enum(PROFILE_COLORS),
});

export const slugInput = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,40}$/, 'Use 3–40 lowercase letters, digits or hyphens.');

export const createWorkspaceInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(120, 'Name can be at most 120 characters.'),
  slug: slugInput,
  timeZone: z.string().min(1, 'Choose a time zone.'),
});

export const orgRef = z.object({ org: slugInput });
const uuid = z.uuid('Invalid id.');

/** An auditor's access ends on this day (docs/02 §16): required for auditors, ignored for other roles. */
const accessEnds = z
  .union([z.iso.date('Choose the day access ends.'), z.literal('')])
  .optional()
  .transform((v) => v || undefined);
const auditorNeedsEnd = (v: { role: string; expiresOn?: string }) =>
  v.role !== 'auditor' || !!v.expiresOn;
const endMessage = { message: "Choose the day an auditor's access ends.", path: ['expiresOn'] };

export const createInviteInput = orgRef
  .extend({
    email: z.email('Enter a valid email address.').trim().toLowerCase(),
    role: z.enum(ROLES),
    expiresOn: accessEnds,
  })
  .refine(auditorNeedsEnd, endMessage);
export const revokeInviteInput = orgRef.extend({ inviteId: uuid });
export const acceptInviteInput = z.object({
  token: z.string().regex(/^[0-9a-f]{48}$/, 'Invalid invite link.'),
});

export const changeRoleInput = orgRef
  .extend({ userId: uuid, role: z.enum(ROLES), expiresOn: accessEnds })
  .refine(auditorNeedsEnd, endMessage);
export const removeMemberInput = orgRef.extend({ userId: uuid });

export const teamInput = orgRef.extend({ name: name('Team name', 80) });
export const teamRef = orgRef.extend({ teamId: uuid });
export const teamMemberInput = teamRef.extend({ userId: uuid });

export const jobRoleInput = orgRef.extend({ name: name('Job role', 80) });
export const jobRoleRef = orgRef.extend({ jobRoleId: uuid });

export const entityInput = orgRef.extend({
  name: name('Entity name', 120),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter country code, such as GB or NO.'),
});
export const entityRef = orgRef.extend({ entityId: uuid });
export const siteInput = entityRef.extend({ name: name('Site name', 120) });
export const siteRef = orgRef.extend({ siteId: uuid });
