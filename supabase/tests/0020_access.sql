-- P2 access control (0025–0028, docs/02 §16): a role × object matrix over a restricted sheet, folder inheritance,
-- sub-item sheets, the auditor role and its end date, restricted fields, and the logs. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(106);

-- ───────────────────────── people ─────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'acc-owner@a.test'),
  ('00000000-0000-0000-0000-00000000a002', 'acc-admin-out@a.test'),
  ('00000000-0000-0000-0000-00000000a003', 'acc-admin-in@a.test'),
  ('00000000-0000-0000-0000-00000000a004', 'acc-editor-in@a.test'),
  ('00000000-0000-0000-0000-00000000a005', 'acc-editor-out@a.test'),
  ('00000000-0000-0000-0000-00000000a006', 'acc-commenter@a.test'),
  ('00000000-0000-0000-0000-00000000a007', 'acc-viewer-in@a.test'),
  ('00000000-0000-0000-0000-00000000a008', 'acc-auditor@a.test'),
  ('00000000-0000-0000-0000-00000000a009', 'acc-auditor-old@a.test'),
  ('00000000-0000-0000-0000-00000000a00a', 'acc-other@b.test'),
  ('00000000-0000-0000-0000-00000000a00b', 'acc-viewer-out@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-00000000a001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-00000000a002', 'Adam Out', 'AO'),
  ('00000000-0000-0000-0000-00000000a003', 'Ada In', 'AI'),
  ('00000000-0000-0000-0000-00000000a004', 'Eve In', 'EI'),
  ('00000000-0000-0000-0000-00000000a005', 'Ed Out', 'EO'),
  ('00000000-0000-0000-0000-00000000a006', 'Cleo Commenter', 'CC'),
  ('00000000-0000-0000-0000-00000000a007', 'Vic In', 'VI'),
  ('00000000-0000-0000-0000-00000000a008', 'Aud Active', 'AA'),
  ('00000000-0000-0000-0000-00000000a009', 'Aud Expired', 'AE'),
  ('00000000-0000-0000-0000-00000000a00a', 'Xena Other', 'XO'),
  ('00000000-0000-0000-0000-00000000a00b', 'Val Out', 'VO');
insert into orgs (id, name, slug) values
  ('ac000000-0000-0000-0000-000000000000', 'Access A', 'pgtap-access-a'),
  ('ac000000-0000-0000-0000-00000000000b', 'Access B', 'pgtap-access-b');
insert into memberships (org_id, user_id, role, expires_at) values
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a001', 'owner', null),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a002', 'admin', null),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a003', 'admin', null),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a004', 'editor', null),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a005', 'editor', null),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a006', 'editor', null),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a007', 'viewer', null),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a008', 'auditor', now() + interval '30 days'),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a009', 'auditor', now() + interval '30 days'),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a00b', 'viewer', null),
  ('ac000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a00a', 'owner', null);

select throws_ok($$ insert into memberships (org_id, user_id, role) values
  ('ac000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a008', 'auditor') $$,
  '23514', null, 'an auditor always has an end date');
select is((select count(*)::int from activity_log where action = 'member.added'
            and org_id = 'ac000000-0000-0000-0000-000000000000' and new_value->>'role' = 'auditor'), 2,
  'adding an auditor is logged on the workspace chain');

-- ───────────────────────── structure (as the system) ─────────────────────────
-- F: a restricted folder. Sheets: R (restricted on its own), O (open), RC (R's sub-items), FS (in F, follows it),
-- FO (in F, open on its own).
insert into folders (id, org_id, name, position) values
  ('ac000002-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'HR', 'a0');
insert into sheets (id, org_id, name, id_prefix, position, folder_id) values
  ('ac000001-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'Investigations', 'INV-', 'a0', null),
  ('ac000001-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000000', 'Staff', 'STF-', 'a1', null),
  ('ac000001-0000-0000-0000-000000000004', 'ac000000-0000-0000-0000-000000000000', 'Grievances', 'GRV-', 'a2',
   'ac000002-0000-0000-0000-000000000001'),
  ('ac000001-0000-0000-0000-000000000005', 'ac000000-0000-0000-0000-000000000000', 'HR policies', 'HRP-', 'a3',
   'ac000002-0000-0000-0000-000000000001');
insert into sheets (id, org_id, name, id_prefix, position, parent_sheet_id) values
  ('ac000001-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000000', 'Investigation steps', null, 'a0',
   'ac000001-0000-0000-0000-000000000001');
insert into groups (id, org_id, sheet_id, name, position) values
  ('ac000003-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000001', 'Open', 'a0'),
  ('ac000003-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002', 'All', 'a0'),
  ('ac000003-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000003', 'Steps', 'a0'),
  ('ac000003-0000-0000-0000-000000000004', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000004', 'Open', 'a0'),
  ('ac000003-0000-0000-0000-000000000005', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000005', 'All', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('ac000004-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000001',
   'finding', 'Finding', 'text', 'a0', '{}'),
  ('ac000004-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002',
   'case', 'Case', 'link', 'a0', '{"targetSheetId":"ac000001-0000-0000-0000-000000000001","multiple":true}'),
  ('ac000004-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002',
   'salary', 'Salary', 'number', 'a1', '{}'),
  ('ac000004-0000-0000-0000-000000000004', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002',
   'manager', 'Manager', 'people', 'a2', '{"multiple":false}'),
  ('ac000004-0000-0000-0000-000000000005', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000003',
   'step_note', 'Note', 'text', 'a0', '{}');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position, values) values
  ('ac000005-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000001',
   'ac000003-0000-0000-0000-000000000001', 1, 'INV-001', 'Theft at the warehouse', 'a0',
   '{"ac000004-0000-0000-0000-000000000001":"camera 4"}'),
  ('ac000005-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000001',
   'ac000003-0000-0000-0000-000000000001', 2, 'INV-002', 'Bullying report', 'a1', '{}'),
  ('ac000005-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002',
   'ac000003-0000-0000-0000-000000000002', 1, 'STF-001', 'Sam Staff', 'a0',
   '{"ac000004-0000-0000-0000-000000000003": 41000, "ac000004-0000-0000-0000-000000000004": ["00000000-0000-0000-0000-00000000a004"]}'),
  ('ac000005-0000-0000-0000-000000000005', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000004',
   'ac000003-0000-0000-0000-000000000004', 1, 'GRV-001', 'Shift pattern', 'a0', '{}'),
  ('ac000005-0000-0000-0000-000000000006', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000005',
   'ac000003-0000-0000-0000-000000000005', 1, 'HRP-001', 'Leave policy', 'a0', '{}');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position, parent_id, sub_seq) values
  ('ac000005-0000-0000-0000-000000000004', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000003',
   'ac000003-0000-0000-0000-000000000003', 1, 'INV-001.1', 'Interview the guard', 'a0',
   'ac000005-0000-0000-0000-000000000001', 1);
update sheets set next_seq = 3 where org_id = 'ac000000-0000-0000-0000-000000000000';
update items set next_sub_seq = 2 where id = 'ac000005-0000-0000-0000-000000000001';
-- a log entry for the salary written before the field is restricted (the log never changes)
insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value)
values ('ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002', 'ac000005-0000-0000-0000-000000000003',
        '', 'system', null, 'value.changed', 'ac000004-0000-0000-0000-000000000003', '39000', '41000');
insert into item_links (org_id, field_id, from_item, to_item) values
  ('ac000000-0000-0000-0000-000000000000', 'ac000004-0000-0000-0000-000000000002',
   'ac000005-0000-0000-0000-000000000003', 'ac000005-0000-0000-0000-000000000001');
insert into files (id, org_id, item_id, field_id, storage_path, filename, mime_type, size_bytes, sha256, uploaded_by) values
  ('ac000006-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'ac000005-0000-0000-0000-000000000001',
   null, 'org/ac000000-0000-0000-0000-000000000000/item/ac000005-0000-0000-0000-000000000001/ac000006-0000-0000-0000-000000000001/cctv.pdf',
   'cctv.pdf', 'application/pdf', 10, repeat('a', 64), '00000000-0000-0000-0000-00000000a001');
insert into file_access_log (org_id, file_id, item_id, user_id) values
  ('ac000000-0000-0000-0000-000000000000', 'ac000006-0000-0000-0000-000000000001', 'ac000005-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000a001');
insert into item_updates (org_id, item_id, author_id, body) values
  ('ac000000-0000-0000-0000-000000000000', 'ac000005-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001',
   'Spoke to HR');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by) values
  ('ac000007-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000001',
   'Tell HR', '{"type":"item_created"}', '[{"type":"notify","userIds":[]}]', '00000000-0000-0000-0000-00000000a001');
insert into automation_runs (org_id, automation_id, sheet_id, item_id, event, status, chain_id) values
  ('ac000000-0000-0000-0000-000000000000', 'ac000007-0000-0000-0000-000000000001', 'ac000001-0000-0000-0000-000000000001',
   'ac000005-0000-0000-0000-000000000001', '{}', 'done', gen_random_uuid());
insert into views (id, org_id, sheet_id, name, type, config, position) values
  ('ac000008-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000001',
   'Open cases', 'list', '{}', 'a0'),
  ('ac000008-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000001',
   'Report', 'form', '{"form":{"status":"open","access":"internal","fields":[]}}', 'a1');
insert into dashboards (id, org_id, name, position, config, created_by) values
  ('ac000009-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000000', 'HR overview', 'a0',
   '{"widgets":[{"id":"w1","type":"count","title":"Cases","sheetId":"ac000001-0000-0000-0000-000000000001"}]}',
   '00000000-0000-0000-0000-00000000a001');

-- people to authorise in turn
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- What a person reads of the restricted sheet R (its sub-items, links, files, downloads, updates, log, automations,
-- runs, views, forms, form links, notifications) — one line per object kind.
create function pg_temp.seen() returns text language sql as $$
  select concat_ws(' ',
    'sheet=' || (select count(*) from sheets where id in ('ac000001-0000-0000-0000-000000000001', 'ac000001-0000-0000-0000-000000000003')),
    'fields=' || (select count(*) from fields where sheet_id = 'ac000001-0000-0000-0000-000000000001'),
    'items=' || (select count(*) from items where sheet_id = 'ac000001-0000-0000-0000-000000000001'),
    'subitems=' || (select count(*) from items where sheet_id = 'ac000001-0000-0000-0000-000000000003'),
    'links=' || (select count(*) from item_links where to_item = 'ac000005-0000-0000-0000-000000000001'),
    'files=' || (select count(*) from files where item_id = 'ac000005-0000-0000-0000-000000000001'),
    'downloads=' || (select count(*) from file_access_log where item_id = 'ac000005-0000-0000-0000-000000000001'),
    'updates=' || (select count(*) from item_updates where item_id = 'ac000005-0000-0000-0000-000000000001'),
    'log=' || (select (count(*) > 0)::int from activity_log where sheet_id = 'ac000001-0000-0000-0000-000000000001'),
    'automations=' || (select count(*) from automations where sheet_id = 'ac000001-0000-0000-0000-000000000001'),
    'runs=' || (select count(*) from automation_runs where sheet_id = 'ac000001-0000-0000-0000-000000000001'),
    'views=' || (select count(*) from views where sheet_id = 'ac000001-0000-0000-0000-000000000001'),
    'open=' || (select count(*) from items where sheet_id = 'ac000001-0000-0000-0000-000000000002'))
$$;
grant execute on function pg_temp.seen() to authenticated;
-- R as a restricted sheet's row in the menu (owners and admins see its name, nobody else)
create function pg_temp.menu() returns text language sql as $$
  select coalesce((select level from my_sheet_access('ac000000-0000-0000-0000-000000000000')
                    where sheet_id = 'ac000001-0000-0000-0000-000000000001'), 'hidden')
$$;
grant execute on function pg_temp.menu() to authenticated;

set local role authenticated;

-- ───────────────────────── restricting and listing (owner) ─────────────────────────
select pg_temp.as_user('a001');
select is(set_sheet_access('ac000001-0000-0000-0000-000000000001', 'restricted'), 'restricted',
  'an owner restricts a sheet');
select lives_ok($$
  select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'editor');
  select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a004', 'editor');
  select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a006', 'commenter');
  select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a007', 'viewer');
  select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a008', 'viewer');
  select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a009', 'viewer');
  select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a005', 'viewer');
  select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a005', null);
  $$, 'the owner lists people with a level (and takes one off again)');
select is((select string_agg(action, ',' order by id) from activity_log
            where chain_key = 'sheet:ac000001-0000-0000-0000-000000000001'
              and action in ('access.changed', 'access.granted', 'access.revoked')),
  'access.changed,access.granted,access.granted,access.granted,access.granted,access.granted,access.granted,access.granted,access.revoked',
  'restricting, every grant and the revoke are logged on the sheet chain');
select is(set_folder_access('ac000002-0000-0000-0000-000000000001', true), true, 'an owner restricts a folder');
select lives_ok($$
  select set_access_grant('folder', 'ac000002-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a004', 'viewer');
  select set_sheet_access('ac000001-0000-0000-0000-000000000005', 'open') $$,
  'a folder lists people; a sheet in it can be opened on its own setting');
select throws_ok($$ select set_sheet_access('ac000001-0000-0000-0000-000000000003', 'open') $$,
  'access: Sub-items follow the access of their sheet.', 'sub-item sheets follow their parent sheet');
reset role;
update memberships set expires_at = now() - interval '1 minute'
 where user_id = '00000000-0000-0000-0000-00000000a009';
insert into notifications (org_id, user_id, item_id, kind, body) values
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a004', 'ac000005-0000-0000-0000-000000000001', 'notify', 'For Eve'),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a005', 'ac000005-0000-0000-0000-000000000001', 'notify', 'For Ed'),
  ('ac000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a002', 'ac000005-0000-0000-0000-000000000001', 'mention', 'For Adam');
select is((select string_agg(user_id::text, ',' order by user_id) from notifications
            where item_id = 'ac000005-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-00000000a004',
  'notifications about an item reach only people who can read it (the others are dropped, whoever sends them)');
select is((select count(*)::int from activity_log where action = 'member.changed'
            and new_value->>'user_id' = '00000000-0000-0000-0000-00000000a009'), 1, 'changing an end date is logged');
set local role authenticated;

-- ───────────────────────── the matrix: reading the restricted sheet ─────────────────────────
select pg_temp.as_user('a001');
select is(pg_temp.seen(),
  'sheet=2 fields=1 items=2 subitems=1 links=1 files=1 downloads=1 updates=1 log=1 automations=1 runs=1 views=2 open=1',
  'owner: everything (owners always see)');
select pg_temp.as_user('a002');
select is(pg_temp.seen(),
  'sheet=0 fields=0 items=0 subitems=0 links=0 files=0 downloads=0 updates=0 log=0 automations=0 runs=0 views=0 open=1',
  'admin not listed: nothing of the restricted sheet, the open sheet as before');
select is(pg_temp.menu(), 'none', 'admin not listed: sees the restricted sheet''s name in the menu, with no access');
select is(sheet_access('ac000001-0000-0000-0000-000000000001'), 'none', 'admin not listed: sheet_access is none');
select pg_temp.as_user('a003');
select is(pg_temp.seen(),
  'sheet=2 fields=1 items=2 subitems=1 links=1 files=1 downloads=1 updates=1 log=1 automations=1 runs=1 views=2 open=1',
  'admin listed: everything');
select pg_temp.as_user('a004');
select is(pg_temp.seen(),
  'sheet=2 fields=1 items=2 subitems=1 links=1 files=1 downloads=1 updates=1 log=1 automations=1 runs=1 views=2 open=1',
  'editor listed: everything');
select is(sheet_access('ac000001-0000-0000-0000-000000000003'), 'editor', 'editor listed: the sub-item sheet follows');
select pg_temp.as_user('a005');
select is(pg_temp.seen(),
  'sheet=0 fields=0 items=0 subitems=0 links=0 files=0 downloads=0 updates=0 log=0 automations=0 runs=0 views=0 open=1',
  'editor not listed (and taken off the list): nothing');
select is(pg_temp.menu(), 'hidden', 'editor not listed: the restricted sheet is not in the menu at all');
select is((select count(*)::int from notifications), 0, 'editor not listed: no notification about the item');
select pg_temp.as_user('a006');
select is(pg_temp.seen(),
  'sheet=2 fields=1 items=2 subitems=1 links=1 files=1 downloads=1 updates=1 log=1 automations=1 runs=1 views=2 open=1',
  'commenter: reads everything');
select is(sheet_access('ac000001-0000-0000-0000-000000000001'), 'commenter', 'commenter: level commenter');
select pg_temp.as_user('a007');
select is(pg_temp.seen(),
  'sheet=2 fields=1 items=2 subitems=1 links=1 files=1 downloads=1 updates=1 log=1 automations=1 runs=1 views=2 open=1',
  'viewer listed: reads everything');
select pg_temp.as_user('a00b');
select is(pg_temp.seen(),
  'sheet=0 fields=0 items=0 subitems=0 links=0 files=0 downloads=0 updates=0 log=0 automations=0 runs=0 views=0 open=1',
  'viewer not listed: nothing');
select pg_temp.as_user('a008');
select is(pg_temp.seen(),
  'sheet=2 fields=1 items=2 subitems=1 links=1 files=1 downloads=1 updates=1 log=1 automations=1 runs=1 views=2 open=1',
  'auditor (active, listed): reads everything, logs and run logs included');
select is(sheet_access('ac000001-0000-0000-0000-000000000002'), 'viewer', 'auditor: read-only on open sheets too');
select pg_temp.as_user('a009');
select is(pg_temp.seen(),
  'sheet=0 fields=0 items=0 subitems=0 links=0 files=0 downloads=0 updates=0 log=0 automations=0 runs=0 views=0 open=0',
  'auditor after the end date: nothing, not even the open sheet');
select is((select count(*)::int from memberships), 0, 'auditor after the end date: not a member any more');
select is((select count(*)::int from dashboards), 0, 'auditor after the end date: no dashboards');
select pg_temp.as_user('a00a');
select is(pg_temp.seen(),
  'sheet=0 fields=0 items=0 subitems=0 links=0 files=0 downloads=0 updates=0 log=0 automations=0 runs=0 views=0 open=0',
  'another workspace: nothing');
select is(pg_temp.menu(), 'hidden', 'another workspace: not in its menu');

-- dashboards are workspace rows; the data behind a widget follows the sheet
select pg_temp.as_user('a002');
select is((select count(*)::int from dashboards where id = 'ac000009-0000-0000-0000-000000000001'), 1,
  'a dashboard over a restricted sheet is still listed');
select is((select level from sheet_levels(array['ac000001-0000-0000-0000-000000000001'::uuid])), 'none',
  'and its widget can tell "No access" from empty');

-- ───────────────────────── the matrix: writing ─────────────────────────
create function pg_temp.try_edit() returns text language plpgsql as $$
begin
  perform set_item_values('ac000005-0000-0000-0000-000000000002', '{"ac000004-0000-0000-0000-000000000001":"x"}');
  return 'ok';
exception when others then return sqlerrm;
end $$;
grant execute on function pg_temp.try_edit() to authenticated;
create function pg_temp.try_comment() returns text language plpgsql as $$
begin
  insert into item_updates (org_id, item_id, author_id, body) values
    ('ac000000-0000-0000-0000-000000000000', 'ac000005-0000-0000-0000-000000000002', auth.uid(), 'A comment');
  return 'ok';
exception when others then return case when sqlstate = '42501' then 'denied' else sqlerrm end;
end $$;
grant execute on function pg_temp.try_comment() to authenticated;

select pg_temp.as_user('a001');
select is(pg_temp.try_edit(), 'ok', 'owner edits');
select is(pg_temp.try_comment(), 'ok', 'owner comments');
select pg_temp.as_user('a002');
select is(pg_temp.try_edit(), 'no access: you cannot edit this sheet', 'admin not listed cannot edit');
select is(pg_temp.try_comment(), 'denied', 'admin not listed cannot comment');
select throws_ok($$ select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001',
                                            '00000000-0000-0000-0000-00000000a002', 'editor') $$,
  'not allowed: only owners and admins with access manage access', 'admin not listed cannot add themselves');
select throws_ok($$ select form_link_create('ac000008-0000-0000-0000-000000000002') $$,
  '42501', null, 'admin not listed cannot publish a link to the restricted sheet''s form (definer functions are held too)');
select pg_temp.as_user('a003');
select is(pg_temp.try_edit(), 'ok', 'admin listed edits');
select lives_ok($$ select set_access_grant('sheet', 'ac000001-0000-0000-0000-000000000001',
                                           '00000000-0000-0000-0000-00000000a00b', 'viewer') $$,
  'admin listed manages the list');
select pg_temp.as_user('a004');
select is(pg_temp.try_edit(), 'ok', 'editor listed edits');
select is(pg_temp.try_comment(), 'ok', 'editor listed comments');
select lives_ok($$ select create_subitem('ac000005-0000-0000-0000-000000000001', 'Check the logs', 'a1') $$,
  'editor listed adds a sub-item (the sub-item sheet follows its parent)');
select throws_ok($$ select set_sheet_access('ac000001-0000-0000-0000-000000000001', 'open') $$,
  'not allowed: only owners and admins with access manage access', 'an editor cannot change access');
select pg_temp.as_user('a005');
select is(pg_temp.try_edit(), 'no access: you cannot edit this sheet', 'editor not listed cannot edit');
select throws_ok($$ select create_subitem('ac000005-0000-0000-0000-000000000001', 'Sneak', 'a2') $$,
  '42501', null, 'editor not listed cannot add a sub-item');
select throws_ok($$ select set_item_links('ac000004-0000-0000-0000-000000000002', 'ac000005-0000-0000-0000-000000000003',
                                          array['ac000005-0000-0000-0000-000000000002'::uuid], 'add') $$,
  '42501', null, 'editor not listed cannot link an open item to a restricted one');
select pg_temp.as_user('a006');
select is(pg_temp.try_edit(), 'no access: you cannot edit this sheet', 'commenter cannot edit values');
select is(pg_temp.try_comment(), 'ok', 'commenter comments');
select throws_ok($$ insert into files (org_id, item_id, field_id, storage_path, filename, mime_type, size_bytes, sha256, uploaded_by)
  values ('ac000000-0000-0000-0000-000000000000', 'ac000005-0000-0000-0000-000000000001', null, 'x/y', 'a.pdf',
          'application/pdf', 1, repeat('b', 64), '00000000-0000-0000-0000-00000000a006') $$,
  '42501', null, 'commenter cannot add files');
select pg_temp.as_user('a007');
select is(pg_temp.try_edit(), 'not allowed', 'viewer cannot edit');
select is(pg_temp.try_comment(), 'denied', 'viewer cannot comment');
select lives_ok($$ select download_file('ac000006-0000-0000-0000-000000000001') $$, 'viewer listed downloads a file');
select pg_temp.as_user('a008');
select is(pg_temp.try_edit(), 'not allowed', 'auditor cannot edit');
select is(pg_temp.try_comment(), 'denied', 'auditor cannot comment');
select lives_ok($$ select download_file('ac000006-0000-0000-0000-000000000001') $$, 'auditor downloads evidence');
select is((select count(*)::int from file_access_log where user_id = '00000000-0000-0000-0000-00000000a008'), 1,
  'and the download is logged');
select throws_ok($$ select submit_internal_form('ac000008-0000-0000-0000-000000000002', 'Auditor answer', '{}', 'a9') $$,
  'not allowed', 'auditor cannot submit an internal form');
select pg_temp.as_user('a005');
select throws_ok($$ select download_file('ac000006-0000-0000-0000-000000000001') $$,
  '42501', null, 'editor not listed cannot download the restricted sheet''s files');
select is((submit_internal_form('ac000008-0000-0000-0000-000000000002', 'Answer', '{}', 'a9'))->>'reason', 'not_found',
  'editor not listed cannot submit the restricted sheet''s internal form');
select pg_temp.as_user('a009');
select throws_ok($$ select download_file('ac000006-0000-0000-0000-000000000001') $$,
  'file not found', 'auditor after the end date cannot download');
select pg_temp.as_user('a00a');
select throws_ok($$ select verify_activity_chain('ac000005-0000-0000-0000-000000000001') $$,
  'not allowed', 'another workspace cannot verify the chain');
select pg_temp.as_user('a005');
select throws_ok($$ select verify_activity_chain('ac000005-0000-0000-0000-000000000001') $$,
  'not allowed', 'editor not listed cannot verify the item''s chain');

-- ───────────────────────── folders ─────────────────────────
select pg_temp.as_user('a004');
select is(sheet_access('ac000001-0000-0000-0000-000000000004'), 'viewer',
  'a sheet follows its restricted folder: listed on the folder as a viewer');
select pg_temp.as_user('a005');
select is((select count(*)::int from items where sheet_id = 'ac000001-0000-0000-0000-000000000004'), 0,
  'a sheet follows its restricted folder: not listed, nothing');
select is((select count(*)::int from items where sheet_id = 'ac000001-0000-0000-0000-000000000005'), 1,
  'a sheet with its own open setting in a restricted folder is open');
select is((select count(*)::int from folders where id = 'ac000002-0000-0000-0000-000000000001'), 1,
  'the folder shows for the open sheet in it');
select throws_ok($$ update sheets set folder_id = 'ac000002-0000-0000-0000-000000000001'
                    where id = 'ac000001-0000-0000-0000-000000000002' $$,
  'no access: you cannot add sheets to this folder', 'an editor cannot move a sheet into a folder they cannot edit');
select throws_ok($$ update sheets set restricted = true where id = 'ac000001-0000-0000-0000-000000000002' $$,
  'access: Restrict a sheet from its Access settings.', 'access settings change only through set_sheet_access');
select pg_temp.as_user('a001');
select lives_ok($$ select set_access_grant('folder', 'ac000002-0000-0000-0000-000000000001',
                                           '00000000-0000-0000-0000-00000000a004', 'editor') $$, 'the owner makes Eve a folder editor');
select pg_temp.as_user('a004');
select throws_ok($$ update sheets set folder_id = null where id = 'ac000001-0000-0000-0000-000000000004' $$,
  'access: Only owners and admins with access can move a sheet into or out of a restricted folder.',
  'a folder editor cannot move a sheet out of a restricted folder (it would open it)');
select pg_temp.as_user('a002');
select throws_ok($$ select set_folder_archived('ac000002-0000-0000-0000-000000000001', true) $$,
  'access: This folder holds restricted sheets you do not have access to.',
  'an admin cannot archive a folder around sheets they cannot see');

-- ───────────────────────── restricted fields ─────────────────────────
select pg_temp.as_user('a004');
select throws_ok($$ select set_field_restriction('ac000004-0000-0000-0000-000000000003', true,
                                                 array['00000000-0000-0000-0000-00000000a004'::uuid], '{}') $$,
  'not allowed: only owners and admins with access restrict fields', 'an editor cannot restrict a field');
select throws_ok($$ update fields set restricted_to = '{"userIds":[]}' where id = 'ac000004-0000-0000-0000-000000000003' $$,
  'access: Restrict a field from its settings.', 'nor set it directly');
select pg_temp.as_user('a001');
select lives_ok($$ select set_field_restriction('ac000004-0000-0000-0000-000000000003', true,
                                                array['00000000-0000-0000-0000-00000000a004'::uuid], array['auditor']);
                   select set_field_restriction('ac000004-0000-0000-0000-000000000004', true,
                                                array['00000000-0000-0000-0000-00000000a004'::uuid], '{}') $$,
  'an owner restricts Salary (Eve and auditors) and Manager (Eve)');
select is((select count(*)::int from activity_log where action = 'field.restricted'
            and sheet_id = 'ac000001-0000-0000-0000-000000000002'), 2, 'restricting a field is logged');
reset role;
select is((select "values" ? 'ac000004-0000-0000-0000-000000000003' or "values" ? 'ac000004-0000-0000-0000-000000000004'
             from items where id = 'ac000005-0000-0000-0000-000000000003'), false,
  'the values left items.values for the restricted store');
set local role authenticated;
select pg_temp.as_user('a004');
select is(pg_temp.try_edit(), 'ok', '(editor listed still edits)');
select lives_ok($$ select set_item_values('ac000005-0000-0000-0000-000000000003', '{"ac000004-0000-0000-0000-000000000003": 43000}') $$,
  'a listed person changes the restricted value');
select is((select value from restricted_values where item_id = 'ac000005-0000-0000-0000-000000000003'
            and field_id = 'ac000004-0000-0000-0000-000000000003'), '43000'::jsonb, 'a listed person reads it');
select is((select ra.new_value from restricted_activity ra join activity_log a on a.id = ra.activity_id
            where a.item_id = 'ac000005-0000-0000-0000-000000000003' order by a.id desc limit 1), '43000'::jsonb,
  'and its history');
select pg_temp.as_user('a008');
select is((select count(*)::int from restricted_values where field_id = 'ac000004-0000-0000-0000-000000000003'), 1,
  'a role on the list (auditor) reads it');
select pg_temp.as_user('a002');
select is((select count(*)::int from restricted_values), 0, 'an admin not on the list reads no restricted value');
select is((select count(*)::int from restricted_activity), 0, 'nor its history');
select is((select "values" ? 'ac000004-0000-0000-0000-000000000003' from items where id = 'ac000005-0000-0000-0000-000000000003'),
  false, 'items.values never holds it');
select is((select count(*)::int from activity_log where item_id = 'ac000005-0000-0000-0000-000000000003'
            and field_id = 'ac000004-0000-0000-0000-000000000003' and not (activity_value_masked(old_value)
                                                                        and activity_value_masked(new_value))), 0,
  'log entries about it are masked, and older ones that hold it in clear are hidden');
select is((select count(*)::int from activity_log where item_id = 'ac000005-0000-0000-0000-000000000003'
            and field_id = 'ac000004-0000-0000-0000-000000000003'), 1,
  'the masked change still shows ("Restricted")');
select is((select count(*)::int from items_for_people('ac000000-0000-0000-0000-000000000000',
                                                      array['00000000-0000-0000-0000-00000000a004'::uuid])), 0,
  'search by person does not find items through a restricted people field');
select pg_temp.as_user('a005');
select throws_ok($$ select set_item_values('ac000005-0000-0000-0000-000000000003', '{"ac000004-0000-0000-0000-000000000003": 1}') $$,
  '42501', 'no access: you cannot change a restricted field', 'an editor not on the list cannot write it blind');
select is(cardinality(filter_item_ids('ac000001-0000-0000-0000-000000000002',
             'i.values->>''ac000004-0000-0000-0000-000000000003'' is not null', '[]')), 0,
  'filters cannot probe a restricted value');
select pg_temp.as_user('a001');
select is((select count(*)::int from restricted_values where item_id = 'ac000005-0000-0000-0000-000000000003'), 2,
  'the owner always reads restricted values');
select lives_ok($$ select create_item('ac000001-0000-0000-0000-000000000002', 'ac000003-0000-0000-0000-000000000002',
                                      'New starter', 'a1', '{"ac000004-0000-0000-0000-000000000003": 30000}') $$,
  'creating an item with a restricted value');
select is((select (new_value->'values'->'ac000004-0000-0000-0000-000000000003') ? '$restricted' from activity_log
            where action = 'item.created' and sheet_id = 'ac000001-0000-0000-0000-000000000002'
            order by id desc limit 1), true, 'item.created masks the restricted value in the log');
select is((verify_activity_chain('ac000005-0000-0000-0000-000000000003'))->>'ok', 'true',
  'the chain verifies with masked entries and their stored values');
select is(set_field_restriction('ac000004-0000-0000-0000-000000000004', false, null, null), null,
  'an owner lifts a restriction');
reset role;
select is((select "values"->'ac000004-0000-0000-0000-000000000004' from items where id = 'ac000005-0000-0000-0000-000000000003'),
  '["00000000-0000-0000-0000-00000000a004"]'::jsonb, 'the values go back into the rows');
set local role authenticated;

-- ───────────────────────── public forms ─────────────────────────
reset role;
insert into fields (id, org_id, sheet_id, key, name, type, position) values
  ('ac000004-0000-0000-0000-000000000006', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002',
   'note', 'Note', 'text', 'a3');
insert into views (id, org_id, sheet_id, name, type, config, position) values
  ('ac000008-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002',
   'Tell us', 'form', jsonb_build_object('form', jsonb_build_object('status', 'open', 'access', 'public',
     'fields', '[{"key":"salary"},{"key":"note"}]'::jsonb,
     'notice', '{"purpose":"p","legalBasis":"contract","recipients":"r","retention":"1 year","rights":"x","version":1,"reviewedVersion":1}'::jsonb)), 'a2');
insert into form_links (org_id, sheet_id, view_id, token) values
  ('ac000000-0000-0000-0000-000000000000', 'ac000001-0000-0000-0000-000000000002', 'ac000008-0000-0000-0000-000000000003',
   repeat('ac', 32));
select is((select string_agg(e->>'key', ',') from jsonb_array_elements(get_public_form(repeat('ac', 32))->'fields') e),
  'note', 'a public form never shows a restricted field');
set local role service_role;
select is((submit_public_form(repeat('ac', 32), repeat('3', 64), 'Visitor',
            '{"ac000004-0000-0000-0000-000000000003": 1}', 'a5', ''))->>'reason', 'invalid',
  'nor accepts one');
reset role;
set local role authenticated;

-- ───────────────────────── break-glass ─────────────────────────
select pg_temp.as_user('a001');
select is(note_sheet_opened('ac000001-0000-0000-0000-000000000001'), true,
  'an owner not on the list opening a restricted sheet is logged');
select is(note_sheet_opened('ac000001-0000-0000-0000-000000000001'), false, 'at most once a day');
select pg_temp.as_user('a003');
select is(note_sheet_opened('ac000001-0000-0000-0000-000000000001'), false, 'people on the list are not logged');
select is((select count(*)::int from activity_log where action = 'restricted.accessed'), 1,
  'the entry is on the sheet chain for the people who can read it');

-- ───────────────────────── grants ─────────────────────────
reset role;
select ok(has_function_privilege('authenticated', 'sheet_access(uuid)', 'execute')
          and has_function_privilege('authenticated', 'set_access_grant(text, uuid, uuid, text)', 'execute')
          and has_function_privilege('authenticated', 'set_field_restriction(uuid, boolean, uuid[], text[])', 'execute')
          and not has_function_privilege('anon', 'set_sheet_access(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'sheet_access(uuid)', 'execute'),
  'the access functions are for signed-in people only');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like '\_%'
              and (has_function_privilege('anon', p.oid, 'execute')
                   or has_function_privilege('authenticated', p.oid, 'execute'))),
  '{}'::text[], 'no internal _ helper is executable by the API roles');
select is((select count(*)::int from pg_policy where polrelid in ('access_grants'::regclass, 'restricted_values'::regclass,
                                                                    'restricted_activity'::regclass)
            and polcmd <> 'r'), 0, 'grants and restricted values have no write policies (functions only)');

select * from finish();
rollback;
