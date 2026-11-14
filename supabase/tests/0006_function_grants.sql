-- Least-privilege EXECUTE (0008). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

select ok(not has_function_privilege('anon', '_create_item(uuid, uuid, text, text, jsonb, text, uuid)', 'execute'),
  'signed-out visitors cannot call _create_item');
select ok(not has_function_privilege('authenticated', '_create_item(uuid, uuid, text, text, jsonb, text, uuid)', 'execute'),
  'signed-in people cannot call _create_item directly');
select ok(not has_function_privilege('anon', 'submit_public_form(text, text, text, jsonb, text, text, boolean)', 'execute')
       and has_function_privilege('service_role', 'submit_public_form(text, text, text, jsonb, text, text, boolean)', 'execute'),
  'public form submits go only through the route (service role), so the IP hash cannot be forged');
select ok(has_function_privilege('authenticated', 'create_item(uuid, uuid, text, text, jsonb, uuid, text, uuid)', 'execute'),
  'signed-in people still call create_item (0046: with how it was added), which checks permissions');
select bag_eq(
  $$ select p.proname::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'execute') $$,
  $$ values ('get_public_form'), ('is_member'), ('has_role'), ('is_editor'), ('is_admin'), ('can_write'),
            ('actor_kind_for'), ('activity_hash'), ('field_types'), ('non_value_types') $$,
  'signed-out visitors can run only public forms and the read-only helpers RLS uses');

create function public.pgtap_new_fn() returns int language sql as $$ select 1 $$;
select ok(not has_function_privilege('authenticated', 'public.pgtap_new_fn()', 'execute'),
  'new functions are not executable by API roles until granted');

select * from finish();
rollback;
