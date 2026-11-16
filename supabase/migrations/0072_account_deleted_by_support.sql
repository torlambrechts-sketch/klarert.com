-- 0072_account_deleted_by_support.sql · A user deleted in the Supabase dashboard is cleaned up as Delete my account
-- does (owner decision 16 Nov 2026, docs/09 §12).
--
-- Before: deleting a user in the dashboard (Authentication › Users › Delete user, or the Admin API) removed only the
-- `auth.users` row (0071 dropped `profiles_id_fkey`). The profile kept the person's name and every membership stayed,
-- so the workspace listed a member who could never sign in again.
--
-- Now:
-- 1. `_account_close(user, by_support)` is the one clean-up both paths run: every membership goes (logged by
--    `memberships_audit` as `member.removed` with `how`), the profile is renamed "Former member" with initials "?" and
--    `deleted_at` is set. Internal: not executable by any API role.
-- 2. `delete_my_account()` calls it (`by_support` false) and keeps refusing the only owner of a workspace and a session
--    that is not two-step for a person with an authenticator app. Behaviour unchanged.
-- 3. `auth_users_account_closed` (BEFORE DELETE on `auth.users`, function `auth_users_close_account()`) calls it with
--    `by_support` true for a user whose profile is not yet marked deleted. When `delete_my_account` deletes the auth
--    user it has already set `deleted_at`, so the trigger does nothing. A user with no profile is left alone.
-- 4. The dashboard path cannot ask anyone, so it does not refuse the only owner: the workspace is left without an owner.
--    `memberships_guard` lets this one operation through (`app.member_op = 'account_deleted_by_support'` together with
--    `app.member_op_user` naming the person, both transaction-local and set only by `_account_close`), skipping both the
--    owner check and the at-least-one-owner check for that person's memberships only. `memberships_audit` logs
--    `how: account deleted by support` and, whenever a removal leaves a workspace with no owner, `ownerless: true`.
-- The activity log is not touched beyond the new `member.removed` entries.

-- 1. the shared clean-up
create or replace function _account_close(p_user uuid, p_by_support boolean) returns int
language plpgsql security definer set search_path = public as $$
declare removed int := 0;
begin
  perform set_config('app.member_op',
                     case when p_by_support then 'account_deleted_by_support' else 'account_deleted' end, true);
  perform set_config('app.member_op_user', p_user::text, true);
  delete from memberships where user_id = p_user;
  get diagnostics removed = row_count;
  perform set_config('app.member_op', '', true);
  perform set_config('app.member_op_user', '', true);

  update profiles set display_name = 'Former member', initials = '?', deleted_at = coalesce(deleted_at, now())
   where id = p_user and (deleted_at is null or display_name <> 'Former member' or initials <> '?');
  return removed;
end $$;
revoke all on function _account_close(uuid, boolean) from public, anon, authenticated, service_role;

-- 2. Delete my account, through the shared clean-up
create or replace function delete_my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); only_owner text[]; removed int := 0;
begin
  if me is null then raise exception using errcode = '42501', message = 'not signed in'; end if;
  -- one call at a time per person (a double click, a retry while the first still runs)
  perform pg_advisory_xact_lock(hashtextextended('delete_my_account:' || me::text, 0));

  select array_agg(o.name order by o.name) into only_owner
    from memberships m join orgs o on o.id = m.org_id
   where m.user_id = me and m.role = 'owner'
     and not exists (select 1 from memberships x where x.org_id = m.org_id and x.role = 'owner' and x.user_id <> me);
  if only_owner is not null then
    raise exception using errcode = 'P0001',
      message = format('account: You are the only owner of %s. Make someone else owner of each, or delete it, first.',
                       array_to_string(only_owner, ', ')),
      detail = to_jsonb(only_owner)::text;
  end if;

  -- a person with an authenticator app deletes their account from a two-step session only (as _aal_ok, 0063)
  if exists (select 1 from auth.mfa_factors f where f.user_id = me and f.status = 'verified')
     and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'access: Enter the code from your authenticator app first, then try again.';
  end if;

  removed := _account_close(me, false);

  -- the profile is marked deleted now, so auth_users_close_account does nothing
  delete from auth.users where id = me;
  return jsonb_build_object('memberships_removed', removed);
end $$;
revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;

-- 3. a user deleted in the dashboard (or through the Admin API)
create or replace function auth_users_close_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = old.id and deleted_at is null) then
    -- the same lock as delete_my_account: never both at once for one person
    perform pg_advisory_xact_lock(hashtextextended('delete_my_account:' || old.id::text, 0));
    if exists (select 1 from profiles where id = old.id and deleted_at is null) then
      perform _account_close(old.id, true);
    end if;
  end if;
  return old;
end $$;
revoke all on function auth_users_close_account() from public, anon, authenticated, service_role;

drop trigger if exists auth_users_account_closed on auth.users;
create trigger auth_users_account_closed before delete on auth.users
  for each row execute function public.auth_users_close_account();

-- 4. 0071's owner protection, plus: support's clean-up removes the person's memberships without either owner check
create or replace function memberships_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(old.org_id, new.org_id);
begin
  if coalesce(auth.role(), '') = 'service_role' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and (not exists (select 1 from orgs where id = old.org_id)
                           or not exists (select 1 from profiles where id = old.user_id)) then
    return old;
  end if;
  -- a user deleted in the dashboard: the workspace may be left without an owner (docs/09 §12), logged as such
  if tg_op = 'DELETE'
     and coalesce(current_setting('app.member_op', true), '') = 'account_deleted_by_support'
     and coalesce(current_setting('app.member_op_user', true), '') = old.user_id::text then
    return old;
  end if;
  if (tg_op = 'INSERT' and new.role = 'owner')
     or (tg_op = 'UPDATE' and (new.role = 'owner') is distinct from (old.role = 'owner'))
     or (tg_op = 'DELETE' and old.role = 'owner') then
    -- allowed without being an owner: create_workspace adding the first owner of a brand-new workspace,
    -- and accept_invite adding the person an owner invited as owner
    if not (tg_op = 'INSERT' and not exists (select 1 from memberships where org_id = o))
       and not (tg_op = 'INSERT' and new.user_id = auth.uid() and exists (
                  select 1 from invites i where i.org_id = o and i.role = 'owner' and i.accepted_at is null
                     and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))))
       and not (tg_op = 'DELETE' and old.user_id = auth.uid()
                and coalesce(current_setting('app.member_op', true), '') = 'account_deleted')
       and not has_role(o, array['owner']::member_role[]) then
      raise exception 'only an owner can change who owns the workspace';
    end if;
  end if;
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    if not exists (select 1 from memberships m where m.org_id = o and m.role = 'owner' and m.user_id <> old.user_id) then
      raise exception 'a workspace needs at least one owner';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function memberships_guard() from public, anon, authenticated;

-- 0071's membership log, plus support's deletion and a workspace left without an owner
create or replace function memberships_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(new.org_id, old.org_id); how jsonb := '{}'::jsonb;
        op text := coalesce(current_setting('app.member_op', true), '');
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
  elsif tg_op = 'DELETE' then
    how := jsonb_strip_nulls(jsonb_build_object(
      'how', case op when 'account_deleted' then 'account deleted'
                     when 'account_deleted_by_support' then 'account deleted by support' end,
      'ownerless', case when old.role = 'owner'
                         and not exists (select 1 from memberships m where m.org_id = o and m.role = 'owner')
                        then true end));
  end if;
  insert into activity_log(org_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (o, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          'member.' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'removed' end,
          case when tg_op <> 'INSERT' then jsonb_build_object('user_id', old.user_id, 'role', old.role,
                                                             'expires_at', old.expires_at) end,
          case when tg_op <> 'DELETE' then jsonb_build_object('user_id', new.user_id, 'role', new.role,
                                                             'expires_at', new.expires_at) || how
               when how <> '{}'::jsonb then how end,
          (select display_name from profiles where id = coalesce(new.user_id, old.user_id)));
  return null;
end $$;
revoke execute on function memberships_audit() from public, anon, authenticated;
