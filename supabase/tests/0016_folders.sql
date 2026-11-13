-- Folders: audit, permissions, archive with sheets (0021_folders_organise.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'fold-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'fold-editor@a.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'fold-viewer@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000f1', 'Fold Admin', 'FA'),
  ('00000000-0000-0000-0000-0000000000f2', 'Fold Editor', 'FE'),
  ('00000000-0000-0000-0000-0000000000f3', 'Fold Viewer', 'FV');
insert into orgs (id, name, slug) values ('f0f0f0f0-0000-0000-0000-000000000000', 'Org F', 'pgtap-folders');
insert into memberships (org_id, user_id, role) values
  ('f0f0f0f0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f1', 'admin'),
  ('f0f0f0f0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f2', 'editor'),
  ('f0f0f0f0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f3', 'viewer');

select ok(has_function_privilege('authenticated', 'set_folder_archived(uuid, boolean)', 'execute')
          and not has_function_privilege('anon', 'set_folder_archived(uuid, boolean)', 'execute'),
  'signed-in people can call set_folder_archived; signed-out visitors cannot');
select ok(not has_function_privilege('authenticated', 'folders_guard()', 'execute'),
  'the folders guard trigger function is not callable');

set local role authenticated;

-- editor: may create a folder (a sheet from a template), not rename, move, archive or delete one
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select lives_ok($$
  insert into folders (id, org_id, name, position) values
    ('f0f0f0f0-1111-0000-0000-000000000000', 'f0f0f0f0-0000-0000-0000-000000000000', 'Audit and CAPA', 'a0') $$,
  'an editor can create a folder');
select is((select count(*)::int from activity_log where action = 'folders.insert'
            and chain_key = 'sheet:f0f0f0f0-0000-0000-0000-000000000000'), 1,
  'creating a folder is audited on the workspace chain');
update folders set name = 'Hacked', position = 'Zz' where id = 'f0f0f0f0-1111-0000-0000-000000000000';
delete from folders where id = 'f0f0f0f0-1111-0000-0000-000000000000';
select is((select name from folders where id = 'f0f0f0f0-1111-0000-0000-000000000000'), 'Audit and CAPA',
  'an editor cannot rename, move or delete a folder');
select throws_ok($$ select set_folder_archived('f0f0f0f0-1111-0000-0000-000000000000', true) $$,
  'only owners and admins can archive folders', 'an editor cannot archive a folder');
insert into sheets (id, org_id, folder_id, name, id_prefix, position) values
  ('f0f0f0f0-5555-0000-0000-000000000001', 'f0f0f0f0-0000-0000-0000-000000000000',
   'f0f0f0f0-1111-0000-0000-000000000000', 'CAPA', 'CAPA-', 'a0'),
  ('f0f0f0f0-5555-0000-0000-000000000002', 'f0f0f0f0-0000-0000-0000-000000000000',
   'f0f0f0f0-1111-0000-0000-000000000000', 'Audits', 'AU-', 'a1');
update sheets set position = 'a2' where id = 'f0f0f0f0-5555-0000-0000-000000000001';
select is((select count(*)::int from activity_log where action = 'sheets.update'
            and sheet_id = 'f0f0f0f0-5555-0000-0000-000000000001'
            and old_value->>'position' = 'a0' and new_value->>'position' = 'a2'), 1,
  'reordering a sheet is audited (sheets.update with the old and new position)');

-- viewer
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
select throws_ok($$
  insert into folders (org_id, name, position) values ('f0f0f0f0-0000-0000-0000-000000000000', 'Mine', 'a1') $$,
  '42501', null, 'a viewer cannot create a folder');

-- admin: rename, archive with sheets, restore together, delete when empty
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
update folders set name = 'Audits and CAPA' where id = 'f0f0f0f0-1111-0000-0000-000000000000';
select is((select count(*)::int from activity_log where action = 'folders.update'
            and old_value->>'name' = 'Audit and CAPA' and new_value->>'name' = 'Audits and CAPA'), 1,
  'renaming a folder is audited with the old and new name');
-- a sheet archived on its own before stays archived when the folder is restored
update sheets set archived_at = now() - interval '1 day' where id = 'f0f0f0f0-5555-0000-0000-000000000002';
select is(set_folder_archived('f0f0f0f0-1111-0000-0000-000000000000', true), 1,
  'archiving a folder archives its active sheets');
select ok((select f.archived_at is not null and f.archived_at = s.archived_at
             from folders f, sheets s
            where f.id = 'f0f0f0f0-1111-0000-0000-000000000000' and s.id = 'f0f0f0f0-5555-0000-0000-000000000001'),
  'the folder and its sheet share one archive time');
select is(set_folder_archived('f0f0f0f0-1111-0000-0000-000000000000', false), 1,
  'restoring the folder restores the sheets archived with it');
select ok((select archived_at is not null from sheets where id = 'f0f0f0f0-5555-0000-0000-000000000002'),
  'a sheet archived on its own stays archived');
select is((select count(*)::int from activity_log where action = 'folders.update'
            and chain_key = 'sheet:f0f0f0f0-0000-0000-0000-000000000000'
            and (old_value->>'archived_at' is null) <> (new_value->>'archived_at' is null)), 2,
  'archiving and restoring a folder are audited');
delete from sheets where folder_id = 'f0f0f0f0-1111-0000-0000-000000000000';
delete from folders where id = 'f0f0f0f0-1111-0000-0000-000000000000';
select is((select count(*)::int from activity_log where action = 'folders.delete'
            and old_value->>'id' = 'f0f0f0f0-1111-0000-0000-000000000000'), 1,
  'deleting a folder is audited');

select * from finish();
rollback;
