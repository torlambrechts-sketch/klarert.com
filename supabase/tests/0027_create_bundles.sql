-- Create wizard bundles (0037_create_bundles.sql, docs/11 Bundles): create_bundle installs a pack and stamps it with
-- a name, an owner, a review date and its origin in one transaction, logging bundle.created; only the named owner
-- marks it reviewed (bundle.reviewed); only owners and admins create one. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'cb-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'cb-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000e1', 'Bundle Admin', 'BA'),
  ('00000000-0000-0000-0000-0000000000e2', 'Bundle Editor', 'BE');
insert into orgs (id, name, slug) values ('e0e0e0e0-0000-0000-0000-000000000000', 'Org B', 'pgtap-bundles');
insert into memberships (org_id, user_id, role) values
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'admin'),
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e2', 'editor');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-bundle', '1.0.0', 'Complaints', '{}', repeat('e', 64));

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
insert into plans values ('one', $j${
  "pack": { "key": "pgtap-bundle", "version": "1.0.0", "hash": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  "folders": [],
  "sheets": [{ "id": "e2000000-0000-4000-8000-000000000001", "ref": "log", "folder_id": null,
      "name": "Complaints", "item_label": "Complaint", "id_prefix": "CB-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "e3000000-0000-4000-8000-000000000001", "ref": "log.open", "sheet_id": "e2000000-0000-4000-8000-000000000001", "name": "Open", "color": "green", "position": "a0" }],
  "fields": [], "views": [], "items": [], "links": [], "automations": [], "dashboards": []
}$j$);

select ok(exists (select 1 from information_schema.columns where table_name = 'pack_installs' and column_name = 'reviewed_at'),
  'pack_installs has a review state');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select throws_ok($$ select create_bundle('e0e0e0e0-0000-0000-0000-000000000000', (select p from plans where name = 'one'),
    '{"name": "Complaints", "owner_id": "00000000-0000-0000-0000-0000000000e2"}') $$,
  'not allowed: only owners and admins create ready-made apps', 'an editor cannot create a bundle');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select throws_ok($$ select create_bundle('e0e0e0e0-0000-0000-0000-000000000000', (select p from plans where name = 'one'),
    '{"name": " ", "owner_id": "00000000-0000-0000-0000-0000000000e2"}') $$,
  'bundle: a name is required', 'a name is required');
select throws_ok($$ select create_bundle('e0e0e0e0-0000-0000-0000-000000000000', (select p from plans where name = 'one'),
    '{"name": "Complaints", "owner_id": "00000000-0000-0000-0000-0000000000e9"}') $$,
  'bundle: the owner must be a member of the workspace', 'the owner is a member');
select is((select count(*)::int from pack_installs where pack_key = 'pgtap-bundle'), 0, 'nothing was written on a refusal');

select lives_ok($$ select create_bundle('e0e0e0e0-0000-0000-0000-000000000000', (select p from plans where name = 'one'),
    '{"name": "Customer complaints", "owner_id": "00000000-0000-0000-0000-0000000000e2", "review_by": "2027-02-14"}') $$,
  'an admin creates a bundle');
select results_eq($$ select bundle_name, owner_id, review_by, origin, reviewed_at from pack_installs where pack_key = 'pgtap-bundle' $$,
  $$ values ('Customer complaints'::text, '00000000-0000-0000-0000-0000000000e2'::uuid, '2027-02-14'::date, 'create'::text, null::timestamptz) $$,
  'the install carries the name, owner, review date and origin, not yet reviewed');
select is((select count(*)::int from sheets where id = 'e2000000-0000-4000-8000-000000000001'), 1, 'the plan was written');
select is((select note from activity_log where action = 'bundle.created' and org_id = 'e0e0e0e0-0000-0000-0000-000000000000'),
  'created via Create from Complaints 1.0.0', 'bundle.created records the origin');
select is((select count(*)::int from activity_log where action = 'pack.installed' and org_id = 'e0e0e0e0-0000-0000-0000-000000000000'),
  1, 'install_pack logged the install in the same transaction');

select throws_ok($$ select mark_bundle_reviewed((select id from pack_installs where pack_key = 'pgtap-bundle')) $$,
  'not allowed: only the named owner marks it reviewed', 'an admin who is not the owner cannot mark it reviewed');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select lives_ok($$ select mark_bundle_reviewed((select id from pack_installs where pack_key = 'pgtap-bundle')) $$,
  'the named owner marks it reviewed');
select is((select reviewed_by from pack_installs where pack_key = 'pgtap-bundle'),
  '00000000-0000-0000-0000-0000000000e2'::uuid, 'who reviewed it is kept');
select is((select count(*)::int from activity_log where action = 'bundle.reviewed' and org_id = 'e0e0e0e0-0000-0000-0000-000000000000'),
  1, 'bundle.reviewed is logged');

select * from finish();
rollback;
