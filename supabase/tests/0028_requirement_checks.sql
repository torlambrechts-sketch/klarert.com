-- Requirement checks (0038_requirement_checks.sql): a sheet's uniqueLinkPair allows one live item per pair of
-- targets, whoever links it; create_link_pair_items creates checks with both links (and two-way inverses) and
-- skips pairs that already have one. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'chk-editor@a.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'chk-viewer@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000e1', 'Chk Editor', 'CE'),
  ('00000000-0000-0000-0000-0000000000e2', 'Chk Viewer', 'CV');
insert into orgs (id, name, slug) values ('e0e0e0e0-0000-0000-0000-000000000000', 'Org C', 'pgtap-checks');
insert into memberships (org_id, user_id, role) values
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'editor'),
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e2', 'viewer');
-- suppliers, a requirement library and the checks sheet (uniqueLinkPair supplier × requirement)
insert into sheets (id, org_id, name, id_prefix, position, is_library, settings) values
  ('e0000001-0000-0000-0000-000000000001', 'e0e0e0e0-0000-0000-0000-000000000000', 'Suppliers', 'SUP-', 'a0', false, '{}'),
  ('e0000001-0000-0000-0000-000000000002', 'e0e0e0e0-0000-0000-0000-000000000000', 'Requirements', 'SRQ-', 'a1', true, '{}'),
  ('e0000001-0000-0000-0000-000000000003', 'e0e0e0e0-0000-0000-0000-000000000000', 'Checks', 'SRC-', 'a2', false,
   '{"uniqueLinkPair":["supplier","requirement"]}');
insert into groups (id, org_id, sheet_id, name, position) values
  ('e0000003-0000-0000-0000-000000000001', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000001', 'All', 'a0'),
  ('e0000003-0000-0000-0000-000000000002', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000002', 'All', 'a0'),
  ('e0000003-0000-0000-0000-000000000003', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000003', 'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('e0000004-0000-0000-0000-000000000001', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000001',
   'checks', 'Checks', 'link', 'a0',
   '{"targetSheetId":"e0000001-0000-0000-0000-000000000003","multiple":true,"inverseFieldId":"e0000004-0000-0000-0000-000000000003"}'),
  ('e0000004-0000-0000-0000-000000000003', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000003',
   'supplier', 'Supplier', 'link', 'a0',
   '{"targetSheetId":"e0000001-0000-0000-0000-000000000001","multiple":false,"inverseFieldId":"e0000004-0000-0000-0000-000000000001"}'),
  ('e0000004-0000-0000-0000-000000000004', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000003',
   'requirement', 'Requirement', 'link', 'a1',
   '{"targetSheetId":"e0000001-0000-0000-0000-000000000002","multiple":false,"inverseFieldId":null}'),
  ('e0000004-0000-0000-0000-000000000005', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000003',
   'note', 'Note', 'text', 'a2', '{}');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('e0000005-0000-0000-0000-000000000001', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000001',
   'e0000003-0000-0000-0000-000000000001', 1, 'SUP-001', 'Acme', 'a0'),
  ('e0000005-0000-0000-0000-000000000002', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000002',
   'e0000003-0000-0000-0000-000000000002', 1, 'SRQ-001', 'Signed contract', 'a0'),
  ('e0000005-0000-0000-0000-000000000003', 'e0e0e0e0-0000-0000-0000-000000000000', 'e0000001-0000-0000-0000-000000000002',
   'e0000003-0000-0000-0000-000000000002', 2, 'SRQ-002', 'DPA signed', 'a1');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- grants
select ok(has_function_privilege('authenticated', 'create_link_pair_items(uuid, uuid, jsonb, uuid)', 'execute'),
  'authenticated may create checks');
select ok(not has_function_privilege('anon', 'create_link_pair_items(uuid, uuid, jsonb, uuid)', 'execute'),
  'anon may not');
select ok(not has_function_privilege('authenticated', '_link_pair_clash(uuid)', 'execute')
          and not has_function_privilege('authenticated', '_link_pair_fields(uuid)', 'execute'),
  'internal helpers are not granted');

set local role authenticated;
select pg_temp.as_user('e1');
create temp table t_first as select create_link_pair_items(
  'e0000001-0000-0000-0000-000000000003', 'e0000003-0000-0000-0000-000000000003',
  '[{"name":"Signed contract","position":"a0","values":{"e0000004-0000-0000-0000-000000000005":"Rule"},
     "a":"e0000005-0000-0000-0000-000000000001","b":"e0000005-0000-0000-0000-000000000002"},
    {"name":"DPA signed","position":"a1","values":{},
     "a":"e0000005-0000-0000-0000-000000000001","b":"e0000005-0000-0000-0000-000000000003"},
    {"name":"Signed contract again","position":"a2","values":{},
     "a":"e0000005-0000-0000-0000-000000000001","b":"e0000005-0000-0000-0000-000000000002"}]'::jsonb) r;
select is((select jsonb_array_length(r->'created') from t_first), 2, 'two checks created');
select is((select jsonb_array_length(r->'skipped') from t_first), 1, 'the repeated pair in the same call is skipped');
select is((select count(*)::int from items where sheet_id = 'e0000001-0000-0000-0000-000000000003'), 2,
  'one item per pair');
select is((select count(*)::int from item_links where field_id = 'e0000004-0000-0000-0000-000000000001'
             and from_item = 'e0000005-0000-0000-0000-000000000001'), 2, 'the supplier links back to both (two-way)');
select is((select count(*)::int from activity_log where sheet_id = 'e0000001-0000-0000-0000-000000000003'
             and action = 'item.created'), 2, 'each creation is logged');

-- calling again skips everything: the sync is idempotent
select is((select jsonb_array_length(create_link_pair_items(
  'e0000001-0000-0000-0000-000000000003', 'e0000003-0000-0000-0000-000000000003',
  '[{"name":"x","position":"a3","values":{},"a":"e0000005-0000-0000-0000-000000000001",
     "b":"e0000005-0000-0000-0000-000000000003"}]'::jsonb)->'created')), 0, 'a second sync creates nothing');

-- a person linking a second item to the same pair by hand is refused by the database
create temp table t_dup as select (create_item('e0000001-0000-0000-0000-000000000003',
  'e0000003-0000-0000-0000-000000000003', 'By hand', 'a9')).id;
select lives_ok($$ select set_item_links('e0000004-0000-0000-0000-000000000003', (select id from t_dup),
  array['e0000005-0000-0000-0000-000000000001'::uuid], 'add') $$, 'one half of a pair is fine');
select throws_ok($$ select set_item_links('e0000004-0000-0000-0000-000000000004', (select id from t_dup),
  array['e0000005-0000-0000-0000-000000000002'::uuid], 'add') $$, '23505', null,
  'completing a pair that already has a check is refused');

-- a viewer cannot create checks
select pg_temp.as_user('e2');
select throws_ok($$ select create_link_pair_items('e0000001-0000-0000-0000-000000000003',
  'e0000003-0000-0000-0000-000000000003', '[]'::jsonb) $$, 'P0001', 'not allowed', 'viewers may not create checks');

select * from finish();
rollback;
