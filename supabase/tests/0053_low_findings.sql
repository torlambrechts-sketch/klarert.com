-- The cheap Low findings (0062: L1, L2, L3, L4, L7, L9). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000098001', 'low-owner@a.test'),
  ('00000000-0000-0000-0000-000000098002', 'low-admin@a.test'),
  ('00000000-0000-0000-0000-000000098003', 'low-vic@a.test'),
  ('00000000-0000-0000-0000-000000098004', 'low-aud@a.test'),
  ('00000000-0000-0000-0000-000000098005', 'low-out@b.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000098001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000098002', 'Ada Admin', 'AA'),
  ('00000000-0000-0000-0000-000000098003', 'Vic Viewer', 'VV'),
  ('00000000-0000-0000-0000-000000098004', 'Aud Ended', 'AE'),
  ('00000000-0000-0000-0000-000000098005', 'Xena Outside', 'XO');
insert into orgs (id, name, slug) values
  ('98000000-0000-0000-0000-00000000000a', 'Lows A', 'pgtap-lows-a'),
  ('98000000-0000-0000-0000-00000000000b', 'Lows B', 'pgtap-lows-b');
insert into memberships (org_id, user_id, role, expires_at) values
  ('98000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000098001', 'owner', null),
  ('98000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000098002', 'admin', null),
  ('98000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000098003', 'viewer', null),
  ('98000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000098004', 'auditor', now() + interval '1 day'),
  ('98000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000098005', 'owner', null);
update memberships set expires_at = now() - interval '1 day' where user_id = '00000000-0000-0000-0000-000000098004';
-- a restricted HR folder with a sheet nobody but the owner is on
insert into folders (id, org_id, name, position) values
  ('98000002-0000-0000-0000-000000000001', '98000000-0000-0000-0000-00000000000a', 'HR investigations', 'a0');
select set_config('app.access_op', 'on', true);
update folders set restricted = true where id = '98000002-0000-0000-0000-000000000001';
select set_config('app.access_op', '', true);
insert into sheets (id, org_id, name, id_prefix, position, folder_id) values
  ('98000001-0000-0000-0000-000000000001', '98000000-0000-0000-0000-00000000000a', 'Cases', 'CAS-', 'a0',
   '98000002-0000-0000-0000-000000000001'),
  ('98000001-0000-0000-0000-000000000002', '98000000-0000-0000-0000-00000000000a', 'Requests', 'REQ-', 'a1', null);
insert into groups (id, org_id, sheet_id, name, position) values
  ('98000003-0000-0000-0000-000000000001', '98000000-0000-0000-0000-00000000000a', '98000001-0000-0000-0000-000000000001', 'All', 'a0'),
  ('98000003-0000-0000-0000-000000000002', '98000000-0000-0000-0000-00000000000a', '98000001-0000-0000-0000-000000000002', 'All', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config, restricted_to) values
  ('98000004-0000-0000-0000-000000000001', '98000000-0000-0000-0000-00000000000a', '98000001-0000-0000-0000-000000000002',
   'hr_contact', 'HR contact', 'people', 'a0', '{}', '{"userIds": [], "roles": []}');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('98000005-0000-0000-0000-000000000001', '98000000-0000-0000-0000-00000000000a', '98000001-0000-0000-0000-000000000001',
   '98000003-0000-0000-0000-000000000001', 1, 'CAS-001', 'Case', 'a0'),
  ('98000005-0000-0000-0000-000000000002', '98000000-0000-0000-0000-00000000000a', '98000001-0000-0000-0000-000000000002',
   '98000003-0000-0000-0000-000000000002', 1, 'REQ-001', 'Request', 'a0');
insert into restricted_values (org_id, sheet_id, item_id, field_id, value) values
  ('98000000-0000-0000-0000-00000000000a', '98000001-0000-0000-0000-000000000002', '98000005-0000-0000-0000-000000000002',
   '98000004-0000-0000-0000-000000000001', '["00000000-0000-0000-0000-000000098003"]');
insert into views (id, org_id, sheet_id, name, type, position) values
  ('98000006-0000-0000-0000-000000000001', '98000000-0000-0000-0000-00000000000a', '98000001-0000-0000-0000-000000000002',
   'Request form', 'form', 'a0');
insert into form_links (org_id, sheet_id, view_id) values
  ('98000000-0000-0000-0000-00000000000a', '98000001-0000-0000-0000-000000000002', '98000006-0000-0000-0000-000000000001');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009800' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;

-- L1: an outsider learns nothing about workspace A's ids
select pg_temp.as_user('5');
select is(folder_hidden_sheet_count('98000002-0000-0000-0000-000000000001'), 0,
  'L1: an outsider cannot count the sheets in another workspace''s folder');
select ok(not sheet_in_org('98000001-0000-0000-0000-000000000001', '98000000-0000-0000-0000-00000000000a'),
  'L1: nor test which workspace a sheet is in');
select ok(not file_object_pending('org/98000000-0000-0000-0000-00000000000a/item/x/y/z.pdf'),
  'L1: nor probe storage paths');

-- L2, L3: the viewer
select pg_temp.as_user('3');
select is((select count(*)::int from form_links), 0, 'L2: a viewer cannot read a form link''s token');
select is((select count(*)::int from activity_log where action like 'folders.%'
            and (new_value ->> 'id') = '98000002-0000-0000-0000-000000000001'), 0,
  'L3: nor the log entries of a restricted folder she cannot see');
select pg_temp.as_user('2');
select is((select count(*)::int from form_links), 1, 'L2: admins share links');
select ok((select count(*)::int from activity_log where action like 'folders.%'
            and (new_value ->> 'id') = '98000002-0000-0000-0000-000000000001') > 0,
  'L3: admins read the folder''s entries');

-- L4: an auditor whose access ended
select pg_temp.as_user('4');
select is((select count(*)::int from profiles), 1, 'L4: an ended auditor lists nobody but themselves');

-- L9: an admin not listed on the restricted sheet
select pg_temp.as_user('2');
select throws_ok($$ select retention_enqueue('98000000-0000-0000-0000-00000000000a',
                    '[{"item_id":"98000005-0000-0000-0000-000000000001","sheet_id":"98000001-0000-0000-0000-000000000001",
                       "rule_id":"r1","due_on":"2026-01-01"}]') $$,
  '42501', null, 'L9: an admin cannot write retention entries on items of a sheet they cannot open');
reset role;

-- L7: approvers never come from a restricted field; L2 public field configs
select is(_wf_resolve((select i from items i where id = '98000005-0000-0000-0000-000000000002'),
                      '{"kind":"field","fieldKey":"hr_contact"}'), '{}'::uuid[],
  'L7: an approval step never takes its approvers from a restricted field');
select is(_public_field_config('{"options":[{"id":"o1"}],"targetSheetId":"x","allowedUserIds":["u"],"expr":"1"}'),
  '{"options":[{"id":"o1"}]}'::jsonb, 'L2: public forms get a field''s options, not its internal ids or formulas');
select ok(position('_public_field_config(fd.config)' in pg_get_functiondef('get_public_form(text)'::regprocedure)) > 0,
  'L2: get_public_form uses it');

select * from finish();
rollback;
