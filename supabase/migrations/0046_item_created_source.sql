-- 0046 · Where an item was added, in its item.created entry (owner decision 14 Nov 2026, the New item dialog).
--
-- create_item takes how the person added the item: 'dialog' (the New item dialog) or 'inline' (a row of the Table or a
-- phone card), and, for the dialog, the sheet's form it asked (its new-item form, docs/05 §3.7). The facts go into the
-- item.created entry's `source` as a detail ({"via": "dialog", "intake_form_id": …, "intake_form": "…"}), hashed with
-- the entry like a form's source (0022). No column changes: items.source_form_id and source_channel stay for forms,
-- so an item from the dialog never counts as an answer to that form. Callers that send neither (automations, the
-- requirement checks of 0038, scripts) write the entry as before.
--
-- The 6-argument create_item is replaced, not overloaded, so calls by position (0038) keep resolving to one function.

drop function if exists create_item(uuid, uuid, text, text, jsonb, uuid);

create function create_item(p_sheet uuid, p_group uuid, p_name text, p_position text,
                            p_values jsonb default '{}'::jsonb, p_automation uuid default null,
                            p_via text default null, p_intake uuid default null)
returns items language plpgsql security definer set search_path = public as $$
declare o uuid; src jsonb; form_name text;
begin
  select org_id into o from sheets where id = p_sheet;
  if o is null or not can_write(o, p_automation) then raise exception 'not allowed'; end if;
  if p_via is not null and p_via not in ('dialog', 'inline') then raise exception 'unknown source %', p_via; end if;
  if p_intake is not null then
    if p_via is distinct from 'dialog' then raise exception 'a new-item form is asked only by the dialog'; end if;
    select name into form_name from views where id = p_intake and sheet_id = p_sheet and type = 'form';
    if form_name is null then raise exception 'form not found'; end if;
  end if;
  if p_via is not null then
    src := jsonb_strip_nulls(jsonb_build_object('via', p_via, 'intake_form_id', p_intake, 'intake_form', form_name));
  end if;
  return _insert_item(p_sheet, p_group, p_name, p_position, p_values, actor_kind_for(p_automation),
                      coalesce(p_automation, auth.uid()), src);
end $$;

revoke all on function create_item(uuid, uuid, text, text, jsonb, uuid, text, uuid) from public, anon;
grant execute on function create_item(uuid, uuid, text, text, jsonb, uuid, text, uuid) to authenticated, service_role;
