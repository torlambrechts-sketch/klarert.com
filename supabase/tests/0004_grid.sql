-- Locked items and protected values (0006_grid.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006a1', 'owner@g.test'),
  ('00000000-0000-0000-0000-0000000006a2', 'editor@g.test'),
  ('00000000-0000-0000-0000-0000000006a3', 'viewer@g.test'),
  ('00000000-0000-0000-0000-0000000006a4', 'listed@g.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@g.test';
insert into orgs (id, name, slug) values ('a6a6a6a6-0000-0000-0000-000000000000', 'Grid Org', 'grid-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a6a6a6a6-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000006a1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('a6a6a6a6-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000006a2', 'editor'),
  ('a6a6a6a6-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000006a3', 'viewer'),
  ('a6a6a6a6-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000006a4', 'editor');
select set_config('request.jwt.claims', '', true);
insert into sheets (id, org_id, name, id_prefix, position) values
  ('a6a6a6a6-1111-0000-0000-000000000000', 'a6a6a6a6-0000-0000-0000-000000000000', 'Grid', 'GR-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('a6a6a6a6-2222-0000-0000-000000000001', 'a6a6a6a6-0000-0000-0000-000000000000', 'a6a6a6a6-1111-0000-0000-000000000000', 'Open', 'a0'),
  ('a6a6a6a6-2222-0000-0000-000000000002', 'a6a6a6a6-0000-0000-0000-000000000000', 'a6a6a6a6-1111-0000-0000-000000000000', 'Done', 'a1');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('a6a6a6a6-3333-0000-0000-000000000001', 'a6a6a6a6-0000-0000-0000-000000000000', 'a6a6a6a6-1111-0000-0000-000000000000',
   'secret', 'Secret', 'protected', 'a0', '{"allowedUserIds":["00000000-0000-0000-0000-0000000006a4"]}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a2","role":"authenticated"}', true);
create temp table t_item as select (create_item('a6a6a6a6-1111-0000-0000-000000000000', 'a6a6a6a6-2222-0000-0000-000000000001', 'Fix guard', 'a0')).id;
create temp table t_item2 as select (create_item('a6a6a6a6-1111-0000-0000-000000000000', 'a6a6a6a6-2222-0000-0000-000000000001', 'Calibrate', 'a1')).id;

-- ───────────── locked items ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}', true);
select lives_ok($$ select set_item_lock((select id from t_item), true, 'Approved by QA') $$, 'an owner locks an item');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a2","role":"authenticated"}', true);
select throws_ok($$ select move_item((select id from t_item), 'a6a6a6a6-2222-0000-0000-000000000002', 'a0') $$,
  'item locked: Approved by QA', 'an editor cannot move a locked item');
select throws_ok($$ select set_item_archived((select id from t_item), true) $$,
  'item locked: Approved by QA', 'an editor cannot archive a locked item');
select lives_ok($$ select move_item((select id from t_item2), 'a6a6a6a6-2222-0000-0000-000000000002', 'a0') $$,
  'an editor moves an unlocked item');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}', true);
select is((move_item((select id from t_item), 'a6a6a6a6-2222-0000-0000-000000000002', 'a1')).group_id,
  'a6a6a6a6-2222-0000-0000-000000000002'::uuid, 'an owner moves a locked item');

-- ───────────── protected values ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a2","role":"authenticated"}', true);
select throws_ok($$ select set_protected_value((select id from t_item2), 'a6a6a6a6-3333-0000-0000-000000000001', 'PIN 1') $$,
  'not allowed', 'an editor the field does not list cannot write it');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a3","role":"authenticated"}', true);
select throws_ok($$ select set_protected_value((select id from t_item2), 'a6a6a6a6-3333-0000-0000-000000000001', 'PIN 1') $$,
  'not allowed', 'a viewer cannot write it');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a4","role":"authenticated"}', true);
select lives_ok($$ select set_protected_value((select id from t_item2), 'a6a6a6a6-3333-0000-0000-000000000001', 'PIN 1') $$,
  'a listed editor writes it');
select is((select value from protected_values where item_id = (select id from t_item2)), 'PIN 1', 'the listed editor reads it back');
select ok((select old_value is null and new_value is null and action = 'protected.changed' from activity_log
            where item_id = (select id from t_item2) and field_id = 'a6a6a6a6-3333-0000-0000-000000000001'),
  'the log records the action without the value');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a2","role":"authenticated"}', true);
select is((select count(*)::int from protected_values), 0, 'an editor the field does not list cannot read it');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a4","role":"authenticated"}', true);
select set_protected_value((select id from t_item2), 'a6a6a6a6-3333-0000-0000-000000000001', '');
select is((select count(*)::int from protected_values), 0, 'clearing deletes the value');

select * from finish();
rollback;
