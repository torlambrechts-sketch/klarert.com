-- Saved views, public forms and server-side filters (0009_views_forms.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009a1', 'owner@v.test'),
  ('00000000-0000-0000-0000-0000000009a2', 'editor@v.test'),
  ('00000000-0000-0000-0000-0000000009a3', 'viewer@v.test'),
  ('00000000-0000-0000-0000-0000000009a4', 'outsider@v.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@v.test';
insert into orgs (id, name, slug) values
  ('a9a9a9a9-0000-0000-0000-000000000000', 'Views Org', 'views-org'),
  ('a9a9a9a9-0000-0000-0000-00000000000b', 'Other Org', 'other-views-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009a1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009a2', 'editor'),
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009a3', 'viewer');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a4","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('a9a9a9a9-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000009a4', 'owner');
select set_config('request.jwt.claims', '', true);
insert into sheets (id, org_id, name, id_prefix, position) values
  ('a9a9a9a9-1111-0000-0000-000000000000', 'a9a9a9a9-0000-0000-0000-000000000000', 'Incidents', 'IN-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('a9a9a9a9-2222-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000', 'New', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('a9a9a9a9-3333-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000',
   'where_seen', 'Where', 'text', 'a0', '{}'),
  ('a9a9a9a9-3333-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000',
   'internal', 'Internal note', 'text', 'a1', '{}'),
  ('a9a9a9a9-3333-0000-0000-000000000003', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000',
   'score', 'Score', 'number', 'a2', '{}');
insert into views (id, org_id, sheet_id, name, type, config, position) values
  ('a9a9a9a9-4444-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000',
   'Report', 'form', '{"form":{"fields":[{"key":"where_seen","required":true}]}}', 'a0');
insert into form_links (id, org_id, sheet_id, view_id, token) values
  ('a9a9a9a9-5555-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000',
   'a9a9a9a9-4444-0000-0000-000000000001', repeat('ab', 32)),
  ('a9a9a9a9-5555-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000',
   'a9a9a9a9-4444-0000-0000-000000000001', repeat('cd', 32));
update form_links set enabled = false where id = 'a9a9a9a9-5555-0000-0000-000000000002';

-- ───────────── views ─────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a2","role":"authenticated"}', true);
select lives_ok($$ insert into views (org_id, sheet_id, name, type, owner_id, position) values
  ('a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000', 'My open', 'list',
   '00000000-0000-0000-0000-0000000009a2', 'a1') $$, 'an editor saves a personal view');
select lives_ok($$ insert into views (org_id, sheet_id, name, type, position) values
  ('a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000', 'Team board', 'kanban', 'a2') $$,
  'an editor saves a shared view');
select is((select count(*)::int from views where name = 'My open'), 1, 'the owner sees their personal view');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
select is((select count(*)::int from views where name = 'My open'), 0, 'a personal view is invisible to other members');
select is((select count(*)::int from views where name = 'Team board'), 1, 'shared views are visible to members');
update views set name = 'Taken' where name = 'My open';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a2","role":"authenticated"}', true);
select is((select name from views where owner_id = '00000000-0000-0000-0000-0000000009a2'), 'My open',
  'others cannot change a personal view');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a3","role":"authenticated"}', true);
select throws_like($$ insert into views (org_id, sheet_id, name, type, position) values
  ('a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000', 'Viewer shared', 'list', 'a3') $$,
  '%row-level security%', 'a viewer cannot create a shared view');
select lives_ok($$ insert into views (org_id, sheet_id, name, type, owner_id, position) values
  ('a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000', 'Viewer own', 'list',
   '00000000-0000-0000-0000-0000000009a3', 'a3') $$, 'a viewer saves a personal view');
select throws_like($$ insert into views (org_id, sheet_id, name, type, owner_id, position) values
  ('a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000000', 'For someone', 'list',
   '00000000-0000-0000-0000-0000000009a2', 'a4') $$,
  '%row-level security%', 'nobody saves a personal view for someone else');
select is((select count(*)::int from views where name = 'Team board'), 1, 'a viewer sees shared views');

-- ───────────── public forms ─────────────
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok(not has_function_privilege('anon', 'submit_form(text, text, jsonb, text)', 'execute'),
  'signed-out visitors cannot skip the rate limit by calling submit_form');
select is((get_public_form(repeat('ab', 32))->'fields'->0->>'key'), 'where_seen', 'the public form shows its fields');
select is(jsonb_array_length(get_public_form(repeat('ab', 32))->'fields'), 1, 'and only the fields on the form');
select is(get_public_form(repeat('cd', 32)), null, 'a disabled link shows no form');

select throws_ok($$ select submit_public_form(repeat('ab', 32), repeat('9', 64), 'Direct', '{}', 'a1', '') $$,
  '42501', null, 'signed-out callers cannot call submit_public_form directly');
reset role;
set local role service_role;
select is((submit_public_form(repeat('ab', 32), repeat('1', 64), 'Spill near bay 3',
  '{"a9a9a9a9-3333-0000-0000-000000000001":"Bay 3"}', 'a0', ''))->>'ok', 'true', 'a visitor submits the form');
select is((submit_public_form(repeat('ab', 32), repeat('2', 64), 'Sneaky',
  '{"a9a9a9a9-3333-0000-0000-000000000002":"set by a visitor"}', 'a1', ''))->>'reason', 'invalid',
  'fields that are not on the form are refused');
select is((submit_public_form(repeat('ab', 32), repeat('2', 64), 'Bot', '{}', 'a1', 'http://spam.example'))->>'reason',
  'rejected', 'a filled honeypot is rejected');
select is((submit_public_form(repeat('cd', 32), repeat('2', 64), 'Late', '{}', 'a1', ''))->>'reason', 'not_found',
  'a disabled link refuses submissions');
select is((select array_agg((submit_public_form(repeat('ab', 32), repeat('3', 64), 'Burst ' || n, '{}', 'a' || n, ''))->>'ok')
             from generate_series(1, 11) n),
  array['true','true','true','true','true','true','true','true','true','true','false'],
  'the 11th submission from one IP in a minute is refused');
select is((submit_public_form(repeat('ab', 32), repeat('3', 64), 'Again', '{}', 'b0', ''))->>'reason', 'rate_limited',
  'and says why');

reset role;
select is((select count(*)::int from items where sheet_id = 'a9a9a9a9-1111-0000-0000-000000000000'), 11,
  'only accepted submissions created items');
select is((select count(*)::int from activity_log where action = 'item.created' and actor_kind = 'form'
             and sheet_id = 'a9a9a9a9-1111-0000-0000-000000000000'), 11, 'each is logged with actor form');

-- ───────────── server-side filters ─────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a3","role":"authenticated"}', true);
select is(array_length(filter_item_ids('a9a9a9a9-1111-0000-0000-000000000000',
  'strpos(lower(coalesce(i.values->>''a9a9a9a9-3333-0000-0000-000000000001'', '''')), lower(($1->>0))) > 0',
  '["bay"]'), 1), 1, 'a member filters items with a parameterised clause');
select throws_ok($$ select filter_item_ids('a9a9a9a9-1111-0000-0000-000000000000', 'true) or (select pg_sleep(1)) is null or (true', '[]') $$,
  'bad filter', 'clauses with anything the builder does not emit are refused');

select * from finish();
rollback;
