-- Files: Storage reads follow a logged download_file, blocked / archived / erased files stay out, restricted fields'
-- files are for people who see the field, refused uploads can be removed, no direct files rows
-- (0054, SA-4 / M3, SA-9, M2, M4). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000b0001', 'fil-admin@a.test'),
  ('00000000-0000-0000-0000-0000000b0002', 'fil-eve@a.test'),
  ('00000000-0000-0000-0000-0000000b0003', 'fil-vic@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000b0001', 'Ada Admin', 'AA'),
  ('00000000-0000-0000-0000-0000000b0002', 'Eve Editor', 'EE'),
  ('00000000-0000-0000-0000-0000000b0003', 'Vic Viewer', 'VV');
insert into orgs (id, name, slug) values ('b0000000-0000-0000-0000-00000000000a', 'Files A', 'pgtap-files-a');
insert into memberships (org_id, user_id, role) values
  ('b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000b0001', 'owner'),
  ('b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000b0002', 'editor'),
  ('b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000b0003', 'viewer');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('b0000001-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Controls', 'CTL-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('b0000003-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'b0000001-0000-0000-0000-000000000001', 'All', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config, restricted_to) values
  ('b0000004-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'b0000001-0000-0000-0000-000000000001',
   'evidence', 'Evidence', 'evidence', 'a0', '{}', null),
  ('b0000004-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'b0000001-0000-0000-0000-000000000001',
   'hr_case', 'HR case file', 'attachment', 'a1', '{}', '{"userIds": [], "roles": []}');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('b0000005-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'b0000001-0000-0000-0000-000000000001',
   'b0000003-0000-0000-0000-000000000001', 1, 'CTL-001', 'Backups', 'a0');
-- files: clean, blocked, archived, erased, on the restricted field
insert into files (id, org_id, item_id, field_id, storage_path, filename, mime_type, size_bytes, sha256, source,
                   uploaded_by, scan_status, archived_at, erased_at) values
  ('b000000f-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'b0000005-0000-0000-0000-000000000001',
   'b0000004-0000-0000-0000-000000000001', 'org/b0000000-0000-0000-0000-00000000000a/item/b0000005-0000-0000-0000-000000000001/b000000f-0000-0000-0000-000000000001/clean.pdf',
   'clean.pdf', 'application/pdf', 1, repeat('a', 64), 'upload', '00000000-0000-0000-0000-0000000b0002', 'clean', null, null),
  ('b000000f-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'b0000005-0000-0000-0000-000000000001',
   null, 'org/b0000000-0000-0000-0000-00000000000a/item/b0000005-0000-0000-0000-000000000001/b000000f-0000-0000-0000-000000000002/blocked.pdf',
   'blocked.pdf', 'application/pdf', 1, repeat('b', 64), 'upload', '00000000-0000-0000-0000-0000000b0002', 'blocked', null, null),
  ('b000000f-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'b0000005-0000-0000-0000-000000000001',
   null, 'org/b0000000-0000-0000-0000-00000000000a/item/b0000005-0000-0000-0000-000000000001/b000000f-0000-0000-0000-000000000003/old.pdf',
   'old.pdf', 'application/pdf', 1, repeat('c', 64), 'upload', '00000000-0000-0000-0000-0000000b0002', 'clean', now(), null),
  ('b000000f-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'b0000005-0000-0000-0000-000000000001',
   null, 'org/b0000000-0000-0000-0000-00000000000a/item/b0000005-0000-0000-0000-000000000001/b000000f-0000-0000-0000-000000000004/erased',
   'erased', 'application/pdf', 1, repeat('0', 64), 'upload', '00000000-0000-0000-0000-0000000b0002', 'clean', now(), now()),
  ('b000000f-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'b0000005-0000-0000-0000-000000000001',
   'b0000004-0000-0000-0000-000000000002', 'org/b0000000-0000-0000-0000-00000000000a/item/b0000005-0000-0000-0000-000000000001/b000000f-0000-0000-0000-000000000005/case.pdf',
   'case.pdf', 'application/pdf', 1, repeat('d', 64), 'upload', '00000000-0000-0000-0000-0000000b0001', 'clean', null, null);
insert into storage.objects (bucket_id, name, owner_id)
select 'files', storage_path, '00000000-0000-0000-0000-0000000b0002' from files where org_id = 'b0000000-0000-0000-0000-00000000000a';
-- a pending upload by Eve (no files row yet)
insert into storage.objects (bucket_id, name, owner_id) values ('files',
  'org/b0000000-0000-0000-0000-00000000000a/item/b0000005-0000-0000-0000-000000000001/b000000f-0000-0000-0000-000000000009/upload.exe',
  '00000000-0000-0000-0000-0000000b0002');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000b000' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
create function pg_temp.objects(f text) returns int language sql as $$
  select count(*)::int from storage.objects where bucket_id = 'files' and name like '%/' || f || '/%'
$$;
grant execute on function pg_temp.objects(text) to authenticated;

set local role authenticated;

-- Vic (viewer)
select pg_temp.as_user('3');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000001'), 0,
  'a reader cannot fetch a file from Storage without a logged download');
select lives_ok($$ select download_file('b000000f-0000-0000-0000-000000000001') $$, 'download_file logs the download');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000001'), 1, 'and then Storage serves the object');
select is((select count(*)::int from file_access_log where file_id = 'b000000f-0000-0000-0000-000000000001'
            and user_id = auth.uid()), 1, 'the download is in the access log');
select throws_ok($$ select download_file('b000000f-0000-0000-0000-000000000002') $$, 'file blocked', 'a blocked file is refused');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000002'), 0, 'and Storage does not serve it either');
select throws_ok($$ select download_file('b000000f-0000-0000-0000-000000000003') $$, 'file archived',
  'an archived file is refused to a viewer');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000003'), 0, 'and Storage does not serve it either');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000009'), 0, 'a pending upload is not readable by others');

-- Eve (editor, not on the restricted field's list)
select pg_temp.as_user('2');
select throws_ok($$ select download_file('b000000f-0000-0000-0000-000000000005') $$, 'file not found',
  'an editor who cannot see a restricted field cannot download its file');
select throws_ok($$ select set_file_meta('b000000f-0000-0000-0000-000000000005', '{"description": "x"}') $$,
  '42501', null, 'nor change its details (nor read its row back)');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000005'), 0, 'nor fetch it from Storage');
select throws_ok($$ insert into files (org_id, item_id, field_id, storage_path, filename, mime_type, size_bytes, sha256,
                                        source, uploaded_by, approved_at, approved_by)
                    values ('b0000000-0000-0000-0000-00000000000a', 'b0000005-0000-0000-0000-000000000001',
                            'b0000004-0000-0000-0000-000000000001', 'x', 'forged.pdf', 'application/pdf', 1, repeat('e', 64),
                            'upload', auth.uid(), now(), '00000000-0000-0000-0000-0000000b0001') $$,
  '42501', null, 'an editor cannot insert a files row directly (forged hash, dates or approval)');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000009'), 1, 'the uploader reads their pending upload');
select set_config('storage.allow_delete_query', 'true', true);
select pg_temp.as_user('3');
delete from storage.objects where name like '%/b000000f-0000-0000-0000-000000000009/%';
select pg_temp.as_user('2');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000009'), 1, 'nobody else can remove it');
delete from storage.objects where name like '%/b000000f-0000-0000-0000-000000000009/%';
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000009'), 0, 'the uploader removes a refused upload');
delete from storage.objects where name like '%/b000000f-0000-0000-0000-000000000001/%';
select pg_temp.as_user('1');
select lives_ok($$ select download_file('b000000f-0000-0000-0000-000000000001') $$, 'an owner downloads');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000001'), 1, 'a recorded file''s object is never removed by its uploader');

-- Ada (owner)
select lives_ok($$ select download_file('b000000f-0000-0000-0000-000000000003') $$, 'an owner downloads an archived file');
select is(pg_temp.objects('b000000f-0000-0000-0000-000000000003'), 1, 'and Storage serves it after the logged download');
select throws_ok($$ select download_file('b000000f-0000-0000-0000-000000000004') $$, 'file not found',
  'an erased file is refused to everyone');
reset role;

select ok(not ('text/html' = any (allowed_mime_types)) and not ('image/svg+xml' = any (allowed_mime_types))
          and 'application/octet-stream' = any (allowed_mime_types),
          'the bucket takes only the types the app sends, never HTML or SVG')
  from storage.buckets where id = 'files';

select * from finish();
rollback;
