-- The automation builder's writes and per-item pauses (0011_automation_builder.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000b0b1', 'owner@ab.test'),
  ('00000000-0000-0000-0000-00000000b0b2', 'editor@ab.test'),
  ('00000000-0000-0000-0000-00000000b0b3', 'viewer@ab.test'),
  ('00000000-0000-0000-0000-00000000b0b4', 'outsider@ab.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@ab.test';
insert into orgs (id, name, slug) values
  ('b0b0b0b0-0000-0000-0000-000000000000', 'Builder Org', 'builder-org'),
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'Other Builder Org', 'other-builder-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b0b1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('b0b0b0b0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('b0b0b0b0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b2', 'editor'),
  ('b0b0b0b0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b3', 'viewer');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b0b4","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('b0b0b0b0-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000b0b4', 'owner');
select set_config('request.jwt.claims', '', true);

insert into sheets (id, org_id, name, id_prefix, position) values
  ('b0b0b0b0-1111-0000-0000-000000000001', 'b0b0b0b0-0000-0000-0000-000000000000', 'Actions', 'AB-', 'a0'),
  ('b0b0b0b0-1111-0000-0000-000000000002', 'b0b0b0b0-0000-0000-0000-000000000000', 'Risks', 'RB-', 'a1'),
  ('b0b0b0b0-1111-0000-0000-00000000000b', 'b0b0b0b0-0000-0000-0000-00000000000b', 'Other', 'OB-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('b0b0b0b0-2222-0000-0000-000000000001', 'b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000001', 'Open', 'a0'),
  ('b0b0b0b0-2222-0000-0000-000000000002', 'b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000002', 'Open', 'a0'),
  ('b0b0b0b0-2222-0000-0000-00000000000b', 'b0b0b0b0-0000-0000-0000-00000000000b', 'b0b0b0b0-1111-0000-0000-00000000000b', 'Open', 'a0');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by, locked) values
  ('b0b0b0b0-4444-0000-0000-000000000001', 'b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000001',
   'Custom', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000b0b2', false),
  ('b0b0b0b0-4444-0000-0000-000000000002', 'b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000001',
   'From a pack', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000b0b1', true),
  ('b0b0b0b0-4444-0000-0000-00000000000b', 'b0b0b0b0-0000-0000-0000-00000000000b', 'b0b0b0b0-1111-0000-0000-00000000000b',
   'Elsewhere', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000b0b4', false);
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('b0b0b0b0-5555-0000-0000-000000000001', 'b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000001',
   'b0b0b0b0-2222-0000-0000-000000000001', 1, 'AB-001', 'First', 'a0'),
  ('b0b0b0b0-5555-0000-0000-000000000002', 'b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000002',
   'b0b0b0b0-2222-0000-0000-000000000002', 1, 'RB-001', 'A risk', 'a0'),
  ('b0b0b0b0-5555-0000-0000-00000000000b', 'b0b0b0b0-0000-0000-0000-00000000000b', 'b0b0b0b0-1111-0000-0000-00000000000b',
   'b0b0b0b0-2222-0000-0000-00000000000b', 1, 'OB-001', 'Theirs', 'a0');

set local role authenticated;

-- ───────────── automations: editors, locked rows, consistent rows ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b0b2","role":"authenticated"}', true);
select lives_ok($$ insert into automations (org_id, sheet_id, name, trigger, actions, created_by)
                   values ('b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000001', 'Mine',
                           '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000b0b2') $$,
  'an editor creates an automation on a sheet of the workspace');
select throws_ok($$ insert into automations (org_id, sheet_id, name, trigger, actions, created_by)
                    values ('b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-00000000000b', 'Sneaky',
                            '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000b0b2') $$,
  '42501', null, 'an editor cannot attach an automation to a sheet of another workspace');
select throws_ok($$ insert into automations (org_id, sheet_id, name, trigger, actions, created_by)
                    values ('b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000001', 'Not me',
                            '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000b0b1') $$,
  '42501', null, 'the creator is the person creating it');
select throws_ok($$ insert into automations (org_id, sheet_id, name, trigger, actions, created_by, run_count)
                    values ('b0b0b0b0-0000-0000-0000-000000000000', 'b0b0b0b0-1111-0000-0000-000000000001', 'Busy',
                            '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000b0b2', 99) $$,
  '42501', null, 'a new automation starts with no runs');
select lives_ok($$ update automations set enabled = false, name = 'Custom, off'
                   where id = 'b0b0b0b0-4444-0000-0000-000000000001' $$,
  'an editor turns off and renames an automation');
update automations set name = 'Edited' where id = 'b0b0b0b0-4444-0000-0000-000000000002';
select results_eq($$ select name from automations where id = 'b0b0b0b0-4444-0000-0000-000000000002' $$,
  $$ values ('From a pack'::text) $$, 'an editor cannot edit a locked automation');
delete from automations where id = 'b0b0b0b0-4444-0000-0000-000000000002';
select results_eq($$ select count(*)::int from automations where id = 'b0b0b0b0-4444-0000-0000-000000000002' $$,
  $$ values (1) $$, 'an editor cannot delete a locked automation');
select throws_ok($$ update automations set sheet_id = 'b0b0b0b0-1111-0000-0000-000000000002'
                    where id = 'b0b0b0b0-4444-0000-0000-000000000001' $$,
  'P0001', 'automation workspace, sheet and creator are fixed', 'an automation stays on its sheet');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b0b3","role":"authenticated"}', true);
update automations set enabled = true where id = 'b0b0b0b0-4444-0000-0000-000000000001';
select results_eq($$ select enabled from automations where id = 'b0b0b0b0-4444-0000-0000-000000000001' $$,
  $$ values (false) $$, 'a viewer cannot turn an automation on');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b0b1","role":"authenticated"}', true);
select lives_ok($$ update automations set name = 'From a pack, adjusted' where id = 'b0b0b0b0-4444-0000-0000-000000000002' $$,
  'an admin edits a locked automation');

-- ───────────── pauses ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b0b3","role":"authenticated"}', true);
select throws_ok($$ select set_automation_pause('b0b0b0b0-4444-0000-0000-000000000001', 'b0b0b0b0-5555-0000-0000-000000000001', true) $$,
  'P0001', 'not allowed', 'a viewer cannot pause an automation');
select throws_ok($$ insert into automation_pauses (automation_id, item_id, org_id, paused_by)
                    values ('b0b0b0b0-4444-0000-0000-000000000001', 'b0b0b0b0-5555-0000-0000-000000000001',
                            'b0b0b0b0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b3') $$,
  '42501', null, 'a viewer cannot write pauses directly');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b0b2","role":"authenticated"}', true);
select is(set_automation_pause('b0b0b0b0-4444-0000-0000-000000000001', 'b0b0b0b0-5555-0000-0000-000000000001', true),
  true, 'an editor pauses an automation for one item');
select results_eq($$ select action, note, actor_kind from activity_log
                      where item_id = 'b0b0b0b0-5555-0000-0000-000000000001' order by id $$,
  $$ values ('automation.paused'::text, 'Custom, off'::text, 'user'::text) $$,
  'the pause is logged on the item''s chain');
select is(set_automation_pause('b0b0b0b0-4444-0000-0000-000000000001', 'b0b0b0b0-5555-0000-0000-000000000001', true),
  true, 'pausing twice is harmless');
select is((select count(*)::int from activity_log where item_id = 'b0b0b0b0-5555-0000-0000-000000000001'), 1,
  'and logs once');
select throws_ok($$ select set_automation_pause('b0b0b0b0-4444-0000-0000-000000000001', 'b0b0b0b0-5555-0000-0000-000000000002', true) $$,
  'P0001', 'automation not found', 'an automation can be paused only on items of its own sheet');
select throws_ok($$ insert into automation_pauses (automation_id, item_id, org_id, paused_by)
                    values ('b0b0b0b0-4444-0000-0000-00000000000b', 'b0b0b0b0-5555-0000-0000-00000000000b',
                            'b0b0b0b0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b2') $$,
  '42501', null, 'an editor cannot pause automations of another workspace by naming their ids');
select is(set_automation_pause('b0b0b0b0-4444-0000-0000-000000000001', 'b0b0b0b0-5555-0000-0000-000000000001', false),
  false, 'an editor resumes it');

select * from finish();
rollback;
