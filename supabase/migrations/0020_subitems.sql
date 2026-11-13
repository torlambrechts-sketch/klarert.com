-- 0020_subitems.sql · Sub-items (docs/02 §12): one level of items under an item, kept on a hidden child sheet.
-- 1. sheets.parent_sheet_id: a sheet can have one child sheet (its sub-item schema: own fields, one hidden group).
--    A child sheet has no ID prefix and never a child of its own (depth 1). The parent never changes.
-- 2. items.parent_id / sub_seq / next_sub_seq / archived_with: a sub-item is an item of the child sheet whose parent
--    is an item of the parent sheet. Its display id is the parent's display id, a dot and sub_seq (CA-014.2), counted
--    per parent under the parent's row lock: no gaps, never reused, and frozen when the sub-item moves to another
--    parent (it then takes the next sub_seq of the new parent, so (parent_id, sub_seq) stays unique).
-- 3. create_subitem / create_subitems / move_subitem write the sub-item and the activity log on its own chain and
--    pointer entries on the parent chains (subitem.added, subitem.removed, subitem.archived, subitem.restored) in one
--    transaction. create_item refuses child sheets and move_item refuses sub-items.
-- 4. set_item_archived cascades: archiving a parent archives its open sub-items (archived_with = parent); restoring
--    the parent brings back only those.
-- 5. The gate (sheets.settings.subitems.blockClose): set_item_values refuses to move a parent's status field to a
--    done option while any live sub-item is not done, so bulk edits, imports and automations cannot bypass it.
--    sheets.settings.subitems.lockCascade: a locked parent locks its sub-items for people who are not admins.
-- 6. field type `subitems` (58th): a computed column on the parent sheet (count and progress of the sub-items).

-- ───────────────────────── field types ─────────────────────────
create or replace function field_types() returns text[] language sql immutable as $$
  select array[
    -- basic input (18)
    'text','longtext','comment','number','value','percent','yesno','check','date','datetime','duration',
    'timeline','recurrence','rating','email','phone','url','location',
    -- choice and people (10)
    'status','dropdown','multiselect','people','role','team','entity','country','classification','severity',
    -- compliance (19)
    'requirement','controllink','evidence','attachment','signature','ack','justification','applicability',
    'finding','checklist','question','riskmatrix','maturity','measurement','clock','protected','pdmarker',
    'retention','version',
    -- linked, computed and system (11)
    'link','lookup','rollup','formula','progress','autoid','meta','workflowstep','button','ai','subitems'
  ]::text[]
$$;

create or replace function non_value_types() returns text[] language sql immutable as $$
  select array['link','requirement','controllink','lookup','rollup','formula','progress','autoid','meta',
               'clock','button','evidence','attachment','protected','subitems']::text[]
$$;

-- ───────────────────────── child sheets ─────────────────────────
alter table sheets add column parent_sheet_id uuid references sheets(id) on delete cascade;
alter table sheets alter column id_prefix drop not null;
alter table sheets drop constraint sheets_org_id_id_prefix_key;
-- the prefix stays unique per workspace for ordinary sheets; child sheets have none (sub-items use the parent's id)
create unique index sheets_org_id_id_prefix_key on sheets(org_id, id_prefix) where parent_sheet_id is null;
alter table sheets add constraint sheets_prefix_or_parent check ((parent_sheet_id is null) = (id_prefix is not null));
create unique index sheets_one_child_idx on sheets(parent_sheet_id) where parent_sheet_id is not null;

create or replace function sheets_parent_guard() returns trigger language plpgsql security definer
set search_path = public as $$
declare p sheets;
begin
  if tg_op = 'UPDATE' and new.parent_sheet_id is distinct from old.parent_sheet_id then
    raise exception 'the parent of a sub-item sheet never changes';
  end if;
  if new.parent_sheet_id is not null then
    select * into p from sheets where id = new.parent_sheet_id;
    if p.id is null or p.org_id <> new.org_id or p.id = new.id then raise exception 'parent sheet not in workspace'; end if;
    if p.parent_sheet_id is not null then raise exception 'sub-items cannot have sub-items'; end if;
  end if;
  return new;
end $$;
create trigger sheets_parent_guard_biu before insert or update of parent_sheet_id on sheets
  for each row execute function sheets_parent_guard();

-- ───────────────────────── sub-items ─────────────────────────
alter table items
  add column parent_id     uuid references items(id) on delete cascade,
  add column sub_seq       integer,
  add column next_sub_seq  integer not null default 1,
  add column archived_with uuid;
alter table items add constraint items_sub_seq_with_parent check ((parent_id is null) = (sub_seq is null));
create unique index items_parent_sub_seq_key on items(parent_id, sub_seq) where parent_id is not null;
create index items_parent_idx on items(parent_id, position) where archived_at is null;

-- parent_id is set exactly for items of child sheets, and points at an item of the parent sheet
create or replace function items_parent_guard() returns trigger language plpgsql security definer
set search_path = public as $$
declare s sheets; p items;
begin
  select * into s from sheets where id = new.sheet_id;
  if s.parent_sheet_id is null then
    if new.parent_id is not null then raise exception 'wrong parent: this sheet has no sub-items'; end if;
    return new;
  end if;
  if new.parent_id is null then raise exception 'sheet holds sub-items: add them to an item'; end if;
  select * into p from items where id = new.parent_id;
  if p.id is null or p.sheet_id <> s.parent_sheet_id then raise exception 'wrong parent'; end if;
  return new;
end $$;
create trigger items_parent_guard_biu before insert or update of parent_id, sheet_id on items
  for each row execute function items_parent_guard();

-- ───────────────────────── internal helpers (never granted) ─────────────────────────
-- The field that decides whether an item of a sheet is done: the first status field, else the first field with a
-- done option (as src/engine/fields/item-status.ts).
create or replace function _status_field(p_sheet uuid) returns fields
language sql stable security definer set search_path = public as $$
  select f.* from fields f
   where f.sheet_id = p_sheet and f.archived_at is null
     and (f.type = 'status' or exists (select 1 from jsonb_array_elements(
            case when jsonb_typeof(f.config->'options') = 'array' then f.config->'options' else '[]'::jsonb end) o
            where (o->>'done')::boolean))
   order by (f.type = 'status') desc, f.position, f.id
   limit 1
$$;

create or replace function _option_done(p_field fields, p_value jsonb) returns boolean
language sql stable set search_path = public as $$
  select p_value is not null and jsonb_typeof(p_value) = 'string' and exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(p_field.config->'options') = 'array' then p_field.config->'options' else '[]'::jsonb end) o
     where o->>'id' = p_value #>> '{}' and coalesce((o->>'done')::boolean, false))
$$;

-- Live sub-items of a parent that are not done, as "CA-014.2 Root cause" lines (empty when none or no status field).
create or replace function _open_subitems(p_parent uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare c sheets; f fields; out text[];
begin
  select s.* into c from sheets s join items p on p.sheet_id = s.parent_sheet_id where p.id = p_parent;
  if c.id is null then return '{}'; end if;
  f := _status_field(c.id);
  if f.id is null then return '{}'; end if;
  select coalesce(array_agg(i.display_id || ' ' || i.name order by i.sub_seq), '{}') into out
    from items i where i.parent_id = p_parent and i.archived_at is null
     and not _option_done(f, i."values" -> f.id::text);
  return out;
end $$;

create or replace function _subitem_settings(p_sheet uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(settings->'subitems', '{}'::jsonb) from sheets where id = p_sheet
$$;

create or replace function _create_subitem(p_parent uuid, p_name text, p_position text, p_values jsonb,
                                           p_actor_kind text, p_actor_id uuid)
returns items language plpgsql security definer set search_path = public as $$
declare par items; c sheets; g uuid; v_seq int; v_sub int; it items; k text;
begin
  select * into par from items where id = p_parent and archived_at is null for update;
  if par.id is null then raise exception 'item not found'; end if;
  if par.parent_id is not null then raise exception 'sub-items cannot have sub-items'; end if;
  select * into c from sheets where parent_sheet_id = par.sheet_id and archived_at is null;
  if c.id is null then raise exception 'sub-items are off for this sheet'; end if;
  select id into g from groups where sheet_id = c.id order by position, id limit 1;
  if g is null then raise exception 'group not in sheet'; end if;
  for k in select jsonb_object_keys(coalesce(p_values,'{}'::jsonb)) loop
    if not exists (select 1 from fields f where f.id::text = k and f.sheet_id = c.id and f.archived_at is null
                   and not (f.type = any(non_value_types()))) then
      raise exception 'field % cannot hold a value', k;
    end if;
  end loop;
  -- bookkeeping on the parent (no audit entry of its own: the pointer entry below records the change)
  update items set next_sub_seq = next_sub_seq + 1 where id = par.id returning next_sub_seq - 1 into v_sub;
  update sheets set next_seq = next_seq + 1, updated_at = now() where id = c.id returning next_seq - 1 into v_seq;
  insert into items(org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by,
                    parent_id, sub_seq)
  values (c.org_id, c.id, g, v_seq, par.display_id || '.' || v_sub, p_name, coalesce(p_values,'{}'::jsonb),
          p_position, auth.uid(), auth.uid(), par.id, v_sub)
  returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (it.org_id, it.sheet_id, it.id, '', p_actor_kind, p_actor_id, 'item.created',
          jsonb_build_object('name', it.name, 'parent_id', par.id, 'parent', par.display_id, 'values', it."values"));
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (par.org_id, par.sheet_id, par.id, '', p_actor_kind, p_actor_id, 'subitem.added',
          jsonb_build_object('id', it.id, 'display_id', it.display_id, 'name', it.name));
  return it;
end $$;

-- ───────────────────────── RPCs ─────────────────────────
create or replace function create_subitem(p_parent uuid, p_name text, p_position text,
                                          p_values jsonb default '{}'::jsonb, p_automation uuid default null)
returns items language plpgsql security definer set search_path = public as $$
declare par items;
begin
  select * into par from items where id = p_parent;
  if par.id is null or not can_write(par.org_id, p_automation) then raise exception 'not allowed'; end if;
  if par.locked and p_automation is null and not is_admin(par.org_id)
     and coalesce((_subitem_settings(par.sheet_id)->>'lockCascade')::boolean, false) then
    raise exception 'item locked: %', coalesce(par.lock_reason, 'approved');
  end if;
  return _create_subitem(p_parent, p_name, p_position, p_values, actor_kind_for(p_automation),
                         coalesce(p_automation, auth.uid()));
end $$;

-- p_rows: [{ name, position, values }] (a template's sub-item set, the create_subitems action); at most 50
create or replace function create_subitems(p_parent uuid, p_rows jsonb, p_automation uuid default null)
returns setof items language plpgsql security definer set search_path = public as $$
declare par items; r jsonb; n int;
begin
  select * into par from items where id = p_parent;
  if par.id is null or not can_write(par.org_id, p_automation) then raise exception 'not allowed'; end if;
  if par.locked and p_automation is null and not is_admin(par.org_id)
     and coalesce((_subitem_settings(par.sheet_id)->>'lockCascade')::boolean, false) then
    raise exception 'item locked: %', coalesce(par.lock_reason, 'approved');
  end if;
  n := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  if n > 50 then raise exception 'at most 50 sub-items at once'; end if;
  for r in select x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x loop
    return next _create_subitem(p_parent, r->>'name', r->>'position', coalesce(r->'values', '{}'::jsonb),
                                actor_kind_for(p_automation), coalesce(p_automation, auth.uid()));
  end loop;
end $$;

-- Move a sub-item to another parent of the same sheet (or reorder it under its own). The display id never changes.
create or replace function move_subitem(p_item uuid, p_parent uuid, p_position text, p_automation uuid default null)
returns items language plpgsql security definer set search_path = public as $$
declare it items; oldp items; newp items; v_sub int; ak text; aid uuid;
begin
  select * into it from items where id = p_item and archived_at is null;
  if it.id is null then raise exception 'item not found'; end if;
  if it.parent_id is null then raise exception 'not a sub-item'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  -- both parents in id order, then the sub-item: two moves in opposite directions cannot deadlock
  perform 1 from items where id in (it.parent_id, p_parent) order by id for update;
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if it.locked and p_automation is null and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  select * into newp from items where id = p_parent and archived_at is null;
  if newp.id is null or newp.org_id <> it.org_id
     or newp.sheet_id <> (select parent_sheet_id from sheets where id = it.sheet_id) then
    raise exception 'wrong parent';
  end if;
  if newp.id = it.parent_id then
    update items set position = p_position, updated_at = now(), updated_by = auth.uid()
     where id = it.id returning * into it;
    return it;
  end if;
  select * into oldp from items where id = it.parent_id;
  ak := actor_kind_for(p_automation);
  aid := coalesce(p_automation, auth.uid());
  update items set next_sub_seq = next_sub_seq + 1 where id = newp.id returning next_sub_seq - 1 into v_sub;
  update items set parent_id = newp.id, sub_seq = v_sub, position = p_position, updated_at = now(),
                   updated_by = auth.uid()
   where id = it.id returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
  values (it.org_id, it.sheet_id, it.id, '', ak, aid, 'subitem.moved',
          jsonb_build_object('parent_id', oldp.id, 'parent', oldp.display_id),
          jsonb_build_object('parent_id', newp.id, 'parent', newp.display_id));
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value)
  values (oldp.org_id, oldp.sheet_id, oldp.id, '', ak, aid, 'subitem.removed',
          jsonb_build_object('id', it.id, 'display_id', it.display_id, 'name', it.name, 'to', newp.display_id));
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (newp.org_id, newp.sheet_id, newp.id, '', ak, aid, 'subitem.added',
          jsonb_build_object('id', it.id, 'display_id', it.display_id, 'name', it.name, 'from', oldp.display_id));
  return it;
end $$;

-- create_item: sub-items are created under their parent
create or replace function _create_item(p_sheet uuid, p_group uuid, p_name text, p_position text,
                                        p_values jsonb, p_actor_kind text, p_actor_id uuid)
returns items language plpgsql security definer set search_path = public as $$
declare s sheets; v_seq int; it items; k text;
begin
  select * into s from sheets where id = p_sheet and archived_at is null;
  if s.id is null then raise exception 'sheet not found'; end if;
  if s.parent_sheet_id is not null then raise exception 'sheet holds sub-items: add them to an item'; end if;
  if not exists (select 1 from groups g where g.id = p_group and g.sheet_id = p_sheet) then raise exception 'group not in sheet'; end if;
  for k in select jsonb_object_keys(coalesce(p_values,'{}'::jsonb)) loop
    if not exists (select 1 from fields f where f.id::text = k and f.sheet_id = p_sheet and f.archived_at is null
                   and not (f.type = any(non_value_types()))) then
      raise exception 'field % cannot hold a value', k;
    end if;
  end loop;
  update sheets set next_seq = next_seq + 1, updated_at = now() where id = p_sheet returning next_seq - 1 into v_seq;
  insert into items(org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by)
  values (s.org_id, p_sheet, p_group, v_seq, s.id_prefix || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0'),
          p_name, coalesce(p_values,'{}'::jsonb), p_position, auth.uid(), auth.uid())
  returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (it.org_id, it.sheet_id, it.id, '', p_actor_kind, p_actor_id, 'item.created',
          jsonb_build_object('name', it.name, 'group_id', it.group_id, 'values', it."values"));
  return it;
end $$;

-- move_item: groups only; sub-items move with move_subitem
create or replace function move_item(p_item uuid, p_group uuid, p_position text, p_automation uuid default null)
returns items language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if it.parent_id is not null then raise exception 'sub-items move with move_subitem'; end if;
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

-- set_item_values: the gate and the lock cascade
create or replace function set_item_values(p_item uuid, p_patch jsonb, p_name text default null,
                                           p_automation uuid default null, p_note text default null)
returns items language plpgsql security definer set search_path = public as $$
declare it items; f fields; k text; old_v jsonb; new_v jsonb; par items; sf fields; settings jsonb; open text[];
        label text; listed text;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if it.locked and p_automation is null and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  if it.parent_id is not null and p_automation is null and not is_admin(it.org_id) then
    select * into par from items where id = it.parent_id;
    if par.locked and coalesce((_subitem_settings(par.sheet_id)->>'lockCascade')::boolean, false) then
      raise exception 'item locked: %', coalesce(par.lock_reason, 'approved');
    end if;
  end if;
  if p_name is not null and p_name <> it.name then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
    values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
            'item.renamed', to_jsonb(it.name), to_jsonb(p_name), p_note);
    it.name := p_name;
  end if;
  settings := case when it.parent_id is null then _subitem_settings(it.sheet_id) else '{}'::jsonb end;
  if coalesce((settings->>'blockClose')::boolean, false) then sf := _status_field(it.sheet_id); end if;
  for k in select jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) loop
    select * into f from fields where id::text = k and sheet_id = it.sheet_id and archived_at is null;
    if f.id is null then raise exception 'field % not in sheet', k; end if;
    if f.type = any(non_value_types()) then raise exception 'field % (%) is not set through values', f.name, f.type; end if;
    if f.type = 'workflowstep' and p_automation is null and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'workflow step is set by automations only';
    end if;
    old_v := it."values" -> k;
    new_v := p_patch -> k;
    if new_v is null or new_v = 'null'::jsonb then
      it."values" := it."values" - k; new_v := null;
    else
      it."values" := jsonb_set(it."values", array[k], new_v, true);
    end if;
    -- the gate: the parent's status may not become done while a sub-item is open
    if sf.id = f.id and _option_done(f, new_v) and not _option_done(f, old_v) then
      open := _open_subitems(it.id);
      if cardinality(open) > 0 then
        label := coalesce(nullif(settings->>'label', ''), 'Sub-items');
        listed := array_to_string(open[1:5], ', ')
                  || case when cardinality(open) > 5 then ' and ' || (cardinality(open) - 5) || ' more' else '' end;
        raise exception 'subitems open: % still open: %. Close them before closing %.', label, listed, it.display_id;
      end if;
    end if;
    if old_v is distinct from new_v then
      insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value, note)
      values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
              'value.changed', f.id, old_v, new_v, p_note);
    end if;
  end loop;
  update items set name = it.name, "values" = it."values", updated_at = now(), updated_by = auth.uid()
   where id = it.id returning * into it;
  return it;
end $$;

-- set_item_archived: cascade to sub-items; pointer entries on the parent
create or replace function set_item_archived(p_item uuid, p_archived boolean) returns items
language plpgsql security definer set search_path = public as $$
declare it items; par items;
begin
  select * into it from items where id = p_item for update;
  if it.id is null or not can_write(it.org_id, null) then raise exception 'not allowed'; end if;
  if it.locked and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  if it.parent_id is not null then
    select * into par from items where id = it.parent_id;
    if not p_archived and par.archived_at is not null then
      raise exception 'restore the parent first: %', par.display_id;
    end if;
  end if;
  if (it.archived_at is not null) = p_archived then return it; end if;
  update items set archived_at = case when p_archived then now() end, archived_with = null,
                   updated_at = now(), updated_by = auth.uid()
   where id = p_item returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), case when p_archived then 'item.archived' else 'item.restored' end);
  if par.id is not null then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
    values (par.org_id, par.sheet_id, par.id, '', 'user', auth.uid(),
            case when p_archived then 'subitem.archived' else 'subitem.restored' end,
            jsonb_build_object('id', it.id, 'display_id', it.display_id, 'name', it.name));
  elsif p_archived then
    with c as (
      update items set archived_at = now(), archived_with = it.id, updated_at = now(), updated_by = auth.uid()
       where parent_id = it.id and archived_at is null
      returning id, org_id, sheet_id
    )
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, note)
    select c.org_id, c.sheet_id, c.id, '', 'user', auth.uid(), 'item.archived', 'Archived with ' || it.display_id from c;
  else
    with c as (
      update items set archived_at = null, archived_with = null, updated_at = now(), updated_by = auth.uid()
       where parent_id = it.id and archived_with = it.id
      returning id, org_id, sheet_id
    )
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, note)
    select c.org_id, c.sheet_id, c.id, '', 'user', auth.uid(), 'item.restored', 'Restored with ' || it.display_id from c;
  end if;
  return it;
end $$;

-- create_sheet: child sheets (parent_sheet_id, no prefix)
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

  insert into sheets (id, org_id, folder_id, name, description, item_label, id_prefix, is_library, settings, position,
                      created_by, parent_sheet_id)
  values (sid, o, (s->>'folder_id')::uuid, s->>'name', nullif(s->>'description', ''), coalesce(s->>'item_label', 'Item'),
          s->>'id_prefix', coalesce((s->>'is_library')::boolean, false), coalesce(s->'settings', '{}'::jsonb),
          s->>'position', auth.uid(), (s->>'parent_sheet_id')::uuid);

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

-- ───────────────────────── grants ─────────────────────────
revoke all on function _status_field(uuid), _option_done(fields, jsonb), _open_subitems(uuid), _subitem_settings(uuid),
                       _create_subitem(uuid, text, text, jsonb, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function sheets_parent_guard(), items_parent_guard() from public, anon, authenticated;
revoke all on function create_subitem(uuid, text, text, jsonb, uuid), create_subitems(uuid, jsonb, uuid),
                       move_subitem(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function create_subitem(uuid, text, text, jsonb, uuid), create_subitems(uuid, jsonb, uuid),
                          move_subitem(uuid, uuid, text, uuid)
  to authenticated;
