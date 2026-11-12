-- create_items note (0013_first_sheet.sql): the template importer's items read "Template import", written by the
-- system when the service role imports. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000013a1', 'editor@fs.test');
insert into profiles (id, display_name, initials) values ('00000000-0000-0000-0000-0000000013a1', 'Editor', 'ED');
insert into orgs (id, name, slug) values ('a1300000-0000-0000-0000-000000000000', 'First sheet', 'first-sheet-tap');
insert into memberships (org_id, user_id, role)
values ('a1300000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000013a1', 'owner');
insert into sheets (id, org_id, name, item_label, id_prefix, position)
values ('a1300000-1111-0000-0000-000000000000', 'a1300000-0000-0000-0000-000000000000', 'Corrective actions', 'CA', 'CA-', 'a0');
insert into groups (id, org_id, sheet_id, name, color, position)
values ('a1300000-2222-0000-0000-000000000000', 'a1300000-0000-0000-0000-000000000000',
        'a1300000-1111-0000-0000-000000000000', 'Open', 'orange', 'a0');

select ok(not has_function_privilege('anon', 'create_items(uuid, uuid, jsonb, text)', 'execute')
      and has_function_privilege('authenticated', 'create_items(uuid, uuid, jsonb, text)', 'execute')
      and has_function_privilege('service_role', 'create_items(uuid, uuid, jsonb, text)', 'execute'),
  'create_items: signed-in people and the service role, not signed-out visitors');

-- the service role (the seed's importer): actor system, note "Template import"
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(create_items('a1300000-1111-0000-0000-000000000000', 'a1300000-2222-0000-0000-000000000000',
  '[{"name":"Burrs on bracket 44-210","position":"a0"}]', 'Template import'), 1, 'the importer creates an item');
select results_eq($$ select actor_kind, actor_id, note from activity_log
                     where sheet_id = 'a1300000-1111-0000-0000-000000000000' and action = 'item.created' $$,
  $$ values ('system'::text, null::uuid, 'Template import'::text) $$, 'logged as the system with the template note');
select throws_ok($$ select create_items('a1300000-1111-0000-0000-000000000000', 'a1300000-2222-0000-0000-000000000000',
  '[{"name":"x","position":"a1"}]', 'anything I like') $$, 'bad note', 'the note is one of the known sources');
reset role;

-- a person: the default note stays "CSV import"
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000013a1","role":"authenticated"}', true);
set local role authenticated;
select is(create_items('a1300000-1111-0000-0000-000000000000', 'a1300000-2222-0000-0000-000000000000',
  '[{"name":"Guard bypassed on press 3","position":"a2"}]'), 1, 'an owner imports an item');
select results_eq($$ select actor_kind, note from activity_log
                     where sheet_id = 'a1300000-1111-0000-0000-000000000000' and action = 'item.created' order by id desc limit 1 $$,
  $$ values ('user'::text, 'CSV import'::text) $$, 'the CSV import keeps its note and the person as actor');
select results_eq($$ select display_id from items where sheet_id = 'a1300000-1111-0000-0000-000000000000' order by seq $$,
  array['CA-001', 'CA-002'], 'display ids follow the sequence');

select * from finish();
rollback;
