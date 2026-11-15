-- 0055_link_field_visibility.sql · Links and protected values of a restricted field are for people who see it
-- (security review M2).
--
-- Before: `set_item_links` (SECURITY DEFINER) returned every link row of the field for the item. Called with an empty
-- target list it inserted nothing, so no guard trigger fired and only `is_editor(org)` was checked: a member who
-- cannot see a restricted link field (or cannot open the sheet at all) read all of its links, and could replace them.
--
-- Now, for people:
-- * `set_item_links` needs edit access to the item's sheet (`_need_sheet`) and sight of the field before anything
--   else; a hidden field reads as `bad link field or item`, as a missing one does.
-- * It returns only links whose target item the person can read (RLS-like), never a hidden target's id.
-- * `set_protected_value` also needs sight of the field when the protected field is restricted.
-- Automations (the runner, service role) are unchanged: they were authorised when saved and are re-checked before
-- every run (0052).

create or replace function set_item_links(p_field uuid, p_from uuid, p_to uuid[], p_mode text, p_automation uuid default null)
returns setof item_links
language plpgsql security definer set search_path = public as $$
declare f fields; it items; before uuid[]; after uuid[]; person boolean := _is_person();
begin
  select * into f from fields where id = p_field and type in ('link','requirement','controllink');
  select * into it from items where id = p_from and archived_at is null;
  if f.id is null or it.id is null or f.sheet_id <> it.sheet_id then raise exception 'bad link field or item'; end if;
  if person and p_automation is null then
    if not field_visible(f.id) then raise exception 'bad link field or item'; end if;
    if coalesce(current_setting('app.workflow_op', true), '') <> 'on' then
      perform _need_sheet(it.sheet_id, 'editor');
    end if;
  end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if it.locked and p_automation is null and not is_admin(it.org_id) then raise exception 'item locked'; end if;
  if exists (select 1 from unnest(p_to) t(id) left join items x on x.id = t.id left join sheets xs on xs.id = x.sheet_id
             where x.id is null or x.org_id <> it.org_id
                or x.sheet_id::text <> coalesce(nullif(f.config->>'targetSheetId', ''), x.sheet_id::text)
                or (f.type in ('requirement', 'controllink') and nullif(f.config->>'targetSheetId', '') is null
                    and not xs.is_library)) then
    raise exception 'link target not allowed';
  end if;
  select coalesce(array_agg(to_item order by position), '{}') into before from item_links where field_id = p_field and from_item = p_from;
  if p_mode = 'replace' then
    delete from item_links where field_id = p_field and from_item = p_from and not (to_item = any(p_to));
  end if;
  if p_mode in ('add','replace') then
    insert into item_links(org_id, field_id, from_item, to_item)
    select it.org_id, p_field, p_from, t.id from unnest(p_to) t(id) on conflict do nothing;
  elsif p_mode = 'remove' then
    delete from item_links where field_id = p_field and from_item = p_from and to_item = any(p_to);
  else raise exception 'bad mode %', p_mode; end if;
  select coalesce(array_agg(to_item order by position), '{}') into after from item_links where field_id = p_field and from_item = p_from;
  if before is distinct from after then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value)
    values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
            'link.changed', p_field, to_jsonb(before), to_jsonb(after));
  end if;
  return query
    select l.* from item_links l
     where l.field_id = p_field and l.from_item = p_from
       and (not person
            or exists (select 1 from items x where x.id = l.to_item
                          and _sheet_level_for(auth.uid(), x.sheet_id) <> 'none'))
     order by l.position;
end $$;

create or replace function set_protected_value(p_item uuid, p_field uuid, p_value text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare it items; f fields; old_v text;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  select * into f from fields where id = p_field and type = 'protected' and archived_at is null;
  if it.id is null or f.id is null or f.sheet_id <> it.sheet_id then raise exception 'bad protected field or item'; end if;
  if not field_visible(f.id) then raise exception 'bad protected field or item'; end if;
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
