-- Retention rules and turning off the personal-data flag are for owners and admins (0060, M7; 0064: editors may turn it on). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000096001', 'ret-admin@a.test'),
  ('00000000-0000-0000-0000-000000096002', 'ret-eve@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000096001', 'Ada Admin', 'AA'),
  ('00000000-0000-0000-0000-000000096002', 'Eve Editor', 'EE');
insert into orgs (id, name, slug) values ('96000000-0000-0000-0000-00000000000a', 'Retention A', 'pgtap-retset-a');
insert into memberships (org_id, user_id, role) values
  ('96000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000096001', 'admin'),
  ('96000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000096002', 'editor');
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('96000001-0000-0000-0000-000000000001', '96000000-0000-0000-0000-00000000000a', 'Requests', 'DSR-', 'a0',
   '{"retention":{"personalNames":true,"rules":[{"id":"r1","name":"Erase","from":{"kind":"created"},"period":{"n":3,"unit":"years"},"action":"erase"}]}}');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('96000004-0000-0000-0000-000000000001', '96000000-0000-0000-0000-00000000000a', '96000001-0000-0000-0000-000000000001',
   'requester', 'Requester', 'text', 'a0', '{"personalData": true}'),
  ('96000004-0000-0000-0000-000000000002', '96000000-0000-0000-0000-00000000000a', '96000001-0000-0000-0000-000000000001',
   'notes', 'Notes', 'text', 'a1', '{}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009600' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;

select pg_temp.as_user('2');
select throws_ok($$ update sheets set settings = settings - 'retention' where id = '96000001-0000-0000-0000-000000000001' $$,
  '42501', 'access: Only owners and admins change retention rules.', 'an editor cannot remove a retention rule');
select throws_ok($$ update sheets set settings = jsonb_set(settings, '{retention,personalNames}', 'false')
                    where id = '96000001-0000-0000-0000-000000000001' $$,
  '42501', null, 'nor turn off personal names');
select throws_ok($$ update fields set config = '{}' where id = '96000004-0000-0000-0000-000000000001' $$,
  '42501', 'access: Only owners and admins turn off personal data on a field.',
  'nor turn off a field''s personal-data flag');
select lives_ok($$ update fields set config = '{"personalData": true, "x": 1}' where id = '96000004-0000-0000-0000-000000000001' $$,
  'other config changes keep the flag and are allowed');
select lives_ok($$ update fields set config = '{"personalData": true}' where id = '96000004-0000-0000-0000-000000000002' $$,
  'an editor marks a field as personal data (0064)');
select lives_ok($$ update sheets set name = 'Data requests' where id = '96000001-0000-0000-0000-000000000001' $$,
  'other sheet settings are unaffected');

select pg_temp.as_user('1');
select lives_ok($$ update sheets set settings = jsonb_set(settings, '{retention,personalNames}', 'false')
                   where id = '96000001-0000-0000-0000-000000000001' $$, 'an admin changes retention settings');
select lives_ok($$ update fields set config = '{}' where id = '96000004-0000-0000-0000-000000000001' $$,
  'and the personal-data flag');

select * from finish();
rollback;
