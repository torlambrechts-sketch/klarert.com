-- Round-2 advisor cleanup: move RLS helper functions into a private schema
-- (klarert_private) that is NOT listed under Supabase's exposed schemas, so
-- the functions cannot be reached via /rest/v1/rpc/* but can still be called
-- from RLS policy expressions and from server-side code.
--
-- Also: push the anonymous-JWT and auth.uid() checks INTO the helpers, so
-- policies stay trivial (no auth.<fn> references that re-evaluate per row).

create schema if not exists klarert_private;
revoke all on schema klarert_private from public;
grant usage on schema klarert_private to authenticated, service_role;

comment on schema klarert_private is
  'Internal helpers for klarert.com. NOT exposed via PostgREST; do not add this schema to db.schemas in the API settings.';

-- =============================================================================
-- acting_user_id: auth.uid() when the JWT is a real user; null for anonymous
-- sessions or when no JWT is present. Use this anywhere a policy needs "the
-- calling human" — it short-circuits both the anon-JWT and no-JWT cases.
-- =============================================================================

create or replace function klarert_private.acting_user_id() returns uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select case
    when coalesce(
      (current_setting('request.jwt.claims', true)::jsonb ->> 'is_anonymous')::boolean,
      false
    ) then null
    else nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  end;
$$;

revoke all on function klarert_private.acting_user_id() from public, anon;
grant execute on function klarert_private.acting_user_id() to authenticated, service_role;

comment on function klarert_private.acting_user_id is
  'Returns auth.uid() for non-anonymous authenticated sessions; null otherwise. Centralises the anonymous-JWT guard so RLS policies do not have to repeat it.';

-- =============================================================================
-- user_org_ids: orgs the acting user is a profile member of. Returns empty
-- for anonymous sessions (acting_user_id() = null).
-- =============================================================================

create or replace function klarert_private.user_org_ids() returns setof uuid
language sql
stable
security definer
set search_path = klarert, pg_temp
as $$
  select organization_id from klarert.profiles
  where id = klarert_private.acting_user_id();
$$;

revoke all on function klarert_private.user_org_ids() from public, anon;
grant execute on function klarert_private.user_org_ids() to authenticated, service_role;

comment on function klarert_private.user_org_ids is
  'Organization ids the calling user is a profile member of. Empty set for anonymous sessions. SECURITY DEFINER to bypass RLS on profiles.';

-- =============================================================================
-- Recreate policies using only the private helpers. Policies no longer
-- reference auth.<fn> directly, so auth_rls_initplan should clear; the
-- functions live in a non-exposed schema, so security_definer RPC warnings
-- on user_org_ids should clear too.
-- =============================================================================

drop policy organizations_select_member on klarert.organizations;
drop policy profiles_select_same_org on klarert.profiles;
drop policy profiles_update_self on klarert.profiles;
drop policy audit_log_select_same_org on klarert.audit_log;

create policy organizations_select_member
  on klarert.organizations for select to authenticated
  using (id in (select klarert_private.user_org_ids()));

create policy profiles_select_same_org
  on klarert.profiles for select to authenticated
  using (organization_id in (select klarert_private.user_org_ids()));

create policy profiles_update_self
  on klarert.profiles for update to authenticated
  using (id = (select klarert_private.acting_user_id()))
  with check (id = (select klarert_private.acting_user_id()));

create policy audit_log_select_same_org
  on klarert.audit_log for select to authenticated
  using (organization_id in (select klarert_private.user_org_ids()));

-- =============================================================================
-- Drop the now-unused public-schema helper.
-- =============================================================================

drop function klarert.user_org_ids();
