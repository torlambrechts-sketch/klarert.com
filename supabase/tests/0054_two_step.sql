-- Two-step sign-in is enforced by the database (0063). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(17);

-- Tia has set up a factor; Nia has none; Ada is an admin with a factor
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000099001', 'two-tia@a.test'),
  ('00000000-0000-0000-0000-000000099002', 'two-nia@a.test'),
  ('00000000-0000-0000-0000-000000099003', 'two-ada@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000099001', 'Tia Owner', 'TO'),
  ('00000000-0000-0000-0000-000000099002', 'Nia Editor', 'NE'),
  ('00000000-0000-0000-0000-000000099003', 'Ada Admin', 'AA');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000099001', 'Phone', 'totp', 'verified', now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000099003', 'Phone', 'totp', 'verified', now(), now());
-- A does not require two-step sign-in; R does
insert into orgs (id, name, slug, settings) values
  ('99000000-0000-0000-0000-00000000000a', 'Two-step A', 'pgtap-twostep-a', '{}'),
  ('99000000-0000-0000-0000-00000000000b', 'Two-step R', 'pgtap-twostep-r', '{"requireTwoStep": true}');
insert into memberships (org_id, user_id, role) values
  ('99000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099001', 'owner'),
  ('99000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099002', 'editor'),
  ('99000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099003', 'admin'),
  ('99000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000099001', 'owner'),
  ('99000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000099002', 'editor');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('99000001-0000-0000-0000-00000000000a', '99000000-0000-0000-0000-00000000000a', 'Risks A', 'RA-', 'a0'),
  ('99000001-0000-0000-0000-00000000000b', '99000000-0000-0000-0000-00000000000b', 'Risks R', 'RR-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('99000003-0000-0000-0000-00000000000a', '99000000-0000-0000-0000-00000000000a', '99000001-0000-0000-0000-00000000000a', 'All', 'a0'),
  ('99000003-0000-0000-0000-00000000000b', '99000000-0000-0000-0000-00000000000b', '99000001-0000-0000-0000-00000000000b', 'All', 'a0');
insert into items (org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('99000000-0000-0000-0000-00000000000a', '99000001-0000-0000-0000-00000000000a', '99000003-0000-0000-0000-00000000000a', 1, 'RA-001', 'Fire', 'a0'),
  ('99000000-0000-0000-0000-00000000000b', '99000001-0000-0000-0000-00000000000b', '99000003-0000-0000-0000-00000000000b', 1, 'RR-001', 'Flood', 'a0');

create function pg_temp.as_user(u text, aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009900' || u,
                    'role', 'authenticated', 'aal', aal)::text, true);
$$;
grant execute on function pg_temp.as_user(text, text) to authenticated;
create function pg_temp.seen() returns text language sql as $$
  select concat_ws(' ', 'sheets=' || (select count(*) from sheets where id::text like '99000001%'),
                        'items=' || (select count(*) from items where display_id in ('RA-001', 'RR-001')),
                        'orgs=' || (select count(*) from orgs where slug like 'pgtap-twostep-%'),
                        'own=' || (select count(*) from memberships where user_id = auth.uid()))
$$;
grant execute on function pg_temp.seen() to authenticated;
set local role authenticated;

-- a person with a factor, signed in with the password only
select pg_temp.as_user('1', 'aal1');
select is(pg_temp.seen(), 'sheets=0 items=0 orgs=2 own=2',
  'with a factor set up, a password-only session reads no sheet or item, only its workspaces and memberships');
select ok(not is_member('99000000-0000-0000-0000-00000000000a'), 'and is not treated as a member for data');
select is((select count(*)::int from memberships where org_id = '99000000-0000-0000-0000-00000000000a'), 1,
  'it reads only its own membership, not the other members');
select pg_temp.as_user('1', 'aal2');
select is(pg_temp.seen(), 'sheets=2 items=2 orgs=2 own=2', 'the same person with the two-step code reads everything');

-- a person with no factor
select pg_temp.as_user('2', 'aal1');
select is((select count(*)::int from items where display_id = 'RA-001'), 1,
  'no factor, workspace not requiring it: reads as before');
select is((select count(*)::int from items where display_id = 'RR-001'), 0,
  'no factor, workspace requiring it: no data');
select is((select count(*)::int from sheets where id = '99000001-0000-0000-0000-00000000000b'), 0, 'not even sheet names');
select is((select count(*)::int from orgs where slug = 'pgtap-twostep-r'), 1,
  'but the workspace itself stays readable, so the app can ask for a setup');
select ok((select settings ->> 'requireTwoStep' = 'true' from orgs where slug = 'pgtap-twostep-r'),
  'with its two-step setting');
select is((select count(*)::int from memberships where org_id = '99000000-0000-0000-0000-00000000000b'), 1,
  'and her own membership');
select throws_ok($$ select create_item('99000001-0000-0000-0000-00000000000b', '99000003-0000-0000-0000-00000000000b',
                                       'Sneak', 'a1') $$, null, null, 'nor can she write there');

-- set_require_two_step
select pg_temp.as_user('3', 'aal2');
select throws_ok($$ select set_require_two_step('99000000-0000-0000-0000-00000000000a', true) $$,
  '42501', 'access: Only owners change two-step sign-in.', 'an admin cannot change it');
select pg_temp.as_user('1', 'aal1');
select throws_ok($$ select set_require_two_step('99000000-0000-0000-0000-00000000000a', true) $$,
  '42501', 'access: Sign in with your two-step code first, then change this.',
  'an owner signed in with the password only cannot change it');
select pg_temp.as_user('1', 'aal2');
select throws_ok($$ update orgs set settings = settings || '{"requireTwoStep": false}'
                    where id = '99000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'the setting cannot be changed by a direct update');
select lives_ok($$ select set_require_two_step('99000000-0000-0000-0000-00000000000a', true) $$,
  'a two-step owner turns it on');
select is((select count(*)::int from activity_log where org_id = '99000000-0000-0000-0000-00000000000a'
            and action = 'workspace.two_step_changed' and new_value ->> 'requireTwoStep' = 'true'), 1,
  'and the change is logged on the workspace chain');
select is((select array_agg(two_step order by user_id) from member_two_step('99000000-0000-0000-0000-00000000000a')),
  array[true, false, true], 'owners and admins see who uses two-step sign-in');
reset role;

select * from finish();
rollback;
