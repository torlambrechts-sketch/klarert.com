-- Round-3 advisor cleanup: re-introduce an explicit auth.jwt() ->> 'is_anonymous'
-- check in each policy expression.
--
-- klarert_private.acting_user_id() and klarert_private.user_org_ids() already
-- return null/empty for anonymous sessions — but the auth_allow_anonymous_sign_ins
-- lint scans policy text and cannot see through the helper. Putting the check
-- inline (wrapped in select to stay init-plan-safe) satisfies both the lint
-- and defense-in-depth.

drop policy organizations_select_member on klarert.organizations;
drop policy profiles_select_same_org on klarert.profiles;
drop policy profiles_update_self on klarert.profiles;
drop policy audit_log_select_same_org on klarert.audit_log;

create policy organizations_select_member
  on klarert.organizations for select to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and id in (select klarert_private.user_org_ids())
  );

create policy profiles_select_same_org
  on klarert.profiles for select to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
  );

create policy profiles_update_self
  on klarert.profiles for update to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and id = (select klarert_private.acting_user_id())
  )
  with check (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and id = (select klarert_private.acting_user_id())
  );

create policy audit_log_select_same_org
  on klarert.audit_log for select to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
  );
