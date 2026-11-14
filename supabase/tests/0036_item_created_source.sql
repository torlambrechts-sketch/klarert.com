-- Where an item was added, in its item.created entry (0046_item_created_source.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000046a1', 'owner@src.test'),
  ('00000000-0000-0000-0000-0000000046a2', 'viewer@src.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@src.test';
insert into orgs (id, name, slug) values ('a46a46a4-0000-0000-0000-000000000000', 'Source Org', 'source-org');
insert into memberships (org_id, user_id, role) values
  ('a46a46a4-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000046a1', 'owner'),
  ('a46a46a4-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000046a2', 'viewer');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-0000-0000-0000-000000000000', 'Nonconformities', 'NC-', 'a0'),
  ('a46a46a4-1111-0000-0000-000000000001', 'a46a46a4-0000-0000-0000-000000000000', 'Other', 'OT-', 'a1');
insert into groups (id, org_id, sheet_id, name, position) values
  ('a46a46a4-2222-0000-0000-000000000001', 'a46a46a4-0000-0000-0000-000000000000', 'a46a46a4-1111-0000-0000-000000000000', 'Open', 'a0');
insert into views (id, org_id, sheet_id, name, type, config, position) values
  ('a46a46a4-3333-0000-0000-000000000001', 'a46a46a4-0000-0000-0000-000000000000', 'a46a46a4-1111-0000-0000-000000000000',
   'Report a nonconformity', 'form', '{"form":{"fields":[],"access":"internal"}}', 'a0'),
  ('a46a46a4-3333-0000-0000-000000000002', 'a46a46a4-0000-0000-0000-000000000000', 'a46a46a4-1111-0000-0000-000000000001',
   'Elsewhere', 'form', '{"form":{"fields":[]}}', 'a0'),
  ('a46a46a4-3333-0000-0000-000000000003', 'a46a46a4-0000-0000-0000-000000000000', 'a46a46a4-1111-0000-0000-000000000000',
   'Board', 'kanban', '{}', 'a1');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000046a1","role":"authenticated"}', true);

create temp table t_items (label text, id uuid) on commit drop;
grant all on t_items to authenticated;
insert into t_items select 'dialog', (create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'From the dialog', 'a0', '{}', null, 'dialog')).id;
insert into t_items select 'inline', (create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'From a row', 'a1', '{}', null, 'inline')).id;
insert into t_items select 'intake', (create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'From the intake form', 'a2', '{}', null, 'dialog', 'a46a46a4-3333-0000-0000-000000000001')).id;
insert into t_items select 'plain', (create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'Old caller', 'a3')).id;

select is((select new_value->'source' from activity_log a join t_items t on t.id = a.item_id
            where t.label = 'dialog' and a.action = 'item.created'),
          '{"via":"dialog"}'::jsonb, 'the dialog is recorded in the item.created entry');
select is((select new_value->'source' from activity_log a join t_items t on t.id = a.item_id
            where t.label = 'inline' and a.action = 'item.created'),
          '{"via":"inline"}'::jsonb, 'an inline row is recorded');
select is((select new_value->'source' from activity_log a join t_items t on t.id = a.item_id
            where t.label = 'intake' and a.action = 'item.created'),
          '{"via":"dialog","intake_form":"Report a nonconformity","intake_form_id":"a46a46a4-3333-0000-0000-000000000001"}'::jsonb,
          'the new-item form the dialog asked is recorded by id and name');
select is((select new_value ? 'source' from activity_log a join t_items t on t.id = a.item_id
            where t.label = 'plain' and a.action = 'item.created'),
          false, 'a caller that sends no source writes the entry as before');
select is((select count(*)::int from items i join t_items t on t.id = i.id
            where i.source_form_id is not null or i.source_channel is not null),
          0, 'an item from the dialog never counts as a form answer');
select is((select new_value->>'name' from activity_log a join t_items t on t.id = a.item_id
            where t.label = 'intake' and a.action = 'item.created'),
          'From the intake form', 'the entry keeps the name and values beside the source');

select throws_ok($$ select create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'Bad', 'a4', '{}', null, 'import') $$, 'unknown source import', 'only the dialog and inline rows are sources');
select throws_ok($$ select create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'Bad', 'a4', '{}', null, 'inline', 'a46a46a4-3333-0000-0000-000000000001') $$,
  'a new-item form is asked only by the dialog', 'an inline row names no form');
select throws_ok($$ select create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'Bad', 'a4', '{}', null, 'dialog', 'a46a46a4-3333-0000-0000-000000000002') $$,
  'form not found', 'a form of another sheet is refused');
select throws_ok($$ select create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'Bad', 'a4', '{}', null, 'dialog', 'a46a46a4-3333-0000-0000-000000000003') $$,
  'form not found', 'a view that is not a form is refused');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000046a2","role":"authenticated"}', true);
select throws_ok($$ select create_item('a46a46a4-1111-0000-0000-000000000000', 'a46a46a4-2222-0000-0000-000000000001',
  'Viewer', 'a5', '{}', null, 'dialog') $$, 'not allowed', 'a viewer still cannot add items');

reset role;
select is((select count(*)::int from pg_proc where proname = 'create_item'), 1,
          'one create_item: calls by position resolve to it');
select ok(not has_function_privilege('anon', 'create_item(uuid, uuid, text, text, jsonb, uuid, text, uuid)', 'execute'),
          'signed-out visitors cannot call create_item');

select * from finish();
rollback;
