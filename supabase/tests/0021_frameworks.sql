-- The requirement library (0030_frameworks.sql, docs/12): the global catalogue is read-only and append-only,
-- adopt_framework is owners' and admins' only, atomic and stamps provenance and requirement keys, a library item's
-- requirement key and Ref never change, links to any library sheet, and library sheets follow sheet access.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'fw-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'fw-editor@a.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'fw-outsider@b.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000f1', 'Fw Admin', 'FA'),
  ('00000000-0000-0000-0000-0000000000f2', 'Fw Editor', 'FE'),
  ('00000000-0000-0000-0000-0000000000f3', 'Fw Outsider', 'FO');
insert into orgs (id, name, slug) values
  ('f0f0f0f0-0000-0000-0000-000000000000', 'Org F', 'pgtap-frameworks'),
  ('f1f1f1f1-0000-0000-0000-000000000000', 'Org G', 'pgtap-frameworks-other');
insert into memberships (org_id, user_id, role) values
  ('f0f0f0f0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f1', 'admin'),
  ('f0f0f0f0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f2', 'editor'),
  ('f1f1f1f1-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f3', 'owner');

-- the catalogue, as the seed writes it (service role): two frameworks, their library packs and one cross-walk
insert into packs (key, version, title, manifest, hash) values
  ('framework-pgx', '2024.1.0', 'PGX', '{}', repeat('d', 64)),
  ('framework-pgy', '2024.1.0', 'PGY', '{}', repeat('e', 64));
insert into frameworks (key, version, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, hash) values
  ('pgx', '2024', 'PGX 2024', 'PGX', 'Test', 'standard', 'PGX (reference numbers only)', 'Reference numbers only.', 'https://example.com/pgx',
   'framework-pgx', '2024.1.0', repeat('1', 64)),
  ('pgy', '2024', 'PGY 2024', 'PGY', 'Test', 'law', 'PGY', 'EU law.', 'https://example.com/pgy',
   'framework-pgy', '2024.1.0', repeat('2', 64));
insert into requirements (framework_key, framework_version, ref, parent_ref, kind, position, title) values
  ('pgx', '2024', '1', null, 'theme', 0, 'Theme one'),
  ('pgx', '2024', '1.1', '1', 'clause', 1, 'First'),
  ('pgx', '2024', '1.2', '1', 'clause', 2, 'Second'),
  ('pgy', '2024', 'Ch. I', null, 'theme', 0, 'Chapter one'),
  ('pgy', '2024', 'Art. 1', 'Ch. I', 'article', 1, 'Article one');
insert into crosswalks (from_framework, from_version, from_ref, to_framework, to_version, to_ref, relation, source) values
  ('pgx', '2024', '1.1', 'pgy', '2024', 'Art. 1', 'related', 'Test mapping v1');

-- PGX's library as the pack planner writes it: a folder, a library sheet naming the framework, a Ref and an
-- applicability field, one group, an item per requirement with its key
create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
insert into plans values ('good', $j${
  "pack": { "key": "framework-pgx", "version": "2024.1.0", "hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
  "folders": [{ "id": "f1000000-0000-4000-8000-000000000001", "ref": "frameworks", "name": "Frameworks", "position": "a0" }],
  "sheets": [{ "id": "f2000000-0000-4000-8000-000000000001", "ref": "library", "folder_id": "f1000000-0000-4000-8000-000000000001",
      "name": "PGX requirements", "item_label": "Requirement", "id_prefix": "PGX-", "is_library": true, "position": "a0",
      "settings": { "framework": { "key": "pgx", "version": "2024", "refFieldKey": "ref" } } }],
  "groups": [{ "id": "f3000000-0000-4000-8000-000000000001", "ref": "library.r1", "sheet_id": "f2000000-0000-4000-8000-000000000001", "name": "Theme one", "color": "green", "position": "a0" }],
  "fields": [
    { "id": "f4000000-0000-4000-8000-000000000001", "ref": "library.ref", "sheet_id": "f2000000-0000-4000-8000-000000000001", "key": "ref", "name": "Ref", "type": "text", "position": "a0", "width": 100, "locked": true, "config": {} },
    { "id": "f4000000-0000-4000-8000-000000000002", "ref": "library.applicable", "sheet_id": "f2000000-0000-4000-8000-000000000001", "key": "applicable", "name": "Applicable", "type": "applicability", "position": "a1", "width": 150, "config": { "reasonRequiredWhenNot": false } }],
  "views": [],
  "items": [
    { "id": "f6000000-0000-4000-8000-000000000001", "ref": "library.r1_1", "sheet_id": "f2000000-0000-4000-8000-000000000001", "group_id": "f3000000-0000-4000-8000-000000000001",
      "name": "First", "position": "a0", "values": { "f4000000-0000-4000-8000-000000000001": "1.1" }, "requirement_ref": "pgx@2024#1.1" },
    { "id": "f6000000-0000-4000-8000-000000000002", "ref": "library.r1_2", "sheet_id": "f2000000-0000-4000-8000-000000000001", "group_id": "f3000000-0000-4000-8000-000000000001",
      "name": "Second", "position": "a1", "values": { "f4000000-0000-4000-8000-000000000001": "1.2" }, "requirement_ref": "pgx@2024#1.2" }],
  "links": [], "automations": [], "dashboards": []
}$j$);
-- a Ref value that is not the requirement's; a key of another framework; a requirement left out; another pack
insert into plans select 'bad_ref', jsonb_set(p, '{items,1,values}', '{"f4000000-0000-4000-8000-000000000001": "9.9"}') from plans where name = 'good';
insert into plans select 'bad_key', jsonb_set(p, '{items,1,requirement_ref}', '"pgy@2024#Art. 1"') from plans where name = 'good';
insert into plans select 'missing', jsonb_set(p, '{items}', (p->'items') - 1) from plans where name = 'good';
insert into plans select 'other_pack', jsonb_set(p, '{pack,key}', '"framework-pgy"') from plans where name = 'good';

-- ── the catalogue is append-only, whoever writes
select throws_ok($$ delete from requirements where framework_key = 'pgx' and ref = '1.2' $$,
  'the requirement catalogue is append-only', 'a requirement is never deleted');
select throws_ok($$ update requirements set ref = '1.9' where framework_key = 'pgx' and ref = '1.2' $$,
  'a requirement''s ref, parent and kind never change', 'a reference number never changes');
select lives_ok($$ update requirements set title = 'Second, reworded' where framework_key = 'pgx' and ref = '1.2' $$,
  'a revision may reword our own title');
select throws_ok($$ update crosswalks set relation = 'equivalent' $$,
  'a cross-walk never changes: add a new mapping version', 'a cross-walk never changes');

-- ── grants
select ok(has_function_privilege('authenticated', 'adopt_framework(uuid, text, text, jsonb)', 'execute')
          and not has_function_privilege('anon', 'adopt_framework(uuid, text, text, jsonb)', 'execute'),
  'signed-in people can call adopt_framework (it checks the role); visitors cannot');
select ok(not has_function_privilege('authenticated', '_library_ref_field(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'items_requirement_guard()', 'execute')
          and not has_function_privilege('authenticated', 'catalogue_guard()', 'execute'),
  'the internal helpers are not callable');

-- a controls sheet (any library) and a plain sheet, as the admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
insert into sheets (id, org_id, name, id_prefix, position) values
  ('f2000000-0000-4000-8000-0000000000c1', 'f0f0f0f0-0000-0000-0000-000000000000', 'Controls', 'CTL-', 'b0'),
  ('f2000000-0000-4000-8000-0000000000c2', 'f0f0f0f0-0000-0000-0000-000000000000', 'Notes', 'NTE-', 'b1');
insert into groups (id, org_id, sheet_id, name, position) values
  ('f3000000-0000-4000-8000-0000000000c1', 'f0f0f0f0-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-0000000000c1', 'Open', 'a0'),
  ('f3000000-0000-4000-8000-0000000000c2', 'f0f0f0f0-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-0000000000c2', 'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('f4000000-0000-4000-8000-0000000000c1', 'f0f0f0f0-0000-0000-0000-000000000000', 'f2000000-0000-4000-8000-0000000000c1',
   'requirements', 'Requirements', 'requirement', 'a0', '{"targetSheetId": null, "multiple": true, "inverseFieldId": null}');
select create_item('f2000000-0000-4000-8000-0000000000c1', 'f3000000-0000-4000-8000-0000000000c1', 'Access policy', 'a0');
select create_item('f2000000-0000-4000-8000-0000000000c2', 'f3000000-0000-4000-8000-0000000000c2', 'A note', 'a0');

set local role authenticated;

-- ── reading and writing the catalogue
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from frameworks where key in ('pgx', 'pgy'))
          + (select count(*)::int from requirements where framework_key = 'pgx')
          + (select count(*)::int from crosswalks where source = 'Test mapping v1'), 6,
  'members read frameworks, requirements and cross-walks');
select throws_ok($$ insert into frameworks (key, version, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, hash)
                    values ('mine', '1', 'Mine', 'M', 'Me', 'internal', 'Me', 'Mine.', 'https://example.com', 'framework-pgx', '2024.1.0', repeat('3', 64)) $$,
  '42501', null, 'nobody writes frameworks through the API');
select throws_ok($$ insert into requirements (framework_key, framework_version, ref, parent_ref, kind, position, title)
                    values ('pgx', '2024', '1.3', '1', 'clause', 3, 'Third') $$,
  '42501', null, 'nobody writes requirements through the API');
select throws_ok($$ insert into crosswalks (from_framework, from_version, from_ref, to_framework, to_version, to_ref, relation, source)
                    values ('pgx', '2024', '1.2', 'pgy', '2024', 'Art. 1', 'equivalent', 'Mine') $$,
  '42501', null, 'nobody writes cross-walks through the API');

-- ── adopting: owners and admins only, all or nothing
select throws_ok($$ select adopt_framework('f0f0f0f0-0000-0000-0000-000000000000', 'pgx', '2024', (select p from plans where name = 'good')) $$,
  'not allowed: only owners and admins adopt frameworks', 'an editor cannot adopt a framework');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select throws_ok($$ select adopt_framework('f0f0f0f0-0000-0000-0000-000000000000', 'pgx', '2024', (select p from plans where name = 'bad_ref')) $$,
  'adopt: not requirements of PGX 2024: pgx@2024#1.2', 'an item''s Ref must be its requirement''s');
select throws_ok($$ select adopt_framework('f0f0f0f0-0000-0000-0000-000000000000', 'pgx', '2024', (select p from plans where name = 'bad_key')) $$,
  'adopt: not requirements of PGX 2024: pgy@2024#Art. 1', 'every key is a requirement of the adopted framework');
select throws_ok($$ select adopt_framework('f0f0f0f0-0000-0000-0000-000000000000', 'pgx', '2024', (select p from plans where name = 'missing')) $$,
  'adopt: PGX 2024 has 2 requirements, the plan 1', 'every requirement gets its item');
select throws_ok($$ select adopt_framework('f0f0f0f0-0000-0000-0000-000000000000', 'pgx', '2024', (select p from plans where name = 'other_pack')) $$,
  'adopt: the plan is not this framework''s library', 'the plan must be the framework''s own library pack');
select is((select count(*)::int from sheets where org_id = 'f0f0f0f0-0000-0000-0000-000000000000' and is_library)
          + (select count(*)::int from pack_installs where org_id = 'f0f0f0f0-0000-0000-0000-000000000000')
          + (select count(*)::int from activity_log where org_id = 'f0f0f0f0-0000-0000-0000-000000000000'
               and action in ('pack.installed', 'framework.adopted')), 0,
  'nothing of a failed adoption is left: no library, install or log entry');
select throws_ok($$ select adopt_framework('f1f1f1f1-0000-0000-0000-000000000000', 'pgx', '2024', (select p from plans where name = 'good')) $$,
  'not allowed: only owners and admins adopt frameworks', 'an admin of one workspace cannot adopt into another');

select lives_ok($$ select adopt_framework('f0f0f0f0-0000-0000-0000-000000000000', 'pgx', '2024', (select p from plans where name = 'good')) $$,
  'an admin adopts the framework');
select is((select string_agg(requirement_ref || ' ' || pack_ref, ',' order by seq) from items
            where sheet_id = 'f2000000-0000-4000-8000-000000000001'),
  'pgx@2024#1.1 library.r1_1,pgx@2024#1.2 library.r1_2', 'library items carry their requirement and provenance');
select ok((select pack_install_id is not null and is_library from sheets where id = 'f2000000-0000-4000-8000-000000000001')
          and (select count(*) = 1 from pack_installs where pack_key = 'framework-pgx' and status = 'installed'),
  'the library is a pack install with provenance');
select is((select new_value->>'requirements' from activity_log where action = 'framework.adopted'
              and chain_key = 'sheet:f0f0f0f0-0000-0000-0000-000000000000'), '2',
  'framework.adopted is on the workspace chain');
select throws_ok($$ select adopt_framework('f0f0f0f0-0000-0000-0000-000000000000', 'pgx', '2024', (select p from plans where name = 'good')) $$,
  'framework already adopted', 'a framework is adopted once at a time');

-- ── a library item's requirement and Ref never change
select throws_ok($$ select set_item_values('f6000000-0000-4000-8000-000000000001', '{"f4000000-0000-4000-8000-000000000001": "1.9"}') $$,
  'locked: the reference number of a requirement never changes', 'the Ref value is locked');
select lives_ok($$ select set_item_values('f6000000-0000-4000-8000-000000000001',
                     '{"f4000000-0000-4000-8000-000000000002": {"applicable": false, "reason": "Out of scope"}}', 'First, renamed') $$,
  'applicability and the name of a library item can change');

-- ── links to any library sheet
select throws_ok($$ select set_item_links('f4000000-0000-4000-8000-0000000000c1',
                     (select id from items where sheet_id = 'f2000000-0000-4000-8000-0000000000c1'),
                     array[(select id from items where sheet_id = 'f2000000-0000-4000-8000-0000000000c2')], 'replace') $$,
  'link target not allowed', 'a requirement field with no target links to library items only');
select lives_ok($$ select set_item_links('f4000000-0000-4000-8000-0000000000c1',
                     (select id from items where sheet_id = 'f2000000-0000-4000-8000-0000000000c1'),
                     array['f6000000-0000-4000-8000-000000000001']::uuid[], 'replace') $$,
  'a control links to a requirement of any adopted library');

-- ── sheet access applies to library sheets
select set_sheet_access('f2000000-0000-4000-8000-000000000001', 'restricted');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from items where sheet_id = 'f2000000-0000-4000-8000-000000000001'), 0,
  'a restricted library is not readable by an editor who is not listed');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
select is((select count(*)::int from items where sheet_id = 'f2000000-0000-4000-8000-000000000001')
          + (select count(*)::int from sheets where id = 'f2000000-0000-4000-8000-000000000001'), 0,
  'another workspace never reads the library');

select * from finish();
rollback;
