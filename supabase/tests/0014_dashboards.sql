-- Dashboards (0016_dashboards.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'dash-editor@a.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'dash-viewer@a.test'),
  ('00000000-0000-0000-0000-0000000000d3', 'dash-outsider@b.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dash Editor', 'DE'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dash Viewer', 'DV'),
  ('00000000-0000-0000-0000-0000000000d3', 'Dash Outsider', 'DO');
insert into orgs (id, name, slug) values
  ('dddddddd-0000-0000-0000-000000000000', 'Org D', 'pgtap-dash'),
  ('dddddddd-0000-0000-0000-00000000000b', 'Org D2', 'pgtap-dash-b');
insert into memberships (org_id, user_id, role) values
  ('dddddddd-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000d1', 'editor'),
  ('dddddddd-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000d2', 'viewer'),
  ('dddddddd-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d3', 'owner');

set local role authenticated;

-- editor
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select lives_ok($$
  insert into dashboards (id, org_id, name, position, created_by) values
    ('dddddddd-1111-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000000', 'Compliance overview', 'a0',
     '00000000-0000-0000-0000-0000000000d1') $$, 'an editor can create a dashboard');
select throws_ok($$
  insert into dashboards (org_id, name, position, created_by) values
    ('dddddddd-0000-0000-0000-000000000000', 'Someone else', 'a1', '00000000-0000-0000-0000-0000000000d2') $$,
  '42501', null, 'a dashboard is created as yourself');
select lives_ok($$
  update dashboards set name = 'Overview', config = '{"widgets":[{"id":"w1","type":"count","title":"Items"}]}'
   where id = 'dddddddd-1111-0000-0000-000000000000' $$, 'an editor can change a dashboard');
select throws_ok($$
  update dashboards set config = '{"widgets":{}}' where id = 'dddddddd-1111-0000-0000-000000000000' $$,
  '23514', null, 'widgets must be a list');
select is((select count(*)::int from activity_log where action like 'dashboards.%'
            and chain_key = 'sheet:dddddddd-0000-0000-0000-000000000000'), 2,
  'creating and changing a dashboard is audited on the workspace chain');

-- viewer
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select is((select name from dashboards where id = 'dddddddd-1111-0000-0000-000000000000'), 'Overview',
  'a viewer can read dashboards');
select throws_ok($$
  insert into dashboards (org_id, name, position, created_by) values
    ('dddddddd-0000-0000-0000-000000000000', 'Mine', 'a1', '00000000-0000-0000-0000-0000000000d2') $$,
  '42501', null, 'a viewer cannot create a dashboard');
update dashboards set name = 'Hacked' where id = 'dddddddd-1111-0000-0000-000000000000';
delete from dashboards where id = 'dddddddd-1111-0000-0000-000000000000';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select is((select name from dashboards where id = 'dddddddd-1111-0000-0000-000000000000'), 'Overview',
  'a viewer cannot change or delete a dashboard');

-- another workspace
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
select is((select count(*)::int from dashboards where org_id = 'dddddddd-0000-0000-0000-000000000000'), 0,
  'members of another workspace see nothing');
select throws_ok($$
  insert into dashboards (org_id, name, position, created_by) values
    ('dddddddd-0000-0000-0000-000000000000', 'Theirs', 'a1', '00000000-0000-0000-0000-0000000000d3') $$,
  '42501', null, 'members of another workspace cannot create one');

select * from finish();
rollback;
