-- Writes come only through the app's server commands (0053, SA-3). PostgREST runs api_request_guard() before every
-- request; here we set the request settings it reads and call it as PostgREST would. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

-- a secret for this test when the database has none yet (rolled back)
select case when _command_secret() is null
            then vault.create_secret('pgtap-command-secret', 'klarert_command_secret') end;

create function pg_temp.req(method text, path text, proof text, uid text default '00000000-0000-0000-0000-0000000c0001')
returns void language sql as $$
  select set_config('request.method', method, true), set_config('request.path', path, true),
         set_config('request.headers', case when proof is null then '{}' else json_build_object('x-klarert-command', proof)::text end, true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.req(text, text, text, text) to authenticated, anon, service_role;
-- the proof the server would send (computed with the database's secret, as postgres)
create temp table proofs as
  select 'good' as k, format('t=%s,v1=%s', extract(epoch from now())::bigint,
                             _command_proof(extract(epoch from now())::bigint, '00000000-0000-0000-0000-0000000c0001')) as v
  union all
  select 'other', format('t=%s,v1=%s', extract(epoch from now())::bigint,
                         _command_proof(extract(epoch from now())::bigint, '00000000-0000-0000-0000-0000000c0002'))
  union all
  select 'old', format('t=%s,v1=%s', extract(epoch from now())::bigint - 600,
                       _command_proof(extract(epoch from now())::bigint - 600, '00000000-0000-0000-0000-0000000c0001'));
grant select on proofs to authenticated, anon;

select ok(exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                   where r.rolname = 'authenticator' and 'pgrst.db_pre_request=public.api_request_guard' = any (s.setconfig)),
  'PostgREST runs api_request_guard before every request');

set local role authenticated;
select pg_temp.req('POST', '/rpc/set_item_values', null);
select throws_ok('select api_request_guard()', '42501', 'access: Changes are made in the app, not through the API.',
  'a signed-in person cannot call a write RPC directly (skipping validation, status rules and automations)');
select pg_temp.req('POST', '/rpc/create_item', null);
select throws_ok('select api_request_guard()', '42501', null, 'nor create items directly');
select pg_temp.req('PATCH', '/fields', null);
select throws_ok('select api_request_guard()', '42501', null, 'nor change structure tables directly');
select pg_temp.req('POST', '/automations', null);
select throws_ok('select api_request_guard()', '42501', null, 'nor insert automations directly');
select pg_temp.req('POST', '/rpc/set_item_values', (select v from proofs where k = 'other'));
select throws_ok('select api_request_guard()', '42501', null, 'a proof made for someone else is refused');
select pg_temp.req('POST', '/rpc/set_item_values', (select v from proofs where k = 'old'));
select throws_ok('select api_request_guard()', '42501', null, 'an old proof is refused');
select pg_temp.req('POST', '/rpc/set_item_values', 't=1,v1=' || repeat('0', 64));
select throws_ok('select api_request_guard()', '42501', null, 'a made-up proof is refused');
select pg_temp.req('POST', '/rpc/set_item_values', (select v from proofs where k = 'good'));
select lives_ok('select api_request_guard()', 'the server''s proof for this person lets the command write');
select pg_temp.req('GET', '/items', null);
select lives_ok('select api_request_guard()', 'reads need no proof');
select pg_temp.req('POST', '/rpc/sheet_levels', null);
select lives_ok('select api_request_guard()', 'nor read-only functions');
reset role;

set local role anon;
select pg_temp.req('POST', '/rpc/get_public_form', null, '');
select lives_ok('select api_request_guard()', 'the public form page still reads its form');
reset role;

set local role service_role;
select pg_temp.req('POST', '/rpc/submit_public_form', null, '');
select lives_ok('select api_request_guard()', 'the service role (public form route, scheduler, runner) is not gated');
reset role;

-- the read functions people call from the browser or for reads stay non-volatile, so the gate lets them through
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and provolatile = 'v'
            and proname in ('form_stats', 'item_update_summaries', 'sheet_levels', 'my_sheet_access', 'sheet_access',
                            'get_public_form', 'verify_activity_chain', 'filter_item_ids', 'items_for_people',
                            'sheet_access_info', 'folder_access_info', 'design_health', 'get_invite',
                            'workspace_slug_available', 'pack_member_emails', 'folder_hidden_sheet_count')), 0,
  'read functions are stable');

select * from finish();
rollback;
