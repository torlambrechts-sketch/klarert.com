import 'server-only';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';
import {
  entityInput,
  entityRef,
  jobRoleInput,
  jobRoleRef,
  siteInput,
  siteRef,
  teamInput,
  teamMemberInput,
  teamRef,
} from '@/lib/schemas/workspace';

// Teams, job roles, entities and sites: admin-only workspace structure (docs/01 §4, RLS *_admin policies).

const deleted = (
  error: { message: string } | null,
  count: number | null,
  what: string,
): Result<null> =>
  error ? fromDbError(error) : count ? ok(null) : fail('not_found', `${what} not found.`);

export async function createTeam(input: unknown): Promise<Result<{ id: string }>> {
  const p = teamInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('teams')
        .insert({ org_id: orgId, name: p.data.name })
        .select('id')
        .single();
      return error ? fromDbError(error) : ok({ id: data.id });
    },
    'createTeam',
  );
}

export async function deleteTeam(input: unknown): Promise<Result<null>> {
  const p = teamRef.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error, count } = await supabase
        .from('teams')
        .delete({ count: 'exact' })
        .eq('id', p.data.teamId)
        .eq('org_id', orgId);
      return deleted(error, count, 'Team');
    },
    'deleteTeam',
  );
}

export async function addTeamMember(input: unknown): Promise<Result<null>> {
  const p = teamMemberInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error } = await supabase
        .from('team_members')
        .insert({ org_id: orgId, team_id: p.data.teamId, user_id: p.data.userId });
      if (error && /team_members_pkey/.test(error.message))
        return fail('conflict', 'Already in this team.');
      return error ? fromDbError(error) : ok(null);
    },
    'addTeamMember',
  );
}

export async function removeTeamMember(input: unknown): Promise<Result<null>> {
  const p = teamMemberInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error, count } = await supabase
        .from('team_members')
        .delete({ count: 'exact' })
        .eq('org_id', orgId)
        .eq('team_id', p.data.teamId)
        .eq('user_id', p.data.userId);
      return deleted(error, count, 'Team member');
    },
    'removeTeamMember',
  );
}

export async function createJobRole(input: unknown): Promise<Result<{ id: string }>> {
  const p = jobRoleInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('job_roles')
        .insert({ org_id: orgId, name: p.data.name })
        .select('id')
        .single();
      return error ? fromDbError(error) : ok({ id: data.id });
    },
    'createJobRole',
  );
}

export async function deleteJobRole(input: unknown): Promise<Result<null>> {
  const p = jobRoleRef.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error, count } = await supabase
        .from('job_roles')
        .delete({ count: 'exact' })
        .eq('id', p.data.jobRoleId)
        .eq('org_id', orgId);
      return deleted(error, count, 'Job role');
    },
    'deleteJobRole',
  );
}

export async function createEntity(input: unknown): Promise<Result<{ id: string }>> {
  const p = entityInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('entities')
        .insert({ org_id: orgId, name: p.data.name, country: p.data.country })
        .select('id')
        .single();
      return error ? fromDbError(error) : ok({ id: data.id });
    },
    'createEntity',
  );
}

export async function deleteEntity(input: unknown): Promise<Result<null>> {
  const p = entityRef.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error, count } = await supabase
        .from('entities')
        .delete({ count: 'exact' })
        .eq('id', p.data.entityId)
        .eq('org_id', orgId);
      return deleted(error, count, 'Entity');
    },
    'deleteEntity',
  );
}

export async function createSite(input: unknown): Promise<Result<{ id: string }>> {
  const p = siteInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('sites')
        .insert({ org_id: orgId, entity_id: p.data.entityId, name: p.data.name })
        .select('id')
        .single();
      return error ? fromDbError(error) : ok({ id: data.id });
    },
    'createSite',
  );
}

export async function deleteSite(input: unknown): Promise<Result<null>> {
  const p = siteRef.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error, count } = await supabase
        .from('sites')
        .delete({ count: 'exact' })
        .eq('id', p.data.siteId)
        .eq('org_id', orgId);
      return deleted(error, count, 'Site');
    },
    'deleteSite',
  );
}
