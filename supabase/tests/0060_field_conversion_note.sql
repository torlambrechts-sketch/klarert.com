-- A field type conversion's note is the system's and stays in clear (0069); a person's comment is still masked.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000099601', 'conv-owner@a.test'),
  ('00000000-0000-0000-0000-000000099602', 'conv-viewer@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000099601', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000099602', 'Vic Viewer', 'VV');
insert into orgs (id, name, slug) values ('99600000-0000-0000-0000-00000000000a', 'Conversions', 'pgtap-conversions');
insert into memberships (org_id, user_id, role) values
  ('99600000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099601', 'owner'),
  ('99600000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099602', 'viewer');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('99600001-0000-0000-0000-000000000001', '99600000-0000-0000-0000-00000000000a', 'Risks', 'RSK-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('99600002-0000-0000-0000-000000000001', '99600000-0000-0000-0000-00000000000a', '99600001-0000-0000-0000-000000000001',
   'All', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('99600003-0000-0000-0000-000000000001', '99600000-0000-0000-0000-00000000000a', '99600001-0000-0000-0000-000000000001',
   'score', 'Score', 'number', 'a0', '{}');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('99600004-0000-0000-0000-000000000001', '99600000-0000-0000-0000-00000000000a', '99600001-0000-0000-0000-000000000001',
   '99600002-0000-0000-0000-000000000001', 1, 'RSK-001', 'Fire', 'a0');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009960' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$ select convert_item_value('99600004-0000-0000-0000-000000000001',
                    '99600003-0000-0000-0000-000000000001', '12', 'Number') $$, 'an owner converts a value');
select is((select note from activity_log where item_id = '99600004-0000-0000-0000-000000000001'
            and action = 'value.changed' order by id desc limit 1),
  'Field type changed to Number', 'the conversion''s note stays in clear');
select is(current_setting('app.system_note', true), '', 'the system-note flag is off again after the call');
select set_item_values('99600004-0000-0000-0000-000000000001', '{"99600003-0000-0000-0000-000000000001": 13}', null,
                       null, 'Raised after Sam''s report');
select ok((select note ~ '^\{"\$personal": "[0-9a-f]{64}"\}$' from activity_log
            where item_id = '99600004-0000-0000-0000-000000000001' and action = 'value.changed' order by id desc limit 1),
  'a person''s comment through set_item_values is still masked');
select throws_ok($$ select convert_item_value('99600004-0000-0000-0000-000000000001',
                    '99600003-0000-0000-0000-000000000001', '14', 'Number; Sam was late again') $$,
  'convert: not a field type name', 'free text cannot pass as a type name');
select pg_temp.as_user('2');
select throws_ok($$ select convert_item_value('99600004-0000-0000-0000-000000000001',
                    '99600003-0000-0000-0000-000000000001', '15', 'Number') $$,
  null, null, 'a viewer cannot convert values: set_item_values'' checks apply');
reset role;

select * from finish();
rollback;
