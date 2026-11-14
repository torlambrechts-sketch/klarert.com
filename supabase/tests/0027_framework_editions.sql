-- Framework editions (0037_framework_editions.sql, docs/12): the edition status columns, two editions of one
-- framework adopted side by side, and move_framework_edition (owners and admins, only the same requirement copied,
-- the old library locked and marked as moved, once).
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'ed-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'ed-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000e1', 'Ed Admin', 'EA'),
  ('00000000-0000-0000-0000-0000000000e2', 'Ed Editor', 'EE');
insert into orgs (id, name, slug) values ('e0e0e0e0-0000-0000-0000-000000000000', 'Org E', 'pgtap-editions');
insert into memberships (org_id, user_id, role) values
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'admin'),
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e2', 'editor');

-- two editions of PGE: 2015 (withdrawn) and 2026, each with its own library pack; 1.1 is the same requirement in
-- both editions, 1.2 was changed (partial)
insert into packs (key, version, title, manifest, hash) values
  ('framework-pge', '2015.1.0', 'PGE 2015', '{}', repeat('d', 64)),
  ('framework-pge-2026', '2026.1.0', 'PGE 2026', '{}', repeat('e', 64));
insert into frameworks (key, version, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, hash,
                        status, superseded_by, transition_ends, status_checked_on) values
  ('pge', '2015', 'PGE 2015', 'PGE', 'Test', 'standard', 'PGE', 'Reference numbers only.', 'https://example.com/pge',
   'framework-pge', '2015.1.0', repeat('1', 64), 'withdrawn', 'pge@2026', '2029-04-15', '2026-11-14'),
  ('pge', '2026', 'PGE 2026', 'PGE:2026', 'Test', 'standard', 'PGE', 'Reference numbers only.', 'https://example.com/pge',
   'framework-pge-2026', '2026.1.0', repeat('2', 64), 'current', null, null, '2026-11-14');
insert into requirements (framework_key, framework_version, ref, parent_ref, kind, position, title) values
  ('pge', '2015', '1', null, 'theme', 0, 'Theme'), ('pge', '2015', '1.1', '1', 'clause', 1, 'Same'),
  ('pge', '2015', '1.2', '1', 'clause', 2, 'Changed'),
  ('pge', '2026', '1', null, 'theme', 0, 'Theme'), ('pge', '2026', '1.1', '1', 'clause', 1, 'Same'),
  ('pge', '2026', '1.2', '1', 'clause', 2, 'Changed');
insert into crosswalks (from_framework, from_version, from_ref, to_framework, to_version, to_ref, relation, source) values
  ('pge', '2015', '1.1', 'pge', '2026', '1.1', 'equivalent', 'Test mapping v1'),
  ('pge', '2015', '1.2', 'pge', '2026', '1.2', 'partial', 'Test mapping v1');

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
-- the library plan of one edition: the ids end in the edition's digit (5 or 6)
create function pg_temp._plan(v text, d text, pk text) returns jsonb language sql as $$
  select replace(replace(replace($j${
    "pack": { "key": "PK", "version": "V.1.0", "hash": "HASH" },
    "folders": [{ "id": "e100000D-0000-4000-8000-000000000001", "ref": "frameworks", "name": "Frameworks V", "position": "a0" }],
    "sheets": [{ "id": "e200000D-0000-4000-8000-000000000001", "ref": "library", "folder_id": "e100000D-0000-4000-8000-000000000001",
        "name": "PGE V requirements", "item_label": "Requirement", "id_prefix": "PGED-", "is_library": true, "position": "a0",
        "settings": { "framework": { "key": "pge", "version": "V", "refFieldKey": "ref" } } }],
    "groups": [{ "id": "e300000D-0000-4000-8000-000000000001", "ref": "library.r1", "sheet_id": "e200000D-0000-4000-8000-000000000001", "name": "Theme", "color": "green", "position": "a0" }],
    "fields": [
      { "id": "e400000D-0000-4000-8000-000000000001", "ref": "library.ref", "sheet_id": "e200000D-0000-4000-8000-000000000001", "key": "ref", "name": "Ref", "type": "text", "position": "a0", "width": 100, "locked": true, "config": {} },
      { "id": "e400000D-0000-4000-8000-000000000002", "ref": "library.owner_note", "sheet_id": "e200000D-0000-4000-8000-000000000001", "key": "justification", "name": "Justification", "type": "text", "position": "a1", "width": 150, "config": {} }],
    "views": [],
    "items": [
      { "id": "e600000D-0000-4000-8000-000000000001", "ref": "library.r1_1", "sheet_id": "e200000D-0000-4000-8000-000000000001", "group_id": "e300000D-0000-4000-8000-000000000001",
        "name": "Same", "position": "a0", "values": { "e400000D-0000-4000-8000-000000000001": "1.1" }, "requirement_ref": "pge@V#1.1" },
      { "id": "e600000D-0000-4000-8000-000000000002", "ref": "library.r1_2", "sheet_id": "e200000D-0000-4000-8000-000000000001", "group_id": "e300000D-0000-4000-8000-000000000001",
        "name": "Changed", "position": "a1", "values": { "e400000D-0000-4000-8000-000000000001": "1.2" }, "requirement_ref": "pge@V#1.2" }],
    "links": [], "automations": [], "dashboards": []
  }$j$, 'V', v), 'D', d), 'PK', pk)::jsonb
$$;
insert into plans values
  ('2015', jsonb_set(pg_temp._plan('2015', '5', 'framework-pge'), '{pack,hash}', to_jsonb(repeat('d', 64)))),
  ('2026', jsonb_set(pg_temp._plan('2026', '6', 'framework-pge-2026'), '{pack,hash}', to_jsonb(repeat('e', 64))));

-- ── edition status columns
select throws_ok($$ update frameworks set status = 'withdrawn', superseded_by = null where key = 'pge' and version = '2026' $$,
  '23514', null, 'a withdrawn edition names the edition that replaces it');
select throws_ok($$ update frameworks set status = 'obsolete' where key = 'pge' and version = '2026' $$,
  '23514', null, 'the status is one of the four');
select ok(has_function_privilege('authenticated', 'move_framework_edition(uuid, uuid, uuid, jsonb, jsonb)', 'execute')
          and not has_function_privilege('anon', 'move_framework_edition(uuid, uuid, uuid, jsonb, jsonb)', 'execute'),
  'signed-in people can call move_framework_edition (it checks the role); visitors cannot');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

-- ── both editions side by side
select lives_ok($$ select adopt_framework('e0e0e0e0-0000-0000-0000-000000000000', 'pge', '2015', (select p from plans where name = '2015')) $$,
  'the 2015 edition is adopted');
select lives_ok($$ select adopt_framework('e0e0e0e0-0000-0000-0000-000000000000', 'pge', '2026', (select p from plans where name = '2026')) $$,
  'the 2026 edition is adopted alongside');
select throws_ok($$ select adopt_framework('e0e0e0e0-0000-0000-0000-000000000000', 'pge', '2026', (select p from plans where name = '2026')) $$,
  'framework already adopted', 'one edition is adopted once at a time');

-- the workspace's answers on the 2015 library
select set_item_values('e6000005-0000-4000-8000-000000000001', '{"e4000005-0000-4000-8000-000000000002": "In scope: all sites"}');

-- ── moving
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select throws_ok($$ select move_framework_edition('e0e0e0e0-0000-0000-0000-000000000000', 'e2000005-0000-4000-8000-000000000001',
                     'e2000006-0000-4000-8000-000000000001', '[]', '[]') $$,
  'not allowed: only owners and admins move a library to a new edition', 'an editor cannot move a library');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select throws_ok($$ select move_framework_edition('e0e0e0e0-0000-0000-0000-000000000000', 'e2000006-0000-4000-8000-000000000001',
                     'e2000005-0000-4000-8000-000000000001', '[]', '[]') $$,
  'move: PGE 2015 does not replace PGE 2026', 'only towards the edition that replaces it');
select throws_ok($$ select move_framework_edition('e0e0e0e0-0000-0000-0000-000000000000', 'e2000005-0000-4000-8000-000000000001',
                     'e2000006-0000-4000-8000-000000000001',
                     '[{"from_item": "e6000005-0000-4000-8000-000000000002", "to_item": "e6000006-0000-4000-8000-000000000002", "patch": {"e4000006-0000-4000-8000-000000000002": "x"}}]', '[]') $$,
  'move: pge@2026#1.2 is not the same requirement as pge@2015#1.2', 'answers are copied only to the same requirement');
select lives_ok($$ select move_framework_edition('e0e0e0e0-0000-0000-0000-000000000000', 'e2000005-0000-4000-8000-000000000001',
                     'e2000006-0000-4000-8000-000000000001',
                     '[{"from_item": "e6000005-0000-4000-8000-000000000001", "to_item": "e6000006-0000-4000-8000-000000000001", "patch": {"e4000006-0000-4000-8000-000000000002": "In scope: all sites"}}]', '[]') $$,
  'an admin moves the 2015 library to 2026');
select is((select "values"->>'e4000006-0000-4000-8000-000000000002' from items where id = 'e6000006-0000-4000-8000-000000000001')
          || ' / ' || (select count(*) from activity_log where item_id = 'e6000006-0000-4000-8000-000000000001'
                         and action = 'value.changed' and note = 'Copied from PGE 2015 (move to PGE 2026)')::text,
  'In scope: all sites / 1', 'the answer is copied and logged on the new item');
select ok((select bool_and(locked) from items where sheet_id = 'e2000005-0000-4000-8000-000000000001')
          and (select settings->'framework'->'movedTo'->>'sheetId' from sheets where id = 'e2000005-0000-4000-8000-000000000001')
              = 'e2000006-0000-4000-8000-000000000001'
          and exists (select 1 from activity_log where action = 'framework.moved' and new_value->>'copied' = '1'),
  'the old library is locked, says where it moved, and framework.moved is logged');
select throws_ok($$ select move_framework_edition('e0e0e0e0-0000-0000-0000-000000000000', 'e2000005-0000-4000-8000-000000000001',
                     'e2000006-0000-4000-8000-000000000001', '[]', '[]') $$,
  'move: PGE 2015 was already moved', 'a library is moved once');

select * from finish();
rollback;
