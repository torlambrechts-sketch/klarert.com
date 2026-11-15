-- Files, mentions and own updates (0007_panel_files.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'owner@p.test'),
  ('00000000-0000-0000-0000-0000000007a2', 'editor@p.test'),
  ('00000000-0000-0000-0000-0000000007a3', 'viewer@p.test'),
  ('00000000-0000-0000-0000-0000000007a4', 'outsider@p.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@p.test';
insert into orgs (id, name, slug) values
  ('a7a7a7a7-0000-0000-0000-000000000000', 'Panel Org', 'panel-org'),
  ('a7a7a7a7-0000-0000-0000-00000000000b', 'Other Org', 'other-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a7a7a7a7-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000007a1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('a7a7a7a7-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000007a2', 'editor'),
  ('a7a7a7a7-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000007a3', 'viewer');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a4","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a7a7a7a7-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000007a4', 'owner');
select set_config('request.jwt.claims', '', true);
insert into sheets (id, org_id, name, id_prefix, position) values
  ('a7a7a7a7-1111-0000-0000-000000000000', 'a7a7a7a7-0000-0000-0000-000000000000', 'Panel', 'PA-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('a7a7a7a7-2222-0000-0000-000000000001', 'a7a7a7a7-0000-0000-0000-000000000000', 'a7a7a7a7-1111-0000-0000-000000000000', 'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('a7a7a7a7-3333-0000-0000-000000000001', 'a7a7a7a7-0000-0000-0000-000000000000', 'a7a7a7a7-1111-0000-0000-000000000000',
   'evidence', 'Evidence', 'evidence', 'a0', '{"validDays":30,"multiple":true,"accept":[]}'),
  ('a7a7a7a7-3333-0000-0000-000000000002', 'a7a7a7a7-0000-0000-0000-000000000000', 'a7a7a7a7-1111-0000-0000-000000000000',
   'notes', 'Notes', 'text', 'a1', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a2","role":"authenticated"}', true);
create temp table t_item as select (create_item('a7a7a7a7-1111-0000-0000-000000000000', 'a7a7a7a7-2222-0000-0000-000000000001', 'Fire drill', 'a0')).id;
grant select on t_item to authenticated;

-- objects in the bucket (as the storage service would write them)
reset role;
insert into storage.objects (bucket_id, name) select 'files',
  'org/a7a7a7a7-0000-0000-0000-000000000000/item/' || id || '/f7f7f7f7-0000-0000-0000-000000000001/drill.pdf' from t_item;
insert into storage.objects (bucket_id, name) select 'files',
  'org/a7a7a7a7-0000-0000-0000-000000000000/item/' || id || '/f7f7f7f7-0000-0000-0000-000000000002/drill-v2.pdf' from t_item;
create temp table t_path as select
  'org/a7a7a7a7-0000-0000-0000-000000000000/item/' || id || '/f7f7f7f7-0000-0000-0000-000000000001/drill.pdf' as p1,
  'org/a7a7a7a7-0000-0000-0000-000000000000/item/' || id || '/f7f7f7f7-0000-0000-0000-000000000002/drill-v2.pdf' as p2
  from t_item;
grant select on t_path to authenticated;
set local role authenticated;

-- ───────────── files ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a3","role":"authenticated"}', true);
select throws_ok($$ select add_file((select id from t_item), 'a7a7a7a7-3333-0000-0000-000000000001',
  'f7f7f7f7-0000-0000-0000-000000000001', (select p1 from t_path), 'drill.pdf', 'application/pdf', 10, repeat('a', 64)) $$,
  'not allowed', 'a viewer cannot add a file');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a2","role":"authenticated"}', true);
select throws_ok($$ select add_file((select id from t_item), 'a7a7a7a7-3333-0000-0000-000000000002',
  'f7f7f7f7-0000-0000-0000-000000000001', (select p1 from t_path), 'drill.pdf', 'application/pdf', 10, repeat('a', 64)) $$,
  'bad file field', 'only evidence and attachment fields hold files');
select throws_ok($$ select add_file((select id from t_item), 'a7a7a7a7-3333-0000-0000-000000000001',
  'f7f7f7f7-0000-0000-0000-000000000009', 'org/a7a7a7a7-0000-0000-0000-000000000000/item/x/f/drill.pdf', 'drill.pdf',
  'application/pdf', 10, repeat('a', 64)) $$,
  'bad file path', 'the path must follow org/item/file/filename');
select throws_ok($$ select add_file((select id from t_item), 'a7a7a7a7-3333-0000-0000-000000000001',
  'f7f7f7f7-0000-0000-0000-000000000003', replace((select p1 from t_path), '0001/drill', '0003/drill'), 'drill.pdf',
  'application/pdf', 10, repeat('a', 64)) $$,
  'file not uploaded', 'the object must be in the bucket');
select lives_ok($$ select add_file((select id from t_item), 'a7a7a7a7-3333-0000-0000-000000000001',
  'f7f7f7f7-0000-0000-0000-000000000001', (select p1 from t_path), 'drill.pdf', 'application/pdf', 10, repeat('a', 64)) $$,
  'an editor adds a file');
select is((select valid_until - collected_at from files where id = 'f7f7f7f7-0000-0000-0000-000000000001'), 30,
  'evidence is valid for the field''s validDays');
select is((select action from activity_log where item_id = (select id from t_item) order by id desc limit 1), 'file.added',
  'adding is logged');
select lives_ok($$ select add_file((select id from t_item), 'a7a7a7a7-3333-0000-0000-000000000001',
  'f7f7f7f7-0000-0000-0000-000000000002', (select p2 from t_path), 'drill-v2.pdf', 'application/pdf', 12, repeat('b', 64),
  'f7f7f7f7-0000-0000-0000-000000000001') $$, 'an editor replaces a file');
select is((select replaced_by from files where id = 'f7f7f7f7-0000-0000-0000-000000000001'),
  'f7f7f7f7-0000-0000-0000-000000000002'::uuid, 'the old version is kept and points at the new one');
select ok((select action = 'file.replaced' and old_value->>'filename' = 'drill.pdf' and new_value->>'filename' = 'drill-v2.pdf'
             from activity_log where item_id = (select id from t_item) order by id desc limit 1),
  'replacing is logged with both versions');
select throws_ok($$ select add_file((select id from t_item), 'a7a7a7a7-3333-0000-0000-000000000001',
  'f7f7f7f7-0000-0000-0000-000000000002', (select p2 from t_path), 'drill-v2.pdf', 'application/pdf', 12, repeat('b', 64),
  'f7f7f7f7-0000-0000-0000-000000000001') $$, 'file already replaced', 'a version is replaced once');
select throws_ok($$ select log_file_event((select id from t_item), 'a7a7a7a7-3333-0000-0000-000000000001',
  'f7f7f7f7-0000-0000-0000-000000000001', 'file.added') $$, '42501', null, 'log_file_event is internal');
update files set replaced_by = null;
select isnt((select replaced_by from files where id = 'f7f7f7f7-0000-0000-0000-000000000001'), null,
  'files cannot be changed directly');
select ok((select (verify_activity_chain((select id::text from t_item)))->>'ok' = 'true'), 'the item chain verifies');

-- ───────────── mentions ─────────────
insert into item_updates (org_id, item_id, author_id, body, mentions)
select 'a7a7a7a7-0000-0000-0000-000000000000', id, '00000000-0000-0000-0000-0000000007a2', '@owner please check',
       array['00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007a4']::uuid[] from t_item;
create temp table t_upd as select id from item_updates order by created_at desc limit 1;
select throws_ok($$ insert into item_updates (org_id, item_id, author_id, body)
  select 'a7a7a7a7-0000-0000-0000-00000000000b', id, '00000000-0000-0000-0000-0000000007a2', 'x' from t_item $$,
  null, null, 'an update cannot be filed under another workspace');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
select throws_ok($$ select notify_mention((select id from t_upd), array['00000000-0000-0000-0000-0000000007a1']::uuid[]) $$,
  'not allowed', 'only the author can notify for an update');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a2","role":"authenticated"}', true);
select is(notify_mention((select id from t_upd), array['00000000-0000-0000-0000-0000000007a1',
  '00000000-0000-0000-0000-0000000007a3', '00000000-0000-0000-0000-0000000007a4']::uuid[]), 1,
  'only mentioned members of the workspace are notified');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
select ok((select kind = 'mention' and body like '%mentioned you on PA-001 Fire drill%' from notifications),
  'the mentioned person sees the notification');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a4","role":"authenticated"}', true);
select is((select count(*)::int from notifications), 0, 'a person of another workspace gets nothing');

-- ───────────── own updates ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
select throws_ok($$ select edit_update((select id from t_upd), 'changed') $$, 'not allowed', 'others cannot edit an update');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a2","role":"authenticated"}', true);
select is((edit_update((select id from t_upd), '@owner please check today')).body, '@owner please check today',
  'the author edits their update');
-- since 0059 a comment's body is personal data: the log holds a marker, the body is kept aside for readers
select ok((select a.action = 'update.edited' and activity_value_masked(a.new_value)
                  and pa.new_value = to_jsonb('@owner please check today'::text)
             from activity_log a join personal_activity pa on pa.activity_id = a.id
            where a.item_id = (select id from t_item) order by a.id desc limit 1), 'the edit is logged');
reset role;
update item_updates set created_at = now() - interval '16 minutes' where id = (select id from t_upd);
set local role authenticated;
select throws_ok($$ select delete_update((select id from t_upd)) $$, 'update too old to change',
  'after 15 minutes an update is final');
reset role;
update item_updates set created_at = now() where id = (select id from t_upd);
set local role authenticated;
select lives_ok($$ select delete_update((select id from t_upd)) $$, 'the author deletes a recent update');

select * from finish();
rollback;
