-- Core tenant primitives + append-only audit log.
--
-- Tables:
--   klarert.organizations  — tenant root
--   klarert.profiles       — application user, FK to auth.users
--   klarert.audit_log      — append-only audit trail
--
-- Helpers:
--   klarert.current_org_id()        — active org from JWT claims
--   klarert.user_org_ids(uuid)      — orgs the user is a member of (RLS-safe)
--   klarert.audit_trigger()         — generic AFTER trigger, writes audit_log
--
-- RLS: enabled everywhere. authenticated users see only rows in their orgs.
-- audit_log is append-only from the client side; the trigger function is
-- SECURITY DEFINER and bypasses RLS to insert.

set search_path = klarert, public;

-- =============================================================================
-- helpers
-- =============================================================================

create or replace function klarert.current_org_id() returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'current_org_id',
    ''
  )::uuid;
$$;

comment on function klarert.current_org_id is
  'Active organization id for the calling user, read from request.jwt.claims.app_metadata.current_org_id. NULL if unset.';

-- =============================================================================
-- organizations
-- =============================================================================

create table klarert.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$' and length(slug) between 2 and 64),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

comment on table klarert.organizations is 'Tenant root. Every klarert.* row outside this table belongs to exactly one organization.';

alter table klarert.organizations enable row level security;

-- =============================================================================
-- profiles
-- =============================================================================

create table klarert.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  full_name text,
  email text not null,
  created_at timestamptz not null default now()
);

comment on table klarert.profiles is 'Per-user application profile, 1:1 with auth.users. Anchors a user to an organization.';

create index profiles_organization_id_idx on klarert.profiles (organization_id);

alter table klarert.profiles enable row level security;

-- =============================================================================
-- user_org_ids: RLS-safe lookup. SECURITY DEFINER bypasses profiles RLS so
-- policies on profiles/organizations/audit_log can use it without recursion.
-- =============================================================================

create or replace function klarert.user_org_ids(p_user uuid) returns setof uuid
language sql
stable
security definer
set search_path = klarert, pg_temp
as $$
  select organization_id from klarert.profiles where id = p_user;
$$;

revoke all on function klarert.user_org_ids(uuid) from public;
grant execute on function klarert.user_org_ids(uuid) to authenticated, service_role;

comment on function klarert.user_org_ids is
  'Organization ids the user is a profile member of. SECURITY DEFINER to break RLS recursion in policies that scope by membership.';

-- =============================================================================
-- audit_log (append-only)
-- =============================================================================

create table klarert.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  actor_id uuid,
  table_name text not null,
  row_id uuid not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

comment on table klarert.audit_log is 'Append-only audit trail. Written by klarert.audit_trigger(); no client INSERT/UPDATE/DELETE policies exist.';

create index audit_log_org_time_idx on klarert.audit_log (organization_id, occurred_at desc);
create index audit_log_row_idx on klarert.audit_log (table_name, row_id);

alter table klarert.audit_log enable row level security;

-- =============================================================================
-- audit trigger function
-- =============================================================================

create or replace function klarert.audit_trigger() returns trigger
language plpgsql
security definer
set search_path = klarert, pg_temp
as $$
declare
  v_row jsonb;
  v_org uuid;
  v_row_id uuid;
begin
  v_row := case TG_OP when 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

  -- organization_id lives directly on tenant-scoped rows; for klarert.organizations
  -- itself the row's own id IS the organization id.
  v_org := nullif(v_row ->> 'organization_id', '')::uuid;
  if v_org is null then
    v_org := nullif(v_row ->> 'id', '')::uuid;
  end if;

  v_row_id := (v_row ->> 'id')::uuid;

  insert into klarert.audit_log (
    organization_id, actor_id, table_name, row_id, op, old_data, new_data
  )
  values (
    v_org,
    auth.uid(),
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    v_row_id,
    TG_OP,
    case TG_OP when 'INSERT' then null else to_jsonb(OLD) end,
    case TG_OP when 'DELETE' then null else to_jsonb(NEW) end
  );

  return case TG_OP when 'DELETE' then OLD else NEW end;
end;
$$;

comment on function klarert.audit_trigger is
  'Generic AFTER INSERT/UPDATE/DELETE trigger. SECURITY DEFINER so the audit_log INSERT bypasses RLS. Resolves organization_id from NEW.organization_id, falling back to NEW.id (for klarert.organizations).';

create trigger audit_organizations
  after insert or update or delete on klarert.organizations
  for each row execute function klarert.audit_trigger();

create trigger audit_profiles
  after insert or update or delete on klarert.profiles
  for each row execute function klarert.audit_trigger();

-- =============================================================================
-- RLS policies
-- =============================================================================

-- organizations: members see their org. No client-side INSERT/UPDATE/DELETE
-- (orgs are provisioned via service-role Server Actions).
create policy organizations_select_member
  on klarert.organizations for select to authenticated
  using (id in (select klarert.user_org_ids((select auth.uid()))));

-- profiles: members see profiles in their org; can update only their own row.
create policy profiles_select_same_org
  on klarert.profiles for select to authenticated
  using (organization_id in (select klarert.user_org_ids((select auth.uid()))));

create policy profiles_update_self
  on klarert.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- audit_log: members read their org's audit trail. No write policies — the
-- SECURITY DEFINER trigger is the only path that produces rows.
create policy audit_log_select_same_org
  on klarert.audit_log for select to authenticated
  using (organization_id in (select klarert.user_org_ids((select auth.uid()))));
