-- Retention engine. Per-org per-table policies, drained nightly by pg_cron.
-- CLAUDE.md: retention rules live in data, not code.

create table if not exists klarert.retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  table_name text not null check (length(table_name) between 1 and 200),
  retain_days int not null check (retain_days >= 30),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, table_name)
);

comment on table klarert.retention_policies is 'Per-org retention windows. The retention engine purges older rows nightly. retain_days must be at least 30 to avoid foot-gun policies.';

create index if not exists retention_policies_org_idx on klarert.retention_policies (organization_id);

alter table klarert.retention_policies enable row level security;

drop policy if exists retention_policies_select_same_org on klarert.retention_policies;
create policy retention_policies_select_same_org on klarert.retention_policies
  for select to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids()));

drop policy if exists retention_policies_insert_admin on klarert.retention_policies;
create policy retention_policies_insert_admin on klarert.retention_policies
  for insert to authenticated
  with check (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop policy if exists retention_policies_update_admin on klarert.retention_policies;
create policy retention_policies_update_admin on klarert.retention_policies
  for update to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')))
  with check (organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop policy if exists retention_policies_delete_admin on klarert.retention_policies;
create policy retention_policies_delete_admin on klarert.retention_policies
  for delete to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop trigger if exists audit_retention_policies on klarert.retention_policies;
create trigger audit_retention_policies
  after insert or update or delete on klarert.retention_policies
  for each row execute function klarert.audit_trigger();

-- Purge function. SECURITY DEFINER + set local session_replication_role
-- bypasses the audit append-only trigger so we can purge audit_log itself.
-- The role guard makes this only callable from postgres / supabase_admin
-- (which is what pg_cron uses).
drop function if exists klarert_private.purge_retained_data();
create function klarert_private.purge_retained_data()
returns table(out_table_name text, out_organization_id uuid, out_deleted bigint)
language plpgsql
security definer
set search_path = klarert, pg_temp
as $$
declare
  pol record;
  v_deleted bigint;
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'purge_retained_data must run as a superuser-equivalent role';
  end if;

  set local session_replication_role = replica;

  for pol in
    select rp.id, rp.organization_id, rp.table_name, rp.retain_days
    from klarert.retention_policies rp
    where rp.enabled
  loop
    if pol.table_name = 'klarert.audit_log' then
      delete from klarert.audit_log al
      where al.organization_id = pol.organization_id
        and al.occurred_at < now() - make_interval(days => pol.retain_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    elsif pol.table_name = 'klarert.workflow_runs' then
      delete from klarert.workflow_runs wr
      where wr.organization_id = pol.organization_id
        and wr.completed_at is not null
        and wr.completed_at < now() - make_interval(days => pol.retain_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    else
      continue;
    end if;
    out_table_name := pol.table_name;
    out_organization_id := pol.organization_id;
    out_deleted := v_deleted;
    return next;
  end loop;

  set local session_replication_role = origin;
  return;
end;
$$;

revoke all on function klarert_private.purge_retained_data() from public, anon, authenticated;

comment on function klarert_private.purge_retained_data is
  'Nightly retention purge. Uses session_replication_role=replica to bypass audit append-only. Role guard restricts to postgres/supabase_admin.';

-- Schedule for 03:00 UTC daily. cron.schedule upserts by name.
select cron.schedule(
  'klarert_purge_retained_data',
  '0 3 * * *',
  $$select * from klarert_private.purge_retained_data()$$
);
