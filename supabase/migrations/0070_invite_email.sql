-- 0070_invite_email.sql · Invites are sent by email; admins resend them, rate-limited; every step of an invite is on
-- the workspace chain (board review A4, docs/09 §10).
--
-- Before: creating and revoking an invite left no entry (only accepting one did, `member.added` with the invite id,
-- 0057), and an admin sent the link by hand.
--
-- Now:
-- 1. `invites_audit` logs `invite.created` and `invite.revoked` (an open invite deleted) on the workspace chain
--    (`sheet:<org_id>`), with the invite id, the role and the dates. Never the address: the log is append-only and the
--    address is personal data; the invite id links the entry to the `member.added` entry when the person joins.
-- 2. `resend_invite(invite)`: owners and admins of the invite's workspace send an open invite again. At most one resend
--    every 10 minutes and at most 5 per invite (docs/09 §10). It counts the resend, logs `invite.resent` and returns
--    what the email needs. It refuses a used invite and one whose link (or auditor access) has ended. The email is sent
--    by the server command after this returns; the database never sees the message.

alter table invites add column if not exists resend_count int not null default 0;
alter table invites add column if not exists resent_at timestamptz;

create or replace function invites_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and (old.accepted_at is not null or not exists (select 1 from orgs where id = old.org_id)) then
    return null;
  end if;
  insert into activity_log(org_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
  values (coalesce(new.org_id, old.org_id), '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          case tg_op when 'INSERT' then 'invite.created' else 'invite.revoked' end,
          case when tg_op = 'DELETE' then jsonb_build_object('invite_id', old.id, 'role', old.role) end,
          case when tg_op = 'INSERT' then jsonb_strip_nulls(jsonb_build_object(
            'invite_id', new.id, 'role', new.role, 'expires_at', new.expires_at,
            'link_expires_at', new.link_expires_at)) end);
  return null;
end $$;
create trigger invites_audit after insert or delete on invites
  for each row execute function invites_audit();
revoke execute on function invites_audit() from public, anon, authenticated;

create or replace function resend_invite(p_invite uuid)
returns table (invite_id uuid, email text, role member_role, token text, link_expires_at timestamptz,
               expires_at timestamptz, resend_count int, org_name text, time_zone text, invited_by_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare i invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into i from invites where id = p_invite for update;
  if i.id is null or not is_admin(i.org_id) then raise exception 'invite not found'; end if;
  if i.accepted_at is not null then raise exception 'invite already used'; end if;
  if i.link_expires_at <= now() or (i.expires_at is not null and i.expires_at <= now()) then
    raise exception 'invite resend: link expired';
  end if;
  if i.resend_count >= 5 then raise exception 'invite resend: limit reached'; end if;
  if i.resent_at is not null and i.resent_at > now() - interval '10 minutes' then
    raise exception 'invite resend: too soon';
  end if;
  update invites set resend_count = invites.resend_count + 1, resent_at = now() where id = i.id
    returning * into i;
  insert into activity_log(org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (i.org_id, '', 'user', auth.uid(), 'invite.resent',
          jsonb_build_object('invite_id', i.id, 'role', i.role, 'resend', i.resend_count,
                             'link_expires_at', i.link_expires_at));
  return query
    select i.id, i.email, i.role, i.token, i.link_expires_at, i.expires_at, i.resend_count, o.name, o.time_zone,
           p.display_name
      from orgs o left join profiles p on p.id = i.invited_by
     where o.id = i.org_id;
end $$;
revoke all on function resend_invite(uuid) from public, anon;
grant execute on function resend_invite(uuid) to authenticated;
