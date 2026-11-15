import 'server-only';
import { endDateOk, endOfDayIn } from '@/engine/access';
import { todayIn } from '@/engine/sheet-data';
import { env } from '@/lib/env';
import { canSendEmail, inviteEmail, sendEmail } from '@/server/email';
import { emailDate } from '@/server/email/templates';
import { fromDbError, invalid, ok, fail, type Result } from '@/server/result';
import { withOrg } from './context';
import {
  changeRoleInput,
  createInviteInput,
  INVITE_EMAIL_NOT_SENT,
  removeMemberInput,
  resendInviteInput,
  revokeInviteInput,
} from '@/lib/schemas/workspace';

const inviteLink = (token: string) => `${env.NEXT_PUBLIC_APP_URL}/invite/${token}`;

export type InviteCreated = {
  link: string;
  email: string;
  /** Whether the invite email went out; when not, the admin copies the link (INVITE_EMAIL_NOT_SENT). */
  emailSent: boolean;
  /** The day the link stops working, as 29 Nov 2026 in the workspace's time zone. */
  linkExpiresOn: string;
};

/**
 * Create an invite and email it (board review A4, docs/09 §10). The email is sent by the server after the admin is
 * authorised; it needs no database privilege. When it cannot be sent the invite still exists and the result says so.
 */
export async function createInvite(input: unknown): Promise<Result<InviteCreated>> {
  const parsed = createInviteInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { org, email, role, expiresOn } = parsed.data;
  return withOrg(
    org,
    'admin',
    async ({ supabase, user, profile, orgId, role: myRole }) => {
      if (role === 'owner' && myRole !== 'owner')
        return fail('forbidden', 'Only an owner can invite an owner.');
      const expires = await auditorEnd(supabase, orgId, role, expiresOn);
      if (!expires.ok) return expires;
      const { data, error } = await supabase
        .from('invites')
        .insert({ org_id: orgId, email, role, invited_by: user.id, expires_at: expires.data })
        .select('id, token, link_expires_at')
        .single();
      if (error) return fromDbError(error);
      const { data: ws } = await supabase
        .from('orgs')
        .select('name, time_zone')
        .eq('id', orgId)
        .maybeSingle();
      const timeZone = ws?.time_zone ?? 'Europe/London';
      const link = inviteLink(data.token);
      const content = inviteEmail({
        workspace: ws?.name ?? org,
        inviter: profile?.display_name ?? '',
        role,
        email,
        link,
        linkExpiresAt: data.link_expires_at,
        accessEndsAt: expires.data,
        timeZone,
      });
      const mail = await sendEmail({
        to: email,
        ...content,
        tag: 'invite',
        idempotencyKey: `invite/${data.id}`,
      });
      return ok({
        link,
        email,
        emailSent: mail.sent,
        linkExpiresOn: emailDate(data.link_expires_at, timeZone),
      });
    },
    'createInvite',
  );
}

/**
 * Send an open invite again (owners and admins). `resend_invite` (0070) refuses a used or ended invite, allows one
 * resend every 10 minutes and 5 per invite, counts it and logs `invite.resent` on the workspace chain. Without an
 * email transport nothing is counted: the admin copies the link instead.
 */
export async function resendInvite(input: unknown): Promise<Result<{ emailSent: boolean }>> {
  const parsed = resendInviteInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return withOrg(
    parsed.data.org,
    'admin',
    async ({ supabase, profile, orgId }) => {
      if (!canSendEmail()) return fail('failed', INVITE_EMAIL_NOT_SENT);
      // the invite must be this workspace's (the function checks the caller is an admin of the invite's workspace)
      const { data: mine } = await supabase
        .from('invites')
        .select('id')
        .eq('id', parsed.data.inviteId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!mine) return fail('not_found', 'Invite not found.');
      const { data, error } = await supabase.rpc('resend_invite', {
        p_invite: parsed.data.inviteId,
      });
      if (error) return fromDbError(error);
      const row = data?.[0];
      if (!row) return fail('not_found', 'Invite not found.');
      const content = inviteEmail({
        workspace: row.org_name,
        inviter: row.invited_by_name ?? profile?.display_name ?? '',
        role: row.role,
        email: row.email,
        link: inviteLink(row.token),
        linkExpiresAt: row.link_expires_at,
        accessEndsAt: row.expires_at,
        timeZone: row.time_zone,
      });
      const mail = await sendEmail({
        to: row.email,
        ...content,
        tag: 'invite_resend',
        idempotencyKey: `invite/${row.invite_id}/resend/${row.resend_count}`,
      });
      return ok({ emailSent: mail.sent });
    },
    'resendInvite',
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
