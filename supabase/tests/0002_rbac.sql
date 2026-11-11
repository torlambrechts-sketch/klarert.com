-- pgTAP tests for the RBAC layer.
-- Run with: supabase test db
--
-- Covers:
--   * Built-in role seed
--   * has_role / has_permission under different JWTs
--   * Auto-owner trigger on org INSERT
--   * Permission downgrade (owner → member) revokes org.update

begin;

create extension if not exists pgtap with schema extensions;
set search_path = klarert, klarert_private, extensions, public;

select plan(9);

-- ---------------------------------------------------------------------------
-- Built-in role seed
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from klarert.roles where is_builtin),
  3,
  'three built-in roles are seeded'
);

select bag_eq(
  $$select key from klarert.roles where is_builtin$$,
  $$values ('owner'::text), ('admin'), ('member')$$,
  'built-in role keys are owner / admin / member'
);

select is(
  (select array_length(permissions, 1) from klarert.roles where key = 'owner'),
  10,
  'owner role has 10 permissions (incl. deviation.read/write)'
);

-- ---------------------------------------------------------------------------
-- Auto-owner trigger + helpers
-- ---------------------------------------------------------------------------

-- Stage a fake auth user (via direct insert since pgTAP runs as superuser)
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data)
values (
  '99999999-9999-9999-9999-999999999991',
  '00000000-0000-0000-0000-000000000000',
  'pgtap-owner@klarert.test',
  '',
  now(),
  '{}'::jsonb
);

with new_org as (
  insert into klarert.organizations (name, slug, created_by)
  values ('pgtap-rbac-org', 'pgtap-rbac-' || substr(md5(random()::text), 1, 8),
          '99999999-9999-9999-9999-999999999991')
  returning id
)
select id as test_org_id into temp table rbac_test_org from new_org;

insert into klarert.profiles (id, organization_id, full_name, email)
values (
  '99999999-9999-9999-9999-999999999991',
  (select test_org_id from rbac_test_org),
  'pgtap owner',
  'pgtap-owner@klarert.test'
);

-- Trigger should have inserted the owner role assignment
select is(
  (select role_key from klarert.role_assignments
   where user_id = '99999999-9999-9999-9999-999999999991'
     and organization_id = (select test_org_id from rbac_test_org)),
  'owner',
  'auto-owner trigger assigns role_key=owner on klarert.organizations INSERT'
);

-- Simulate the user's JWT for has_role / has_permission
set local "request.jwt.claims" = '{"sub":"99999999-9999-9999-9999-999999999991","is_anonymous":false}';

select ok(
  klarert_private.has_role('owner'),
  'has_role(owner) is true for the creator'
);

select ok(
  not klarert_private.has_role('admin'),
  'has_role(admin) is false for an owner-only user'
);

select ok(
  klarert_private.has_permission('org.update'),
  'has_permission(org.update) is true for owner'
);

select ok(
  not klarert_private.has_permission('nonexistent.permission'),
  'has_permission(nonexistent.permission) is false'
);

-- Demote to member and re-check
update klarert.role_assignments
set role_key = 'member'
where user_id = '99999999-9999-9999-9999-999999999991'
  and organization_id = (select test_org_id from rbac_test_org);

select ok(
  not klarert_private.has_permission('org.update'),
  'demote to member revokes org.update'
);

select * from finish();
rollback;
