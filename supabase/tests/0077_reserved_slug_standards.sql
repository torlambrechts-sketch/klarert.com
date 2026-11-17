-- The public site's standard pages take /standards (0077_reserved_slug_standards.sql): `standards` joins the reserved
-- addresses; the others stay reserved, the helper stays internal, and a workspace that already has it keeps it.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000077001', 'slug-std@a.test', now());
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000077001', 'Sam Standards', 'SS');
-- a workspace from before 0077 at the address
alter table orgs disable trigger orgs_slug_reserved;
insert into orgs (id, name, slug) values ('77000000-0000-0000-0000-00000000000a', 'Standards Ltd', 'standards');
alter table orgs enable trigger orgs_slug_reserved;
insert into memberships (org_id, user_id, role) values
  ('77000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000077001', 'owner');

select is(has_function_privilege('authenticated', '_reserved_slugs()', 'execute'), false,
  'authenticated still cannot call _reserved_slugs');
select ok('standards' = any (_reserved_slugs()), 'standards is reserved');
select ok('frameworks' = any (_reserved_slugs()) and 'platform' = any (_reserved_slugs()),
  'the earlier addresses stay reserved');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000077001","email":"slug-std@a.test","role":"authenticated","aal":"aal1"}', true);

select is(workspace_slug_available('Standards'), false, 'the address is not available, in any case');
select throws_ok($$ select create_workspace('Standards Two', 'standards') $$, '23514', 'workspace address reserved',
  'create_workspace refuses it');
select is((create_workspace('Standards Co', 'pgtap-standards-co')).slug, 'pgtap-standards-co',
  'an address that only starts with it is fine');
select lives_ok($$ update orgs set name = 'Standards Limited' where id = '77000000-0000-0000-0000-00000000000a' $$,
  'the workspace that already had the address can still be renamed');
reset role;
select is((select slug from orgs where id = '77000000-0000-0000-0000-00000000000a'), 'standards',
  'and keeps its address');

select * from finish();
rollback;
