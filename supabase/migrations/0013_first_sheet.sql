-- 0013_first_sheet.sql · M10: the template importer writes items through create_items like the CSV import does, but
-- the activity entry's note said "CSV import" for every bulk insert. The note is now a parameter (default unchanged),
-- so imported template items read "Template import" in the item's activity log.

drop function create_items(uuid, uuid, jsonb);

create function create_items(p_sheet uuid, p_group uuid, p_rows jsonb, p_note text default 'CSV import')
returns integer language plpgsql security definer set search_path = public as $$
declare s sheets; n int; first_seq int; bad text;
begin
  select * into s from sheets where id = p_sheet;
  if s.id is null or not can_write(s.org_id, null) then raise exception 'not allowed'; end if;
  if s.archived_at is not null then raise exception 'sheet not found'; end if;
  if not exists (select 1 from groups g where g.id = p_group and g.sheet_id = p_sheet) then raise exception 'group not in sheet'; end if;
  if p_note is null or p_note not in ('CSV import', 'Template import', 'Generated') then raise exception 'bad note'; end if;
  n := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  if n = 0 then return 0; end if;
  if n > 10000 then raise exception 'at most 10000 items per import'; end if;

  select k into bad
    from (select distinct jsonb_object_keys(coalesce(r->'values', '{}'::jsonb)) as k
            from jsonb_array_elements(p_rows) r) keys
   where not exists (select 1 from fields f where f.sheet_id = p_sheet and f.id::text = keys.k
                       and f.archived_at is null and not (f.type = any(non_value_types())))
   limit 1;
  if bad is not null then raise exception 'field % cannot hold a value', bad; end if;

  update sheets set next_seq = next_seq + n, updated_at = now() where id = p_sheet returning next_seq - n into first_seq;

  with ins as (
    insert into items (org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by)
    select s.org_id, p_sheet, p_group, first_seq + r.ord::int - 1,
           s.id_prefix || lpad((first_seq + r.ord::int - 1)::text, greatest(3, length((first_seq + r.ord::int - 1)::text)), '0'),
           r.row->>'name', coalesce(r.row->'values', '{}'::jsonb), r.row->>'position', auth.uid(), auth.uid()
      from jsonb_array_elements(p_rows) with ordinality as r(row, ord)
     order by r.ord
    returning id, org_id, sheet_id, group_id, name, "values"
  )
  insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  select ins.org_id, ins.sheet_id, ins.id, '', actor_kind_for(null), auth.uid(), 'item.created',
         jsonb_build_object('name', ins.name, 'group_id', ins.group_id, 'values', ins."values"), p_note
    from ins;
  return n;
end $$;

revoke all on function create_items(uuid, uuid, jsonb, text) from public, anon;
grant execute on function create_items(uuid, uuid, jsonb, text) to authenticated, service_role;
