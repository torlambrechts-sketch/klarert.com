-- 0010_automations.sql · M7: the automation runner's database side.
-- 1. Writes as an automation (p_automation) are made by the runner only. Before, any member could pass the id of an
--    enabled automation to set_item_values and friends, write to any item (also locked ones and as a viewer) and have
--    the activity log name the automation as the actor. The runner calls the RPCs with the server-only service-role
--    client of src/server/automations/effects.ts after it has authorised the workspace (docs/02 §7), so the
--    automation path now requires the service role, an enabled automation of the same workspace, and nothing else.
-- 2. notifications.automation_id: which automation a system notification is about, so failure notices to the
--    creator are sent at most once per hour per automation (docs/04 §7.12) and the inbox can link to it (M9).
-- 3. record_automation_run: one run row and the run counters (docs/04 §7.10–11) in one transaction. Service role only.
--    automation_runs keeps its 0001 policies: members of the workspace read, nobody but the service role writes.

-- ───────────────────────── who may write as an automation ─────────────────────────
create or replace function can_write(o uuid, p_automation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_automation is not null then
      coalesce(auth.role(), '') = 'service_role'
      and exists (select 1 from automations a where a.id = p_automation and a.org_id = o and a.enabled)
    else is_editor(o) or coalesce(auth.role(), '') = 'service_role'
  end
$$;

-- ───────────────────────── notifications about an automation ─────────────────────────
alter table notifications add column automation_id uuid references automations(id) on delete set null;
create index notifications_automation_idx on notifications(automation_id, user_id, created_at desc)
  where automation_id is not null;

-- ───────────────────────── run rows and counters ─────────────────────────
create or replace function record_automation_run(p_automation uuid, p_item uuid, p_event jsonb, p_status text,
                                                 p_detail text, p_steps jsonb, p_depth integer, p_chain uuid,
                                                 p_started_at timestamptz)
returns bigint language plpgsql security definer set search_path = public as $$
declare a automations; it items; run_id bigint;
begin
  select * into a from automations where id = p_automation;
  if a.id is null then raise exception 'automation not found'; end if;
  if p_item is not null then
    select * into it from items where id = p_item;
    if it.id is null or it.org_id <> a.org_id then raise exception 'item not in workspace'; end if;
  end if;
  insert into automation_runs(org_id, automation_id, sheet_id, item_id, event, status, detail, steps, depth, chain_id,
                              started_at, finished_at)
  values (a.org_id, a.id, coalesce(it.sheet_id, a.sheet_id), it.id, coalesce(p_event, '{}'::jsonb), p_status,
          coalesce(p_detail, ''), coalesce(p_steps, '[]'::jsonb), coalesce(p_depth, 0), p_chain,
          coalesce(p_started_at, now()), now())
  returning id into run_id;
  -- bookkeeping, not audited (audit_schema ignores run_count and last_run_at)
  update automations set run_count = run_count + 1, last_run_at = now() where id = a.id;
  return run_id;
end $$;

-- ───────────────────────── grants ─────────────────────────
-- can_write keeps its grants (RLS helpers); record_automation_run is for the runner only.
revoke all on function record_automation_run(uuid, uuid, jsonb, text, text, jsonb, integer, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function record_automation_run(uuid, uuid, jsonb, text, text, jsonb, integer, uuid, timestamptz)
  to service_role;
