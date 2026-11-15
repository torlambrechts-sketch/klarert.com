-- 0069_field_conversion_note.sql · A field type conversion logs its note as the system's, in clear
-- (docs/09 §10.1 item 2, owner decision 15 Nov 2026: option b).
--
-- Before: changing a field's type wrote each converted value through set_item_values with the note "Field type changed
-- to <type>", the same path as a person's comment, so 0065 masked it and audit exports printed "Personal data".
--
-- Now: `convert_item_value(item, field, value, type label)` writes the one converted value through set_item_values
-- (every check of a person's edit applies: access, lock, rules) with `app.system_note` on for that call only, so the
-- note "Field type changed to <label>" stays in clear, as the framework edition move's does (0065). The note is built
-- here; the label is a type's name (a capital letter, then at most 39 letters, digits, spaces and - / & ( ) ,), never
-- free text. SECURITY INVOKER: the caller's own rights, nothing more. Granted to authenticated (0008).

create or replace function convert_item_value(p_item uuid, p_field uuid, p_value jsonb, p_type_label text)
returns items
language plpgsql security invoker set search_path = public as $$
declare r items;
begin
  if p_type_label is null or p_type_label !~ '^[A-Z][A-Za-z0-9 ,/&()-]{0,39}$' then
    raise exception 'convert: not a field type name';
  end if;
  perform set_config('app.system_note', 'on', true);
  r := set_item_values(p_item, jsonb_build_object(p_field::text, p_value), null, null,
                       'Field type changed to ' || p_type_label);
  perform set_config('app.system_note', '', true);
  return r;
end $$;
revoke all on function convert_item_value(uuid, uuid, jsonb, text) from public, anon;
grant execute on function convert_item_value(uuid, uuid, jsonb, text) to authenticated;
