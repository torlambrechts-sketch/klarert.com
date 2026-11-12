-- 0011_automation_builder.sql · M8: the automation builder and per-item pauses.
-- 1. Automations stay structure written by commands with the person's client under RLS (docs/02 §4), but the rows
--    must be consistent: the sheet belongs to the automation's workspace, the creator is the person inserting it, new
--    rows start with no runs, and the workspace, sheet and creator of a row
--    never change afterwards. Before, an editor could insert an automation pointing at a sheet of another workspace.
-- 2. Per-item pauses (docs/04 §7.7, FR-34): set_automation_pause pauses or resumes one automation for one item and
--    logs it on the item's chain (automation.paused / automation.resumed) in the same transaction. Direct writes to
--    automation_pauses keep the editor policy, now also checking that the automation and the item are in the
--    workspace of the row and on the same sheet (before, any ids could be paired).

-- ───────────────────────── automations ─────────────────────────
create or replace function sheet_in_org(p_sheet uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sheets s where s.id = p_sheet and s.org_id = p_org)
$$;
revoke all on function sheet_in_org(uuid, uuid) from public, anon;
grant execute on function sheet_in_org(uuid, uuid) to authenticated, service_role;

drop policy automations_insert on automations;
create policy automations_insert on automations for insert with check (
  is_editor(org_id) and sheet_in_org(sheet_id, org_id) and created_by = auth.uid()
  and run_count = 0 and last_run_at is null);

drop policy automations_update on automations;
create policy automations_update on automations for update
  using (is_admin(org_id) or (is_editor(org_id) and not locked))
  with check ((is_admin(org_id) or (is_editor(org_id) and not locked)) and sheet_in_org(sheet_id, org_id));

create or replace function automations_fixed_columns() returns trigger language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id or new.sheet_id is distinct from old.sheet_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'automation workspace, sheet and creator are fixed';
  end if;
  return new;
end $$;
create trigger automations_fixed before update on automations
  for each row execute function automations_fixed_columns();

-- ───────────────────────── pauses ─────────────────────────
create or replace function pause_pair_ok(p_automation uuid, p_item uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from automations a join items i on i.sheet_id = a.sheet_id
                 where a.id = p_automation and i.id = p_item and a.org_id = p_org and i.org_id = p_org)
$$;
revoke all on function pause_pair_ok(uuid, uuid, uuid) from public, anon;
grant execute on function pause_pair_ok(uuid, uuid, uuid) to authenticated, service_role;

drop policy automation_pauses_write on automation_pauses;
create policy automation_pauses_write on automation_pauses for all
  using (is_editor(org_id))
  with check (is_editor(org_id) and pause_pair_ok(automation_id, item_id, org_id));

-- Pause (p_paused = true) or resume one automation for one item. Editors; the item may be locked (pausing changes no
-- value). Returns whether the automation is now paused for the item.
create or replace function set_automation_pause(p_automation uuid, p_item uuid, p_paused boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare a automations; it items; changed int;
begin
  select * into a from automations where id = p_automation;
  select * into it from items where id = p_item and archived_at is null;
  if a.id is null or it.id is null or it.sheet_id <> a.sheet_id or it.org_id <> a.org_id then
    raise exception 'automation not found';
  end if;
  if not is_editor(a.org_id) then raise exception 'not allowed'; end if;
  if p_paused then
    insert into automation_pauses(automation_id, item_id, org_id, paused_by)
    values (a.id, it.id, a.org_id, auth.uid()) on conflict do nothing;
  else
    delete from automation_pauses where automation_id = a.id and item_id = it.id;
  end if;
  get diagnostics changed = row_count;
  if changed > 0 then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
    values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(),
            case when p_paused then 'automation.paused' else 'automation.resumed' end,
            jsonb_build_object('automation_id', a.id, 'name', a.name), a.name);
  end if;
  return p_paused;
end $$;
revoke all on function set_automation_pause(uuid, uuid, boolean) from public, anon;
grant execute on function set_automation_pause(uuid, uuid, boolean) to authenticated;
