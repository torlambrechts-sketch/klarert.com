-- Workflow engine spine. CLAUDE.md rule #4: cross-module side effects must
-- go through this engine, never via direct DB writes from one module to
-- another.
--
-- Tables:
--   klarert.workflow_rules     when X happens, run my actions
--   klarert.workflow_actions   sequential steps tied to a rule
--   klarert.workflow_runs      append-only execution log
--
-- Helpers:
--   klarert.emit_workflow_event(org, event_type, payload)
--                              queue runs for every matching enabled rule
--   klarert_private.process_workflow_queue(max)
--                              drain queued runs; pg_cron invokes every minute
--
-- v1 action types: 'noop', 'audit_log_write'. Real modules will register
-- additional handlers via future migrations.

create extension if not exists pg_cron with schema extensions;

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists klarert.workflow_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$' and length(key) between 2 and 80),
  name text not null check (length(name) between 1 and 200),
  description text,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]*$' and length(event_type) between 2 and 80),
  condition jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (organization_id, key)
);

comment on table klarert.workflow_rules is 'A rule: when event_type fires on this org, queue the rule''s actions.';

create index if not exists workflow_rules_org_event_enabled_idx
  on klarert.workflow_rules (organization_id, event_type)
  where enabled;
create index if not exists workflow_rules_created_by_idx
  on klarert.workflow_rules (created_by);

alter table klarert.workflow_rules enable row level security;

create table if not exists klarert.workflow_actions (
  id uuid primary key default gen_random_uuid(),
  workflow_rule_id uuid not null references klarert.workflow_rules(id) on delete cascade,
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  action_type text not null check (action_type ~ '^[a-z][a-z0-9_.]*$' and length(action_type) between 2 and 80),
  params jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table klarert.workflow_actions is 'Sequential steps for one workflow rule. Executed by klarert_private.process_workflow_queue() in sort_order.';

create index if not exists workflow_actions_rule_order_idx
  on klarert.workflow_actions (workflow_rule_id, sort_order);
create index if not exists workflow_actions_org_idx
  on klarert.workflow_actions (organization_id);

alter table klarert.workflow_actions enable row level security;

create table if not exists klarert.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_rule_id uuid not null references klarert.workflow_rules(id) on delete cascade,
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  error_message text,
  enqueued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempts int not null default 0
);

comment on table klarert.workflow_runs is 'Append-only execution log of workflow rule firings.';

create index if not exists workflow_runs_queue_idx
  on klarert.workflow_runs (enqueued_at)
  where status = 'queued';
create index if not exists workflow_runs_org_idx
  on klarert.workflow_runs (organization_id, status);

alter table klarert.workflow_runs enable row level security;

-- =============================================================================
-- Audit triggers
-- =============================================================================

drop trigger if exists audit_workflow_rules on klarert.workflow_rules;
create trigger audit_workflow_rules
  after insert or update or delete on klarert.workflow_rules
  for each row execute function klarert.audit_trigger();

drop trigger if exists audit_workflow_actions on klarert.workflow_actions;
create trigger audit_workflow_actions
  after insert or update or delete on klarert.workflow_actions
  for each row execute function klarert.audit_trigger();

-- workflow_runs is the evidence chain itself, not audited via the generic trigger.

-- =============================================================================
-- RLS
-- =============================================================================

drop policy if exists workflow_rules_select_same_org on klarert.workflow_rules;
create policy workflow_rules_select_same_org on klarert.workflow_rules
  for select to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids()));

drop policy if exists workflow_rules_insert_admin on klarert.workflow_rules;
create policy workflow_rules_insert_admin on klarert.workflow_rules
  for insert to authenticated
  with check (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop policy if exists workflow_rules_update_admin on klarert.workflow_rules;
create policy workflow_rules_update_admin on klarert.workflow_rules
  for update to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')))
  with check (organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop policy if exists workflow_rules_delete_admin on klarert.workflow_rules;
create policy workflow_rules_delete_admin on klarert.workflow_rules
  for delete to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop policy if exists workflow_actions_select_same_org on klarert.workflow_actions;
create policy workflow_actions_select_same_org on klarert.workflow_actions
  for select to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids()));

drop policy if exists workflow_actions_insert_admin on klarert.workflow_actions;
create policy workflow_actions_insert_admin on klarert.workflow_actions
  for insert to authenticated
  with check (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop policy if exists workflow_actions_update_admin on klarert.workflow_actions;
create policy workflow_actions_update_admin on klarert.workflow_actions
  for update to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')))
  with check (organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop policy if exists workflow_actions_delete_admin on klarert.workflow_actions;
create policy workflow_actions_delete_admin on klarert.workflow_actions
  for delete to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('org.update')));

drop policy if exists workflow_runs_select_same_org on klarert.workflow_runs;
create policy workflow_runs_select_same_org on klarert.workflow_runs
  for select to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('audit.read')));

-- =============================================================================
-- Emit + runner
-- =============================================================================

create or replace function klarert.emit_workflow_event(
  p_org uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
) returns int
language plpgsql
security definer
set search_path = klarert, pg_temp
as $$
declare v_count int := 0;
begin
  insert into klarert.workflow_runs (workflow_rule_id, organization_id, event_type, event_payload)
  select wr.id, wr.organization_id, p_event_type, p_payload
  from klarert.workflow_rules wr
  where wr.organization_id = p_org
    and wr.event_type = p_event_type
    and wr.enabled;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  return v_count;
end;
$$;

revoke all on function klarert.emit_workflow_event(uuid, text, jsonb) from public, anon;
grant execute on function klarert.emit_workflow_event(uuid, text, jsonb) to authenticated, service_role;

comment on function klarert.emit_workflow_event is
  'Cross-module side-effect entry point. CLAUDE.md rule #4: never write directly across modules — emit a workflow event.';

create or replace function klarert_private.process_workflow_queue(p_max int default 50)
returns int
language plpgsql
security definer
set search_path = klarert, pg_temp
as $$
declare
  r record;
  a record;
  v_count int := 0;
begin
  for r in
    select * from klarert.workflow_runs
    where status = 'queued'
    order by enqueued_at
    limit p_max
    for update skip locked
  loop
    update klarert.workflow_runs
    set status = 'running', started_at = now(), attempts = attempts + 1
    where id = r.id;

    begin
      for a in
        select * from klarert.workflow_actions
        where workflow_rule_id = r.workflow_rule_id and enabled
        order by sort_order, id
      loop
        if a.action_type = 'noop' then
          null;
        elsif a.action_type = 'audit_log_write' then
          insert into klarert.audit_log (organization_id, table_name, row_id, op, new_data)
          values (r.organization_id, 'klarert.workflow_runs', r.id, 'INSERT',
                  jsonb_build_object(
                    'event_type', r.event_type,
                    'note', a.params ->> 'note',
                    'workflow_rule_id', r.workflow_rule_id
                  ));
        else
          raise exception 'unknown action_type: %', a.action_type;
        end if;
      end loop;

      update klarert.workflow_runs
      set status = 'succeeded', completed_at = now()
      where id = r.id;
      v_count := v_count + 1;
    exception when others then
      update klarert.workflow_runs
      set status = 'failed', completed_at = now(), error_message = SQLERRM
      where id = r.id;
    end;
  end loop;
  return v_count;
end;
$$;

revoke all on function klarert_private.process_workflow_queue(int) from public, anon, authenticated;
grant execute on function klarert_private.process_workflow_queue(int) to service_role;

comment on function klarert_private.process_workflow_queue is
  'Drains klarert.workflow_runs where status=queued. Invoked every minute by pg_cron. SECURITY DEFINER + skip-locked so cron ticks do not collide.';

-- pg_cron schedule. cron.schedule is upsert-by-name.
select cron.schedule(
  'klarert_process_workflow_queue',
  '* * * * *',
  $$select klarert_private.process_workflow_queue(100)$$
);
