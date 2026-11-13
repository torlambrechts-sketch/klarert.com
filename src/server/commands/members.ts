import 'server-only';
import { endDateOk, endOfDayIn } from '@/engine/access';
import { todayIn } from '@/engine/sheet-data';
import { env } from '@/lib/env';
import { fromDbError, invalid, ok, fail, type Result } from '@/server/result';
import { withOrg } from './context';
import {
  changeRoleInput,
  createInviteInput,
  removeMemberInput,
  revokeInviteInput,
} from '@/lib/schemas/workspace';

export async function createInvite(input: unknown): Promise<Result<{ link: string }>> {
  const parsed = createInviteInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { org, email, role, expiresOn } = parsed.data;
  return withOrg(
    org,
    'admin',
    async ({ supabase, user, orgId, role: myRole }) => {
      if (role === 'owner' && myRole !== 'owner')
        return fail('forbidden', 'Only an owner can invite an owner.');
      const expires = await auditorEnd(supabase, orgId, role, expiresOn);
      if (!expires.ok) return expires;
      const { data, error } = await supabase
        .from('invites')
        .insert({ org_id: orgId, email, role, invited_by: user.id, expires_at: expires.data })
        .select('token')
        .single();
      if (error) return fromDbError(error);
      return ok({ link: `${env.NEXT_PUBLIC_APP_URL}/invite/${data.token}` });
    },
    'createInvite',
  );
}

export async function revokeInvite(input: unknown): Promise<Result<null>> {
  const parsed = revokeInviteInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withOrg(
    parsed.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error, count } = await supabase
        .from('invites')
        .delete({ count: 'exact' })
        .eq('id', parsed.data.inviteId)
        .eq('org_id', orgId)
        .is('accepted_at', null);
      if (error) return fromDbError(error);
      return count ? ok(null) : fail('not_found', 'Invite not found.');
    },
    'revokeInvite',
  );
}

export async function changeRole(input: unknown): Promise<Result<null>> {
  const parsed = changeRoleInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withOrg(
    parsed.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const expires = await auditorEnd(supabase, orgId, parsed.data.role, parsed.data.expiresOn);
      if (!expires.ok) return expires;
      // only auditors have an end date (docs/02 §16); changing the role or the date is logged by the database
      const { error, count } = await supabase
        .from('memberships')
        .update({ role: parsed.data.role, expires_at: expires.data }, { count: 'exact' })
        .eq('org_id', orgId)
        .eq('user_id', parsed.data.userId);
      if (error) return fromDbError(error);
      return count ? ok(null) : fail('not_found', 'Member not found.');
    },
    'changeRole',
  );
}

export async function removeMember(input: unknown): Promise<Result<null>> {
  const parsed = removeMemberInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withOrg(
    parsed.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { error, count } = await supabase
        .from('memberships')
        .delete({ count: 'exact' })
        .eq('org_id', orgId)
        .eq('user_id', parsed.data.userId);
      if (error) return fromDbError(error);
      if (!count) return fail('not_found', 'Member not found.');
      // team memberships go with the workspace membership
      const { error: teamError } = await supabase
        .from('team_members')
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', parsed.data.userId);
      return teamError ? fromDbError(teamError) : ok(null);
    },
    'removeMember',
  );
}

/** An auditor's end date as the end of that day in the workspace's time zone; null for every other role. */
async function auditorEnd(
  db: Parameters<Parameters<typeof withOrg>[2]>[0]['supabase'],
  orgId: string,
  role: string,
  expiresOn: string | undefined,
): Promise<Result<string | null>> {
  if (role !== 'auditor') return ok(null);
  if (!expiresOn) return fail('invalid', "Choose the day an auditor's access ends.");
  const { data } = await db.from('orgs').select('time_zone').eq('id', orgId).maybeSingle();
  const tz = data?.time_zone ?? 'Europe/London';
  if (!endDateOk(expiresOn, todayIn(new Date(), tz)))
    return fail('invalid', 'Choose a day from today on.', {
      expiresOn: 'Choose a day from today on.',
    });
  return ok(endOfDayIn(expiresOn, tz));
}
