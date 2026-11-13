-- Item files, downloads and controlled documents (0023_item_files.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(35);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000023a1', 'owner@if.test'),
  ('00000000-0000-0000-0000-0000000023a2', 'editor@if.test'),
  ('00000000-0000-0000-0000-0000000023a3', 'viewer@if.test'),
  ('00000000-0000-0000-0000-0000000023a4', 'outsider@if.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@if.test';
insert into orgs (id, name, slug) values
  ('a2a2a2a2-0000-0000-0000-000000000000', 'Files Org', 'files-org'),
  ('a2a2a2a2-0000-0000-0000-00000000000b', 'Other Org', 'files-other');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a2a2a2a2-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000023a1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('a2a2a2a2-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000023a2', 'editor'),
  ('a2a2a2a2-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000023a3', 'viewer');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a4","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a2a2a2a2-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000023a4', 'owner');
select set_config('request.jwt.claims', '', true);

-- an assets sheet and a documents register
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('a2a2a2a2-1111-0000-0000-000000000001', 'a2a2a2a2-0000-0000-0000-000000000000', 'Assets', 'AS-', 'a0', '{}'),
  ('a2a2a2a2-1111-0000-0000-000000000002', 'a2a2a2a2-0000-0000-0000-000000000000', 'Documents', 'DOC-', 'a1',
   '{"register":"documents"}');
insert into groups (id, org_id, sheet_id, name, position) values
  ('a2a2a2a2-2222-0000-0000-000000000001', 'a2a2a2a2-0000-0000-0000-000000000000', 'a2a2a2a2-1111-0000-0000-000000000001', 'Active', 'a0'),
  ('a2a2a2a2-2222-0000-0000-000000000002', 'a2a2a2a2-0000-0000-0000-000000000000', 'a2a2a2a2-1111-0000-0000-000000000002', 'Draft', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('a2a2a2a2-3333-0000-0000-000000000001', 'a2a2a2a2-0000-0000-0000-000000000000', 'a2a2a2a2-1111-0000-0000-000000000002',
   'status', 'Status', 'status', 'a0', '{"options":[{"id":"opt_draft","label":"Draft","color":"grey"},
     {"id":"opt_review","label":"In review","color":"orange"},{"id":"opt_approved","label":"Approved","color":"green","done":true},
     {"id":"opt_obsolete","label":"Obsolete","color":"dark"}]}'),
  ('a2a2a2a2-3333-0000-0000-000000000002', 'a2a2a2a2-0000-0000-0000-000000000000', 'a2a2a2a2-1111-0000-0000-000000000002',
   'author', 'Author', 'people', 'a1', '{"multiple":false}'),
  ('a2a2a2a2-3333-0000-0000-000000000003', 'a2a2a2a2-0000-0000-0000-000000000000', 'a2a2a2a2-1111-0000-0000-000000000002',
   'approver', 'Approver', 'people', 'a2', '{"multiple":false}'),
  ('a2a2a2a2-3333-0000-0000-000000000004', 'a2a2a2a2-0000-0000-0000-000000000000', 'a2a2a2a2-1111-0000-0000-000000000002',
   'approved_on', 'Approved on', 'date', 'a3', '{}'),
  ('a2a2a2a2-3333-0000-0000-000000000005', 'a2a2a2a2-0000-0000-0000-000000000000', 'a2a2a2a2-1111-0000-0000-000000000002',
   'version', 'Version', 'number', 'a4', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a2","role":"authenticated"}', true);
create temp table t_item as select (create_item('a2a2a2a2-1111-0000-0000-000000000001', 'a2a2a2a2-2222-0000-0000-000000000001', 'Laptop', 'a0')).id;
create temp table t_doc as select (create_item('a2a2a2a2-1111-0000-0000-000000000002', 'a2a2a2a2-2222-0000-0000-000000000002',
  'Access control policy', 'a0', '{"a2a2a2a2-3333-0000-0000-000000000002":["00000000-0000-0000-0000-0000000023a2"]}'::jsonb)).id;
grant select on t_item, t_doc to authenticated;

reset role;
create temp table t_path as select n, f, 'org/a2a2a2a2-0000-0000-0000-000000000000/item/' || i || '/' || f || '/' || name as p
  from (values
    (1, (select id from t_item), 'f2f2f2f2-0000-0000-0000-000000000001'::uuid, 'invoice.pdf'),
    (2, (select id from t_item), 'f2f2f2f2-0000-0000-0000-000000000002'::uuid, 'invoice-v2.pdf'),
    (3, (select id from t_item), 'f2f2f2f2-0000-0000-0000-000000000003'::uuid, 'photo.jpg'),
    (4, (select id from t_doc),  'f2f2f2f2-0000-0000-0000-000000000004'::uuid, 'policy-v1.pdf'),
    (5, (select id from t_doc),  'f2f2f2f2-0000-0000-0000-000000000005'::uuid, 'policy-v2.pdf')) v(n, i, f, name);
insert into storage.objects (bucket_id, name) select 'files', p from t_path;
grant select on t_path to authenticated;
set local role authenticated;

-- ───────────── item files ─────────────
select lives_ok($$ select add_file((select id from t_item), null, 'f2f2f2f2-0000-0000-0000-000000000001',
  (select p from t_path where n = 1), 'invoice.pdf', 'application/pdf', 10, repeat('a', 64), null,
  '{"category":"contract","description":"Purchase","valid_until":"2027-01-31","classification":"confidential"}') $$,
  'an editor adds an item file without a field');
select ok((select field_id is null and version_no = 1 and category = 'contract' and valid_until = '2027-01-31'
             and classification = 'confidential' from files where id = 'f2f2f2f2-0000-0000-0000-000000000001'),
  'the item file keeps its details');
select ok((select action = 'file.added' and field_id is null from activity_log
            where item_id = (select id from t_item) order by id desc limit 1), 'adding an item file is logged');
select lives_ok($$ select add_file((select id from t_item), null, 'f2f2f2f2-0000-0000-0000-000000000002',
  (select p from t_path where n = 2), 'invoice-v2.pdf', 'application/pdf', 11, repeat('b', 64),
  'f2f2f2f2-0000-0000-0000-000000000001', '{"version_note":"Signed copy"}') $$, 'a new version of an item file');
select ok((select version_no = 2 and version_note = 'Signed copy' and category = 'contract' and classification = 'confidential'
             from files where id = 'f2f2f2f2-0000-0000-0000-000000000002'),
  'the version number goes up and the details carry over');

reset role;
select throws_ok($$ insert into files (org_id, item_id, field_id, storage_path, filename, mime_type, size_bytes, sha256, source)
  select 'a2a2a2a2-0000-0000-0000-000000000000', id, null, 'x/form.pdf', 'form.pdf', 'application/pdf', 1, repeat('c', 64), 'form'
  from t_item $$, '23514', null, 'a file without a field must be an upload');
set local role authenticated;

-- ───────────── details ─────────────
select lives_ok($$ select set_file_meta('f2f2f2f2-0000-0000-0000-000000000002',
  '{"category":"report","personal_data":true,"valid_until":"2026-01-01"}') $$, 'an editor edits the details');
select ok((select action = 'file.updated' and old_value->>'category' = 'contract' and new_value->>'category' = 'report'
             and new_value ? 'personal_data' and not new_value ? 'classification'
             from activity_log where item_id = (select id from t_item) order by id desc limit 1),
  'set_file_meta logs what changed');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a3","role":"authenticated"}', true);
select throws_ok($$ select set_file_meta('f2f2f2f2-0000-0000-0000-000000000002', '{"category":"other"}') $$,
  'not allowed', 'a viewer cannot edit the details');

-- ───────────── downloads ─────────────
select lives_ok($$ select download_file('f2f2f2f2-0000-0000-0000-000000000001') $$, 'a viewer downloads an old version');
select is((select count(*)::int from file_access_log where file_id = 'f2f2f2f2-0000-0000-0000-000000000001'
             and user_id = '00000000-0000-0000-0000-0000000023a3'), 1, 'the download is logged');
select throws_ok($$ insert into file_access_log (org_id, file_id, item_id, user_id)
  select 'a2a2a2a2-0000-0000-0000-000000000000', 'f2f2f2f2-0000-0000-0000-000000000001', id,
         '00000000-0000-0000-0000-0000000023a3' from t_item $$, '42501', null, 'nobody writes the access log directly');
reset role;
update files set scan_status = 'blocked' where id = 'f2f2f2f2-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$ select download_file('f2f2f2f2-0000-0000-0000-000000000001') $$, 'file blocked',
  'a blocked file is never handed out');
reset role;
update files set scan_status = 'not_scanned' where id = 'f2f2f2f2-0000-0000-0000-000000000001';
set local role authenticated;

-- ───────────── isolation ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a4","role":"authenticated"}', true);
select is((select count(*)::int from files), 0, 'another workspace sees no files');
select is((select count(*)::int from file_access_log), 0, 'another workspace sees no downloads');
select throws_ok($$ select download_file('f2f2f2f2-0000-0000-0000-000000000002') $$, 'file not found',
  'another workspace cannot download');

-- ───────────── archive ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a2","role":"authenticated"}', true);
select throws_ok($$ select archive_file('f2f2f2f2-0000-0000-0000-000000000002') $$, 'not allowed', 'an editor cannot archive');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a1","role":"authenticated"}', true);
select lives_ok($$ select archive_file('f2f2f2f2-0000-0000-0000-000000000002') $$, 'an admin archives a file');
select is((select count(*)::int from files where archived_at is not null), 2, 'the whole version chain is archived');
select is((select action from activity_log where item_id = (select id from t_item) order by id desc limit 1), 'file.archived',
  'archiving is logged');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a2","role":"authenticated"}', true);
select throws_ok($$ select download_file('f2f2f2f2-0000-0000-0000-000000000002') $$, 'file archived',
  'editors cannot download archived files');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a1","role":"authenticated"}', true);
select lives_ok($$ select restore_file('f2f2f2f2-0000-0000-0000-000000000001') $$, 'an admin restores it');
select is((select count(*)::int from files where archived_at is not null), 0, 'restoring brings back the chain');

-- ───────────── controlled documents ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a1","role":"authenticated"}', true);
select throws_ok($$ select set_item_values((select id from t_doc), '{"a2a2a2a2-3333-0000-0000-000000000001":"opt_approved"}', null, null, 'First issue') $$,
  'document: upload the document file before approving it.', 'approving needs a file');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a2","role":"authenticated"}', true);
select lives_ok($$ select add_file((select id from t_doc), null, 'f2f2f2f2-0000-0000-0000-000000000004',
  (select p from t_path where n = 4), 'policy-v1.pdf', 'application/pdf', 10, repeat('d', 64), null, '{"category":"document"}') $$,
  'the author uploads the document');
select throws_ok($$ select set_item_values((select id from t_doc), '{"a2a2a2a2-3333-0000-0000-000000000001":"opt_approved"}', null, null, 'First issue') $$,
  'document: the author cannot approve their own document. Ask another person to approve it.', 'the author cannot approve');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a1","role":"authenticated"}', true);
select throws_ok($$ select set_item_values((select id from t_doc), '{"a2a2a2a2-3333-0000-0000-000000000001":"opt_approved"}') $$,
  'document: add a version note to approve.', 'approving needs a version note');
select lives_ok($$ select set_item_values((select id from t_doc), '{"a2a2a2a2-3333-0000-0000-000000000001":"opt_approved"}', null, null, 'First issue') $$,
  'another person approves');
select ok((select "values"->'a2a2a2a2-3333-0000-0000-000000000003' = '["00000000-0000-0000-0000-0000000023a1"]'::jsonb
             and "values"->'a2a2a2a2-3333-0000-0000-000000000005' = '1'::jsonb
             and "values" ? 'a2a2a2a2-3333-0000-0000-000000000004'
             from items where id = (select id from t_doc)), 'the approval records the approver, the date and the version');

-- a new version, back to draft (needs a comment), approved again: v1 is superseded
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a2","role":"authenticated"}', true);
select lives_ok($$ select add_file((select id from t_doc), null, 'f2f2f2f2-0000-0000-0000-000000000005',
  (select p from t_path where n = 5), 'policy-v2.pdf', 'application/pdf', 12, repeat('e', 64),
  'f2f2f2f2-0000-0000-0000-000000000004', '{"version_note":"Annual review"}') $$, 'a new draft version');
select throws_ok($$ select set_item_values((select id from t_doc), '{"a2a2a2a2-3333-0000-0000-000000000001":"opt_review"}') $$,
  'document: add a comment to change the status of an approved document.', 'leaving Approved needs a comment');
select throws_ok($$ select set_item_values((select id from t_doc), '{"a2a2a2a2-3333-0000-0000-000000000003":["00000000-0000-0000-0000-0000000023a2"]}') $$,
  'document: Approver and Approved on are filled in when a document is approved.', 'nobody sets the approver by hand');
select lives_ok($$ select set_item_values((select id from t_doc), '{"a2a2a2a2-3333-0000-0000-000000000001":"opt_review"}', null, null, 'Annual review') $$,
  'with a comment it goes back to review');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a1","role":"authenticated"}', true);
select lives_ok($$ select set_item_values((select id from t_doc), '{"a2a2a2a2-3333-0000-0000-000000000001":"opt_approved"}', null, null, 'Reviewed') $$,
  'v2 is approved');
select ok((select bool_and(case id when 'f2f2f2f2-0000-0000-0000-000000000004' then superseded_at is not null and approved_at is not null
                                    else approved_at is not null and superseded_at is null end)
             from files where item_id = (select id from t_doc)),
  'approving v2 marks the previously approved v1 superseded');

select * from finish();
rollback;
