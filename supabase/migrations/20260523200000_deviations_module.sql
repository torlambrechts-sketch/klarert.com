-- Avvik (deviation) — first real compliance module on the new architecture.
--
-- This migration is the canonical pattern for shipping a module:
--   1. table + indexes + RLS + audit
--   2. workflow event emission via AFTER trigger
--   3. register the module in klarert.modules (is_builtin=true)
--   4. extend role.permissions with module-specific permissions
--   5. backfill organization_modules for existing orgs (idempotent)
--
-- Also widens klarert_private.user_org_ids to recognise role_assignment-based
-- membership, so an accepted-invitation grants membership without rewriting
-- the user's profile.

create or replace function klarert_private.user_org_ids() returns setof uuid
language sql
stable
security definer
set search_path = klarert, pg_temp
as $$
  select organization_id from klarert.profiles
  where id = klarert_private.acting_user_id()
  union
  select organization_id from klarert.role_assignments
  where user_id = klarert_private.acting_user_id();
$$;
revoke all on function klarert_private.user_org_ids() from public, anon;
grant execute on function klarert_private.user_org_ids() to authenticated, service_role;

-- =============================================================================
-- klarert.deviations
-- =============================================================================

create table if not exists klarert.deviations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  description text,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','investigating','resolved','closed')),
  law_ref text check (law_ref is null or law_ref ~ '^(AML|IK-f|GDPR|Likestillings- og diskrimineringsloven)( |\.)'),
  reported_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

comment on table klarert.deviations is 'Avvik (deviation / non-conformance) records. The first real compliance module on the new architecture.';

create index if not exists deviations_org_status_idx on klarert.deviations (organization_id, status);
create index if not exists deviations_org_severity_idx on klarert.deviations (organization_id, severity);
create index if not exists deviations_assigned_idx on klarert.deviations (assigned_to);
create index if not exists deviations_reported_idx on klarert.deviations (reported_by);
create index if not exists deviations_created_by_idx on klarert.deviations (created_by);

alter table klarert.deviations enable row level security;

drop policy if exists deviations_select_same_org on klarert.deviations;
create policy deviations_select_same_org on klarert.deviations
  for select to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('deviation.read')));

drop policy if exists deviations_insert_writer on klarert.deviations;
create policy deviations_insert_writer on klarert.deviations
  for insert to authenticated
  with check (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('deviation.write')));

drop policy if exists deviations_update_writer on klarert.deviations;
create policy deviations_update_writer on klarert.deviations
  for update to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('deviation.write')))
  with check (organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('deviation.write')));

drop policy if exists deviations_delete_writer on klarert.deviations;
create policy deviations_delete_writer on klarert.deviations
  for delete to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('deviation.write')));

drop trigger if exists audit_deviations on klarert.deviations;
create trigger audit_deviations
  after insert or update or delete on klarert.deviations
  for each row execute function klarert.audit_trigger();

-- =============================================================================
-- Workflow emission on insert / status-change
-- =============================================================================

create or replace function klarert.tg_deviations_emit_workflow_event() returns trigger
language plpgsql
security definer
set search_path = klarert, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    perform klarert.emit_workflow_event(NEW.organization_id, 'deviation.created',
      jsonb_build_object('deviation_id', NEW.id, 'severity', NEW.severity, 'title', NEW.title));
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status then
    perform klarert.emit_workflow_event(NEW.organization_id, 'deviation.status_changed',
      jsonb_build_object('deviation_id', NEW.id, 'from', OLD.status, 'to', NEW.status));
  end if;
  return NEW;
end;
$$;
revoke all on function klarert.tg_deviations_emit_workflow_event() from public, anon, authenticated;

drop trigger if exists deviations_emit_workflow_event on klarert.deviations;
create trigger deviations_emit_workflow_event
  after insert or update on klarert.deviations
  for each row execute function klarert.tg_deviations_emit_workflow_event();

-- =============================================================================
-- Module registration + role permissions
-- =============================================================================

insert into klarert.modules (key, name, description, is_builtin) values
  ('deviations', 'Avvik', 'Registrering og oppfølging av avvik etter Internkontrollforskriften § 5 nr. 7.', true)
on conflict (key) do nothing;

-- Owner + admin: read + write
update klarert.roles
set permissions = (
  select array_agg(distinct p) from unnest(permissions || array['deviation.read', 'deviation.write']) p
)
where key in ('owner', 'admin') and not (permissions @> array['deviation.read', 'deviation.write']);

-- Member: read only
update klarert.roles
set permissions = (
  select array_agg(distinct p) from unnest(permissions || array['deviation.read']) p
)
where key = 'member' and not (permissions @> array['deviation.read']);

-- Backfill: activate deviations on every org that already has dashboard.
insert into klarert.organization_modules (organization_id, module_key)
select distinct organization_id, 'deviations' from klarert.organization_modules
where module_key = 'dashboard'
on conflict (organization_id, module_key) do nothing;
