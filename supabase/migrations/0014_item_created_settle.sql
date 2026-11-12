-- 0014_item_created_settle.sql · "item is created" automations wait until the person has finished the new row
-- A row added inline is saved at once with only a name. Its item_created automations are held until the person leaves
-- the row (release_item_created), so they see the values entered right after. Field changes made while the hold is on
-- are part of creating the item and start no field automations. The scheduler releases holds older than 10 minutes
-- (a closed tab), so nothing is lost.

alter table items add column created_pending_at timestamptz;
create index items_created_pending_idx on items(created_pending_at) where created_pending_at is not null;

create or replace function hold_item_created(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, null) or it.created_by is distinct from auth.uid() then
    raise exception 'not allowed';
  end if;
  update items set created_pending_at = now() where id = p_item;
end $$;

-- true when this call released the hold (the caller then runs item_created exactly once)
create or replace function release_item_created(p_item uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare it items; released uuid;
begin
  select * into it from items where id = p_item;
  if it.id is null then return false; end if;
  if not can_write(it.org_id, null) then raise exception 'not allowed'; end if;
  update items set created_pending_at = null
   where id = p_item and created_pending_at is not null
  returning id into released;
  return released is not null;
end $$;

revoke all on function hold_item_created(uuid) from public, anon;
revoke all on function release_item_created(uuid) from public, anon;
grant execute on function hold_item_created(uuid) to authenticated, service_role;
grant execute on function release_item_created(uuid) to authenticated, service_role;
