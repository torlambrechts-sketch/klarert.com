-- pgTAP tests for the core primitives + audit trigger.
-- Run with: supabase test db
--
-- Covers:
--   * klarert_private.acting_user_id() under no JWT, anonymous JWT, real JWT
--   * klarert_private.user_org_ids() under each of those
--   * Audit trigger fires on klarert.organizations INSERT/UPDATE/DELETE

begin;

create extension if not exists pgtap with schema extensions;
set search_path = klarert, klarert_private, extensions, public;

select plan(8);

-- ---------------------------------------------------------------------------
-- acting_user_id()
-- ---------------------------------------------------------------------------

select is(
  klarert_private.acting_user_id(),
  null,
  'acting_user_id() returns NULL when no JWT claims are set'
);

set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","is_anonymous":true}';
select is(
  klarert_private.acting_user_id(),
  null,
  'acting_user_id() returns NULL for an anonymous JWT'
);

set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","is_anonymous":false}';
select is(
  klarert_private.acting_user_id(),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'acting_user_id() returns the sub uuid for a non-anonymous JWT'
);

-- ---------------------------------------------------------------------------
-- user_org_ids()
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" to '';
select is_empty(
  'select * from klarert_private.user_org_ids()',
  'user_org_ids() is empty with no JWT'
);

set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","is_anonymous":true}';
select is_empty(
  'select * from klarert_private.user_org_ids()',
  'user_org_ids() is empty for an anonymous JWT'
);

-- ---------------------------------------------------------------------------
-- Audit trigger end-to-end on klarert.organizations
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" to '';

with new_org as (
  insert into klarert.organizations (name, slug)
  values ('pgtap-org', 'pgtap-' || substr(md5(random()::text), 1, 8))
  returning id
)
select id as test_org_id into temp table test_org from new_org;

-- The audit_log INSERT happens inside the trigger; visible in this txn after
-- the modifying statement above completes.
select is(
  (select count(*)::int from klarert.audit_log a, test_org t
    where a.row_id = t.test_org_id and a.op = 'INSERT'),
  1,
  'audit_trigger() writes one INSERT row when an organization is created'
);

update klarert.organizations
set name = 'pgtap-org-renamed'
where id = (select test_org_id from test_org);

select is(
  (select count(*)::int from klarert.audit_log a, test_org t
    where a.row_id = t.test_org_id and a.op = 'UPDATE'),
  1,
  'audit_trigger() writes one UPDATE row when an organization is modified'
);

delete from klarert.organizations
where id = (select test_org_id from test_org);

select is(
  (select count(*)::int from klarert.audit_log a, test_org t
    where a.row_id = t.test_org_id and a.op = 'DELETE'),
  1,
  'audit_trigger() writes one DELETE row when an organization is removed'
);

select * from finish();
rollback;
