-- Sub-items (0020_subitems.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(37);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'owner@sub.test'),
  ('00000000-0000-0000-0000-0000000005a2', 'editor@sub.test'),
  ('00000000-0000-0000-0000-0000000005a3', 'viewer@sub.test'),
  ('00000000-0000-0000-0000-0000000005a4', 'outsider@sub.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@sub.test';
insert into orgs (id, name, slug) values
  ('5a5a5a5a-0000-0000-0000-000000000000', 'Sub Org', 'sub-org'),
  ('5a5a5a5a-0000-0000-0000-00000000000b', 'Other Sub Org', 'other-sub-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('5a5a5a5a-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000005a1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('5a5a5a5a-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000005a2', 'editor'),
  ('5a5a5a5a-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000005a3', 'viewer');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a4","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('5a5a5a5a-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000005a4', 'owner');
select set_config('request.jwt.claims', '', true);

-- a CAPA-like parent sheet with the gate on, its child sheet, and a sheet without sub-items
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('5a5a5a5a-1111-0000-0000-000000000001', '5a5a5a5a-0000-0000-0000-000000000000', 'CAPA', 'SUB-', 'a0',
   '{"subitems":{"label":"Actions","blockClose":true}}'),
  ('5a5a5a5a-1111-0000-0000-000000000003', '5a5a5a5a-0000-0000-0000-000000000000', 'Plain', 'PLN-', 'a2', '{}');
insert into sheets (id, org_id, name, id_prefix, position, parent_sheet_id) values
  ('5a5a5a5a-1111-0000-0000-000000000002', '5a5a5a5a-0000-0000-0000-000000000000', 'CAPA · Actions', null, 'a1',
   '5a5a5a5a-1111-0000-0000-000000000001');
insert into groups (id, org_id, sheet_id, name, position) values
  ('5a5a5a5a-2222-0000-0000-000000000001', '5a5a5a5a-0000-0000-0000-000000000000', '5a5a5a5a-1111-0000-0000-000000000001', 'Open', 'a0'),
  ('5a5a5a5a-2222-0000-0000-000000000002', '5a5a5a5a-0000-0000-0000-000000000000', '5a5a5a5a-1111-0000-0000-000000000002', 'Sub-items', 'a0'),
  ('5a5a5a5a-2222-0000-0000-000000000003', '5a5a5a5a-0000-0000-0000-000000000000', '5a5a5a5a-1111-0000-0000-000000000003', 'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('5a5a5a5a-3333-0000-0000-000000000001', '5a5a5a5a-0000-0000-0000-000000000000', '5a5a5a5a-1111-0000-0000-000000000001',
   'status', 'Status', 'status', 'a0',
   '{"options":[{"id":"o_open","label":"Open","color":"orange"},{"id":"o_done","label":"Done","color":"green","done":true}]}'),
  ('5a5a5a5a-3333-0000-0000-000000000002', '5a5a5a5a-0000-0000-0000-000000000000', '5a5a5a5a-1111-0000-0000-000000000002',
   'status', 'Status', 'status', 'a0',
   '{"options":[{"id":"s_todo","label":"To do","color":"grey"},{"id":"s_done","label":"Done","color":"green","done":true}]}');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by, enabled) values
  ('5a5a5a5a-4444-0000-0000-000000000001', '5a5a5a5a-0000-0000-0000-000000000000', '5a5a5a5a-1111-0000-0000-000000000001',
   'Close it', '{"type":"all_subitems_done"}', '[]', '00000000-0000-0000-0000-0000000005a2', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);
create temp table p1 as select * from create_item('5a5a5a5a-1111-0000-0000-000000000001', '5a5a5a5a-2222-0000-0000-000000000001', 'Guard missing', 'a0');
create temp table p2 as select * from create_item('5a5a5a5a-1111-0000-0000-000000000001', '5a5a5a5a-2222-0000-0000-000000000001', 'Spill', 'a1');
create temp table plain as select * from create_item('5a5a5a5a-1111-0000-0000-000000000003', '5a5a5a5a-2222-0000-0000-000000000003', 'Plain', 'a0');

-- ───────────── numbering ─────────────
create temp table s1 as select * from create_subitem((select id from p1), 'Containment', 'a0');
select is((select display_id from s1), 'SUB-001.1', 'a sub-item takes the parent''s id, a dot and its number');
select is((select sub_seq from s1), 1, 'sub_seq starts at 1');
create temp table batch as select * from create_subitems((select id from p1),
  '[{"name":"Root cause","position":"a1"},{"name":"Correction","position":"a2"}]');
select results_eq($$ select display_id from batch order by sub_seq $$, array['SUB-001.2', 'SUB-001.3'],
  'create_subitems numbers a template set in order');
-- many in a row: one counter per parent, under the parent's row lock (no gaps, no duplicates)
select lives_ok($$ select create_subitem((select id from p2), 'Step ' || n, 'b' || n) from generate_series(1, 20) n $$,
  'twenty sub-items in a row');
select results_eq($$ select array_agg(sub_seq order by sub_seq) from items where parent_id = (select id from p2) $$,
  $$ select array_agg(n) from generate_series(1, 20) n $$, 'sub_seq has no gaps and no duplicates');
select is((select next_sub_seq from items where id = (select id from p2)), 21, 'the parent counts the next number');
select is((select count(*)::int from activity_log where item_id = (select id from p1) and action = 'subitem.added'), 3,
  'the parent chain gets a pointer entry per sub-item');

-- ───────────── structure guards ─────────────
reset role;
select throws_ok($$ insert into sheets (org_id, name, id_prefix, position, parent_sheet_id) values
  ('5a5a5a5a-0000-0000-0000-000000000000', 'Deeper', null, 'a3', '5a5a5a5a-1111-0000-0000-000000000002') $$,
  'P0001', 'sub-items cannot have sub-items', 'one level only: a child sheet cannot have a child sheet');
select throws_ok($$ insert into sheets (org_id, name, id_prefix, position, parent_sheet_id) values
  ('5a5a5a5a-0000-0000-0000-000000000000', 'Second', null, 'a4', '5a5a5a5a-1111-0000-0000-000000000001') $$,
  '23505', null, 'a sheet has at most one child sheet');
select throws_ok($$ insert into items (org_id, sheet_id, group_id, seq, display_id, name, position, parent_id, sub_seq) values
  ('5a5a5a5a-0000-0000-0000-000000000000', '5a5a5a5a-1111-0000-0000-000000000002', '5a5a5a5a-2222-0000-0000-000000000002',
   999, 'X.1', 'Wrong', 'z', (select id from plain), 1) $$,
  'P0001', 'wrong parent', 'a sub-item''s parent must be an item of the parent sheet');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);
select throws_ok($$ select create_item('5a5a5a5a-1111-0000-0000-000000000002', '5a5a5a5a-2222-0000-0000-000000000002', 'Loose', 'z') $$,
  'P0001', 'sheet holds sub-items: add them to an item', 'create_item refuses a child sheet');
select throws_ok($$ select create_subitem((select id from plain), 'Nope', 'a0') $$,
  'P0001', 'sub-items are off for this sheet', 'a sheet without sub-items refuses them');
select throws_ok($$ select create_subitem((select id from s1), 'Nested', 'a0') $$,
  'P0001', 'sub-items cannot have sub-items', 'a sub-item cannot have sub-items');
select throws_ok($$ select move_subitem((select id from s1), (select id from plain), 'a0') $$,
  'P0001', 'wrong parent', 'a sub-item moves only to an item of the parent sheet');
select throws_ok($$ select move_item((select id from s1), '5a5a5a5a-2222-0000-0000-000000000002', 'a0') $$,
  'P0001', 'sub-items move with move_subitem', 'move_item refuses sub-items');

-- ───────────── who may ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a3","role":"authenticated"}', true);
select throws_ok($$ select create_subitem((select id from p1), 'Viewer', 'a9') $$, 'P0001', 'not allowed',
  'a viewer cannot add sub-items');
select throws_ok($$ select set_item_values((select id from s1), '{"5a5a5a5a-3333-0000-0000-000000000002":"s_done"}') $$,
  'P0001', 'not allowed', 'a viewer cannot change a sub-item');
select is((select count(*)::int from items where parent_id = (select id from p1)), 3, 'a viewer reads the sub-items');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a4","role":"authenticated"}', true);
select is((select count(*)::int from items where sheet_id = '5a5a5a5a-1111-0000-0000-000000000002'), 0,
  'another workspace cannot read sub-items');
select is((select count(*)::int from sheets where parent_sheet_id is not null and org_id = '5a5a5a5a-0000-0000-0000-000000000000'), 0,
  'another workspace cannot read the child sheet');
select throws_ok($$ select create_subitem((select id from p1), 'Outsider', 'a9') $$, 'P0001', 'not allowed',
  'another workspace cannot add sub-items');

-- ───────────── the gate ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);
select throws_like($$ select set_item_values((select id from p1), '{"5a5a5a5a-3333-0000-0000-000000000001":"o_done"}') $$,
  'subitems open: Actions still open: SUB-001.1 Containment, SUB-001.2 Root cause, SUB-001.3 Correction%',
  'the parent cannot close while sub-items are open, and the message lists them');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_like($$ select set_item_values((select id from items where display_id = 'SUB-001'
                       and sheet_id = '5a5a5a5a-1111-0000-0000-000000000001'),
                     '{"5a5a5a5a-3333-0000-0000-000000000001":"o_done"}', null, '5a5a5a5a-4444-0000-0000-000000000001') $$,
  'subitems open:%', 'an automation cannot bypass the gate');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);
select lives_ok($$ select set_item_values(id, '{"5a5a5a5a-3333-0000-0000-000000000002":"s_done"}')
                     from items where parent_id = (select id from p1) $$, 'the sub-items are closed');
select lives_ok($$ select set_item_values((select id from p1), '{"5a5a5a5a-3333-0000-0000-000000000001":"o_done"}') $$,
  'the parent closes once every sub-item is done');

-- ───────────── archive and restore ─────────────
create temp table one as select id from items where parent_id = (select id from p2) and sub_seq = 1;
select lives_ok($$ select set_item_archived((select id from one), true) $$, 'one sub-item archived on its own');
select is((select count(*)::int from activity_log where item_id = (select id from p2) and action = 'subitem.archived'), 1,
  'archiving a sub-item writes a pointer on the parent');
select lives_ok($$ select set_item_archived((select id from p2), true) $$, 'archive the parent');
select is((select count(*)::int from items where parent_id = (select id from p2) and archived_at is null), 0,
  'archiving the parent archives its sub-items');
select throws_ok($$ select set_item_archived((select id from one), false) $$, 'P0001', 'restore the parent first: SUB-002',
  'a sub-item of an archived parent cannot be restored alone');
select lives_ok($$ select set_item_archived((select id from p2), false) $$, 'restore the parent');
select is((select count(*)::int from items where parent_id = (select id from p2) and archived_at is null), 19,
  'restoring the parent brings back only the sub-items archived with it');

-- ───────────── move keeps the id; chains stay valid ─────────────
create temp table moved as select * from move_subitem((select id from s1), (select id from p2), 'zz');
select is((select display_id from moved), 'SUB-001.1', 'the display id is frozen when a sub-item moves');
select is((select (parent_id, sub_seq)::text from moved), (select ((select id from p2), 21)::text),
  'the sub-item takes the new parent and its next number');
select ok((select bool_and((verify_activity_chain(k) ->> 'ok')::boolean)
             from unnest(array[(select id::text from s1), (select id::text from p1), (select id::text from p2)]) k),
  'the activity chains of the sub-item and both parents verify');

-- ───────────── grants ─────────────
reset role;
select ok(not has_function_privilege('anon', 'create_subitem(uuid, text, text, jsonb, uuid)', 'execute')
          and not has_function_privilege('anon', 'create_subitems(uuid, jsonb, uuid)', 'execute')
          and not has_function_privilege('anon', 'move_subitem(uuid, uuid, text, uuid)', 'execute'),
  'signed-out visitors cannot call the sub-item functions');
select ok(not has_function_privilege('authenticated', '_create_subitem(uuid, text, text, jsonb, text, uuid)', 'execute')
          and not has_function_privilege('authenticated', '_open_subitems(uuid)', 'execute')
          and not has_function_privilege('authenticated', '_status_field(uuid)', 'execute')
          and not has_function_privilege('authenticated', '_subitem_settings(uuid)', 'execute'),
  'internal helpers are not executable by signed-in people');

select * from finish();
rollback;
