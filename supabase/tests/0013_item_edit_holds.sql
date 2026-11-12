-- Edit holds (0015_item_edit_holds.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'hold-editor@a.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'hold-viewer@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000c1', 'Hold Editor', 'HE'),
  ('00000000-0000-0000-0000-0000000000c2', 'Hold Viewer', 'HV');
insert into orgs (id, name, slug) values ('cccccccc-0000-0000-0000-000000000000', 'Org C', 'pgtap-hold');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('cccccccc-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'owner');
insert into memberships (org_id, user_id, role) values ('cccccccc-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 'viewer');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('cccccccc-1111-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000000', 'Holds', 'HLD-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('cccccccc-2222-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000000', 'cccccccc-1111-0000-0000-000000000000', 'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('cccccccc-3333-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000000', 'cccccccc-1111-0000-0000-000000000000', 'notes', 'Notes', 'text', 'a0', '{}');

set local role authenticated;
create temp table t_new as
  select (create_item('cccccccc-1111-0000-0000-000000000000', 'cccccccc-2222-0000-0000-000000000000', 'New row', 'a0',
                      '{"cccccccc-3333-0000-0000-000000000001":"before"}')).id;

select is(hold_item((select id from t_new)), true, 'an editor can hold an item');
update items set values = '{"cccccccc-3333-0000-0000-000000000001":"after"}' where id = (select id from t_new);
select is(hold_item((select id from t_new)), true, 'holding again extends the hold');
select is((select held_snapshot from items where id = (select id from t_new)), '{"cccccccc-3333-0000-0000-000000000001":"before"}'::jsonb,
  'the snapshot keeps the values from the start of the edit');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select throws_ok($$ select release_item((select id from t_new)) $$, 'not allowed', 'a viewer cannot release a hold');
select throws_ok($$ select hold_item((select id from t_new)) $$, 'not allowed', 'a viewer cannot hold an item');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is(release_item((select id from t_new)) -> 'values', '{"cccccccc-3333-0000-0000-000000000001":"before"}'::jsonb, 'release returns the snapshot once');
select is(release_item((select id from t_new)), null, 'a second release returns nothing');

select * from finish();
rollback;
