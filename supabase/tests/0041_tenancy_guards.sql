-- Rows never leave their workspace or sheet (0050, security review H1, SA-14, L8). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

-- Eve edits sheet S in workspace A (not on the restricted field's list) and owns her own workspace B.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e0001', 'ten-owner@a.test'),
  ('00000000-0000-0000-0000-0000000e0002', 'ten-eve@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000e0001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-0000000e0002', 'Eve Editor', 'EE');
insert into orgs (id, name, slug) values
  ('e0000000-0000-0000-0000-00000000000a', 'Tenancy A', 'pgtap-tenancy-a'),
  ('e0000000-0000-0000-0000-00000000000b', 'Tenancy B', 'pgtap-tenancy-b');
insert into memberships (org_id, user_id, role) values
  ('e0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000e0001', 'owner'),
  ('e0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000e0002', 'editor'),
  ('e0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000e0002', 'owner');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('e0000001-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000a', 'Staff', 'STF-', 'a0'),
  ('e0000001-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000b', 'Eve''s sheet', 'EVE-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('e0000003-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000a', 'e0000001-0000-0000-0000-000000000001', 'All', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config, restricted_to) values
  ('e0000004-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000a', 'e0000001-0000-0000-0000-000000000001',
   'salary', 'Salary', 'number', 'a0', '{}', '{"userIds": [], "roles": []}');
insert into views (id, org_id, sheet_id, name, type, position) values
  ('e0000006-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000a', 'e0000001-0000-0000-0000-000000000001', 'All', 'list', 'a0');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000e000' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

set local role authenticated;
select pg_temp.as_user('2');

-- H1 (a): the field is hidden from Eve, and moving it to her workspace is refused
select ok('e0000004-0000-0000-0000-000000000001' = any (hidden_field_ids()), 'the restricted field is hidden from Eve');
select throws_ok($$ update fields set org_id = 'e0000000-0000-0000-0000-00000000000b'
                    where id = 'e0000004-0000-0000-0000-000000000001' $$,
  '42501', null, 'an editor cannot move a field to a workspace they own');
select ok('e0000004-0000-0000-0000-000000000001' = any (hidden_field_ids())
          and not field_visible('e0000004-0000-0000-0000-000000000001'),
  'so the field stays hidden from her');
select throws_ok($$ update fields set sheet_id = 'e0000001-0000-0000-0000-000000000002'
                    where id = 'e0000004-0000-0000-0000-000000000001' $$,
  '42501', null, 'nor to another sheet');

-- H1 (b): the whole sheet
select throws_ok($$ update sheets set org_id = 'e0000000-0000-0000-0000-00000000000b'
                    where id = 'e0000001-0000-0000-0000-000000000001' $$,
  '42501', null, 'an editor cannot move a sheet (with its items and history) to a workspace they own');
select throws_ok($$ update groups set org_id = 'e0000000-0000-0000-0000-00000000000b'
                    where id = 'e0000003-0000-0000-0000-000000000001' $$,
  '42501', null, 'nor a group');
select throws_ok($$ update views set sheet_id = 'e0000001-0000-0000-0000-000000000002'
                    where id = 'e0000006-0000-0000-0000-000000000001' $$,
  '42501', null, 'nor a view to another sheet');

-- SA-14: a row's workspace is its sheet's
select throws_ok($$ insert into fields (org_id, sheet_id, key, name, type, position)
                    values ('e0000000-0000-0000-0000-00000000000b', 'e0000001-0000-0000-0000-000000000001',
                            'mine', 'Mine', 'text', 'a1') $$,
  '42501', null, 'a field cannot claim another workspace than its sheet''s');
select throws_ok($$ insert into groups (org_id, sheet_id, name, position)
                    values ('e0000000-0000-0000-0000-00000000000a', 'e0000001-0000-0000-0000-000000000002', 'X', 'a1') $$,
  '42501', null, 'nor a group');
select throws_ok($$ insert into views (org_id, sheet_id, name, type, position)
                    values ('e0000000-0000-0000-0000-00000000000b', 'e0000001-0000-0000-0000-000000000001', 'X', 'list', 'a1') $$,
  '42501', null, 'nor a view');
select lives_ok($$ insert into fields (org_id, sheet_id, key, name, type, position)
                   values ('e0000000-0000-0000-0000-00000000000a', 'e0000001-0000-0000-0000-000000000001',
                           'notes', 'Notes', 'text', 'a1') $$,
  'a field of the sheet''s own workspace is added as before');

-- L8: the item counter
select throws_ok($$ update sheets set next_seq = 7 where id = 'e0000001-0000-0000-0000-000000000001' $$,
  '42501', null, 'an editor cannot reset a sheet''s item counter');
select lives_ok($$ select create_item('e0000001-0000-0000-0000-000000000001', 'e0000003-0000-0000-0000-000000000001',
                                      'Ann', 'a0') $$, 'creating an item still moves the counter');

reset role;
select is((select org_id from sheets where id = 'e0000001-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-00000000000a'::uuid, 'the sheet is still in workspace A');

select * from finish();
rollback;
