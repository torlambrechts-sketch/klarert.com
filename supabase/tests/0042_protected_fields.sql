-- Protected fields: the list is for owners and admins, values only through set_protected_value (0051, H2).
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f0001', 'pro-admin@a.test'),
  ('00000000-0000-0000-0000-0000000f0002', 'pro-eve@a.test'),
  ('00000000-0000-0000-0000-0000000f0003', 'pro-lee@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000f0001', 'Ada Admin', 'AA'),
  ('00000000-0000-0000-0000-0000000f0002', 'Eve Editor', 'EE'),
  ('00000000-0000-0000-0000-0000000f0003', 'Lee Listed', 'LL');
insert into orgs (id, name, slug) values ('f0000000-0000-0000-0000-00000000000a', 'Protected A', 'pgtap-protected-a');
insert into memberships (org_id, user_id, role) values
  ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000f0001', 'owner'),
  ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000f0002', 'editor'),
  ('f0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000f0003', 'editor');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('f0000001-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'Systems', 'SYS-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('f0000003-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'f0000001-0000-0000-0000-000000000001', 'All', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('f0000004-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'f0000001-0000-0000-0000-000000000001',
   'root_password', 'Root password', 'protected', 'a0', '{"allowedUserIds": ["00000000-0000-0000-0000-0000000f0003"]}');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('f0000005-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'f0000001-0000-0000-0000-000000000001',
   'f0000003-0000-0000-0000-000000000001', 1, 'SYS-001', 'Firewall', 'a0');
insert into protected_values (org_id, item_id, field_id, value) values
  ('f0000000-0000-0000-0000-00000000000a', 'f0000005-0000-0000-0000-000000000001', 'f0000004-0000-0000-0000-000000000001', 'hunter2');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000f000' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

set local role authenticated;

-- Eve (editor, not listed)
select pg_temp.as_user('2');
select is((select count(*)::int from protected_values), 0, 'an editor not on the list reads no protected value');
select throws_ok($$ update fields set config = '{"allowedUserIds": ["00000000-0000-0000-0000-0000000f0003",
                                                                    "00000000-0000-0000-0000-0000000f0002"]}'
                    where id = 'f0000004-0000-0000-0000-000000000001' $$,
  '42501', 'access: Only owners and admins can change who sees a protected field.',
  'an editor cannot add themselves to a protected field''s list');
select throws_ok($$ update fields set type = 'text' where id = 'f0000004-0000-0000-0000-000000000001' $$,
  '42501', null, 'nor turn the protected field into an ordinary one');

-- Lee (editor, listed): no direct writes, only the logged function
select pg_temp.as_user('3');
select throws_ok($$ update protected_values set value = 'changed' $$, '42501', null,
  'a listed editor cannot overwrite a protected value directly');
select throws_ok($$ delete from protected_values $$, '42501', null, 'nor delete one');
select throws_ok($$ insert into protected_values (org_id, item_id, field_id, value) values
  ('f0000000-0000-0000-0000-00000000000a', 'f0000005-0000-0000-0000-000000000001', 'f0000004-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, 'nor insert one');
select lives_ok($$ select set_protected_value('f0000005-0000-0000-0000-000000000001',
                                              'f0000004-0000-0000-0000-000000000001', 'correct horse') $$,
  'set_protected_value still changes it');
select is((select count(*)::int from activity_log where item_id = 'f0000005-0000-0000-0000-000000000001'
            and action = 'protected.changed'), 1, 'and logs protected.changed');

-- the owner manages the list (logged by the fields audit trigger)
select pg_temp.as_user('1');
select lives_ok($$ update fields set config = '{"allowedUserIds": ["00000000-0000-0000-0000-0000000f0002"]}'
                   where id = 'f0000004-0000-0000-0000-000000000001' $$,
  'an owner changes the list');

select * from finish();
rollback;
