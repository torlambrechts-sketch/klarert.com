-- 0073_reserved_slugs.sql · The app's own page names cannot be workspace addresses (owner decision, 16 Nov 2026).
--
-- A workspace lives at `/{slug}`, so a workspace called `account` or `privacy` would sit behind that page.
-- 1. `_reserved_slugs()` is the list: the top-level route segments under `src/app` and what Next.js serves at the top
--    level. It must equal `RESERVED_SLUGS` in `src/lib/reserved-slugs.ts` (a unit test compares them). Internal: not
--    executable by any API role.
-- 2. `workspace_slug_available` says false for a reserved address; `create_workspace` refuses one
--    ("workspace address reserved", shown as "That address is reserved. Try another.").
-- 3. `orgs_slug_reserved` (BEFORE INSERT OR UPDATE OF slug on `orgs`) refuses a new workspace or a changed address
--    that is reserved, so neither an RPC nor a direct update by an admin (`orgs_admin`) can take one.
-- Existing workspaces are left alone: a row whose address does not change is never refused.

-- 1. the list
create or replace function _reserved_slugs() returns text[]
language sql immutable set search_path = public as $$
  select array['_next', 'account', 'account-deleted', 'api', 'auth', 'f', 'favicon.ico', 'invite', 'login',
               'onboarding', 'opengraph-image', 'poster', 'privacy', 'robots.txt', 'sitemap.xml', 'terms']::text[]
$$;
revoke all on function _reserved_slugs() from public, anon, authenticated, service_role;

-- 2. availability and creation
create or replace function workspace_slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select not (lower(btrim(p_slug)) = any (_reserved_slugs()))
     and not exists (select 1 from orgs where slug = lower(p_slug))
$$;

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
  if lower(btrim(p_slug)) = any (_reserved_slugs()) then
    raise exception using errcode = '23514', message = 'workspace address reserved';
  end if;
  insert into orgs(name, slug, time_zone) values (btrim(p_name), lower(p_slug), p_time_zone) returning * into o;
  perform set_config('app.member_op', 'on', true), set_config('app.member_via', 'workspace', true);
  insert into memberships(org_id, user_id, role) values (o.id, auth.uid(), 'owner');
  perform set_config('app.member_op', '', true), set_config('app.member_via', '', true);
  return o;
end $$;
-- `create or replace` keeps the grants both functions have (0004: `authenticated` only)

-- 3. any other way to set an address
create or replace function orgs_slug_reserved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.slug is distinct from old.slug)
     and lower(btrim(new.slug)) = any (_reserved_slugs()) then
    raise exception using errcode = '23514', message = 'workspace address reserved';
  end if;
  return new;
end $$;
revoke all on function orgs_slug_reserved() from public, anon, authenticated, service_role;
drop trigger if exists orgs_slug_reserved on orgs;
create trigger orgs_slug_reserved before insert or update of slug on orgs
  for each row execute function orgs_slug_reserved();
