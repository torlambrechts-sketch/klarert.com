-- The app's own page names cannot be workspace addresses (0073_reserved_slugs.sql): not through
-- workspace_slug_available, create_workspace, a direct insert or an admin's update of orgs.slug. A workspace that
-- already has one keeps it. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000073001', 'slug-ann@a.test', now());
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000073001', 'Ann Admin', 'AA');
insert into orgs (id, name, slug) values
  ('73000000-0000-0000-0000-00000000000a', 'Plain Works', 'pgtap-reserved-plain');
-- a workspace from before 0073 with an address that is now reserved
alter table orgs disable trigger orgs_slug_reserved;
insert into orgs (id, name, slug) values
  ('73000000-0000-0000-0000-00000000000b', 'Terms Ltd', 'terms');
alter table orgs enable trigger orgs_slug_reserved;
insert into memberships (org_id, user_id, role) values
  ('73000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000073001', 'owner'),
  ('73000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000073001', 'owner');

-- internal helpers are not for API roles
select is(has_function_privilege('authenticated', '_reserved_slugs()', 'execute'), false,
  'authenticated cannot call _reserved_slugs');
select is(has_function_privilege('anon', '_reserved_slugs()', 'execute'), false, 'nor can anon');
select is(has_function_privilege('authenticated', 'orgs_slug_reserved()', 'execute'), false,
  'authenticated cannot call the trigger function');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000073001","email":"slug-ann@a.test","role":"authenticated","aal":"aal1"}', true);

-- availability and creation
select is(workspace_slug_available('account'), false, 'a reserved address is not available');
select is(workspace_slug_available(' Privacy '), false, 'in any case and with spaces');
select is(workspace_slug_available('pgtap-reserved-free'), true, 'an ordinary free address is');
select throws_ok($$ select create_workspace('Account Ltd', 'account') $$, '23514', 'workspace address reserved',
  'create_workspace refuses a reserved address');
select throws_ok($$ select create_workspace('Onboarding Ltd', 'Onboarding') $$, '23514', 'workspace address reserved',
  'in any case');
select is((create_workspace('Accounts Ltd', 'pgtap-accounts')).slug, 'pgtap-accounts',
  'an address that only starts with a page name is fine');

-- an admin's direct update (orgs_admin)
select throws_ok($$ update orgs set slug = 'login' where id = '73000000-0000-0000-0000-00000000000a' $$,
  '23514', 'workspace address reserved', 'an admin cannot move a workspace to a reserved address');
select lives_ok($$ update orgs set slug = 'pgtap-reserved-moved' where id = '73000000-0000-0000-0000-00000000000a' $$,
  'or to an ordinary one');

-- the workspace that already had one keeps it
select lives_ok($$ update orgs set name = 'Terms Limited' where id = '73000000-0000-0000-0000-00000000000b' $$,
  'an existing workspace with a reserved address can still be renamed');
select lives_ok($$ update orgs set slug = 'terms' where id = '73000000-0000-0000-0000-00000000000b' $$,
  'and setting the same address again is no change');
select throws_ok($$ update orgs set slug = 'privacy' where id = '73000000-0000-0000-0000-00000000000b' $$,
  '23514', 'workspace address reserved', 'but it cannot move to another reserved one');
reset role;
select is((select slug || '|' || name from orgs where id = '73000000-0000-0000-0000-00000000000b'),
  'terms|Terms Limited', 'it keeps its address');

-- no other path either
select throws_ok($$ insert into orgs (name, slug) values ('Api Ltd', 'api') $$, '23514', 'workspace address reserved',
  'a direct insert, even without RLS, cannot take one');

select * from finish();
rollback;
