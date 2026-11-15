-- Links of a restricted field are for people who see it (0055, M2). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000091001', 'lnk-owner@a.test'),
  ('00000000-0000-0000-0000-000000091002', 'lnk-eve@a.test'),
  ('00000000-0000-0000-0000-000000091003', 'lnk-ed@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000091001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000091002', 'Eve Editor', 'EE'),
  ('00000000-0000-0000-0000-000000091003', 'Ed Outside', 'EO');
insert into orgs (id, name, slug) values ('91000000-0000-0000-0000-00000000000a', 'Links A', 'pgtap-links-a');
insert into memberships (org_id, user_id, role) values
  ('91000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000091001', 'owner'),
  ('91000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000091002', 'editor'),
  ('91000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000091003', 'editor');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('91000001-0000-0000-0000-000000000001', '91000000-0000-0000-0000-00000000000a', 'Staff', 'STF-', 'a0'),
  ('91000001-0000-0000-0000-000000000002', '91000000-0000-0000-0000-00000000000a', 'Cases', 'CAS-', 'a1');
-- Ed has no access to Staff
select set_config('app.access_op', 'on', true);
update sheets set restricted = true, access_inherit = false where id = '91000001-0000-0000-0000-000000000001';
insert into access_grants (org_id, sheet_id, user_id, level, granted_by) values
  ('91000000-0000-0000-0000-00000000000a', '91000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000091002', 'editor',
   '00000000-0000-0000-0000-000000091001');
select set_config('app.access_op', '', true);
insert into groups (id, org_id, sheet_id, name, position) values
  ('91000003-0000-0000-0000-000000000001', '91000000-0000-0000-0000-00000000000a', '91000001-0000-0000-0000-000000000001', 'All', 'a0'),
  ('91000003-0000-0000-0000-000000000002', '91000000-0000-0000-0000-00000000000a', '91000001-0000-0000-0000-000000000002', 'All', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config, restricted_to) values
  ('91000004-0000-0000-0000-000000000001', '91000000-0000-0000-0000-00000000000a', '91000001-0000-0000-0000-000000000001',
   'case', 'Linked disciplinary case', 'link', 'a0', '{"targetSheetId": "91000001-0000-0000-0000-000000000002"}',
   '{"userIds": [], "roles": []}');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('91000005-0000-0000-0000-000000000001', '91000000-0000-0000-0000-00000000000a', '91000001-0000-0000-0000-000000000001',
   '91000003-0000-0000-0000-000000000001', 1, 'STF-001', 'Ann', 'a0'),
  ('91000005-0000-0000-0000-000000000002', '91000000-0000-0000-0000-00000000000a', '91000001-0000-0000-0000-000000000002',
   '91000003-0000-0000-0000-000000000002', 1, 'CAS-001', 'Case 1', 'a0');
insert into item_links (org_id, field_id, from_item, to_item) values
  ('91000000-0000-0000-0000-00000000000a', '91000004-0000-0000-0000-000000000001', '91000005-0000-0000-0000-000000000001',
   '91000005-0000-0000-0000-000000000002');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009100' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;

-- Eve edits Staff but is not on the field's list
select pg_temp.as_user('2');
select throws_ok($$ select * from set_item_links('91000004-0000-0000-0000-000000000001', '91000005-0000-0000-0000-000000000001',
                                                 '{}', 'add') $$,
  'bad link field or item', 'a member who cannot see a restricted link field cannot read its links through set_item_links');
select throws_ok($$ select * from set_item_links('91000004-0000-0000-0000-000000000001', '91000005-0000-0000-0000-000000000001',
                                                 '{}', 'replace') $$,
  'bad link field or item', 'nor remove them');
-- Ed cannot open Staff at all
select pg_temp.as_user('3');
select throws_ok($$ select * from set_item_links('91000004-0000-0000-0000-000000000001', '91000005-0000-0000-0000-000000000001',
                                                 '{}', 'add') $$,
  'bad link field or item', 'nor can an editor with no access to the sheet');
-- the owner sees the field
select pg_temp.as_user('1');
select is((select count(*)::int from set_item_links('91000004-0000-0000-0000-000000000001',
                                                    '91000005-0000-0000-0000-000000000001', '{}', 'add')), 1,
  'someone who sees the field still reads its links');
reset role;
-- Eve is listed now; the target sheet becomes restricted without her
select set_config('app.access_op', 'on', true);
update fields set restricted_to = '{"userIds": ["00000000-0000-0000-0000-000000091002"], "roles": []}'
 where id = '91000004-0000-0000-0000-000000000001';
update sheets set restricted = true, access_inherit = false where id = '91000001-0000-0000-0000-000000000002';
select set_config('app.access_op', '', true);
set local role authenticated;
select pg_temp.as_user('2');
select lives_ok($$ select * from set_item_links('91000004-0000-0000-0000-000000000001', '91000005-0000-0000-0000-000000000001',
                                                '{}', 'add') $$, 'a listed editor calls set_item_links');
select is((select count(*)::int from set_item_links('91000004-0000-0000-0000-000000000001',
                                                    '91000005-0000-0000-0000-000000000001', '{}', 'add')), 0,
  'but never reads the ids of targets she cannot open');
reset role;
select is((select count(*)::int from item_links where field_id = '91000004-0000-0000-0000-000000000001'), 1,
  'the link itself is untouched');

select * from finish();
rollback;
