-- Writes as an automation, run rows and counters (0010_automations.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a0a1', 'owner@au.test'),
  ('00000000-0000-0000-0000-00000000a0a2', 'editor@au.test'),
  ('00000000-0000-0000-0000-00000000a0a3', 'viewer@au.test'),
  ('00000000-0000-0000-0000-00000000a0a4', 'outsider@au.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@au.test';
insert into orgs (id, name, slug) values
  ('a0a0a0a0-0000-0000-0000-000000000000', 'Auto Org', 'auto-org'),
  ('a0a0a0a0-0000-0000-0000-00000000000b', 'Other Org', 'other-auto-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a0a1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a0a0a0a0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a0a1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('a0a0a0a0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a0a2', 'editor'),
  ('a0a0a0a0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a0a3', 'viewer');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a0a4","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a0a0a0a0-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a0a4', 'owner');
select set_config('request.jwt.claims', '', true);

insert into sheets (id, org_id, name, id_prefix, position) values
  ('a0a0a0a0-1111-0000-0000-000000000000', 'a0a0a0a0-0000-0000-0000-000000000000', 'Actions', 'AU-', 'a0'),
  ('a0a0a0a0-1111-0000-0000-00000000000b', 'a0a0a0a0-0000-0000-0000-00000000000b', 'Other', 'OT-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('a0a0a0a0-2222-0000-0000-000000000001', 'a0a0a0a0-0000-0000-0000-000000000000', 'a0a0a0a0-1111-0000-0000-000000000000', 'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('a0a0a0a0-3333-0000-0000-000000000001', 'a0a0a0a0-0000-0000-0000-000000000000', 'a0a0a0a0-1111-0000-0000-000000000000',
   'notes', 'Notes', 'text', 'a0', '{}');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by, enabled) values
  ('a0a0a0a0-4444-0000-0000-000000000001', 'a0a0a0a0-0000-0000-0000-000000000000', 'a0a0a0a0-1111-0000-0000-000000000000',
   'On', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000a0a2', true),
  ('a0a0a0a0-4444-0000-0000-000000000002', 'a0a0a0a0-0000-0000-0000-000000000000', 'a0a0a0a0-1111-0000-0000-000000000000',
   'Off', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000a0a2', false),
  ('a0a0a0a0-4444-0000-0000-00000000000b', 'a0a0a0a0-0000-0000-0000-00000000000b', 'a0a0a0a0-1111-0000-0000-00000000000b',
   'Elsewhere', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-00000000a0a4', true);
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position, locked, lock_reason) values
  ('a0a0a0a0-5555-0000-0000-000000000001', 'a0a0a0a0-0000-0000-0000-000000000000', 'a0a0a0a0-1111-0000-0000-000000000000',
   'a0a0a0a0-2222-0000-0000-000000000001', 1, 'AU-001', 'Approved item', 'a0', true, 'Approved');

-- ───────────── who may write as an automation ─────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a0a3","role":"authenticated"}', true);
select throws_ok($$ select set_item_values('a0a0a0a0-5555-0000-0000-000000000001',
                    '{"a0a0a0a0-3333-0000-0000-000000000001":"x"}', null, 'a0a0a0a0-4444-0000-0000-000000000001') $$,
  'P0001', 'not allowed', 'a viewer cannot write by naming an enabled automation');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a0a2","role":"authenticated"}', true);
select throws_ok($$ select set_item_values('a0a0a0a0-5555-0000-0000-000000000001',
                    '{"a0a0a0a0-3333-0000-0000-000000000001":"x"}', null, 'a0a0a0a0-4444-0000-0000-000000000001') $$,
  'P0001', 'not allowed', 'an editor cannot write to a locked item by posing as an automation');
select throws_ok($$ select set_item_lock('a0a0a0a0-5555-0000-0000-000000000001', false, null,
                    'a0a0a0a0-4444-0000-0000-000000000001') $$,
  'P0001', 'not allowed', 'an editor cannot unlock by posing as an automation');
select throws_ok($$ select set_item_values('a0a0a0a0-5555-0000-0000-000000000001',
                    '{"a0a0a0a0-3333-0000-0000-000000000001":"x"}') $$,
  'P0001', 'item locked: Approved', 'an editor still cannot edit a locked item');

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ select set_item_values('a0a0a0a0-5555-0000-0000-000000000001',
                   '{"a0a0a0a0-3333-0000-0000-000000000001":"Set by the runner"}', null,
                   'a0a0a0a0-4444-0000-0000-000000000001') $$,
  'the runner (service role) writes to a locked item as an enabled automation');
select results_eq($$ select actor_kind, actor_id from activity_log
                      where item_id = 'a0a0a0a0-5555-0000-0000-000000000001' and action = 'value.changed' $$,
  $$ values ('automation'::text, 'a0a0a0a0-4444-0000-0000-000000000001'::uuid) $$,
  'the activity log names the automation');
select throws_ok($$ select set_item_values('a0a0a0a0-5555-0000-0000-000000000001',
                    '{"a0a0a0a0-3333-0000-0000-000000000001":"x"}', null, 'a0a0a0a0-4444-0000-0000-000000000002') $$,
  'P0001', 'not allowed', 'a disabled automation cannot write');
select throws_ok($$ select set_item_values('a0a0a0a0-5555-0000-0000-000000000001',
                    '{"a0a0a0a0-3333-0000-0000-000000000001":"x"}', null, 'a0a0a0a0-4444-0000-0000-00000000000b') $$,
  'P0001', 'not allowed', 'an automation of another workspace cannot write');

-- ───────────── run rows and counters ─────────────
select ok(not has_function_privilege('authenticated',
  'record_automation_run(uuid, uuid, jsonb, text, text, jsonb, integer, uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon',
  'record_automation_run(uuid, uuid, jsonb, text, text, jsonb, integer, uuid, timestamptz)', 'execute'),
  'only the runner records runs');
select lives_ok($$ select record_automation_run('a0a0a0a0-4444-0000-0000-000000000001', 'a0a0a0a0-5555-0000-0000-000000000001',
                   '{"type":"item.created"}', 'done', '', '[{"action":"lock_item","outcome":"done"}]', 0,
                   gen_random_uuid(), now()) $$, 'the runner records a run');
select throws_ok($$ select record_automation_run('a0a0a0a0-4444-0000-0000-00000000000b', 'a0a0a0a0-5555-0000-0000-000000000001',
                    '{}', 'done', '', '[]', 0, gen_random_uuid(), now()) $$,
  'P0001', 'item not in workspace', 'a run cannot point at an item of another workspace');
select results_eq($$ select run_count, last_run_at is not null from automations where id = 'a0a0a0a0-4444-0000-0000-000000000001' $$,
  $$ values (1, true) $$, 'the counters are bumped');
select is((select count(*)::int from activity_log
            where sheet_id = 'a0a0a0a0-1111-0000-0000-000000000000' and action = 'automations.update'), 0,
  'counters are bookkeeping, not audited');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a0a3","role":"authenticated"}', true);
select is((select count(*)::int from automation_runs where org_id = 'a0a0a0a0-0000-0000-0000-000000000000'), 1,
  'members read the run log of their workspace');
select throws_ok($$ insert into automation_runs(org_id, automation_id, event, status, chain_id)
                    values ('a0a0a0a0-0000-0000-0000-000000000000', 'a0a0a0a0-4444-0000-0000-000000000001', '{}', 'done',
                            gen_random_uuid()) $$,
  '42501', null, 'people cannot write run rows');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a0a4","role":"authenticated"}', true);
select is((select count(*)::int from automation_runs where org_id = 'a0a0a0a0-0000-0000-0000-000000000000'), 0,
  'another workspace cannot read the run log');

select * from finish();
rollback;
