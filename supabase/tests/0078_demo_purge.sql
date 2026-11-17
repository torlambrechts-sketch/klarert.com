-- Purging retired copies of the demo workspace (0078_demo_purge.sql; docs/17 The live demo, owner decision
-- 17 Nov 2026): only the service role purges, only a workspace marked settings.demo = true, only once it has no
-- members; no API session can set or clear the mark; the purge removes the copy with its activity log and leaves
-- every other workspace's log as it was. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(22);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000078001', 'purge-owner@a.test', now());
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000078001', 'Pat Owner', 'PO');
insert into orgs (id, name, slug, settings) values
  ('78000000-0000-0000-0000-00000000000a', 'Normal Works', 'pgtap-purge-normal', '{}'),
  ('78000000-0000-0000-0000-00000000000b', 'Demo copy', 'pgtap-purge-demo', '{"demo": true}'),
  ('78000000-0000-0000-0000-00000000000c', 'Live demo', 'pgtap-purge-live', '{"demo": true}');
insert into memberships (org_id, user_id, role) values
  ('78000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000078001', 'owner'),
  ('78000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000078001', 'owner');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('78100000-0000-0000-0000-00000000000a', '78000000-0000-0000-0000-00000000000a', 'Risks', 'R-', 'a0'),
  ('78100000-0000-0000-0000-00000000000b', '78000000-0000-0000-0000-00000000000b', 'Risks', 'R-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('78200000-0000-0000-0000-00000000000a', '78000000-0000-0000-0000-00000000000a', '78100000-0000-0000-0000-00000000000a', 'Open', 'a0'),
  ('78200000-0000-0000-0000-00000000000b', '78000000-0000-0000-0000-00000000000b', '78100000-0000-0000-0000-00000000000b', 'Open', 'a0');
select _create_item('78100000-0000-0000-0000-00000000000a', '78200000-0000-0000-0000-00000000000a', 'Kept risk', 'a0', '{}', 'system', null);
select _create_item('78100000-0000-0000-0000-00000000000b', '78200000-0000-0000-0000-00000000000b', 'Demo risk', 'a0', '{}', 'system', null);
select _create_item('78100000-0000-0000-0000-00000000000b', '78200000-0000-0000-0000-00000000000b', 'Demo risk 2', 'a1', '{}', 'system', null);

create temporary table before_log as
  select org_id, count(*) n, max(id) last_id from activity_log
   where org_id in ('78000000-0000-0000-0000-00000000000a', '78000000-0000-0000-0000-00000000000b') group by org_id;

-- grants: the service role only
select is(has_function_privilege('anon', 'purge_demo_workspace(uuid)', 'execute'), false, 'anon cannot purge');
select is(has_function_privilege('authenticated', 'purge_demo_workspace(uuid)', 'execute'), false,
  'authenticated cannot purge');
select is(has_function_privilege('service_role', 'purge_demo_workspace(uuid)', 'execute'), true,
  'the service role can');
select is(has_function_privilege('authenticated', '_purge_skip_activity()', 'execute'), false,
  'the log helper is nobody''s');
select is(has_function_privilege('service_role', 'orgs_demo_flag_guard()', 'execute'), false,
  'nor is the flag guard');

-- an owner cannot mark a workspace as a demo copy, or unmark the demo, through orgs_admin
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000078001","email":"purge-owner@a.test","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$ update orgs set settings = settings || '{"demo": true}' where id = '78000000-0000-0000-0000-00000000000a' $$,
  '42501', 'access: Only the demo seed marks a demo workspace.', 'an owner cannot mark their workspace as a demo');
select throws_ok($$ update orgs set settings = settings - 'demo' where id = '78000000-0000-0000-0000-00000000000c' $$,
  '42501', 'access: Only the demo seed marks a demo workspace.', 'nor clear the mark of a demo workspace');
select lives_ok($$ update orgs set name = 'Live demo, renamed' where id = '78000000-0000-0000-0000-00000000000c' $$,
  'other changes to a demo workspace stay as they were');
select throws_ok($$ select purge_demo_workspace('78000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'a signed-in person cannot purge');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select purge_demo_workspace('78000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'nor can anon');
reset role;

-- the service role
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ update orgs set settings = settings || '{"demo": true}' where id = '78000000-0000-0000-0000-00000000000b' $$,
  'the seed (service role) marks a demo workspace');
select throws_ok($$ select purge_demo_workspace('78000000-0000-0000-0000-00000000000a') $$,
  '42501', 'Workspace /pgtap-purge-normal is not a demo copy: it is never purged.', 'a normal workspace is refused');
select throws_ok($$ select purge_demo_workspace('78000000-0000-0000-0000-00000000000c') $$,
  '55000', 'Demo workspace /pgtap-purge-live still has members: retire it first (DEMO_RESET=1).',
  'a demo workspace with members (the live one) is refused');
select throws_ok($$ select purge_demo_workspace('78000000-0000-0000-0000-0000000000ff') $$,
  'P0002', 'No such workspace.', 'an unknown workspace is refused');
select is((purge_demo_workspace('78000000-0000-0000-0000-00000000000b') ->> 'items')::int, 2,
  'a retired demo copy is purged');
reset role;

select is((select count(*)::int from orgs where id = '78000000-0000-0000-0000-00000000000b'), 0, 'the copy is gone');
select is((select count(*)::int from activity_log where org_id = '78000000-0000-0000-0000-00000000000b'), 0,
  'with its activity log');
select is((select count(*)::int from items where org_id = '78000000-0000-0000-0000-00000000000b'), 0,
  'and its items');
select is((select count(*)::int from orgs where id in ('78000000-0000-0000-0000-00000000000a', '78000000-0000-0000-0000-00000000000c')),
  2, 'the normal workspace and the live demo stay');
select is((select count(*)::int from activity_log where org_id = '78000000-0000-0000-0000-00000000000a'),
  (select n::int from before_log where org_id = '78000000-0000-0000-0000-00000000000a'),
  'the normal workspace''s log is untouched');

-- outside a purge the log is append-only as before, and an entry is written as before
select throws_ok($$ delete from activity_log where org_id = '78000000-0000-0000-0000-00000000000a' $$,
  'P0001', 'activity_log is append-only', 'the log stays append-only');
select _create_item('78100000-0000-0000-0000-00000000000a', '78200000-0000-0000-0000-00000000000a', 'Another risk', 'a1', '{}', 'system', null);
select ok((select count(*) from activity_log where org_id = '78000000-0000-0000-0000-00000000000a')
            > (select n from before_log where org_id = '78000000-0000-0000-0000-00000000000a'),
  'and new entries are still written');

select * from finish();
rollback;
