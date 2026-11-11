-- Round of advisor hardening after the engine + invitation + storage work.
--
-- 1. Pin search_path on klarert.tg_audit_log_append_only (function_search_path_mutable).
-- 2. Add a membership check inside klarert.emit_workflow_event so an
--    authenticated caller cannot pass an org they aren't a member of —
--    closes an IDOR-style escalation vector found in the advisor scan.
-- 3. Covering indexes for two FKs flagged unindexed_foreign_keys:
--      klarert.invitations.role_key
--      klarert.workflow_runs.workflow_rule_id

create or replace function klarert.tg_audit_log_append_only() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'klarert.audit_log is append-only: % is not allowed', TG_OP
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function klarert.tg_audit_log_append_only() from public, anon, authenticated;

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
  -- Service role (no JWT claims set) bypasses the check; an authenticated
  -- user must be a member of p_org. Without this, any logged-in user could
  -- call emit_workflow_event(<other_org>, ...) and queue runs against an
  -- org they don't belong to.
  if current_setting('request.jwt.claims', true) is not null
     and current_setting('request.jwt.claims', true) <> ''
     and p_org not in (select klarert_private.user_org_ids()) then
    raise exception 'forbidden: caller is not a member of organization %', p_org
      using errcode = 'insufficient_privilege';
  end if;

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

create index if not exists invitations_role_key_idx on klarert.invitations (role_key);
create index if not exists workflow_runs_workflow_rule_id_idx on klarert.workflow_runs (workflow_rule_id);
