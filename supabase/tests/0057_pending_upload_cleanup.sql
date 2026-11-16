-- Abandoned uploads for the scheduler's hourly cleanup (0067, security review 9.1 item 2). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into orgs (id, name, slug) values ('99570000-0000-0000-0000-00000000000a', 'Uploads', 'pgtap-uploads');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('99570001-0000-0000-0000-000000000001', '99570000-0000-0000-0000-00000000000a', 'Evidence', 'EV-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('99570002-0000-0000-0000-000000000001', '99570000-0000-0000-0000-00000000000a', '99570001-0000-0000-0000-000000000001',
   'All', 'a0');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('99570003-0000-0000-0000-000000000001', '99570000-0000-0000-0000-00000000000a', '99570001-0000-0000-0000-000000000001',
   '99570002-0000-0000-0000-000000000001', 1, 'EV-001', 'Audit', 'a0');

create function pg_temp.p(f text) returns text language sql as $$
  select 'org/99570000-0000-0000-0000-00000000000a/item/99570003-0000-0000-0000-000000000001/' || f || '/scan.pdf'
$$;
insert into storage.buckets (id, name) values ('pgtap-other', 'pgtap-other');
insert into storage.objects (bucket_id, name, created_at, updated_at) values
  ('files', pg_temp.p('abandoned'), now() - interval '3 hours', now() - interval '3 hours'),
  ('files', pg_temp.p('young'), now() - interval '20 minutes', now() - interval '20 minutes'),
  -- created long ago but written again a few minutes ago (an upsert): still young
  ('files', pg_temp.p('rewritten'), now() - interval '5 hours', now() - interval '5 minutes'),
  ('files', pg_temp.p('confirmed'), now() - interval '3 hours', now() - interval '3 hours'),
  ('files', 'org/99570000-0000-0000-0000-00000000000a/logo.png', now() - interval '3 hours', now() - interval '3 hours'),
  ('pgtap-other', pg_temp.p('other-bucket'), now() - interval '3 hours', now() - interval '3 hours');
insert into files (org_id, item_id, storage_path, filename, mime_type, size_bytes, sha256) values
  ('99570000-0000-0000-0000-00000000000a', '99570003-0000-0000-0000-000000000001', pg_temp.p('confirmed'), 'scan.pdf',
   'application/pdf', 10, repeat('a', 64));

select is((select array_agg(name) from stale_pending_uploads(now(), 1000)
            where org_id = '99570000-0000-0000-0000-00000000000a'),
          array[pg_temp.p('abandoned')],
  'only item-file objects of the files bucket that no files row holds and that are an hour old are listed');
select is((select org_id from stale_pending_uploads(now(), 1000) where name = pg_temp.p('abandoned')),
          '99570000-0000-0000-0000-00000000000a'::uuid, 'with their workspace');
select is((select count(*)::int from stale_pending_uploads(now() + interval '1 day', 1000)
            where org_id = '99570000-0000-0000-0000-00000000000a'), 1,
  'a later cut-off never lists an upload younger than an hour');
select is((select count(*)::int from stale_pending_uploads(now() - interval '4 hours', 1000)
            where org_id = '99570000-0000-0000-0000-00000000000a'), 0, 'an earlier cut-off lists fewer');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from stale_pending_uploads(now(), 10) $$, '42501', null,
  'members cannot list other people''s uploads');
reset role;
set local role anon;
select throws_ok($$ select * from stale_pending_uploads(now(), 10) $$, '42501', null, 'nor can visitors');
reset role;
set local role service_role;
select lives_ok($$ select * from stale_pending_uploads(now(), 10) $$, 'the scheduler (service role) can');
reset role;

select * from finish();
rollback;
