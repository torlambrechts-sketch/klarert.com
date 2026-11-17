-- A workspace's own frameworks (0074_own_frameworks.sql, docs/12 Your own frameworks): the reserved key form, customer
-- text only in a workspace's own rows, RLS between workspaces, publish (owners and admins, a revision logged with its
-- hash, a new edition with its mapping), the definer functions refusing another workspace's framework or pack, the
-- catalogue guard, and the workspace's own cross-walks (insert-only, retired, logged).
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(50);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'own-a-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'own-a-editor@a.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'own-b-admin@b.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000a1', 'Ann Admin', 'AA'),
  ('00000000-0000-0000-0000-0000000000a2', 'Ed Editor', 'EE'),
  ('00000000-0000-0000-0000-0000000000b1', 'Bea Admin', 'BA');
insert into orgs (id, name, slug) values
  ('a8a8a8a8-0000-0000-0000-000000000000', 'Org A', 'pgtap-own-a'),
  ('b8b8b8b8-0000-0000-0000-000000000000', 'Org B', 'pgtap-own-b');
insert into memberships (org_id, user_id, role) values
  ('a8a8a8a8-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('a8a8a8a8-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'editor'),
  ('b8b8b8b8-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b1', 'admin');

-- a catalogue framework to map to
insert into packs (key, version, title, manifest, hash) values ('framework-pgc', '1.1.0', 'PGC', '{}', repeat('c', 64));
insert into frameworks (key, version, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, hash)
values ('pgc', '1', 'PGC 1', 'PGC', 'Test', 'standard', 'PGC', 'Reference numbers only.', 'https://example.com/pgc',
        'framework-pgc', '1.1.0', repeat('1', 64));
insert into requirements (framework_key, framework_version, ref, parent_ref, kind, position, title) values
  ('pgc', '1', 'T', null, 'theme', 0, 'Theme'), ('pgc', '1', 'C.1', 'T', 'control', 1, 'Access');

create temporary table j (name text primary key, v jsonb);
grant select on j to authenticated;
-- the framework the server builds from a draft, for org A (key wa8a8a8a8-acme)
create function pg_temp._fw(p_version text, p_rev int, p_reqs jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('key', 'wa8a8a8a8-acme', 'version', p_version, 'revision', p_rev, 'title', 'Acme schedule',
           'short_title', 'ACME', 'kind', 'internal', 'source', 'Acme MSA', 'publisher', 'Org A',
           'licence', 'Provided by Acme MSA. Owned by Org A.', 'hash', repeat(p_rev::text, 64), 'rights_confirmed', true,
           'requirements', p_reqs) || p_extra
$$;
create function pg_temp._pack(p_key text, p_version text, p_fw_version text, p_hash text) returns jsonb language sql as $$
  select jsonb_build_object('key', p_key, 'version', p_version, 'title', 'Acme schedule', 'description', '',
           'hash', p_hash,
           'manifest', jsonb_build_object('key', p_key, 'version', p_version, 'requires', '[]'::jsonb,
                         'automations', '[]'::jsonb, 'dashboards', '[]'::jsonb,
                         'sheets', jsonb_build_array(jsonb_build_object('isLibrary', true,
                           'framework', jsonb_build_object('key', 'wa8a8a8a8-acme', 'version', p_fw_version)))))
$$;
grant execute on function pg_temp._fw(text, int, jsonb, jsonb), pg_temp._pack(text, text, text, text) to authenticated;
insert into j values
  ('reqs1', '[{"ref": "G", "parent": "", "kind": "theme", "title": "Supplier duties"},
              {"ref": "1", "parent": "G", "kind": "clause", "title": "Access reviews", "text": "Review all access every quarter."},
              {"ref": "2", "parent": "G", "kind": "clause", "title": "Backups"}]'),
  ('reqs2', '[{"ref": "G", "parent": "", "kind": "theme", "title": "Supplier duties"},
              {"ref": "1", "parent": "G", "kind": "clause", "title": "Access reviews", "text": "Review all access every month."},
              {"ref": "2", "parent": "G", "kind": "clause", "title": "Backups"},
              {"ref": "3", "parent": "G", "kind": "clause", "title": "Incident notice"}]'),
  ('deep', '[{"ref": "G", "parent": "", "kind": "theme", "title": "G"}, {"ref": "1", "parent": "G", "kind": "clause", "title": "1"},
             {"ref": "2", "parent": "1", "kind": "clause", "title": "2"}, {"ref": "3", "parent": "2", "kind": "clause", "title": "3"},
             {"ref": "4", "parent": "3", "kind": "clause", "title": "4"}, {"ref": "5", "parent": "4", "kind": "clause", "title": "5"}]');
-- the adoption plan of the own library in org A (as the planner makes it)
insert into j values ('plan', replace($p${
    "pack": { "key": "framework-wa8a8a8a8-acme", "version": "1.1.0", "hash": "HASH" },
    "folders": [{ "id": "a1000000-0000-4000-8000-000000000001", "ref": "frameworks", "name": "Frameworks", "position": "a0" }],
    "sheets": [{ "id": "a2000000-0000-4000-8000-000000000001", "ref": "library", "folder_id": "a1000000-0000-4000-8000-000000000001",
        "name": "Acme schedule requirements", "item_label": "Requirement", "id_prefix": "ACME-", "is_library": true, "position": "a0",
        "settings": { "framework": { "key": "wa8a8a8a8-acme", "version": "1", "refFieldKey": "ref" } } }],
    "groups": [{ "id": "a3000000-0000-4000-8000-000000000001", "ref": "library.g", "sheet_id": "a2000000-0000-4000-8000-000000000001", "name": "Supplier duties", "color": "green", "position": "a0" }],
    "fields": [
      { "id": "a4000000-0000-4000-8000-000000000001", "ref": "library.ref", "sheet_id": "a2000000-0000-4000-8000-000000000001", "key": "ref", "name": "Ref", "type": "text", "position": "a0", "width": 100, "locked": true, "config": {} },
      { "id": "a4000000-0000-4000-8000-000000000002", "ref": "library.requirement_text", "sheet_id": "a2000000-0000-4000-8000-000000000001", "key": "requirement_text", "name": "Requirement", "type": "longtext", "position": "a1", "width": 200, "locked": true, "config": {} }],
    "views": [],
    "items": [
      { "id": "a6000000-0000-4000-8000-000000000001", "ref": "library.1", "sheet_id": "a2000000-0000-4000-8000-000000000001", "group_id": "a3000000-0000-4000-8000-000000000001",
        "name": "Access reviews", "position": "a0", "requirement_ref": "wa8a8a8a8-acme@1#1",
        "values": { "a4000000-0000-4000-8000-000000000001": "1", "a4000000-0000-4000-8000-000000000002": "Review all access every quarter." } },
      { "id": "a6000000-0000-4000-8000-000000000002", "ref": "library.2", "sheet_id": "a2000000-0000-4000-8000-000000000001", "group_id": "a3000000-0000-4000-8000-000000000001",
        "name": "Backups", "position": "a1", "values": { "a4000000-0000-4000-8000-000000000001": "2" }, "requirement_ref": "wa8a8a8a8-acme@1#2" }],
    "links": [], "automations": [], "dashboards": []
  }$p$, 'HASH', repeat('1', 64))::jsonb);

-- ── the reserved key form and the customer text (as the database owner)
select throws_ok($$ insert into frameworks (key, version, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, hash)
                    values ('wa8a8a8a8-fake', '1', 'Fake', 'F', 'T', 'standard', 'S', 'L', 'https://x.test', 'framework-pgc', '1.1.0', repeat('1', 64)) $$,
  '23514', null, 'a catalogue framework cannot take the reserved key form');
select throws_ok($$ select set_config('app.framework_op', 'on', true);
                    insert into frameworks (key, version, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, hash, titles, org_id)
                    values ('wb8b8b8b8-fake', '1', 'Fake', 'F', 'T', 'internal', 'S', 'L', null, 'framework-pgc', '1.1.0', repeat('1', 64), 'customer',
                            'a8a8a8a8-0000-0000-0000-000000000000') $$,
  '23514', null, 'an own key names its own workspace');
select set_config('app.framework_op', '', false);
select throws_ok($$ insert into frameworks (key, version, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, hash, titles, org_id)
                    values ('wa8a8a8a8-direct', '1', 'Fake', 'F', 'T', 'internal', 'S', 'L', null, 'framework-pgc', '1.1.0', repeat('1', 64), 'customer',
                            'a8a8a8a8-0000-0000-0000-000000000000') $$,
  'a workspace''s own framework is written only by publish_framework', 'own rows are written only by the RPCs');
select throws_ok($$ insert into requirements (framework_key, framework_version, ref, parent_ref, kind, position, title, text)
                    values ('pgc', '1', 'C.2', 'T', 'control', 2, 'Text', 'The standard''s own words') $$,
  '23514', null, 'customer text never goes into a catalogue row');
select throws_ok($$ update frameworks set titles = 'customer' where key = 'pgc' $$,
  '23514', null, 'a catalogue framework is never titled customer');
select ok(has_function_privilege('authenticated', 'publish_framework(uuid, jsonb, jsonb, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'set_crosswalk(uuid, text, text, text, text)', 'execute')
          and has_function_privilege('authenticated', 'save_framework_draft(uuid, text, jsonb)', 'execute')
          and not has_function_privilege('anon', 'publish_framework(uuid, jsonb, jsonb, jsonb)', 'execute')
          and not has_function_privilege('anon', 'retire_crosswalk(uuid, bigint)', 'execute')
          and not has_function_privilege('authenticated', '_own_key_prefix(uuid)', 'execute')
          and not has_function_privilege('authenticated', '_upgrade_pack_rows(uuid, jsonb)', 'execute'),
  'signed-in people call the RPCs (they check the role); visitors cannot; the helpers are nobody''s');

set local role authenticated;
-- ── an editor of A cannot write a framework
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select throws_ok($$ select save_framework_draft('a8a8a8a8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme', '{"title": "x", "requirements": []}') $$,
  'not allowed: only owners and admins write frameworks', 'an editor cannot save a draft');
select throws_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000', pg_temp._fw('1', 1, (select v from j where name = 'reqs1')),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.1.0', '1', repeat('1', 64))) $$,
  'not allowed: only owners and admins publish frameworks', 'an editor cannot publish');

-- ── an admin of A: draft, then publish
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ select save_framework_draft('a8a8a8a8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme',
                     jsonb_build_object('title', 'Acme schedule', 'requirements', (select v from j where name = 'reqs1'))) $$,
  'an admin saves a draft');
select throws_ok($$ select save_framework_draft('a8a8a8a8-0000-0000-0000-000000000000', 'wb8b8b8b8-acme', '{"title": "x", "requirements": []}') $$,
  'draft: the key is not this workspace''s', 'a draft key carries the workspace''s own prefix');
select throws_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000',
                     pg_temp._fw('1', 1, (select v from j where name = 'reqs1'), '{"rights_confirmed": false}'),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.1.0', '1', repeat('1', 64))) $$,
  'publish: confirm that you have the right to use this text in this workspace', 'publishing needs the licence confirmation');
select throws_like($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000',
                     pg_temp._fw('1', 1, (select v from j where name = 'reqs1'), '{"licence": "Licensed by us."}'),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.1.0', '1', repeat('1', 64))) $$,
  'publish: the licence note is "Provided by Acme MSA. Owned by Org A."', 'the licence note names the source and the workspace');
select throws_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000', pg_temp._fw('1', 1, (select v from j where name = 'deep')),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.1.0', '1', repeat('1', 64))) $$,
  'publish: too deep: a group and at most 4 levels below it', 'a group and at most 4 levels below it');
select throws_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000', pg_temp._fw('1', 1, (select v from j where name = 'reqs1')),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.1.0', '1', repeat('1', 64))
                       || jsonb_build_object('manifest', jsonb_build_object('key', 'framework-wa8a8a8a8-acme', 'version', '1.1.0',
                            'automations', '[{"ref": "x"}]'::jsonb, 'sheets', '[{"isLibrary": true, "framework": {"key": "wa8a8a8a8-acme", "version": "1"}}]'::jsonb))) $$,
  'publish: the pack is not this framework''s library', 'the pack is only the library sheet');
select lives_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000', pg_temp._fw('1', 1, (select v from j where name = 'reqs1')),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.1.0', '1', repeat('1', 64))) $$,
  'an admin publishes edition 1, revision 1');
select is((select org_id::text || ' ' || titles || ' ' || licence || ' ' || revision from frameworks where key = 'wa8a8a8a8-acme'),
  'a8a8a8a8-0000-0000-0000-000000000000 customer Provided by Acme MSA. Owned by Org A. 1',
  'the framework is the workspace''s, titled customer, with the ownership note');
select is((select text from requirements where framework_key = 'wa8a8a8a8-acme' and ref = '1'),
  'Review all access every quarter.', 'the requirement keeps its full wording');
select is((select owner_org_id::text from packs where key = 'framework-wa8a8a8a8-acme' and version = '1.1.0'),
  'a8a8a8a8-0000-0000-0000-000000000000', 'the library pack belongs to the workspace');
select is((select new_value->>'revision' || ' ' || (new_value->>'hash') from activity_log
            where org_id = 'a8a8a8a8-0000-0000-0000-000000000000' and action = 'framework.published'),
  '1 ' || repeat('1', 64), 'framework.published is logged with the revision and hash');
select is((select count(*)::int from framework_drafts where key = 'wa8a8a8a8-acme'), 0, 'publishing removes the draft');

-- ── adopt it
select lives_ok($$ select adopt_framework('a8a8a8a8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme', '1', (select v from j where name = 'plan')) $$,
  'an admin adopts the workspace''s own framework');

-- ── a revision: reworded and added, logged; removing a ref needs an edition
select throws_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000',
                     pg_temp._fw('1', 2, (select jsonb_agg(x) from jsonb_array_elements((select v from j where name = 'reqs1')) x where x->>'ref' <> '2')),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.2.0', '1', repeat('2', 64))) $$,
  'publish: removing or renumbering a requirement needs a new edition (2)', 'removing a requirement is not a revision');
select throws_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000', pg_temp._fw('1', 3, (select v from j where name = 'reqs2')),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.3.0', '1', repeat('3', 64))) $$,
  'publish: Acme schedule changed since you opened it. Open it again', 'a revision follows the one before');
select lives_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000', pg_temp._fw('1', 2, (select v from j where name = 'reqs2')),
                     pg_temp._pack('framework-wa8a8a8a8-acme', '1.2.0', '1', repeat('2', 64))) $$,
  'a reworded and an added requirement publish as revision 2');
select is((select revision || ' ' || pack_version || ' ' || (select count(*) from requirements where framework_key = 'wa8a8a8a8-acme')
             || ' ' || (select text from requirements where framework_key = 'wa8a8a8a8-acme' and ref = '1')
           from frameworks where key = 'wa8a8a8a8-acme'),
  '2 1.2.0 4 Review all access every month.', 'the revision rewords, adds and points at the new library pack version');
select is((select count(*)::int from activity_log where action = 'framework.published' and new_value->>'revision' = '2'), 1,
  'the revision is logged');

-- ── the workspace's own cross-walks
select throws_ok($$ select set_crosswalk('a8a8a8a8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme@1#1', 'wa8a8a8a8-acme@1#2', 'related') $$,
  'map: not a requirement of the catalogue', 'a mapping goes to a catalogue requirement');
select throws_ok($$ select set_crosswalk('a8a8a8a8-0000-0000-0000-000000000000', 'pgc@1#C.1', 'pgc@1#C.1', 'related') $$,
  'map: not a requirement of this workspace''s own frameworks', 'a mapping starts at one of the workspace''s requirements');
select lives_ok($$ select set_crosswalk('a8a8a8a8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme@1#1', 'pgc@1#C.1', 'related', 'Same idea') $$,
  'an admin maps a requirement to a catalogue requirement');
select lives_ok($$ select set_crosswalk('a8a8a8a8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme@1#1', 'pgc@1#C.1', 'equivalent', 'Same idea') $$,
  'and changes the relation');
select is((select count(*) filter (where retired_at is null) || ' live, ' || count(*) filter (where retired_at is not null) || ' retired, '
                  || max(relation) filter (where retired_at is null) || ' by ' || max(created_by::text)
           from crosswalks where org_id = 'a8a8a8a8-0000-0000-0000-000000000000' and from_framework = 'wa8a8a8a8-acme'),
  '1 live, 1 retired, equivalent by 00000000-0000-0000-0000-0000000000a1',
  'a change retires the old row and inserts a new one, with who made it');
select is((select string_agg(action, ',' order by id) from activity_log
            where org_id = 'a8a8a8a8-0000-0000-0000-000000000000' and action like 'crosswalk.%'),
  'crosswalk.added,crosswalk.retired,crosswalk.added', 'every mapping change is logged');

-- ── another workspace sees none of it and cannot use it
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from frameworks where key = 'wa8a8a8a8-acme'), 0, 'org B cannot read org A''s framework');
select is((select count(*)::int from requirements where framework_key = 'wa8a8a8a8-acme'), 0, 'org B cannot read its requirements');
select is((select count(*)::int from crosswalks where org_id is not null), 0, 'org B cannot read its cross-walks');
select is((select count(*)::int from packs where key like 'framework-wa8a8a8a8-%'), 0, 'org B cannot read its library pack');
select ok((select count(*) from frameworks where key = 'pgc') = 1, 'org B still reads the catalogue');
select throws_ok($$ select adopt_framework('b8b8b8b8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme', '1', (select v from j where name = 'plan')) $$,
  'framework not found', 'org B cannot adopt org A''s framework');
select throws_ok($$ select install_pack('b8b8b8b8-0000-0000-0000-000000000000', (select v from j where name = 'plan')) $$,
  'pack not found', 'org B cannot install org A''s library pack');
select throws_ok($$ select set_crosswalk('b8b8b8b8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme@1#1', 'pgc@1#C.1', 'related') $$,
  'map: not a requirement of this workspace''s own frameworks', 'org B cannot map org A''s requirement');

reset role;
-- org B with an install and two library sheets that name org A's framework (written as the owner, as if forged)
insert into pack_installs (id, org_id, pack_key, version, manifest_hash)
values ('b9000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-0000-0000-000000000000', 'framework-wa8a8a8a8-acme', '1.1.0', repeat('1', 64));
insert into sheets (id, org_id, name, item_label, id_prefix, position, is_library, settings) values
  ('b2000000-0000-4000-8000-000000000001', 'b8b8b8b8-0000-0000-0000-000000000000', 'Forged 1', 'Requirement', 'FA-', 'a0', true,
   '{"framework": {"key": "wa8a8a8a8-acme", "version": "1", "refFieldKey": "ref"}}'),
  ('b2000000-0000-4000-8000-000000000002', 'b8b8b8b8-0000-0000-0000-000000000000', 'Forged 2', 'Requirement', 'FB-', 'a1', true,
   '{"framework": {"key": "wa8a8a8a8-acme", "version": "2", "refFieldKey": "ref"}}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select throws_ok($$ select upgrade_pack('b9000000-0000-4000-8000-000000000001', '{"pack": {"version": "1.2.0"}}') $$,
  'pack version not found', 'org B cannot upgrade to org A''s library pack');
select throws_ok($$ select move_framework_edition('b8b8b8b8-0000-0000-0000-000000000000', 'b2000000-0000-4000-8000-000000000001',
                     'b2000000-0000-4000-8000-000000000002', '[]', '[]') $$,
  'move: not two editions of one framework', 'org B cannot move with org A''s framework');

-- ── an editor of A reads the framework but not the drafts
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select save_framework_draft('a8a8a8a8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme', '{"title": "Acme schedule", "requirements": []}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int || ' ' || (select count(*) from framework_drafts) from frameworks where key = 'wa8a8a8a8-acme'),
  '1 0', 'members read the workspace''s framework; only owners and admins read its drafts');
select throws_ok($$ select set_crosswalk('a8a8a8a8-0000-0000-0000-000000000000', 'wa8a8a8a8-acme@1#2', 'pgc@1#C.1', 'related') $$,
  'not allowed: only owners and admins map requirements', 'an editor cannot map');

-- ── a new edition: requirement 2 removed; edition 1 is replaced and mapped to edition 2
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ select publish_framework('a8a8a8a8-0000-0000-0000-000000000000',
                     pg_temp._fw('2', 1, (select jsonb_agg(x) from jsonb_array_elements((select v from j where name = 'reqs2')) x where x->>'ref' <> '2'),
                       '{"edition_mapping": [{"from_ref": "1", "to_ref": "1", "relation": "equivalent"}, {"from_ref": "3", "to_ref": "3", "relation": "partial"}]}'),
                     pg_temp._pack('framework-wa8a8a8a8-acme-2', '2.1.0', '2', repeat('4', 64))) $$,
  'removing a requirement publishes edition 2');
select is((select status || ' ' || superseded_by from frameworks where key = 'wa8a8a8a8-acme' and version = '1')
          || ' / ' || (select string_agg(from_ref || '>' || to_ref || ':' || relation, ',' order by from_ref) from crosswalks
                        where from_framework = 'wa8a8a8a8-acme' and to_framework = 'wa8a8a8a8-acme'),
  'withdrawn wa8a8a8a8-acme@2 / 1>1:equivalent,3>3:partial', 'edition 1 is replaced by edition 2 and mapped to it');

-- ── the catalogue guard holds for a workspace's own rows
reset role;
select throws_ok($$ update requirements set parent_ref = null, kind = 'theme' where framework_key = 'wa8a8a8a8-acme' and framework_version = '1' and ref = '2' $$,
  null, null, 'an own requirement''s parent and kind never change');
select throws_ok($$ delete from requirements where framework_key = 'wa8a8a8a8-acme' and ref = '2' $$,
  'the requirement catalogue is append-only', 'an own requirement is never deleted');
select throws_ok($$ update crosswalks set relation = 'partial' where org_id = 'a8a8a8a8-0000-0000-0000-000000000000' and retired_at is null and to_framework = 'pgc' $$,
  'a cross-walk never changes: add a new mapping version', 'a cross-walk never changes, not even a workspace''s own');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ select retire_crosswalk('a8a8a8a8-0000-0000-0000-000000000000',
                     (select id from crosswalks where org_id = 'a8a8a8a8-0000-0000-0000-000000000000' and retired_at is null and to_framework = 'pgc')) $$,
  'an admin retires a mapping (the row stays, logged)');

select * from finish();
rollback;
