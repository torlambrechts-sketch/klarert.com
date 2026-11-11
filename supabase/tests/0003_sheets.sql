-- create_sheet, create_items, the prefix lock and delete_group (0005_sheets.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(22);

-- ───────────── fixtures (as postgres) ─────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'owner@s.test'),
  ('00000000-0000-0000-0000-0000000005a2', 'editor@s.test'),
  ('00000000-0000-0000-0000-0000000005a3', 'viewer@s.test'),
  ('00000000-0000-0000-0000-0000000005b1', 'owner@other.test');
insert into profiles (id, display_name, initials)
select id, email, 'XX' from auth.users where email like '%@s.test' or email = 'owner@other.test';
insert into orgs (id, name, slug) values
  ('a5a5a5a5-0000-0000-0000-000000000000', 'Sheets Org', 'sheets-org'),
  ('b5b5b5b5-0000-0000-0000-000000000000', 'Other Org', 'other-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a5a5a5a5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000005a1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('a5a5a5a5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000005a2', 'editor'),
  ('a5a5a5a5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000005a3', 'viewer');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005b1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('b5b5b5b5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000005b1', 'owner');
select set_config('request.jwt.claims', '', true);
insert into folders (id, org_id, name, position) values
  ('a5a5a5a5-0f0f-0000-0000-000000000000', 'a5a5a5a5-0000-0000-0000-000000000000', 'Your sheets', 'a0'),
  ('b5b5b5b5-0f0f-0000-0000-000000000000', 'b5b5b5b5-0000-0000-0000-000000000000', 'Theirs', 'a0');

create temp table t_payload as select jsonb_build_object(
  'sheet', jsonb_build_object('id', 'a5a5a5a5-1111-0000-0000-000000000000', 'org_id', 'a5a5a5a5-0000-0000-0000-000000000000',
    'folder_id', 'a5a5a5a5-0f0f-0000-0000-000000000000', 'name', 'Corrective actions', 'item_label', 'Action',
    'id_prefix', 'CA-', 'position', 'a0'),
  'groups', jsonb_build_array(
    jsonb_build_object('id', 'a5a5a5a5-2222-0000-0000-000000000001', 'name', 'Open', 'color', 'orange', 'position', 'a0'),
    jsonb_build_object('id', 'a5a5a5a5-2222-0000-0000-000000000002', 'name', 'Done', 'color', 'green', 'position', 'a1')),
  'fields', jsonb_build_array(
    jsonb_build_object('id', 'a5a5a5a5-3333-0000-0000-000000000001', 'key', 'due_date', 'name', 'Due date', 'type', 'date', 'position', 'a0', 'width', 120),
    jsonb_build_object('id', 'a5a5a5a5-3333-0000-0000-000000000002', 'key', 'related', 'name', 'Related', 'type', 'link', 'position', 'a1')),
  'views', jsonb_build_array(jsonb_build_object('id', 'a5a5a5a5-4444-0000-0000-000000000001', 'name', 'List', 'type', 'list', 'position', 'a0')),
  'automations', jsonb_build_array(jsonb_build_object('name', 'Notify on done',
    'trigger', jsonb_build_object('type', 'field_changed', 'fieldId', 'a5a5a5a5-3333-0000-0000-000000000001'),
    'actions', jsonb_build_array(jsonb_build_object('type', 'notify'))))
) as p;
grant select on t_payload to authenticated;

set local role authenticated;

-- ───────────── create_sheet ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a3","role":"authenticated"}', true);
select throws_ok($$ select create_sheet((select p from t_payload)) $$, 'not allowed', 'a viewer cannot create a sheet');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005b1","role":"authenticated"}', true);
select throws_ok($$ select create_sheet((select p from t_payload)) $$, 'not allowed', 'another workspace cannot create a sheet here');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);
select throws_ok($$ select create_sheet(jsonb_set((select p from t_payload), '{sheet,folder_id}', '"b5b5b5b5-0f0f-0000-0000-000000000000"')) $$,
  'folder not in workspace', 'a sheet cannot go into another workspace''s folder');
select throws_ok($$ select create_sheet(jsonb_set((select p from t_payload), '{groups}', '[]')) $$,
  'a sheet needs at least one group', 'a sheet needs a group');
select is(create_sheet((select p from t_payload)), 'a5a5a5a5-1111-0000-0000-000000000000'::uuid, 'an editor creates a sheet');
select is((select count(*)::int from groups where sheet_id = 'a5a5a5a5-1111-0000-0000-000000000000'), 2, 'groups created');
select is((select count(*)::int from fields where sheet_id = 'a5a5a5a5-1111-0000-0000-000000000000'), 2, 'fields created');
select is((select count(*)::int from views where sheet_id = 'a5a5a5a5-1111-0000-0000-000000000000'), 1, 'views created');
select is((select trigger->>'fieldId' from automations where sheet_id = 'a5a5a5a5-1111-0000-0000-000000000000'),
  'a5a5a5a5-3333-0000-0000-000000000001', 'automations created as given');
select ok((select count(*) from activity_log where chain_key = 'sheet:a5a5a5a5-1111-0000-0000-000000000000'
            and action in ('sheets.insert', 'groups.insert', 'fields.insert', 'automations.insert')) = 6,
  'the schema changes are on the sheet chain');

-- ───────────── create_items ─────────────
select throws_ok($$ select create_items('a5a5a5a5-1111-0000-0000-000000000000', 'a5a5a5a5-2222-0000-0000-000000000001',
  '[{"name":"x","position":"a0","values":{"a5a5a5a5-3333-0000-0000-000000000002":["y"]}}]') $$,
  'field a5a5a5a5-3333-0000-0000-000000000002 cannot hold a value', 'link fields are not set through values');
select is(create_items('a5a5a5a5-1111-0000-0000-000000000000', 'a5a5a5a5-2222-0000-0000-000000000001',
  '[{"name":"Fix guard","position":"a0","values":{"a5a5a5a5-3333-0000-0000-000000000001":"2026-11-25"}},
    {"name":"Replace eye-wash","position":"a1","values":{}},
    {"name":"Calibrate","position":"a2"}]'), 3, 'an editor imports three items');
select results_eq($$ select display_id from items where sheet_id = 'a5a5a5a5-1111-0000-0000-000000000000' order by seq $$,
  array['CA-001', 'CA-002', 'CA-003'], 'display ids follow the sequence');
select is((select next_seq from sheets where id = 'a5a5a5a5-1111-0000-0000-000000000000'), 4, 'the sequence moves on');
select is((select count(*)::int from activity_log a join items i on i.id = a.item_id
            where i.sheet_id = 'a5a5a5a5-1111-0000-0000-000000000000' and a.action = 'item.created' and a.actor_id = auth.uid()),
  3, 'every imported item is logged as created by the editor');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a3","role":"authenticated"}', true);
select throws_ok($$ select create_items('a5a5a5a5-1111-0000-0000-000000000000', 'a5a5a5a5-2222-0000-0000-000000000001',
  '[{"name":"x","position":"a9"}]') $$, 'not allowed', 'a viewer cannot import items');

-- ───────────── prefix lock ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);
select throws_ok($$ update sheets set id_prefix = 'CX-' where id = 'a5a5a5a5-1111-0000-0000-000000000000' $$,
  'prefix locked: the sheet has items', 'the prefix is locked once items exist');

-- ───────────── delete_group ─────────────
select throws_ok($$ select delete_group('a5a5a5a5-2222-0000-0000-000000000001') $$, 'group has items',
  'a group with items needs a target');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a3","role":"authenticated"}', true);
select throws_ok($$ select delete_group('a5a5a5a5-2222-0000-0000-000000000001', 'a5a5a5a5-2222-0000-0000-000000000002') $$,
  'not allowed', 'a viewer cannot delete a group');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);
select is(delete_group('a5a5a5a5-2222-0000-0000-000000000001', 'a5a5a5a5-2222-0000-0000-000000000002',
  (select jsonb_object_agg(id::text, 'b' || seq) from items where sheet_id = 'a5a5a5a5-1111-0000-0000-000000000000')),
  3, 'items move to the target group, then the group is deleted');
select is((select count(*)::int from activity_log a join items i on i.id = a.item_id
            where i.sheet_id = 'a5a5a5a5-1111-0000-0000-000000000000' and a.action = 'item.moved'), 3, 'each move is logged');
select throws_ok($$ select delete_group('a5a5a5a5-2222-0000-0000-000000000002', null) $$,
  'a sheet needs at least one group', 'the last group stays');

select * from finish();
rollback;
