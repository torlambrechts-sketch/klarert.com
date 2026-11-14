// Access control (docs/02 §16): the levels a person has on a sheet, who sees a restricted field, and the words the
// Access panel uses. Pure. The database decides (supabase/migrations/0026, 0027); this mirrors its rules so the app
// can explain them, hide edit affordances and say "Restricted" instead of showing an empty value.
import type { Json, Role } from './types';

export type AccessLevel = 'owner' | 'editor' | 'commenter' | 'viewer' | 'none';
export type GrantLevel = 'editor' | 'commenter' | 'viewer';
export const GRANT_LEVELS: readonly GrantLevel[] = ['editor', 'commenter', 'viewer'];

/** How a sheet's access is set: following its folder, restricted to its own list, or open to the workspace. */
export type SheetAccessMode = 'inherit' | 'restricted' | 'open';

const RANK: Record<AccessLevel, number> = { none: 0, viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const levelRank = (l: AccessLevel) => RANK[l] ?? 0;
export const canRead = (l: AccessLevel) => levelRank(l) >= 1;
export const canComment = (l: AccessLevel) => levelRank(l) >= 2;
export const canEdit = (l: AccessLevel) => levelRank(l) >= 3;

export function toLevel(v: unknown): AccessLevel {
  return v === 'owner' || v === 'editor' || v === 'commenter' || v === 'viewer' ? v : 'none';
}

/** Read-only workspace roles: a grant never gives them more than viewing. */
export const isReadOnlyRole = (role: Role) => role === 'viewer' || role === 'auditor';

/**
 * A person's level on a sheet (the database's _sheet_levels): owners always; an open sheet by workspace role; a
 * restricted one by the person's grant, capped by the role (viewers and auditors read only); otherwise none.
 */
export function resolveLevel(input: {
  role: Role | null;
  restricted: boolean;
  grant: GrantLevel | null;
}): AccessLevel {
  const { role, restricted, grant } = input;
  if (!role) return 'none';
  if (role === 'owner') return 'owner';
  if (!restricted) return isReadOnlyRole(role) ? 'viewer' : 'editor';
  if (!grant) return 'none';
  return isReadOnlyRole(role) ? 'viewer' : grant;
}

/**
 * Where a sheet's restriction comes from. Sub-item sheets pass their parent's settings. A sheet that follows its
 * folder is restricted when the folder is, with the folder's list; with its own setting, by its own flag and list.
 */
export function effectiveRestriction(sheet: {
  inherit: boolean;
  restricted: boolean;
  folderRestricted: boolean;
}): { restricted: boolean; source: 'folder' | 'sheet' } {
  return sheet.inherit
    ? { restricted: sheet.folderRestricted, source: 'folder' }
    : { restricted: sheet.restricted, source: 'sheet' };
}

export const modeOf = (inherit: boolean, restricted: boolean): SheetAccessMode =>
  inherit ? 'inherit' : restricted ? 'restricted' : 'open';

// ───────────── restricted fields ─────────────

export interface FieldRestriction {
  userIds: string[];
  roles: Role[];
}

const ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'viewer', 'auditor'];

/** fields.restricted_to, read leniently: null when the field is not restricted. */
export function parseRestriction(v: Json | null | undefined): FieldRestriction | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const ids = Array.isArray(v.userIds)
    ? v.userIds.filter((x): x is string => typeof x === 'string')
    : [];
  const roles = Array.isArray(v.roles)
    ? v.roles.filter((x): x is Role => typeof x === 'string' && (ROLES as string[]).includes(x))
    : [];
  return { userIds: ids, roles };
}

/** Whether a person sees a restricted field's values: owners, the people listed, the roles listed. */
export function canSeeRestricted(
  restriction: FieldRestriction | null | undefined,
  viewer: { userId: string; role: Role | null },
): boolean {
  if (!restriction) return true;
  if (viewer.role === 'owner') return true;
  if (restriction.userIds.includes(viewer.userId)) return true;
  return !!viewer.role && restriction.roles.includes(viewer.role);
}

// ───────────── words ─────────────

export const LEVEL_LABEL: Record<AccessLevel, string> = {
  owner: 'Owner',
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'Can view',
  none: 'No access',
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
  auditor: 'Auditor',
};

/** "Only the 3 people listed and the owners" / "Everyone in the workspace" for the Access panel. */
export function whoCanSee(input: {
  restricted: boolean;
  listed: number;
  owners: number;
  source: 'folder' | 'sheet';
  folderName?: string | null;
}): string {
  if (!input.restricted) return 'Everyone in the workspace, by their workspace role.';
  const people = input.listed === 1 ? '1 person' : `${input.listed} people`;
  const from =
    input.source === 'folder' && input.folderName ? ` listed on ${input.folderName}` : ' listed';
  return `Only the ${people}${from}, and the workspace owners.`;
}

/** The read-only banner for an auditor: "Read-only auditor access until 31 Dec 2026". */
export function auditorBanner(expiresAt: string, timeZone: string): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(expiresAt));
  return `Read-only auditor access until ${date}`;
}

/**
 * A value the activity log keeps as a marker: restricted (0027) or personal data (0036, docs/02 §18). People who may
 * see it read the value from its own store; an erased personal value stays a marker for good.
 */
export function isMaskedValue(v: unknown): boolean {
  return (
    !!v && typeof v === 'object' && !Array.isArray(v) && ('$restricted' in v || '$personal' in v)
  );
}

/** A personal-data value erased under a retention rule (the panel puts this in place of the marker). */
export const ERASED_VALUE = { $erased: true } as const;
export function isErasedValue(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && '$erased' in v;
}

/**
 * The instant an auditor's access ends: the end of `date` (YYYY-MM-DD) in the workspace's time zone, as ISO UTC.
 * Pure: the zone's offset is read from Intl for that day.
 */
export function endOfDayIn(date: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
    999,
  );
  return new Date(guess - (local - guess)).toISOString();
}

/** An end date is a day still to come in the workspace's time zone. */
export function endDateOk(date: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today;
}
