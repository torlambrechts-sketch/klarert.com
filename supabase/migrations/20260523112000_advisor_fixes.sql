-- Apply Supabase advisor findings against 20260523110000_core_primitives_and_audit:
--
-- 1. user_org_ids(uuid) → user_org_ids() (no parameter; uses auth.uid()
--    internally). Removes the "pass any user's uuid" attack surface.
-- 2. Revoke EXECUTE on klarert.user_org_ids and klarert.audit_trigger from
--    anon and public. Default privileges previously auto-granted EXECUTE to
--    anon for every new klarert function; revoke that default too.
-- 3. Recreate the four RLS policies to reject anonymous-sign-in JWTs
--    (auth.jwt() ->> 'is_anonymous'). Anonymous flows route through separate
--    schemas/tables — never these.
-- 4. Add the missing covering index on organizations.created_by.

set search_path = klarert, public;

-- 1. Replace user_org_ids signature
drop policy organizations_select_member on klarert.organizations;
drop policy profiles_select_same_org on klarert.profiles;
drop policy profiles_update_self on klarert.profiles;
drop policy audit_log_select_same_org on klarert.audit_log;

drop function klarert.user_org_ids(uuid);

create or replace function klarert.user_org_ids() returns setof uuid
language sql
stable
security definer
set search_path = klarert, pg_temp
as $$
  select organization_id from klarert.profiles where id = auth.uid();
$$;

comment on function klarert.user_org_ids is
  'Organization ids the calling user is a profile member of. SECURITY DEFINER to break RLS recursion. No parameter — only ever returns the calling user''s memberships.';

-- 2. Tighten EXECUTE privileges
revoke all on function klarert.user_org_ids() from public, anon, authenticated;
grant execute on function klarert.user_org_ids() to authenticated, service_role;

revoke all on function klarert.audit_trigger() from public, anon, authenticated;
-- Trigger functions are invoked by the trigger system; no role grant required.

-- Stop the schema's default privileges from auto-granting EXECUTE to anon on
-- every future function in klarert.
alter default privileges in schema klarert
  revoke execute on functions from anon;

-- 3. Recreate policies with anonymous-JWT guard + no-arg user_org_ids()
create policy organizations_select_member
  on klarert.organizations for select to authenticated
  using (
    (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false
    and id in (select klarert.user_org_ids())
  );

create policy profiles_select_same_org
  on klarert.profiles for select to authenticated
  using (
    (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false
    and organization_id in (select klarert.user_org_ids())
  );

create policy profiles_update_self
  on klarert.profiles for update to authenticated
  using (
    (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false
    and id = (select auth.uid())
  )
  with check (
    (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false
    and id = (select auth.uid())
  );

create policy audit_log_select_same_org
  on klarert.audit_log for select to authenticated
  using (
    (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) = false
    and organization_id in (select klarert.user_org_ids())
  );

-- 4. Covering index for organizations.created_by FK
create index organizations_created_by_idx on klarert.organizations (created_by);
