-- 0071_delete_account.sql · Delete my account: the person's own sign-in goes, a nameless profile stays as a tombstone
-- (owner decision 15 Nov 2026, option a; docs/02 §18, docs/09 §12).
--
-- Before: `profiles.id` referenced `auth.users(id) on delete cascade`, and 23 columns reference `profiles(id)` with no
-- delete rule (`items.created_by`, `item_updates.author_id`, `files.uploaded_by` …). Deleting the auth user either
-- failed for anyone who ever made something, or would have deleted the profile instead of anonymising it.
--
-- Now:
-- 1. `profiles_id_fkey` is dropped: a profile outlives its auth user. `profiles.deleted_at` marks the tombstone.
-- 2. `automations.acts_as` references `profiles(id)` instead of `auth.users(id) on delete set null`: deleting the auth
--    user no longer rewrites automations (that update would run `automations_targets_guard` as the leaving person).
--    The runner already stops an automation whose person is no longer a member (0052), and names them as the
--    profile now does: "Former member".
-- 3. `delete_my_account()` (granted to `authenticated` only) acts on `auth.uid()` alone. It refuses the only owner of
--    a workspace (naming each, in the message and as a JSON array in the detail), asks for a two-step (aal2) session
--    when the person has a verified authenticator app, removes every membership (`member.removed`, with
--    `how: account deleted`, through `memberships_audit`), anonymises the profile ("Former member", initials "?"),
--    marks it deleted and deletes the auth user (identities, sessions and factors go by Supabase Auth's own cascades).
--    Idempotent: a retry with a token still valid finds nothing left to do and succeeds.
-- 4. A deleted profile joins nothing and is not changed by a person again: `memberships_join_guard` refuses it and the
--    `profiles_self` policy no longer matches it (an access token lives up to an hour after the auth user is gone).
-- The activity log is not touched: no foreign key on `actor_id`, and member names in `member.*` notes stay in clear
-- (owner decision 15 Nov 2026, docs/02 §18).

alter table profiles add column if not exists deleted_at timestamptz;
alter table profiles drop constraint if exists profiles_id_fkey;

alter table automations drop constraint if exists automations_acts_as_fkey;
alter table automations add constraint automations_acts_as_fkey foreign key (acts_as) references profiles(id) not valid;
alter table automations validate constraint automations_acts_as_fkey;

-- a deleted profile cannot be renamed by a token that outlives its auth user
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for update using (id = auth.uid() and deleted_at is null)
  with check (id = auth.uid() and deleted_at is null);

-- people join only through an invite or by creating the workspace (0057), and never with a deleted profile
create or replace function memberships_join_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if _is_person() and coalesce(current_setting('app.member_op', true), '') <> 'on' then
    raise exception using errcode = '42501', message = 'access: People join a workspace by accepting an invite.';
  end if;
  if exists (select 1 from profiles where id = new.user_id and deleted_at is not null) then
    raise exception using errcode = '42501', message = 'access: This account has been deleted.';
  end if;
  return new;
end $$;
revoke execute on function memberships_join_guard() from public, anon, authenticated;

-- 0004's owner protection, plus: the person leaving through delete_my_account removes their own owner membership
-- without the owner check (a workspace that requires two-step sign-in answers has_role no for a session without it);
-- a workspace still keeps at least one owner.
create or replace function memberships_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(old.org_id, new.org_id);
begin
  if coalesce(auth.role(), '') = 'service_role' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and (not exists (select 1 from orgs where id = old.org_id)
                           or not exists (select 1 from profiles where id = old.user_id)) then
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

-- 0057's membership log, plus how a membership ended when the person deleted their account
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
                                                             'expires_at', new.expires_at) || how
               when coalesce(current_setting('app.member_op', true), '') = 'account_deleted'
                 then jsonb_build_object('how', 'account deleted') end,
          (select display_name from profiles where id = coalesce(new.user_id, old.user_id)));
  return null;
end $$;
revoke execute on function memberships_audit() from public, anon, authenticated;

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

  perform set_config('app.member_op', 'account_deleted', true);
  delete from memberships where user_id = me;
  get diagnostics removed = row_count;
  perform set_config('app.member_op', '', true);

  update profiles set display_name = 'Former member', initials = '?', deleted_at = coalesce(deleted_at, now())
   where id = me and (deleted_at is null or display_name <> 'Former member' or initials <> '?');

  delete from auth.users where id = me;
  return jsonb_build_object('memberships_removed', removed);
end $$;
revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
