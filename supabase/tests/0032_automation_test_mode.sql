-- Automation test mode (0042_automation_test_mode.sql, docs/04 §14): a pack plan installs automations in test mode,
-- runs can be logged as test runs, only owners and admins change the mode, and set_pack_automations_mode turns a
-- pack's automations live at once and logs it. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'quiet-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'quiet-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000d1', 'Quiet Admin', 'QA'),
  ('00000000-0000-0000-0000-0000000000d2', 'Quiet Editor', 'QE');
insert into orgs (id, name, slug) values ('d0d0d0d0-0000-0000-0000-000000000000', 'Org D', 'pgtap-quiet');
insert into memberships (org_id, user_id, role) values
  ('d0d0d0d0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000d1', 'admin'),
  ('d0d0d0d0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000d2', 'editor');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-quiet', '1.0.0', 'Quiet pack', '{}', repeat('a', 64));

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
insert into plans values ('quiet', $j${
  "pack": { "key": "pgtap-quiet", "version": "1.0.0", "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  "folders": [],
  "sheets": [{ "id": "d2000000-0000-4000-8000-000000000001", "ref": "risk", "folder_id": null,
      "name": "Quiet risks", "item_label": "Risk", "id_prefix": "QR-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "d3000000-0000-4000-8000-000000000001", "ref": "risk.open", "sheet_id": "d2000000-0000-4000-8000-000000000001", "name": "Open", "color": "blue", "position": "a0" }],
  "fields": [{ "id": "d4000000-0000-4000-8000-000000000001", "ref": "risk.owner", "sheet_id": "d2000000-0000-4000-8000-000000000001", "key": "owner", "name": "Owner", "type": "people", "position": "a0", "width": 160, "config": { "multiple": true } }],
  "views": [], "items": [], "links": [], "dashboards": [],
  "automations": [
    { "id": "d7000000-0000-4000-8000-000000000001", "ref": "tell", "sheet_id": "d2000000-0000-4000-8000-000000000001", "name": "New risk → tell the owner",
      "enabled": true, "mode": "test", "trigger": { "type": "item_created" }, "conditions": [],
      "actions": [{ "type": "notify", "to": ["field:owner"], "message": "{name}" }] },
    { "id": "d7000000-0000-4000-8000-000000000002", "ref": "hook", "sheet_id": "d2000000-0000-4000-8000-000000000001", "name": "New risk → Teams",
      "enabled": false, "mode": "test", "trigger": { "type": "item_created" }, "conditions": [],
      "actions": [{ "type": "webhook", "url": "https://hooks.example.com/x", "preset": "teams" }] },
    { "id": "d7000000-0000-4000-8000-000000000003", "ref": "post", "sheet_id": "d2000000-0000-4000-8000-000000000001", "name": "New risk → post",
      "enabled": true, "trigger": { "type": "item_created" }, "conditions": [],
      "actions": [{ "type": "post_update", "message": "Added" }] }
  ]
}$j$);

select has_column('automations', 'mode', 'automations have a mode');
select col_default_is('automations', 'mode', 'live', 'automations are live unless a plan says otherwise');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select lives_ok($$ select install_pack('d0d0d0d0-0000-0000-0000-000000000000', (select p from plans where name = 'quiet')) $$,
  'an admin installs the pack');
select results_eq($$ select pack_ref, enabled, mode from automations
                      where org_id = 'd0d0d0d0-0000-0000-0000-000000000000' order by pack_ref $$,
  $$ values ('hook', false, 'test'), ('post', true, 'live'), ('tell', true, 'test') $$,
  'the plan''s mode and on/off are installed as planned');

-- only owners and admins change the mode
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select throws_ok($$ update automations set mode = 'live' where id = 'd7000000-0000-4000-8000-000000000001' $$,
  'only owners and admins can turn test mode on or off', 'an editor cannot turn an automation live');
select lives_ok($$ update automations set name = 'Renamed' where id = 'd7000000-0000-4000-8000-000000000003' $$,
  'an editor still edits the rest of an automation');
select throws_ok($$ select set_pack_automations_mode((select id from pack_installs where pack_key = 'pgtap-quiet'), 'live') $$,
  'only owners and admins can turn test mode on or off', 'an editor cannot turn a pack''s automations live');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select lives_ok($$ update automations set mode = 'live' where id = 'd7000000-0000-4000-8000-000000000002' $$,
  'an admin turns one automation live');
select is((select count(*)::int from activity_log where action = 'automations.update'
            and new_value->>'id' = 'd7000000-0000-4000-8000-000000000002' and new_value->>'mode' = 'live'), 1,
  'the change is logged on the sheet''s chain');
select throws_ok($$ select set_pack_automations_mode((select id from pack_installs where pack_key = 'pgtap-quiet'), 'loud') $$,
  'mode must be live or test', 'the mode is live or test');
select is(set_pack_automations_mode((select id from pack_installs where pack_key = 'pgtap-quiet'), 'live'), 1,
  'turning the pack live changes the one still in test mode');
select is((select count(*)::int from automations where org_id = 'd0d0d0d0-0000-0000-0000-000000000000' and mode = 'test'), 0,
  'every automation of the pack is live');
select is((select new_value->>'count' from activity_log where action = 'pack.automations_mode'
            and org_id = 'd0d0d0d0-0000-0000-0000-000000000000'), '1',
  'the workspace log says how many were turned on');
select is(set_pack_automations_mode((select id from pack_installs where pack_key = 'pgtap-quiet'), 'live'), 0,
  'nothing left to turn on: no change, no entry');

reset role;
-- a test run is a run status of its own
select lives_ok($$ insert into automation_runs (org_id, automation_id, sheet_id, event, status, chain_id)
    values ('d0d0d0d0-0000-0000-0000-000000000000', 'd7000000-0000-4000-8000-000000000001',
            'd2000000-0000-4000-8000-000000000001', '{}', 'test', gen_random_uuid()) $$,
  'a run can be stored as a test run');
select ok(has_function_privilege('authenticated', 'set_pack_automations_mode(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'set_pack_automations_mode(uuid, text)', 'execute'),
  'set_pack_automations_mode is for signed-in people only');

select * from finish();
rollback;
