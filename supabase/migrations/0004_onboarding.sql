-- 0004_onboarding.sql · first sign-in, workspace creation, invites, owner protection (M1)
-- 0001 has no path for a signed-in person to create their profile, a workspace or accept an invite.
-- Those writes cross the admin-only RLS on memberships, so they are SECURITY DEFINER functions with explicit checks.

-- ───────────────────────── profiles ─────────────────────────
-- A person creates their own profile on first sign-in.
create policy profiles_insert_self on profiles for insert with check (id = auth.uid());

-- ───────────────────────── workspaces ─────────────────────────
create or replace function create_workspace(p_name text, p_slug text, p_time_zone text default 'Europe/London')
returns orgs language plpgsql security definer set search_path = public as $$
declare o orgs;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'profile required'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'unknown time zone %', p_time_zone;
  end if;
  insert into orgs(name, slug, time_zone) values (btrim(p_name), lower(p_slug), p_time_zone) returning * into o;
  insert into memberships(org_id, user_id, role) values (o.id, auth.uid(), 'owner');
  return o;
end $$;

-- slug availability for the onboarding form, without exposing other workspaces
create or replace function workspace_slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from orgs where slug = lower(p_slug))
$$;

-- ───────────────────────── invites ─────────────────────────
-- Admins create invites through the invites_admin policy (0001); the token link is copied and sent by the admin.
create unique index invites_open_email_idx on invites(org_id, lower(email)) where accepted_at is null;

-- The invite page shows who invited you to what before you accept. Token-gated; no listing.
create or replace function get_invite(p_token text)
returns table (org_name text, org_slug text, email text, role member_role, invited_by_name text, accepted boolean)
language sql stable security definer set search_path = public as $$
  select o.name, o.slug, i.email, i.role, p.display_name, i.accepted_at is not null
    from invites i join orgs o on o.id = i.org_id left join profiles p on p.id = i.invited_by
   where i.token = p_token and auth.uid() is not null
$$;

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
  insert into memberships(org_id, user_id, role) values (i.org_id, auth.uid(), i.role)
    on conflict (org_id, user_id) do nothing;
  update invites set accepted_at = now() where id = i.id;
  select * into o from orgs where id = i.org_id;
  return o;
end $$;

-- ───────────────────────── owner protection ─────────────────────────
-- docs/01 §4: only owners transfer ownership; a workspace always keeps at least one owner.
-- Cascades from deleting the workspace or the person are allowed.
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
create trigger memberships_guard_biud before insert or update or delete on memberships
  for each row execute function memberships_guard();

-- only owners may invite someone as owner
create or replace function invites_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'owner' and coalesce(auth.role(), '') <> 'service_role'
     and not has_role(new.org_id, array['owner']::member_role[]) then
    raise exception 'only an owner can invite an owner';
  end if;
  return new;
end $$;
create trigger invites_guard_biu before insert or update of role on invites
  for each row execute function invites_guard();

-- team members and sites must belong to the same workspace as their team and entity
create or replace function same_org_guard() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'team_members' then
    if not exists (select 1 from teams t where t.id = new.team_id and t.org_id = new.org_id)
       or not exists (select 1 from memberships m where m.user_id = new.user_id and m.org_id = new.org_id) then
      raise exception 'team member must be a member of the team''s workspace';
    end if;
  elsif tg_table_name = 'sites' then
    if not exists (select 1 from entities e where e.id = new.entity_id and e.org_id = new.org_id) then
      raise exception 'site must belong to an entity in the same workspace';
    end if;
  end if;
  return new;
end $$;
create trigger team_members_same_org before insert or update on team_members
  for each row execute function same_org_guard();
create trigger sites_same_org before insert or update on sites
  for each row execute function same_org_guard();

-- ───────────────────────── grants ─────────────────────────
revoke all on function create_workspace, workspace_slug_available, get_invite, accept_invite from public;
grant execute on function create_workspace, workspace_slug_available, get_invite, accept_invite to authenticated;
