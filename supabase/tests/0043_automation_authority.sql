-- Automation targets are checked in the database, and again before every run (0052, SA-1, M1). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d0001', 'aut-owner@a.test'),
  ('00000000-0000-0000-0000-0000000d0002', 'aut-eve@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000d0001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-0000000d0002', 'Eve Editor', 'EE');
insert into orgs (id, name, slug) values ('d0000000-0000-0000-0000-00000000000a', 'Automations A', 'pgtap-autauth-a');
insert into memberships (org_id, user_id, role) values
  ('d0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000d0001', 'owner'),
  ('d0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000d0002', 'editor');
-- T: Eve's tasks; R: a restricted HR sheet Eve is not listed on; U: an open sheet
insert into sheets (id, org_id, name, id_prefix, position) values
  ('d0000001-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'Tasks', 'TSK-', 'a0'),
  ('d0000001-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a', 'Whistleblowing', 'WB-', 'a1'),
  ('d0000001-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000000a', 'Follow-ups', 'FU-', 'a2');
select set_config('app.access_op', 'on', true);
update sheets set restricted = true, access_inherit = false where id = 'd0000001-0000-0000-0000-000000000002';
select set_config('app.access_op', '', true);
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('d0000004-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'd0000001-0000-0000-0000-000000000001',
   'case', 'Case', 'link', 'a0', '{"targetSheetId": "d0000001-0000-0000-0000-000000000002"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000d000' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
create function pg_temp.auto(id text, actions text) returns text language sql as $$
  select format($f$insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by)
                  values (%L, 'd0000000-0000-0000-0000-00000000000a', 'd0000001-0000-0000-0000-000000000001', 'A',
                          '{"type":"item_created"}', %L, auth.uid())$f$, id, actions)
$$;
grant execute on function pg_temp.auto(text, text) to authenticated;

set local role authenticated;
select pg_temp.as_user('2');

select throws_ok(pg_temp.auto('d0000007-0000-0000-0000-000000000001',
  '[{"type":"create_item","sheetId":"d0000001-0000-0000-0000-000000000002","name":"{name}"}]'),
  '42501', 'access: You cannot edit a sheet you cannot open, so this automation cannot write to it.',
  'an editor cannot insert an automation that creates items in a restricted sheet they cannot edit');
select throws_ok(pg_temp.auto('d0000007-0000-0000-0000-000000000002',
  '[{"type":"update_linked","path":{"linkFieldKey":"case"},"fieldKey":"status","value":"x"}]'),
  '42501', null, 'nor one that updates items linked in that sheet');
select throws_ok(pg_temp.auto('d0000007-0000-0000-0000-000000000003',
  '[{"type":"update_linked","path":{"direction":"in","sheetId":"d0000001-0000-0000-0000-000000000002","linkFieldKey":"x"},"fieldKey":"y","value":1}]'),
  '42501', null, 'nor one that updates the items of that sheet linking here');
select throws_ok(pg_temp.auto('d0000007-0000-0000-0000-000000000004',
  '[{"type":"sync_requirement_checks","sheetId":"d0000001-0000-0000-0000-000000000002"}]'),
  '42501', null, 'nor one that syncs requirement checks into it');
select lives_ok(pg_temp.auto('d0000007-0000-0000-0000-000000000005',
  '[{"type":"create_item","sheetId":"d0000001-0000-0000-0000-000000000003","name":"{name}"}]'),
  'an automation that writes to a sheet the editor can edit is saved');
select is((select acts_as from automations where id = 'd0000007-0000-0000-0000-000000000005'),
  '00000000-0000-0000-0000-0000000d0002'::uuid, 'and acts as its creator');
select throws_ok($$ update automations set actions = '[{"type":"create_item","sheetId":"d0000001-0000-0000-0000-000000000002"}]'
                    where id = 'd0000007-0000-0000-0000-000000000005' $$,
  '42501', null, 'adding a restricted target to a saved automation is refused too');
select lives_ok($$ update automations set enabled = false where id = 'd0000007-0000-0000-0000-000000000005' $$,
  'switching it off is never refused');
select throws_ok($$ select * from automation_authority(array['d0000007-0000-0000-0000-000000000005'::uuid]) $$,
  '42501', null, 'people cannot call the runner''s check');
reset role;

-- the runner's check, before every run (service role)
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select stop_reason from automation_authority(array['d0000007-0000-0000-0000-000000000005'::uuid])), null,
  'it may run while its creator can edit every sheet it writes to');
reset role;
select set_config('app.access_op', 'on', true);
update sheets set restricted = true, access_inherit = false where id = 'd0000001-0000-0000-0000-000000000003';
set local role service_role;
select is((select stop_reason from automation_authority(array['d0000007-0000-0000-0000-000000000005'::uuid])),
  'Stopped: Eve Editor can no longer edit Follow-ups. Someone who can should save the automation again.',
  'it stops, saying why, once its creator can no longer edit a target');
reset role;
update memberships set role = 'viewer' where user_id = '00000000-0000-0000-0000-0000000d0002';
set local role service_role;
select matches((select stop_reason from automation_authority(array['d0000007-0000-0000-0000-000000000005'::uuid])),
  '^Stopped: Eve Editor can no longer edit in this workspace', 'or once they are no longer an editor');
reset role;
delete from memberships where user_id = '00000000-0000-0000-0000-0000000d0002';
set local role service_role;
select matches((select stop_reason from automation_authority(array['d0000007-0000-0000-0000-000000000005'::uuid])),
  '^Stopped: Eve Editor is no longer a member of this workspace', 'or once they have left the workspace');
reset role;

select * from finish();
rollback;
