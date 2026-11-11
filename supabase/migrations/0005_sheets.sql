-- 0005_sheets.sql · M3: create a sheet in one transaction, bulk item import, prefix lock, delete a group.
-- Structure writes stay under RLS (create_sheet is SECURITY INVOKER); item writes go through definer functions that
-- check the caller like create_item does and log every item to the activity log in the same transaction.

-- ───────────────────────── create a sheet (wizard, CSV import, copy) ─────────────────────────
-- p: { sheet: {id, org_id, folder_id, name, description, item_label, id_prefix, is_library, settings, position},
--      groups: [{id, name, color, position}], fields: [{id, key, name, type, position, width, required, locked,
--      description, config, validation, rules, visibility}], views: [{id, name, type, config, position}],
--      automations: [{name, enabled, trigger, conditions, actions, source, version, locked}] }
-- Ids come from the caller so a copy can re-key references between them before the insert.
create or replace function create_sheet(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare s jsonb := p->'sheet'; o uuid := (p->'sheet'->>'org_id')::uuid; sid uuid := (p->'sheet'->>'id')::uuid;
begin
  if auth.uid() is null or not is_editor(o) then raise exception 'not allowed'; end if;
  if s->>'folder_id' is not null
     and not exists (select 1 from folders f where f.id = (s->>'folder_id')::uuid and f.org_id = o) then
    raise exception 'folder not in workspace';
  end if;
  if jsonb_array_length(coalesce(p->'groups', '[]'::jsonb)) = 0 then raise exception 'a sheet needs at least one group'; end if;

  insert into sheets (id, org_id, folder_id, name, description, item_label, id_prefix, is_library, settings, position, created_by)
  values (sid, o, (s->>'folder_id')::uuid, s->>'name', nullif(s->>'description', ''), coalesce(s->>'item_label', 'Item'),
          s->>'id_prefix', coalesce((s->>'is_library')::boolean, false), coalesce(s->'settings', '{}'::jsonb),
          s->>'position', auth.uid());

  insert into groups (id, org_id, sheet_id, name, color, position)
  select g.id, o, sid, g.name, coalesce(g.color, 'blue'), g.position
    from jsonb_to_recordset(p->'groups') as g(id uuid, name text, color text, position text);

  insert into fields (id, org_id, sheet_id, key, name, type, position, width, required, locked, description,
                      config, validation, rules, visibility)
  select f.id, o, sid, f.key, f.name, f.type, f.position, f.width, coalesce(f.required, false), coalesce(f.locked, false),
         f.description, coalesce(f.config, '{}'::jsonb), coalesce(f.validation, '{}'::jsonb), coalesce(f.rules, '[]'::jsonb),
         f.visibility
    from jsonb_to_recordset(coalesce(p->'fields', '[]'::jsonb)) as f(id uuid, key text, name text, type text, position text,
         width integer, required boolean, locked boolean, description text, config jsonb, validation jsonb, rules jsonb,
         visibility jsonb);

  insert into views (id, org_id, sheet_id, name, type, config, owner_id, position)
  select v.id, o, sid, v.name, v.type, coalesce(v.config, '{}'::jsonb), null, v.position
    from jsonb_to_recordset(coalesce(p->'views', '[]'::jsonb)) as v(id uuid, name text, type text, config jsonb, position text);

  insert into automations (org_id, sheet_id, name, enabled, trigger, conditions, actions, source, version, locked, created_by)
  select o, sid, a.name, coalesce(a.enabled, true), a.trigger, coalesce(a.conditions, '[]'::jsonb), a.actions,
         coalesce(a.source, 'custom'), coalesce(a.version, 1), coalesce(a.locked, false), auth.uid()
    from jsonb_to_recordset(coalesce(p->'automations', '[]'::jsonb)) as a(name text, enabled boolean, trigger jsonb,
         conditions jsonb, actions jsonb, source text, version integer, locked boolean);

  return sid;
end $$;

-- ───────────────────────── bulk items (CSV import) ─────────────────────────
-- Same checks as create_item/_create_item, done once per call instead of once per row:
-- caller can write, sheet not archived, group in sheet, every value key a value-holding field of the sheet.
-- p_rows: [{ name, position, values }]. Returns the number of items created.
create or replace function create_items(p_sheet uuid, p_group uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare s sheets; n int; first_seq int; bad text;
begin
  select * into s from sheets where id = p_sheet;
  if s.id is null or not can_write(s.org_id, null) then raise exception 'not allowed'; end if;
  if s.archived_at is not null then raise exception 'sheet not found'; end if;
  if not exists (select 1 from groups g where g.id = p_group and g.sheet_id = p_sheet) then raise exception 'group not in sheet'; end if;
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
         jsonb_build_object('name', ins.name, 'group_id', ins.group_id, 'values', ins."values"), 'CSV import'
    from ins;
  return n;
end $$;

-- ───────────────────────── ID prefix is fixed once items exist ─────────────────────────
-- docs/01 FR-7: the prefix can change only while the sheet has no items (display ids are never rewritten).
create or replace function sheets_prefix_guard() returns trigger language plpgsql as $$
begin
  if new.id_prefix is distinct from old.id_prefix and old.next_seq > 1 then
    raise exception 'prefix locked: the sheet has items';
  end if;
  return new;
end $$;
create trigger sheets_prefix_guard_bu before update of id_prefix on sheets
  for each row execute function sheets_prefix_guard();

-- ───────────────────────── delete a group (FR-8) ─────────────────────────
-- Empty groups are deleted. A group with items (archived ones too) needs p_target: every item moves there first,
-- each move logged as item.moved. p_positions: { "<item id>": "<new position>" } computed by the caller
-- (fractional keys after the target's last item); items not listed keep their position. A sheet keeps one group.
create or replace function delete_group(p_group uuid, p_target uuid default null, p_positions jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare g groups; moved int := 0;
begin
  select * into g from groups where id = p_group;
  if g.id is null or not is_editor(g.org_id) then raise exception 'not allowed'; end if;
  if not exists (select 1 from groups x where x.sheet_id = g.sheet_id and x.id <> g.id) then
    raise exception 'a sheet needs at least one group';
  end if;
  if exists (select 1 from items i where i.group_id = g.id) then
    if p_target is null then raise exception 'group has items'; end if;
    if p_target = g.id or not exists (select 1 from groups x where x.id = p_target and x.sheet_id = g.sheet_id) then
      raise exception 'group not in sheet';
    end if;
    with mv as (
      update items i set group_id = p_target,
                         position = coalesce(p_positions->>i.id::text, i.position),
                         updated_at = now(), updated_by = auth.uid()
       where i.group_id = g.id
      returning i.id, i.org_id, i.sheet_id
    )
    insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
    select mv.org_id, mv.sheet_id, mv.id, '', 'user', auth.uid(), 'item.moved', to_jsonb(g.id), to_jsonb(p_target)
      from mv;
    get diagnostics moved = row_count;
  end if;
  delete from groups where id = g.id;
  return moved;
end $$;

revoke all on function create_sheet, create_items, delete_group from public;
grant execute on function create_sheet, create_items, delete_group to authenticated;
