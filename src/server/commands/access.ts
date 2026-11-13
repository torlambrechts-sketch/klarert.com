import 'server-only';
import { z } from 'zod';
import {
  GRANT_LEVELS,
  toLevel,
  type AccessLevel,
  type GrantLevel,
  type SheetAccessMode,
} from '@/engine/access';
import { ACCESS_ACTIONS, accessText } from '@/engine/activity';
import type { Json, Role } from '@/engine/types';
import type { Db } from '@/lib/sheet-query';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// Access control (docs/02 §16): who may read, comment on and edit a folder or a sheet, and who sees a restricted
// field. The database decides and logs (set_sheet_access, set_folder_access, set_access_grant, set_field_restriction:
// owners, and admins who have access); these commands validate, check the workspace role first for a readable
// message, and shape what the Access panel shows.

const org = z.string().min(1).max(40);
const uuid = z.uuid();

export interface AccessPerson {
  userId: string;
  name: string;
  initials: string;
  color: string;
  role: Role;
  /** The person's level on this sheet or folder now. */
  level: AccessLevel;
  /** Listed on the sheet's or folder's own list, with this level. */
  grant: GrantLevel | null;
}

export interface AccessInfo {
  kind: 'sheet' | 'folder';
  id: string;
  name: string;
  /** Sheets: following the folder, restricted to its own list, or open to the workspace. */
  mode: SheetAccessMode | null;
  restricted: boolean;
  /** Where the restriction comes from (a sheet following a restricted folder: the folder). */
  source: 'folder' | 'sheet';
  folder: { id: string; name: string; restricted: boolean } | null;
  myLevel: AccessLevel;
  canManage: boolean;
  people: AccessPerson[];
  /** Recent access changes (grants, revokes, restricting), newest first. */
  log: { id: number; at: string; who: string; text: string }[];
}

type LogRow = {
  id: number;
  at: string;
  actor_kind: string;
  actor_id: string | null;
  action: string;
  old_value: Json | null;
  new_value: Json | null;
  note: string | null;
};

function logLines(rows: LogRow[], dir: Awaited<ReturnType<typeof directory>>) {
  const personName = (id: string) => dir.get(id)?.name;
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    who:
      r.actor_kind === 'user'
        ? ((r.actor_id && personName(r.actor_id)) ?? 'Former member')
        : 'System',
    text:
      accessText(
        { action: r.action, oldValue: r.old_value, newValue: r.new_value, note: r.note },
        { personName },
      ) ?? r.action,
  }));
}

type Grant = { userId: string; level: string };
type Member = { userId: string; role: Role; level: string };

async function directory(db: Db, orgId: string) {
  const { data, error } = await db
    .from('memberships')
    .select('user_id, profiles!inner(display_name, initials, color)')
    .eq('org_id', orgId);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((m) => [
      m.user_id,
      { name: m.profiles.display_name, initials: m.profiles.initials, color: m.profiles.color },
    ]),
  );
}

function people(
  members: Member[],
  grants: Grant[],
  dir: Awaited<ReturnType<typeof directory>>,
): AccessPerson[] {
  const listed = new Map(grants.map((g) => [g.userId, g.level as GrantLevel]));
  return members
    .map((m) => {
      const p = dir.get(m.userId);
      return {
        userId: m.userId,
        name: p?.name ?? 'Former member',
        initials: p?.initials ?? '?',
        color: p?.color ?? 'grey',
        role: m.role,
        level: toLevel(m.level),
        grant: listed.get(m.userId) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
}

const sheetInput = z.object({ org, sheetId: uuid });

/** The Access panel of a sheet. Owners and admins see it for any sheet (to know it is restricted); others need access. */
export async function getSheetAccess(raw: unknown): Promise<Result<AccessInfo>> {
  const p = sheetInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase.rpc('sheet_access_info', { p_sheet: p.data.sheetId });
      if (error) return fromDbError(error);
      const info = data as {
        sheetId: string;
        name: string;
        level: string;
        mode: SheetAccessMode;
        restricted: boolean;
        source: 'folder' | 'sheet';
        folder: { id: string; name: string; restricted: boolean } | null;
        canManage: boolean;
        grants: Grant[];
        members: Member[];
      } | null;
      if (!info) return fail('not_found', 'This sheet is not available.');
      const [dir, log] = await Promise.all([
        directory(supabase, orgId),
        info.level === 'none'
          ? Promise.resolve({ data: [] as LogRow[] })
          : supabase
              .from('activity_log')
              .select('id, at, actor_kind, actor_id, action, old_value, new_value, note')
              .eq('sheet_id', info.sheetId)
              .is('item_id', null)
              .in('action', [...ACCESS_ACTIONS])
              .order('id', { ascending: false })
              .limit(20),
      ]);
      return ok({
        kind: 'sheet',
        id: info.sheetId,
        name: info.name,
        mode: info.mode,
        restricted: info.restricted,
        source: info.source,
        folder: info.folder,
        myLevel: toLevel(info.level),
        canManage: info.canManage,
        people: people(info.members, info.grants, dir),
        log: logLines((log.data ?? []) as LogRow[], dir),
      });
    },
    'getSheetAccess',
  );
}

const folderInput = z.object({ org, folderId: uuid });

export async function getFolderAccess(raw: unknown): Promise<Result<AccessInfo>> {
  const p = folderInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase.rpc('folder_access_info', {
        p_folder: p.data.folderId,
      });
      if (error) return fromDbError(error);
      const info = data as {
        folderId: string;
        name: string;
        level: string;
        restricted: boolean;
        canManage: boolean;
        grants: Grant[];
        members: Member[];
      } | null;
      if (!info) return fail('not_found', 'This folder is not available.');
      const [dir, log] = await Promise.all([
        directory(supabase, orgId),
        supabase
          .from('activity_log')
          .select('id, at, actor_kind, actor_id, action, old_value, new_value, note')
          .eq('org_id', orgId)
          .is('sheet_id', null)
          .like('action', 'folder.access%')
          .or(`new_value->>folder_id.eq.${info.folderId},old_value->>folder_id.eq.${info.folderId}`)
          .order('id', { ascending: false })
          .limit(20),
      ]);
      return ok({
        kind: 'folder',
        id: info.folderId,
        name: info.name,
        mode: null,
        restricted: info.restricted,
        source: 'folder',
        folder: null,
        myLevel: toLevel(info.level),
        canManage: info.canManage,
        people: people(info.members, info.grants, dir),
        log: logLines((log.data ?? []) as LogRow[], dir),
      });
    },
    'getFolderAccess',
  );
}

const sheetModeInput = z.object({
  org,
  sheetId: uuid,
  mode: z.enum(['inherit', 'restricted', 'open']),
});

/** Restrict a sheet to its own list, open it to the workspace, or let it follow its folder (logged). */
export async function setSheetAccess(raw: unknown): Promise<Result<{ mode: SheetAccessMode }>> {
  const p = sheetModeInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase }) => {
      const { error } = await supabase.rpc('set_sheet_access', {
        p_sheet: p.data.sheetId,
        p_mode: p.data.mode,
      });
      return error ? fromDbError(error) : ok({ mode: p.data.mode });
    },
    'setSheetAccess',
  );
}

const folderModeInput = z.object({ org, folderId: uuid, restricted: z.boolean() });

export async function setFolderAccess(raw: unknown): Promise<Result<{ restricted: boolean }>> {
  const p = folderModeInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase }) => {
      const { error } = await supabase.rpc('set_folder_access', {
        p_folder: p.data.folderId,
        p_restricted: p.data.restricted,
      });
      return error ? fromDbError(error) : ok({ restricted: p.data.restricted });
    },
    'setFolderAccess',
  );
}

const grantInput = z.object({
  org,
  kind: z.enum(['sheet', 'folder']),
  targetId: uuid,
  userId: uuid,
  /** null takes the person off the list. */
  level: z.enum(GRANT_LEVELS as [GrantLevel, ...GrantLevel[]]).nullable(),
});

/** List a person on a sheet or folder with a level, change it, or take them off (logged). */
export async function setAccessGrant(raw: unknown): Promise<Result<{ level: GrantLevel | null }>> {
  const p = grantInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase }) => {
      const { error } = await supabase.rpc('set_access_grant', {
        p_kind: p.data.kind,
        p_target: p.data.targetId,
        p_user: p.data.userId,
        p_level: p.data.level,
      });
      return error ? fromDbError(error) : ok({ level: p.data.level });
    },
    'setAccessGrant',
  );
}

const fieldInput = z.object({
  org,
  fieldId: uuid,
  restricted: z.boolean(),
  userIds: z.array(uuid).max(500).default([]),
  roles: z
    .array(z.enum(['owner', 'admin', 'editor', 'viewer', 'auditor']))
    .max(5)
    .default([]),
});

/**
 * Mark a field Restricted with the people and roles who see its values (owners always do), change who, or lift it.
 * The database moves the values in or out of the restricted store and logs the change.
 */
export async function setFieldRestriction(
  raw: unknown,
): Promise<Result<{ restrictedTo: { userIds: string[]; roles: Role[] } | null }>> {
  const p = fieldInput.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase }) => {
      const { data, error } = await supabase.rpc('set_field_restriction', {
        p_field: p.data.fieldId,
        p_restricted: p.data.restricted,
        p_user_ids: p.data.restricted ? p.data.userIds : null,
        p_roles: p.data.restricted ? p.data.roles : null,
      });
      if (error) return fromDbError(error);
      return ok({ restrictedTo: (data as { userIds: string[]; roles: Role[] } | null) ?? null });
    },
    'setFieldRestriction',
  );
}

/**
 * The person's level on a sheet (commands that run automations as the system check it first: the runner uses the
 * service role, so the database's own checks do not see the person).
 */
export async function sheetLevel(db: Db, sheetId: string): Promise<AccessLevel> {
  const { data, error } = await db.rpc('sheet_access', { p_sheet: sheetId });
  if (error) return 'none';
  return toLevel(data);
}
