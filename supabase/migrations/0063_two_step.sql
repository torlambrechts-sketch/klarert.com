-- 0063_two_step.sql · Two-step sign-in is enforced by the database, not only by the app's server.
--
-- The app (branch claude/security-app) adds two-step sign-in (TOTP) and a workspace setting
-- `orgs.settings.requireTwoStep`. Until now only withOrg / requireMember checked it, so someone holding only a password
-- could still read the workspace's data straight through PostgREST.
--
-- Now:
-- 1. `_aal_ok(org)`: the session may use the workspace's data when it is two-step (`aal2` in the JWT), or when the
--    person has no verified factor **and** the workspace does not require two-step sign-in. A person who has set up a
--    factor must use it everywhere.
-- 2. `is_member`, `has_role` (so `is_admin`, `is_editor`) and `_sheet_levels` (so `readable_sheet_ids`,
--    `editable_sheet_ids`, `_sheet_level_for`, `_need_sheet` …) answer no for the signed-in person when `_aal_ok` is
--    false: every policy and definer function built on them refuses data. `_sheet_levels` for someone else (who to
--    notify, approvers) is unchanged.
-- 3. Still readable without it, so the app can tell the person to set up or enter their code: the workspaces the
--    person belongs to (`orgs`, through `belongs_to`) and their own memberships. Notifications now also need membership.
-- 4. `set_require_two_step(org, on)`: owners only, in a two-step session; writes the setting and logs
--    `workspace.two_step_changed` on the workspace chain. `orgs_security_guard` refuses any other change to
--    `settings.requireTwoStep` (direct updates included); the service role may still change it (lockout recovery).
-- 5. `orgs` changes (name, slug, time zone, settings) are logged as `workspace.updated` on the workspace chain.
-- 6. `member_two_step(org)`: owners and admins see which members use two-step sign-in (for the Members list).

create or replace function _aal_ok(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
          and coalesce((select settings ->> 'requireTwoStep' from orgs where id = o), '') <> 'true')
$$;
revoke execute on function _aal_ok(uuid) from public, anon, authenticated;

-- membership whatever the session's strength: only for reading the workspace itself and one's own membership
create or replace function belongs_to(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = o and m.user_id = auth.uid()
                   and (m.expires_at is null or m.expires_at > now()))
$$;
revoke execute on function belongs_to(uuid) from public, anon;
grant execute on function belongs_to(uuid) to authenticated;

create or replace function is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = o and m.user_id = auth.uid()
                   and (m.expires_at is null or m.expires_at > now()))
     and _aal_ok(o)
$$;

create or replace function has_role(o uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = o and m.user_id = auth.uid() and m.role = any(roles)
                   and (m.expires_at is null or m.expires_at > now()))
     and _aal_ok(o)
$$;

create or replace function _sheet_levels(p_user uuid, p_sheet uuid default null)
returns table (sheet_id uuid, org_id uuid, level text, restricted boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_id,
         case
           when m.role = 'owner' then 'owner'
           when not e.restricted then case when m.role in ('admin', 'editor') then 'editor' else 'viewer' end
           when g.level is null then 'none'
           when m.role in ('viewer', 'auditor') then 'viewer'
           else g.level
         end,
         e.restricted
    from sheets s
    join memberships m on m.org_id = s.org_id and m.user_id = p_user
                      and (m.expires_at is null or m.expires_at > now())
                      -- the signed-in person's own session must meet the workspace's sign-in rule (0063)
                      and (p_user is distinct from auth.uid() or _aal_ok(s.org_id))
    left join sheets p on p.id = s.parent_sheet_id
    cross join lateral (select coalesce(p.id, s.id) as sid,
                               case when p.id is null then s.folder_id else p.folder_id end as fid,
                               coalesce(p.access_inherit, s.access_inherit) as inherit,
                               coalesce(p.restricted, s.restricted) as own) b
    left join folders f on f.id = b.fid
    cross join lateral (select case when b.inherit then coalesce(f.restricted, false) else b.own end as restricted) e
    left join access_grants g on g.user_id = p_user
         and ((b.inherit and g.folder_id = b.fid) or (not b.inherit and g.sheet_id = b.sid))
   where p_user is not null and (p_sheet is null or s.id = p_sheet)
$$;

-- 3. the workspace and one's own membership stay readable, so the app can ask for the code or a setup
drop policy if exists orgs_read on orgs;
create policy orgs_read on orgs for select to authenticated using (belongs_to(id));
drop policy if exists memberships_read on memberships;
create policy memberships_read on memberships for select to authenticated using (
  (user_id = auth.uid() and (expires_at is null or expires_at > now())) or is_member(org_id));
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select using (
  user_id = auth.uid() and is_member(org_id)
  and (item_id is null or exists (select 1 from items i where i.id = notifications.item_id)));

-- 4. the setting
create or replace function orgs_security_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.settings -> 'requireTwoStep') is distinct from (new.settings -> 'requireTwoStep')
     and coalesce(current_setting('app.two_step_op', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'access: Change two-step sign-in for the workspace in Workspace admin › Security.';
  end if;
  return new;
end $$;
create trigger orgs_security_guard before update on orgs for each row execute function orgs_security_guard();

create or replace function set_require_two_step(p_org uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare was jsonb;
begin
  if p_org is null or p_on is null then raise exception 'bad input'; end if;
  if not exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'owner'
                   and (m.expires_at is null or m.expires_at > now())) then
    raise exception using errcode = '42501', message = 'access: Only owners change two-step sign-in.';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'access: Sign in with your two-step code first, then change this.';
  end if;
  select settings -> 'requireTwoStep' into was from orgs where id = p_org for update;
  if coalesce(was, 'false'::jsonb) = to_jsonb(p_on) then return p_on; end if;
  perform set_config('app.two_step_op', 'on', true);
  update orgs set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{requireTwoStep}', to_jsonb(p_on))
   where id = p_org;
  perform set_config('app.two_step_op', '', true);
  insert into activity_log(org_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
  values (p_org, '', 'user', auth.uid(), 'workspace.two_step_changed',
          jsonb_build_object('requireTwoStep', coalesce(was, 'false'::jsonb)),
          jsonb_build_object('requireTwoStep', p_on));
  return p_on;
end $$;
revoke execute on function set_require_two_step(uuid, boolean) from public, anon;
grant execute on function set_require_two_step(uuid, boolean) to authenticated;

-- 5. every other change to a workspace's row is logged
create or replace function orgs_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb;
begin
  if coalesce(current_setting('app.two_step_op', true), '') = 'on' then return null; end if;
  select coalesce(jsonb_object_agg(k, to_jsonb(old) -> k), '{}'::jsonb), coalesce(jsonb_object_agg(k, to_jsonb(new) -> k), '{}'::jsonb)
    into o, n
    from unnest(array['name', 'slug', 'time_zone', 'settings']) k
   where to_jsonb(old) -> k is distinct from to_jsonb(new) -> k;
  if n = '{}'::jsonb then return null; end if;
  insert into activity_log(org_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
  values (new.id, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(), 'workspace.updated', o, n);
  return null;
end $$;
create trigger orgs_audit after update on orgs for each row execute function orgs_audit();
revoke execute on function orgs_security_guard(), orgs_audit() from public, anon, authenticated;

-- 6. who uses two-step sign-in (owners and admins)
create or replace function member_two_step(p_org uuid) returns table (user_id uuid, two_step boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin(p_org) then raise exception 'not allowed'; end if;
  return query
    select m.user_id, exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified')
      from memberships m where m.org_id = p_org and (m.expires_at is null or m.expires_at > now())
     order by m.user_id;
end $$;
revoke execute on function member_two_step(uuid) from public, anon;
grant execute on function member_two_step(uuid) to authenticated;
