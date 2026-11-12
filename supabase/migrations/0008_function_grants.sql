-- 0008_function_grants.sql · least-privilege EXECUTE on SECURITY DEFINER functions
-- Supabase grants EXECUTE on new public functions to anon and authenticated by default, and `revoke … from public`
-- (0001) does not remove those role grants. _create_item has no permission checks of its own (callers check), so
-- anyone, even signed out, could create items in any sheet. Close it, and stop granting by default from now on.

revoke execute on function _create_item(uuid, uuid, text, text, jsonb, text, uuid) from anon, authenticated;

-- Signed-out visitors may submit public forms and evaluate the read-only helpers RLS policies call
-- (is_member, has_role …, which answer false without a session). Every other function needs a session.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.prorettype <> 'trigger'::regtype
              and p.proname not in ('submit_form', 'is_member', 'has_role', 'is_editor', 'is_admin', 'can_write',
                                    'actor_kind_for', 'activity_hash', 'field_types', 'non_value_types') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
grant execute on function _create_item(uuid, uuid, text, text, jsonb, text, uuid) to service_role;

-- New functions are no longer executable by everyone: each migration grants EXECUTE explicitly.
-- (functions get EXECUTE for PUBLIC from a database-wide default, and for the API roles from Supabase's
-- per-schema defaults on the postgres role that runs migrations)
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
