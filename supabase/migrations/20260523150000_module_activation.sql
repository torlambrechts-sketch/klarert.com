-- Module catalogue + per-tenant activation.
--
-- klarert.modules                   global catalog of available modules
-- klarert.organization_modules      per-org activation (enabled + settings)
--
-- A built-in module is auto-activated on every new organization via
-- tg_activate_builtin_modules_on_org_insert.
--
-- The component registry (lib/registry/components.ts) filters sections by
-- (module_enabled AND user has any required permission) so sections for a
-- disabled module never reach a tenant's UI.

create table if not exists klarert.modules (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$' and length(key) between 2 and 40),
  name text not null check (length(name) between 1 and 100),
  description text,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table klarert.modules is 'Catalogue of available product modules. is_builtin = true means the module is enabled on every new organization by default.';

alter table klarert.modules enable row level security;

drop policy if exists modules_select_authenticated on klarert.modules;
create policy modules_select_authenticated on klarert.modules
  for select to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true');

create table if not exists klarert.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  module_key text not null references klarert.modules(key) on update cascade,
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references auth.users(id) on delete set null,
  unique (organization_id, module_key)
);

comment on table klarert.organization_modules is 'Per-tenant module activation. Filtered by the component registry.';

create index if not exists organization_modules_org_idx on klarert.organization_modules (organization_id);
create index if not exists organization_modules_module_key_idx on klarert.organization_modules (module_key);
create index if not exists organization_modules_enabled_by_idx on klarert.organization_modules (enabled_by);

alter table klarert.organization_modules enable row level security;

drop policy if exists organization_modules_select_same_org on klarert.organization_modules;
create policy organization_modules_select_same_org on klarert.organization_modules
  for select to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
  );

drop policy if exists organization_modules_insert_admin on klarert.organization_modules;
create policy organization_modules_insert_admin on klarert.organization_modules
  for insert to authenticated
  with check (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update'))
  );

drop policy if exists organization_modules_update_admin on klarert.organization_modules;
create policy organization_modules_update_admin on klarert.organization_modules
  for update to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update'))
  )
  with check (
    organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update'))
  );

drop policy if exists organization_modules_delete_admin on klarert.organization_modules;
create policy organization_modules_delete_admin on klarert.organization_modules
  for delete to authenticated
  using (
    ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update'))
  );

drop trigger if exists audit_organization_modules on klarert.organization_modules;
create trigger audit_organization_modules
  after insert or update or delete on klarert.organization_modules
  for each row execute function klarert.audit_trigger();

-- Helper: is this module enabled for any of the calling user's orgs?
create or replace function klarert_private.module_enabled(p_key text) returns boolean
language sql
stable
security definer
set search_path = klarert, pg_temp
as $$
  select exists (
    select 1 from klarert.organization_modules om
    where om.module_key = p_key
      and om.enabled
      and om.organization_id in (select klarert_private.user_org_ids())
  );
$$;

revoke all on function klarert_private.module_enabled(text) from public, anon;
grant execute on function klarert_private.module_enabled(text) to authenticated, service_role;

comment on function klarert_private.module_enabled is
  'True if the named module is enabled on any of the calling user''s orgs.';

-- Auto-activate built-in modules on new org
create or replace function klarert.tg_activate_builtin_modules_on_org_insert() returns trigger
language plpgsql
security definer
set search_path = klarert, pg_temp
as $$
begin
  insert into klarert.organization_modules (organization_id, module_key, enabled_by)
  select NEW.id, m.key, NEW.created_by
  from klarert.modules m
  where m.is_builtin
  on conflict (organization_id, module_key) do nothing;
  return NEW;
end;
$$;

revoke all on function klarert.tg_activate_builtin_modules_on_org_insert() from public, anon, authenticated;

drop trigger if exists activate_builtin_modules_after_org_insert on klarert.organizations;
create trigger activate_builtin_modules_after_org_insert
  after insert on klarert.organizations
  for each row execute function klarert.tg_activate_builtin_modules_on_org_insert();

-- Seed: the "dashboard" module is intentionally meta (every org has it; means
-- "show the landing page"). Real modules (avvik, varsling, vernerunde, etc.)
-- are added in their respective module-feature migrations.
insert into klarert.modules (key, name, description, is_builtin) values
  ('dashboard', 'Forside', 'Forsiden viser status og varsler for organisasjonen.', true)
on conflict (key) do nothing;
