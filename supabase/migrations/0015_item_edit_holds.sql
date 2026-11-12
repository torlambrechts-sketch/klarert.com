-- 0015_item_edit_holds.sql · automations run once when the person finishes a row, new or existing
-- Replaces 0014's item_created-only hold. While a person edits a row in the Table or the item panel, the item is held:
-- the values at the start of the edit are kept in held_snapshot and every change is saved and audit-logged at once,
-- but no automations run. When the person finishes the row (another row, Done, panel closed, page left, 2 minutes
-- idle) release_item clears the hold and the command runs the automations once against the final values: item_created
-- for a new row, one value change per field that differs from the snapshot otherwise. The scheduler releases holds
-- older than 2 minutes, so a closed tab loses nothing.

drop function if exists hold_item_created(uuid);
drop function if exists release_item_created(uuid);
alter table items drop column if exists created_pending_at;

alter table items
  add column held_at       timestamptz,
  add column held_by       uuid references profiles(id),
  add column held_snapshot jsonb,
  add column held_created  boolean not null default false;
create index items_held_idx on items(held_at) where held_at is not null;

-- start (or extend) a hold; true when the item is held afterwards
create or replace function hold_item(p_item uuid, p_created boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, null) then raise exception 'not allowed'; end if;
  if it.held_at is null then
    update items set held_at = now(), held_by = auth.uid(), held_snapshot = it.values, held_created = p_created
     where id = p_item;
  else
    update items set held_at = now() where id = p_item;
  end if;
  return true;
end $$;

-- end a hold; returns { created, values, by } once (the caller then runs the automations), null when not held
create or replace function release_item(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item for update;
  if it.id is null or it.held_at is null then return null; end if;
  if not can_write(it.org_id, null) then raise exception 'not allowed'; end if;
  update items set held_at = null, held_by = null, held_snapshot = null, held_created = false where id = p_item;
  return jsonb_build_object('created', it.held_created, 'values', coalesce(it.held_snapshot, '{}'::jsonb),
                            'by', it.held_by);
end $$;

revoke all on function hold_item(uuid, boolean) from public, anon;
revoke all on function release_item(uuid) from public, anon;
grant execute on function hold_item(uuid, boolean) to authenticated, service_role;
grant execute on function release_item(uuid) to authenticated, service_role;
