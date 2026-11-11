-- 0006_grid.sql · M4: the grid's write path
-- 1. Locked items (docs/01 §4, FR-14): people need admin to move or archive them too, as for values and links.
-- 2. set_protected_value: protected text lives in protected_values (docs/02 §2); this writes it and logs the action
--    without the value (docs/03 §3.3: the log stores the action only).

create or replace function move_item(p_item uuid, p_group uuid, p_position text, p_automation uuid default null)
returns items language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if it.locked and p_automation is null and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  if not exists (select 1 from groups g where g.id = p_group and g.sheet_id = it.sheet_id) then raise exception 'group not in sheet'; end if;
  if it.group_id <> p_group then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
    values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
            'item.moved', to_jsonb(it.group_id), to_jsonb(p_group));
  end if;
  update items set group_id = p_group, position = p_position, updated_at = now(), updated_by = auth.uid()
   where id = p_item returning * into it;
  return it;
end $$;

create or replace function set_item_archived(p_item uuid, p_archived boolean) returns items
language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item for update;
  if it.id is null or not can_write(it.org_id, null) then raise exception 'not allowed'; end if;
  if it.locked and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  update items set archived_at = case when p_archived then now() end, updated_at = now(), updated_by = auth.uid()
   where id = p_item returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), case when p_archived then 'item.archived' else 'item.restored' end);
  return it;
end $$;

create or replace function set_protected_value(p_item uuid, p_field uuid, p_value text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare it items; f fields; old_v text;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  select * into f from fields where id = p_field and type = 'protected' and archived_at is null;
  if it.id is null or f.id is null or f.sheet_id <> it.sheet_id then raise exception 'bad protected field or item'; end if;
  if not is_editor(it.org_id) then raise exception 'not allowed'; end if;
  if not (is_admin(it.org_id) or coalesce(f.config -> 'allowedUserIds', '[]'::jsonb) ? auth.uid()::text) then
    raise exception 'not allowed';
  end if;
  if it.locked and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  select value into old_v from protected_values where item_id = p_item and field_id = p_field;
  if p_value is null or btrim(p_value) = '' then
    delete from protected_values where item_id = p_item and field_id = p_field;
    p_value := null;
  else
    insert into protected_values(org_id, item_id, field_id, value) values (it.org_id, p_item, p_field, p_value)
    on conflict (item_id, field_id) do update set value = excluded.value;
  end if;
  if old_v is distinct from p_value then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, note)
    values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(),
            case when p_value is null then 'protected.cleared' else 'protected.changed' end, p_field, p_note);
  end if;
  update items set updated_at = now(), updated_by = auth.uid() where id = p_item;
end $$;

revoke all on function set_protected_value from public;
grant execute on function set_protected_value to authenticated;
