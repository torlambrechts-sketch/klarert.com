-- Fix: acting_user_id() crashed when request.jwt.claims was set to '' (vs
-- unset). The raw ::jsonb cast on an empty string raises "invalid input
-- syntax for type json". Supabase ships auth.jwt() / auth.uid() that already
-- handle null/empty correctly — use them.
--
-- Also drop klarert.current_org_id() — it was created in the first migration
-- but never referenced by any policy (klarert_private.user_org_ids replaced
-- it). Keeping it would carry the same empty-string bug.

drop function klarert.current_org_id();

create or replace function klarert_private.acting_user_id() returns uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select case
    when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then null
    else auth.uid()
  end;
$$;

revoke all on function klarert_private.acting_user_id() from public, anon;
grant execute on function klarert_private.acting_user_id() to authenticated, service_role;
