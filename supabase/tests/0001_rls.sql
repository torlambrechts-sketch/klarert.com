-- RLS matrix for M1 (docs/02 §7). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(19);

-- ───────────── fixtures (as postgres) ─────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'admin@a.test'),
  ('00000000-0000-0000-0000-00000000000c', 'editor@a.test'),
  ('00000000-0000-0000-0000-00000000000d', 'viewer@a.test'),
  ('00000000-0000-0000-0000-00000000000e', 'trusted@a.test'),
  ('00000000-0000-0000-0000-00000000000f', 'owner@b.test');
insert into profiles (id, display_name, initials)
select id, email, 'XX' from auth.users where id::text like '00000000-0000-0000-0000-00000000000_';

insert into orgs (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Org A', 'org-a'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Org B', 'org-b');
-- the guard lets the first owner of a new workspace in; the rest are added by that owner
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner');
insert into memberships (org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000c', 'editor'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000d', 'viewer'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000e', 'editor');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000f","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000f', 'owner');
select set_config('request.jwt.claims', '', true);

insert into sheets (id, org_id, name, id_prefix, position) values
  ('aaaaaaaa-1111-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'Risks', 'R-', 'a0'),
  ('bbbbbbbb-1111-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'Secret', 'S-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('aaaaaaaa-2222-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000', 'Open', 'a0'),
  ('bbbbbbbb-2222-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'bbbbbbbb-1111-0000-0000-000000000000', 'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, locked, config) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000', 'notes', 'Notes', 'text', 'a0', false, '{}'),
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000', 'clause', 'Clause', 'text', 'a1', true, '{}'),
  ('aaaaaaaa-3333-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000000', 'aaaaaaaa-1111-0000-0000-000000000000', 'salary', 'Salary', 'protected', 'a2', false,
   '{"allowedUserIds":["00000000-0000-0000-0000-00000000000e"]}');
select _create_item('aaaaaaaa-1111-0000-0000-000000000000', 'aaaaaaaa-2222-0000-0000-000000000000', 'Press guard', 'a0', '{}', 'system', null);
select _create_item('bbbbbbbb-1111-0000-0000-000000000000', 'bbbbbbbb-2222-0000-0000-000000000000', 'Org B item', 'a0', '{}', 'system', null);
insert into protected_values (org_id, item_id, field_id, value)
select org_id, id, 'aaaaaaaa-3333-0000-0000-000000000003', '52000' from items where name = 'Press guard';

create temp table t_item as select id from items where name = 'Press guard';
create temp table t_item_b as select id from items where name = 'Org B item';
grant select on t_item, t_item_b to authenticated;

-- ───────────── viewer ─────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

select throws_ok(
  $$ select set_item_values((select id from t_item), '{"aaaaaaaa-3333-0000-0000-000000000001":"x"}') $$,
  'not allowed', 'viewer cannot call set_item_values');
select is((select count(*) from items)::int, 1, 'viewer sees the items of their own workspace');
select is((select count(*) from protected_values)::int, 0, 'viewer cannot see protected values');

-- ───────────── editor ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select lives_ok(
  $$ select set_item_values((select id from t_item), '{"aaaaaaaa-3333-0000-0000-000000000001":"checked"}') $$,
  'editor can set a value');
update fields set name = 'Changed' where id = 'aaaaaaaa-3333-0000-0000-000000000002';
delete from fields where id = 'aaaaaaaa-3333-0000-0000-000000000002';
select is((select name from fields where id = 'aaaaaaaa-3333-0000-0000-000000000002'), 'Clause',
  'editor cannot update or delete a locked field');
update fields set name = 'Notes 2' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is((select name from fields where id = 'aaaaaaaa-3333-0000-0000-000000000001'), 'Notes 2',
  'editor can update an unlocked field');
select is((select count(*) from protected_values)::int, 0,
  'protected value hidden from an editor not in allowedUserIds');

-- cross-tenant reads
select is((select count(*) from orgs where id = 'bbbbbbbb-0000-0000-0000-000000000000')::int, 0, 'org A member cannot see org B');
select is((select count(*) from sheets where org_id = 'bbbbbbbb-0000-0000-0000-000000000000')::int, 0, 'org A member cannot see org B sheets');
select is((select count(*) from items where org_id = 'bbbbbbbb-0000-0000-0000-000000000000')::int, 0, 'org A member cannot see org B items');
select is((select count(*) from activity_log where org_id = 'bbbbbbbb-0000-0000-0000-000000000000')::int, 0, 'org A member cannot see org B activity');
select throws_ok(
  $$ select set_item_values((select id from t_item_b), '{}') $$,
  'not allowed', 'org A editor cannot write an org B item');

-- ───────────── trusted editor ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select is((select value from protected_values), '52000', 'protected value visible to an editor in allowedUserIds');

-- ───────────── admin ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
update fields set name = 'Clause (ISO)' where id = 'aaaaaaaa-3333-0000-0000-000000000002';
select is((select name from fields where id = 'aaaaaaaa-3333-0000-0000-000000000002'), 'Clause (ISO)', 'admin can update a locked field');
select is((select count(*) from protected_values)::int, 1, 'admin sees protected values');

-- ───────────── activity log is append-only ─────────────
reset role;
select throws_ok($$ update activity_log set note = 'tampered' $$, 'activity_log is append-only', 'activity_log update fails');
select throws_ok($$ delete from activity_log $$, 'activity_log is append-only', 'activity_log delete fails');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((verify_activity_chain((select id::text from t_item)) ->> 'ok')::boolean, true, 'item chain verifies');

-- ───────────── org B owner cannot write into org A ─────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000f","role":"authenticated"}', true);
select throws_ok(
  $$ select create_item('aaaaaaaa-1111-0000-0000-000000000000', 'aaaaaaaa-2222-0000-0000-000000000000', 'Injected', 'a1') $$,
  'not allowed', 'member of org B cannot create items in org A');

select * from finish();
rollback;
