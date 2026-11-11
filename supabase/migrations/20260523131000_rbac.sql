-- RBAC: built-in roles, per-org role assignments, has_role / has_permission
-- helpers, RLS, and an auto-owner trigger that assigns the org creator the
-- 'owner' role on klarert.organizations INSERT.
--
-- Written idempotent (if not exists / drop policy if exists / on conflict do
-- nothing / create or replace) so re-applying against an already-bootstrapped
-- database is a no-op.

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists klarert.roles (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$' and length(key) between 2 and 40),
  name text not null check (length(name) between 1 and 100),
  description text,
  permissions text[] not null default '{}',
  is_builtin boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table klarert.roles is 'Catalogue of role keys + their permissions. Built-in roles ship in the seed; custom per-tenant roles can be added later.';

alter table klarert.roles enable row level security;

create table if not exists klarert.role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null references klarert.roles(key) on update cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  unique (organization_id, user_id)
);

comment on table klarert.role_assignments is 'Per-org role binding for a user. A user can have at most one role per organization.';

create index if not exists role_assignments_user_org_idx
  on klarert.role_assignments (user_id, organization_id);
create index if not exists role_assignments_org_idx
  on klarert.role_assignments (organization_id);
create index if not exists role_assignments_role_idx
  on klarert.role_assignments (role_key);
create index if not exists role_assignments_assigned_by_idx
  on klarert.role_assignments (assigned_by);

alter table klarert.role_assignments enable row level security;

-- Audit (drop+create so re-running is safe)
drop trigger if exists audit_role_assignments on klarert.role_assignments;
create trigger audit_role_assignments
  after insert or update or delete on klarert.role_assignments
  for each row execute function klarert.audit_trigger();

-- =============================================================================
-- Seed built-in roles
-- =============================================================================

insert into klarert.roles (key, name, description, permissions, is_builtin) values
  ('owner',  'Eier',          'Full tilgang. Kan slette organisasjonen.',
   array['org.read','org.update','org.delete','user.read','user.invite','user.remove','user.role.update','audit.read'], true),
  ('admin',  'Administrator', 'Administrerer brukere, moduler og maler.',
   array['org.read','org.update','user.read','user.invite','user.remove','user.role.update','audit.read'], true),
  ('member', 'Medlem',        'Standardrolle. Kan lese egen organisasjon.',
   array['org.read','user.read'], true)
on conflict (key) do nothing;

-- =============================================================================
-- Helpers (klarert_private — not REST-exposed)
-- =============================================================================

create or replace function klarert_private.has_role(p_role text) returns boolean
language sql
stable
security definer
set search_path = klarert, pg_temp
as $$
  select exists (
    select 1
    from klarert.role_assignments ra
    where ra.user_id = klarert_private.acting_user_id()
      and ra.organization_id in (select klarert_private.user_org_ids())
      and ra.role_key = p_role
  );
$$;

revoke all on function klarert_private.has_role(text) from public, anon;
grant execute on function klarert_private.has_role(text) to authenticated, service_role;

comment on function klarert_private.has_role is
  'True if the calling user holds the given role in any of their orgs.';

create or replace function klarert_private.has_permission(p_permission text) returns boolean
language sql
stable
security definer
set search_path = klarert, pg_temp
as $$
  select exists (
    select 1
    from klarert.role_assignments ra
    join klarert.roles r on r.key = ra.role_key
    where ra.user_id = klarert_private.acting_user_id()
      and ra.organization_id in (select klarert_private.user_org_ids())
      and p_permission = any(r.permissions)
  );
$$;

revoke all on function klarert_private.has_permission(text) from public, anon;
grant execute on function klarert_private.has_permission(text) to authenticated, service_role;

comment on function klarert_private.has_permission is
  'True if the calling user holds any role granting the given permission in any of their orgs.';

-- =============================================================================
-- RLS policies (drop+create for idempotence)
-- =============================================================================

drop policy if exists roles_select_authenticated on klarert.roles;
create policy roles_select_authenticated
  on klarert.roles for select to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true');

drop policy if exists role_assignments_select_same_org on klarert.role_assignments;
create policy role_assignments_select_same_org
  on klarert.role_assignments for select to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
  );

drop policy if exists role_assignments_insert_with_permission on klarert.role_assignments;
create policy role_assignments_insert_with_permission
  on klarert.role_assignments for insert to authenticated
  with check (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('user.role.update'))
  );

drop policy if exists role_assignments_update_with_permission on klarert.role_assignments;
create policy role_assignments_update_with_permission
  on klarert.role_assignments for update to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('user.role.update'))
  )
  with check (
    organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('user.role.update'))
  );

drop policy if exists role_assignments_delete_with_permission on klarert.role_assignments;
create policy role_assignments_delete_with_permission
  on klarert.role_assignments for delete to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('user.role.update'))
  );

drop policy if exists organizations_update_owner on klarert.organizations;
create policy organizations_update_owner
  on klarert.organizations for update to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update'))
  )
  with check (
    id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update'))
  );

drop policy if exists organizations_delete_owner on klarert.organizations;
create policy organizations_delete_owner
  on klarert.organizations for delete to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.delete'))
  );

-- =============================================================================
-- Auto-assign 'owner' to organization creator
-- =============================================================================

create or replace function klarert.tg_assign_owner_on_org_insert() returns trigger
language plpgsql
security definer
set search_path = klarert, pg_temp
as $$
begin
  if NEW.created_by is not null then
    insert into klarert.role_assignments (organization_id, user_id, role_key, assigned_by)
    values (NEW.id, NEW.created_by, 'owner', NEW.created_by)
    on conflict (organization_id, user_id) do nothing;
  end if;
  return NEW;
end;
$$;

revoke all on function klarert.tg_assign_owner_on_org_insert() from public, anon, authenticated;

drop trigger if exists assign_owner_after_org_insert on klarert.organizations;
create trigger assign_owner_after_org_insert
  after insert on klarert.organizations
  for each row execute function klarert.tg_assign_owner_on_org_insert();
