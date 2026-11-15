-- Erasure reaches comment bodies, sub-item names and values kept aside while a field was restricted (0059, M6).
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000095001', 'era-owner@a.test'),
  ('00000000-0000-0000-0000-000000095002', 'era-eve@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000095001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000095002', 'Eve Editor', 'EE');
insert into orgs (id, name, slug) values ('95000000-0000-0000-0000-00000000000a', 'Erasure A', 'pgtap-erasure-a');
insert into memberships (org_id, user_id, role) values
  ('95000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000095001', 'owner'),
  ('95000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000095002', 'editor');
-- P: incidents with sub-items (witnesses, whose names are personal data) and an erase rule
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('95000001-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000000a', 'Incidents', 'INC-', 'a0',
   '{"subitems":{"label":"Witnesses"},"retention":{"rules":[
      {"id":"erase","name":"Erase","from":{"kind":"created"},"period":{"n":1,"unit":"days"},"action":"erase","comments":true}]}}');
insert into sheets (id, org_id, name, id_prefix, position, parent_sheet_id, settings) values
  ('95000001-0000-0000-0000-000000000002', '95000000-0000-0000-0000-00000000000a', 'Incidents · Witnesses', null, 'a1',
   '95000001-0000-0000-0000-000000000001',
   '{"retention":{"personalNames":true,"rules":[
      {"id":"anon","name":"Anonymise","from":{"kind":"created"},"period":{"n":1,"unit":"days"},"action":"anonymise"}]}}');
insert into groups (id, org_id, sheet_id, name, position) values
  ('95000003-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000000a', '95000001-0000-0000-0000-000000000001', 'Open', 'a0'),
  ('95000003-0000-0000-0000-000000000002', '95000000-0000-0000-0000-00000000000a', '95000001-0000-0000-0000-000000000002', 'All', 'a0');
-- the reporter field: restricted first, marked personal data later
insert into fields (id, org_id, sheet_id, key, name, type, position, config, restricted_to) values
  ('95000004-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000000a', '95000001-0000-0000-0000-000000000001',
   'reporter', 'Reporter', 'text', 'a0', '{}', '{"userIds": [], "roles": []}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009500' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;
select pg_temp.as_user('1');
create temp table t_item as select id from create_item('95000001-0000-0000-0000-000000000001',
  '95000003-0000-0000-0000-000000000001', 'Forklift collision', 'a0');
select set_item_values((select id from t_item), '{"95000004-0000-0000-0000-000000000001": "Sam Reporter"}');
create temp table t_sub as select id from create_subitem((select id from t_item), 'Wanda Witness', 'a0');

-- comments
select pg_temp.as_user('2');
insert into item_updates (org_id, item_id, author_id, body)
select '95000000-0000-0000-0000-00000000000a', id, auth.uid(), 'Spoke to Sam' from t_item;
select edit_update((select id from item_updates where item_id = (select id from t_item) limit 1),
                   'Spoke to Sam Reporter about the knee injury');
select ok((select activity_value_masked(old_value) and activity_value_masked(new_value)
             from activity_log where item_id = (select id from t_item) and action = 'update.edited'),
  'a comment''s edited body is kept out of the log in clear');
select is((select pa.new_value #>> '{}' from personal_activity pa join activity_log a on a.id = pa.activity_id
            where a.item_id = (select id from t_item) and a.action = 'update.edited' and pa.slot = 'comment'),
  'Spoke to Sam Reporter about the knee injury', 'readers of the item still read it');
select ok((select activity_value_masked(new_value -> 'name') from activity_log
            where item_id = (select id from t_item) and action = 'subitem.added'),
  'a witness''s name is kept out of the parent''s log in clear (the sub-item sheet''s names are personal)');
reset role;

-- the field is marked personal data after it held values while restricted
update fields set config = '{"personalData": true}' where id = '95000004-0000-0000-0000-000000000001';
select is((select count(*)::int from restricted_activity ra join activity_log a on a.id = ra.activity_id
            where a.item_id = (select id from t_item) and ra.erased_at is null), 1,
  'the reporter''s value was kept aside while the field was restricted');
insert into retention_queue (id, org_id, sheet_id, item_id, rule_id, rule_name, action, due_on) values
  ('95000008-0000-0000-0000-000000000001', '95000000-0000-0000-0000-00000000000a', '95000001-0000-0000-0000-000000000001',
   (select id from t_item), 'erase', 'Erase', 'erase', current_date),
  ('95000008-0000-0000-0000-000000000002', '95000000-0000-0000-0000-00000000000a', '95000001-0000-0000-0000-000000000002',
   (select id from t_sub), 'anon', 'Anonymise', 'anonymise', current_date);

set local role authenticated;
select pg_temp.as_user('1');
create temp table t_res as select retention_execute('95000008-0000-0000-0000-000000000001') as r;
select is((select count(*)::int from restricted_activity ra join activity_log a on a.id = ra.activity_id
            where a.item_id = (select id from t_item) and ra.erased_at is null), 0,
  'erasure erases the values kept aside while the field was restricted');
select is((select (r ->> 'redacted')::int from t_res), 2, 'and the comment''s body (one value, one comment)');
select is((select count(*)::int from personal_activity pa join activity_log a on a.id = pa.activity_id
            where a.item_id = (select id from t_item) and pa.slot = 'comment' and pa.erased_at is null), 0,
  'no comment body is left in the log''s store');
select is((select new_value ->> 'restricted_log_values_erased' from activity_log
            where item_id = (select id from t_item) and action = 'retention.erased'), '1',
  'the tombstone counts the restricted values erased');
select is((select new_value ->> 'earlier_entries_in_clear' from activity_log
            where item_id = (select id from t_item) and action = 'retention.erased'), '0',
  'and nothing is left in clear');
select is((verify_activity_chain((select id::text from t_item))) ->> 'ok', 'true', 'the item''s chain still verifies');

-- anonymising the witness erases her name in the parent's entries too
create temp table t_res2 as select retention_execute('95000008-0000-0000-0000-000000000002') as r;
select is((select count(*)::int from personal_activity
            where item_id = (select id from t_sub) and slot = 'subitem' and erased_at is null), 0,
  'anonymising a sub-item erases its name in its parent''s log');
select is((select name from items where id = (select id from t_sub)), 'Anonymised item',
  'and renames it');
select is((verify_activity_chain((select id::text from t_item))) ->> 'ok', 'true', 'the parent''s chain still verifies');
reset role;
select throws_ok($$ update restricted_activity set salt = null $$, 'restricted_activity is append-only',
  'outside erasure the kept-aside values cannot change');

select * from finish();
rollback;
