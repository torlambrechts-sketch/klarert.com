-- 0078_demo_purge.sql · Retired copies of the demo workspace can be purged (docs/17 The live demo, owner decision
-- 17 Nov 2026). The live demo is rebuilt every night: `pnpm seed:demo` with DEMO_RESET=1 renames yesterday's copy
-- aside and builds a new one. Without a purge the retired copies pile up, one a night, because the activity log is
-- append-only. This adds the one way to delete them, for retired demo copies only.
--
-- 1. `orgs.settings.demo` marks a demo workspace. Only the seed sets it (service role). `orgs_demo_flag_guard`
--    (BEFORE INSERT OR UPDATE on orgs) refuses any API session (anon, authenticated) that adds, changes or removes it,
--    so no customer, not even an owner through `orgs_admin`, can mark a workspace purgeable or unmark the demo.
-- 2. `purge_demo_workspace(p_org)` deletes a workspace and everything in it, inside the `app.purge_org` escape hatch
--    that the append-only triggers already honour (activity_log, restricted_activity, personal_activity,
--    workflow_decisions, restricted values; 0001, 0027, 0036, 0040, 0059, 0068). It refuses a workspace that is not
--    marked `settings.demo = true`, and one that still has members (the live demo always has; a retired copy has none,
--    the seed removes them when it renames it aside), so it can never take the live demo or a customer's workspace.
--    `orgs_publisher_guard` (0076) still applies. Executable by service_role only: never anon or authenticated (0008).
--    Stored files are not deleted here (Storage refuses SQL deletes): the seed removes the copy's objects through the
--    Storage API first (scripts/demo/purge.ts).
-- 3. `activity_0_purge` (BEFORE INSERT on activity_log, named to run before `activity_a_mask` and `activity_chain`):
--    while a workspace is being purged, the audit triggers of the rows the cascade deletes (audit_schema,
--    memberships_audit, views_form_deleted …) would write new entries for that very workspace, which fails on the
--    foreign key. Inside the purge of that workspace only, such an entry is dropped instead. Every other insert is
--    untouched, and the purge of one workspace never drops an entry of another.

-- ───────────────────────── 1. the demo flag ─────────────────────────
create or replace function orgs_demo_flag_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.settings -> 'demo') is distinct from (case when tg_op = 'UPDATE' then old.settings -> 'demo' end)
     and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception using errcode = '42501',
      message = 'access: Only the demo seed marks a demo workspace.';
  end if;
  return new;
end $$;
revoke all on function orgs_demo_flag_guard() from public, anon, authenticated, service_role;
drop trigger if exists orgs_demo_flag_guard on orgs;
create trigger orgs_demo_flag_guard before insert or update on orgs
  for each row execute function orgs_demo_flag_guard();

-- ───────────────────────── 3. entries for a workspace being purged ─────────────────────────
create or replace function _purge_skip_activity() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.purge_org', true), '') = new.org_id::text then return null; end if;
  return new;
end $$;
revoke all on function _purge_skip_activity() from public, anon, authenticated, service_role;
drop trigger if exists activity_0_purge on activity_log;
create trigger activity_0_purge before insert on activity_log
  for each row execute function _purge_skip_activity();

-- ───────────────────────── 2. the purge ─────────────────────────
create or replace function purge_demo_workspace(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; n_items bigint; n_log bigint; n_files bigint;
begin
  -- the grants keep API roles out; this says so again in case a grant is ever widened by mistake
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception using errcode = '42501', message = 'access: Only the demo seed purges a demo workspace.';
  end if;
  if p_org is null then raise exception 'bad input'; end if;
  select id, slug, name, settings into o from orgs where id = p_org for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No such workspace.';
  end if;
  if coalesce(o.settings -> 'demo', 'false'::jsonb) <> 'true'::jsonb then
    raise exception using errcode = '42501',
      message = format('Workspace /%s is not a demo copy: it is never purged.', o.slug);
  end if;
  if exists (select 1 from memberships m where m.org_id = p_org) then
    raise exception using errcode = '55000',
      message = format('Demo workspace /%s still has members: retire it first (DEMO_RESET=1).', o.slug);
  end if;

  select count(*) into n_items from items where org_id = p_org;
  select count(*) into n_log from activity_log where org_id = p_org;
  select count(*) into n_files from files where org_id = p_org;

  perform set_config('app.purge_org', p_org::text, true);
  delete from orgs where id = p_org;
  perform set_config('app.purge_org', '', true);

  return jsonb_build_object('slug', o.slug, 'name', o.name, 'items', n_items, 'activity', n_log, 'files', n_files);
end $$;
revoke all on function purge_demo_workspace(uuid) from public, anon, authenticated;
grant execute on function purge_demo_workspace(uuid) to service_role;
