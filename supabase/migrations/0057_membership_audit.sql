-- 0057_membership_audit.sql · Every way into a workspace is logged; invites expire and need a confirmed address;
-- automation pauses only through the logged function (security review M4, SA-8).
--
-- Before: `memberships_audit` logged an INSERT only for auditors, so joining through an invite, and an admin inserting a
-- membership directly for any user id (a second account, as admin), left no entry (ISO 27001 A.5.18 access
-- provisioning). Editors could insert and delete `automation_pauses` rows directly, without `automation.paused`.
-- Invites never expired, and `accept_invite` trusted the session's email without asking whether it was confirmed.
--
-- Now:
-- 1. `member.added` is logged for every new membership, whoever adds it, with how: `invite` (and the invite's id and
--    who sent it) or `workspace` (the person who created the workspace).
-- 2. People join only through `accept_invite` or `create_workspace` (`app.member_op`); a direct insert by a person is
--    refused. The service role (seed, support) is not affected.
-- 3. `automation_pauses` has no write policy or grant for API roles: `set_automation_pause` (logged) is the only way.
-- 4. SA-8: invites carry `link_expires_at` (14 days from creation; open invites at the time of this migration get 14
--    days from now). `accept_invite` refuses an expired link (`invite expired`) and a session whose email address is
--    not confirmed. The auditor end date (`expires_at`) is unchanged.

create or replace function memberships_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(new.org_id, old.org_id); how jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' and new.role is not distinct from old.role and new.expires_at is not distinct from old.expires_at then
    return null;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from orgs where id = old.org_id) then return null; end if;
  if tg_op = 'INSERT' then
    how := jsonb_strip_nulls(jsonb_build_object(
      'via', nullif(current_setting('app.member_via', true), ''),
      'invite_id', nullif(current_setting('app.member_invite', true), ''),
      'invited_by', (select invited_by from invites where id::text = nullif(current_setting('app.member_invite', true), ''))));
  end if;
  insert into activity_log(org_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (o, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          'member.' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'removed' end,
          case when tg_op <> 'INSERT' then jsonb_build_object('user_id', old.user_id, 'role', old.role,
                                                             'expires_at', old.expires_at) end,
          case when tg_op <> 'DELETE' then jsonb_build_object('user_id', new.user_id, 'role', new.role,
                                                             'expires_at', new.expires_at) || how end,
          (select display_name from profiles where id = coalesce(new.user_id, old.user_id)));
  return null;
end $$;

-- people join only through an invite or by creating the workspace
create or replace function memberships_join_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if _is_person() and coalesce(current_setting('app.member_op', true), '') <> 'on' then
    raise exception using errcode = '42501', message = 'access: People join a workspace by accepting an invite.';
  end if;
  return new;
end $$;
create trigger memberships_join_guard before insert on memberships
  for each row execute function memberships_join_guard();
revoke execute on function memberships_join_guard() from public, anon, authenticated;

create or replace function create_workspace(p_name text, p_slug text, p_time_zone text default 'Europe/London')
returns orgs
language plpgsql security definer set search_path = public as $$
declare o orgs;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'profile required'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone;
  end if;
  insert into orgs(name, slug, time_zone) values (btrim(p_name), lower(p_slug), p_time_zone) returning * into o;
  perform set_config('app.member_op', 'on', true), set_config('app.member_via', 'workspace', true);
  insert into memberships(org_id, user_id, role) values (o.id, auth.uid(), 'owner');
  perform set_config('app.member_op', '', true), set_config('app.member_via', '', true);
  return o;
end $$;

-- SA-8: invite links expire
alter table invites add column if not exists link_expires_at timestamptz not null default now() + interval '14 days';
update invites set link_expires_at = now() + interval '14 days' where accepted_at is null;

create or replace function accept_invite(p_token text) returns orgs
language plpgsql security definer set search_path = public as $$
declare i invites; o orgs; jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'profile required'; end if;
  select * into i from invites where token = p_token for update;
  if i.id is null then raise exception 'invite not found'; end if;
  if i.accepted_at is not null then raise exception 'invite already used'; end if;
  if lower(i.email) <> jwt_email then raise exception 'invite is for another email address'; end if;
  if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null
                    and lower(u.email) = jwt_email) then
    raise exception using errcode = '42501',
      message = 'access: Confirm your email address, then open the invite link again.';
  end if;
  if i.link_expires_at <= now() then raise exception 'invite expired'; end if;
  if i.expires_at is not null and i.expires_at <= now() then raise exception 'invite expired'; end if;
  perform set_config('app.member_op', 'on', true), set_config('app.member_via', 'invite', true),
          set_config('app.member_invite', i.id::text, true);
  insert into memberships(org_id, user_id, role, expires_at) values (i.org_id, auth.uid(), i.role, i.expires_at)
    on conflict (org_id, user_id) do nothing;
  perform set_config('app.member_op', '', true), set_config('app.member_via', '', true),
          set_config('app.member_invite', '', true);
  update invites set accepted_at = now() where id = i.id;
  select * into o from orgs where id = i.org_id;
  return o;
end $$;

-- M4: automation pauses only through set_automation_pause (logged on the item's chain)
drop policy if exists automation_pauses_write on automation_pauses;
revoke insert, update, delete on automation_pauses from anon, authenticated;
