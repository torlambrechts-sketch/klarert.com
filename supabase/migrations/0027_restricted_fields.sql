-- 0027_restricted_fields.sql · P2 access control, part 3: restricted fields (docs/02 §16, decision 4).
-- Any field can be marked Restricted with the people and/or workspace roles allowed to see it (fields.restricted_to,
-- { userIds: [...], roles: [...] }); owners always see it. Only owners and admins with edit access to the sheet change
-- it, through set_field_restriction, which logs the change on the sheet chain.
-- Values never reach anyone else, in the database:
-- 1. Stored values of a restricted field leave items.values for restricted_values (one row per item and field, RLS:
--    the sheet readable and the field visible). A BEFORE trigger on items moves any restricted key out of the row, so
--    every writer (create_item, imports, forms, sub-items, packs, the document workflow) is covered; set_item_values
--    reads and writes the store itself (clearing a value, the old value in the log). Turning the restriction on moves
--    existing values over, turning it off moves them back.
-- 2. Links and files of a restricted field: item_links and files rows are readable only by people who see the field.
-- 3. The activity log: a BEFORE INSERT trigger replaces a restricted field's old and new values (value.changed,
--    link.changed, file events, and the field's entry in item.created values) with a marker
--    {"$restricted": sha256(salt | value)} and keeps the values in restricted_activity (RLS as restricted_values). The
--    hash chain covers the marker, the marker commits to the value, verify_activity_chain checks both. Entries written
--    before a field was restricted cannot change (append-only): RLS hides those that still hold its value from people
--    who cannot see it.
-- 4. Public forms never show or accept a restricted field.

alter table fields add column restricted_to jsonb
  check (restricted_to is null or (jsonb_typeof(restricted_to) = 'object'
         and jsonb_typeof(coalesce(restricted_to->'userIds', '[]')) = 'array'
         and jsonb_typeof(coalesce(restricted_to->'roles', '[]')) = 'array'));
create index fields_restricted_idx on fields(sheet_id) where restricted_to is not null;

-- ───────────────────────── visibility ─────────────────────────
create or replace function _field_visible_for(p_user uuid, p_org uuid, p_restricted jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select p_restricted is null or exists (
    select 1 from memberships m
     where m.org_id = p_org and m.user_id = p_user and (m.expires_at is null or m.expires_at > now())
       and (m.role = 'owner'
            or coalesce(p_restricted->'userIds', '[]') ? p_user::text
            or coalesce(p_restricted->'roles', '[]') ? m.role::text))
$$;

-- Restricted fields of the caller's workspaces that the caller may not see (ids, and ids as text for jsonb ?|).
create or replace function hidden_field_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f.id), '{}') from fields f
   where f.restricted_to is not null
     and f.org_id in (select m.org_id from memberships m where m.user_id = auth.uid())
     and not _field_visible_for(auth.uid(), f.org_id, f.restricted_to)
$$;
create or replace function hidden_field_keys() returns text[]
language sql stable as $$ select coalesce((select array_agg(x::text) from unnest(hidden_field_ids()) x), '{}') $$;

create or replace function field_visible(p_field uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select _field_visible_for(auth.uid(), f.org_id, f.restricted_to) from fields f where f.id = p_field),
                  false)
$$;

-- fields.field_hidden (a computed column the app selects with the fields): the caller may not see this field's values.
create or replace function field_hidden(f fields) returns boolean
language sql stable set search_path = public as $$
  select f.restricted_to is not null and f.id = any (hidden_field_ids())
$$;

-- A marker that stands for a restricted value in the log.
create or replace function activity_value_masked(v jsonb) returns boolean language sql immutable as $$
  select v is null or (jsonb_typeof(v) = 'object' and v ? '$restricted')
$$;

-- ───────────────────────── the store ─────────────────────────
create table restricted_values (
  org_id    uuid not null references orgs(id) on delete cascade,
  sheet_id  uuid not null references sheets(id) on delete cascade,
  -- deferred: the items trigger writes the value before the new item row exists
  item_id   uuid not null references items(id) on delete cascade deferrable initially deferred,
  field_id  uuid not null references fields(id) on delete cascade,
  value     jsonb not null,
  primary key (item_id, field_id)
);
create index restricted_values_sheet_idx on restricted_values(sheet_id, field_id);
alter table restricted_values enable row level security;
create policy restricted_values_read on restricted_values for select using (
  sheet_id in (select readable_sheet_ids()) and not (field_id = any ((select hidden_field_ids())::uuid[])));
revoke insert, update, delete, truncate on restricted_values from anon, authenticated;

create table restricted_activity (
  activity_id bigint not null,
  org_id      uuid not null references orgs(id) on delete cascade,
  sheet_id    uuid,
  field_id    uuid not null,
  salt        text not null,
  old_value   jsonb,
  new_value   jsonb,
  primary key (activity_id, field_id)
);
alter table restricted_activity enable row level security;
create policy restricted_activity_read on restricted_activity for select using (
  sheet_id in (select readable_sheet_ids()) and not (field_id = any ((select hidden_field_ids())::uuid[])));
revoke insert, update, delete, truncate on restricted_activity from anon, authenticated;
-- like the log itself: nothing changes once written (the workspace purge may delete)
create or replace function restricted_activity_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.purge_org', true) = old.org_id::text then return old; end if;
  raise exception 'restricted_activity is append-only';
end $$;
create trigger restricted_activity_no_change before update or delete on restricted_activity
  for each row execute function restricted_activity_append_only();

-- Writing a restricted value needs edit access to the sheet and sight of the field (people; automations and the
-- system are authorised elsewhere).
create or replace function restricted_values_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r restricted_values := coalesce(new, old);
begin
  if not _is_person() then return coalesce(new, old); end if;
  perform _need_sheet(r.sheet_id, 'editor');
  -- set_field_restriction moves values in and out for the owner or admin restricting the field
  if coalesce(current_setting('app.access_op', true), '') = 'on' then return coalesce(new, old); end if;
  if not field_visible(r.field_id) then
    raise exception using errcode = '42501', message = 'no access: you cannot change a restricted field';
  end if;
  return coalesce(new, old);
end $$;
create trigger restricted_values_guard before insert or update or delete on restricted_values
  for each row execute function restricted_values_guard();

-- Any restricted key in a written row moves to the store (runs after the other item triggers: alphabetical order).
create or replace function items_restricted_split() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new."values" = '{}'::jsonb then return new; end if;
  if tg_op = 'UPDATE' and new."values" is not distinct from old."values" then return new; end if;
  for f in select id from fields where sheet_id = new.sheet_id and restricted_to is not null loop
    if new."values" ? f.id::text then
      insert into restricted_values(org_id, sheet_id, item_id, field_id, value)
      values (new.org_id, new.sheet_id, new.id, f.id, new."values" -> f.id::text)
      on conflict (item_id, field_id) do update set value = excluded.value;
      new."values" := new."values" - f.id::text;
    end if;
  end loop;
  return new;
end $$;
create trigger items_restricted_split before insert or update on items
  for each row execute function items_restricted_split();

-- An item's values with its restricted values (for log entries of a creation; definer functions only).
create or replace function _full_values(p_item uuid, p_values jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(p_values, '{}'::jsonb)
         || coalesce((select jsonb_object_agg(field_id::text, value) from restricted_values where item_id = p_item),
                     '{}'::jsonb)
$$;

-- ───────────────────────── the log ─────────────────────────
create or replace function _mask_value(p_salt text, p_kind text, v jsonb) returns jsonb
language sql immutable set search_path = public, extensions as $$
  select case when v is null or v = 'null'::jsonb then v
              else jsonb_build_object('$restricted', encode(digest(p_salt || '|' || p_kind || '|' || v::text, 'sha256'), 'hex'))
         end
$$;

-- Runs before activity_chain (alphabetical): the chain hashes the masked entry.
create or replace function activity_a_mask() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare salt text; f record; vals jsonb;
begin
  if new.field_id is not null then
    if exists (select 1 from fields where id = new.field_id and restricted_to is not null) then
      salt := encode(gen_random_bytes(16), 'hex');
      insert into restricted_activity(activity_id, org_id, sheet_id, field_id, salt, old_value, new_value)
      values (new.id, new.org_id, new.sheet_id, new.field_id, salt, new.old_value, new.new_value);
      new.old_value := _mask_value(salt, 'old', new.old_value);
      new.new_value := _mask_value(salt, 'new', new.new_value);
    end if;
    return new;
  end if;
  if new.sheet_id is null or new.new_value is null or jsonb_typeof(new.new_value) <> 'object'
     or jsonb_typeof(new.new_value->'values') is distinct from 'object' then
    return new;
  end if;
  vals := new.new_value->'values';
  for f in select id from fields where sheet_id = new.sheet_id and restricted_to is not null loop
    if vals ? f.id::text and not activity_value_masked(vals -> f.id::text) then
      salt := encode(gen_random_bytes(16), 'hex');
      insert into restricted_activity(activity_id, org_id, sheet_id, field_id, salt, old_value, new_value)
      values (new.id, new.org_id, new.sheet_id, f.id, salt, null, vals -> f.id::text);
      vals := jsonb_set(vals, array[f.id::text], _mask_value(salt, 'new', vals -> f.id::text));
    end if;
  end loop;
  new.new_value := jsonb_set(new.new_value, '{values}', vals);
  return new;
end $$;
create trigger activity_a_mask_bi before insert on activity_log
  for each row execute function activity_a_mask();

-- Entries: sheet readable (0026) and no restricted value in clear that the caller may not see (entries written before
-- the field was restricted).
drop policy activity_log_read on activity_log;
create policy activity_log_read on activity_log for select using (
  (case when sheet_id is null then is_member(org_id) and (action not like 'folder.access%' or is_admin(org_id))
        else sheet_id in (select readable_sheet_ids()) end)
  and (field_id is null or not (field_id = any ((select hidden_field_ids())::uuid[]))
       or (activity_value_masked(old_value) and activity_value_masked(new_value)))
  and (new_value is null or jsonb_typeof(new_value) <> 'object' or jsonb_typeof(new_value->'values') <> 'object'
       or not (new_value->'values' ?| (select hidden_field_keys()))
       or not exists (select 1 from jsonb_each(new_value->'values') e
                       where e.key = any ((select hidden_field_keys())::text[]) and not activity_value_masked(e.value))));

-- Links and files of a restricted field.
drop policy item_links_read on item_links;
create policy item_links_read on item_links for select using (
  exists (select 1 from items a where a.id = from_item) and exists (select 1 from items b where b.id = to_item)
  and not (field_id = any ((select hidden_field_ids())::uuid[])));

drop policy files_read on files;
create policy files_read on files for select using (
  exists (select 1 from items i where i.id = item_id)
  and (field_id is null or not (field_id = any ((select hidden_field_ids())::uuid[]))));

drop policy protected_read on protected_values;
create policy protected_read on protected_values for select using (
  exists (select 1 from items i where i.id = item_id)
  and (is_admin(org_id) or exists (select 1 from fields f where f.id = field_id
                                     and f.config -> 'allowedUserIds' ? auth.uid()::text)));

-- verify: the chain, and every restricted value against its marker
create or replace function verify_activity_chain(p_chain_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; prev text := 'genesis'; n int := 0; o uuid; s uuid; bad bigint;
begin
  select org_id, sheet_id into o, s from activity_log where chain_key = p_chain_key limit 1;
  if o is null then return jsonb_build_object('ok', true, 'entries', 0); end if;
  if not is_member(o) then raise exception 'not allowed'; end if;
  if s is not null and _sheet_level_for(auth.uid(), s) = 'none' then raise exception 'not allowed'; end if;
  for r in select * from activity_log where chain_key = p_chain_key order by id loop
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> activity_hash(r.prev_hash, r.at, r.actor_kind, r.actor_id, r.action,
                                                       r.field_id, r.old_value, r.new_value, r.note) then
      return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', r.id);
    end if;
    prev := r.hash;
  end loop;
  select min(a.id) into bad from restricted_activity ra join activity_log a on a.id = ra.activity_id
   where a.chain_key = p_chain_key
     and ((a.field_id is not null
           and (_mask_value(ra.salt, 'old', ra.old_value) is distinct from a.old_value
                or _mask_value(ra.salt, 'new', ra.new_value) is distinct from a.new_value))
          or (a.field_id is null
              and _mask_value(ra.salt, 'new', ra.new_value) is distinct from a.new_value->'values'->(ra.field_id::text)));
  if bad is not null then return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', bad); end if;
  return jsonb_build_object('ok', true, 'entries', n, 'last_hash', prev);
end $$;

-- ───────────────────────── setting a restriction ─────────────────────────
-- p_restricted false clears it. Owners, and admins with edit access to the sheet. Moves the values in or out of the
-- store and logs field.restricted / field.restriction_changed / field.unrestricted on the sheet chain.
create or replace function set_field_restriction(p_field uuid, p_restricted boolean, p_user_ids uuid[],
                                                 p_roles text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fields; nxt jsonb; act text; n int := 0;
begin
  select * into f from fields where id = p_field and archived_at is null;
  if f.id is null or not is_member(f.org_id) then raise exception 'no access: field not found'; end if;
  if not (has_role(f.org_id, array['owner']::member_role[])
          or (is_admin(f.org_id) and _level_rank(_sheet_level_for(auth.uid(), f.sheet_id)) >= 3)) then
    raise exception 'not allowed: only owners and admins with access restrict fields';
  end if;
  if p_restricted then
    if exists (select 1 from unnest(coalesce(p_roles, '{}')) r where r not in ('owner', 'admin', 'editor', 'viewer', 'auditor')) then
      raise exception 'access: bad role';
    end if;
    if exists (select 1 from unnest(coalesce(p_user_ids, '{}')) u
                where not exists (select 1 from memberships m where m.org_id = f.org_id and m.user_id = u)) then
      raise exception 'access: Only members of the workspace can be listed.';
    end if;
    nxt := jsonb_build_object(
      'userIds', (select coalesce(jsonb_agg(distinct u), '[]'::jsonb) from unnest(coalesce(p_user_ids, '{}')) u),
      'roles', (select coalesce(jsonb_agg(distinct r), '[]'::jsonb) from unnest(coalesce(p_roles, '{}')) r));
  end if;
  if nxt is not distinct from f.restricted_to then return nxt; end if;
  perform set_config('app.access_op', 'on', true);
  if f.restricted_to is null and nxt is not null then
    -- on: the values move to the store (the items trigger does it as the key leaves the row)
    update fields set restricted_to = nxt where id = f.id;
    insert into restricted_values(org_id, sheet_id, item_id, field_id, value)
    select i.org_id, i.sheet_id, i.id, f.id, i."values" -> f.id::text from items i
     where i.sheet_id = f.sheet_id and i."values" ? f.id::text
    on conflict (item_id, field_id) do update set value = excluded.value;
    get diagnostics n = row_count;
    update items set "values" = "values" - f.id::text where sheet_id = f.sheet_id and "values" ? f.id::text;
    act := 'field.restricted';
  elsif nxt is null then
    -- off: back into the rows
    update fields set restricted_to = null where id = f.id;
    update items i set "values" = i."values" || jsonb_build_object(f.id::text, rv.value)
      from restricted_values rv where rv.item_id = i.id and rv.field_id = f.id;
    get diagnostics n = row_count;
    delete from restricted_values where field_id = f.id;
    act := 'field.unrestricted';
  else
    update fields set restricted_to = nxt where id = f.id;
    act := 'field.restriction_changed';
  end if;
  perform set_config('app.access_op', '', true);
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (f.org_id, f.sheet_id, '', 'user', auth.uid(), act,
          case when f.restricted_to is not null then jsonb_build_object('field_id', f.id) || f.restricted_to end,
          case when nxt is not null then jsonb_build_object('field_id', f.id) || nxt end,
          f.name);
  return nxt;
end $$;

-- restricted_to changes only through set_field_restriction (new fields may start restricted: a copy of a sheet).
create or replace function fields_restricted_guard() returns trigger language plpgsql as $$
begin
  if new.restricted_to is distinct from old.restricted_to
     and coalesce(current_setting('app.access_op', true), '') <> 'on' then
    raise exception 'access: Restrict a field from its settings.';
  end if;
  return new;
end $$;
create trigger fields_restricted_guard before update on fields
  for each row execute function fields_restricted_guard();

-- ───────────────────────── writing values ─────────────────────────
-- set_item_values (0023) with restricted fields: their value lives in restricted_values (old value from there; a
-- cleared value deletes the row).
create or replace function set_item_values(p_item uuid, p_patch jsonb, p_name text default null,
                                           p_automation uuid default null, p_note text default null)
returns items language plpgsql security definer set search_path = public as $$
declare it items; f fields; k text; old_v jsonb; new_v jsonb; par items; sf fields; settings jsonb; open text[];
        label text; listed text; before jsonb;
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
  perform _need_sheet(it.sheet_id, 'editor');
  before := it."values";
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
    new_v := p_patch -> k;
    if new_v = 'null'::jsonb then new_v := null; end if;
    if f.restricted_to is not null then
      select value into old_v from restricted_values where item_id = it.id and field_id = f.id;
      if new_v is null then
        delete from restricted_values where item_id = it.id and field_id = f.id;
      elsif old_v is distinct from new_v then
        insert into restricted_values(org_id, sheet_id, item_id, field_id, value)
        values (it.org_id, it.sheet_id, it.id, f.id, new_v)
        on conflict (item_id, field_id) do update set value = excluded.value;
      end if;
    else
      old_v := it."values" -> k;
      if new_v is null then
        it."values" := it."values" - k;
      else
        it."values" := jsonb_set(it."values", array[k], new_v, true);
      end if;
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
  if _document_register(it.sheet_id) then
    it := _document_transition(it, before, p_automation, p_note);
  end if;
  update items set name = it.name, "values" = it."values", updated_at = now(), updated_by = auth.uid()
   where id = it.id returning * into it;
  return it;
end $$;

-- Creations log the item's values with its restricted ones (the log masks them): _insert_item (forms, create_item),
-- _create_subitem and create_items. Restricted fields are never on a public form.
create or replace function _insert_item(p_sheet uuid, p_group uuid, p_name text, p_position text, p_values jsonb,
                                        p_actor_kind text, p_actor_id uuid, p_source jsonb)
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
  insert into items(org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by,
                    source_form_id, form_version, source_channel)
  values (s.org_id, p_sheet, p_group, v_seq, s.id_prefix || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0'),
          p_name, coalesce(p_values,'{}'::jsonb), p_position, auth.uid(), auth.uid(),
          (p_source->>'form_id')::uuid, (p_source->>'form_version')::int, p_source->>'channel')
  returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (it.org_id, it.sheet_id, it.id, '', p_actor_kind, p_actor_id, 'item.created',
          jsonb_build_object('name', it.name, 'group_id', it.group_id, 'values', _full_values(it.id, it."values"))
          || case when p_source is null then '{}'::jsonb else jsonb_build_object('source', jsonb_strip_nulls(p_source)) end);
  return it;
end $$;

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
  update items set next_sub_seq = next_sub_seq + 1 where id = par.id returning next_sub_seq - 1 into v_sub;
  update sheets set next_seq = next_seq + 1, updated_at = now() where id = c.id returning next_seq - 1 into v_seq;
  insert into items(org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by,
                    parent_id, sub_seq)
  values (c.org_id, c.id, g, v_seq, par.display_id || '.' || v_sub, p_name, coalesce(p_values,'{}'::jsonb),
          p_position, auth.uid(), auth.uid(), par.id, v_sub)
  returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (it.org_id, it.sheet_id, it.id, '', p_actor_kind, p_actor_id, 'item.created',
          jsonb_build_object('name', it.name, 'parent_id', par.id, 'parent', par.display_id,
                             'values', _full_values(it.id, it."values")));
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (par.org_id, par.sheet_id, par.id, '', p_actor_kind, p_actor_id, 'subitem.added',
          jsonb_build_object('id', it.id, 'display_id', it.display_id, 'name', it.name));
  return it;
end $$;

create or replace function create_items(p_sheet uuid, p_group uuid, p_rows jsonb, p_note text default 'CSV import')
returns integer language plpgsql security definer set search_path = public as $$
declare s sheets; n int; first_seq int; bad text;
begin
  select * into s from sheets where id = p_sheet;
  if s.id is null or not can_write(s.org_id, null) then raise exception 'not allowed'; end if;
  if s.archived_at is not null then raise exception 'sheet not found'; end if;
  if not exists (select 1 from groups g where g.id = p_group and g.sheet_id = p_sheet) then raise exception 'group not in sheet'; end if;
  if p_note is null or p_note not in ('CSV import', 'Template import', 'Generated') then raise exception 'bad note'; end if;
  perform _need_sheet(p_sheet, 'editor');
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

  -- the log takes the values as given (restricted ones included: the log masks them), the rows lose restricted keys
  with ins as (
    insert into items (org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by)
    select s.org_id, p_sheet, p_group, first_seq + r.ord::int - 1,
           s.id_prefix || lpad((first_seq + r.ord::int - 1)::text, greatest(3, length((first_seq + r.ord::int - 1)::text)), '0'),
           r.row->>'name', coalesce(r.row->'values', '{}'::jsonb), r.row->>'position', auth.uid(), auth.uid()
      from jsonb_array_elements(p_rows) with ordinality as r(row, ord)
     order by r.ord
    returning id, org_id, sheet_id, group_id, name, seq
  )
  insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  select ins.org_id, ins.sheet_id, ins.id, '', actor_kind_for(null), auth.uid(), 'item.created',
         jsonb_build_object('name', ins.name, 'group_id', ins.group_id,
                            'values', coalesce(p_rows -> (ins.seq - first_seq) -> 'values', '{}'::jsonb)), p_note
    from ins order by ins.seq;
  return n;
end $$;

-- ───────────────────────── public forms: never a restricted field ─────────────────────────
create or replace function _submit_form(p_view uuid, p_channel text, p_name text, p_values jsonb, p_position text,
                                        p_actor_kind text, p_actor_id uuid, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v views; f jsonb; st text; allowed text[]; k text; g uuid; last_pos text; pos text := p_position;
        vals jsonb := coalesce(p_values, '{}'::jsonb); e jsonb; fid uuid; it items; src jsonb; consent_at timestamptz;
        uid text; title text;
begin
  select * into v from views where id = p_view and type = 'form' for update;
  if v.id is null or not exists (select 1 from sheets where id = v.sheet_id and archived_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  f := coalesce(v.config->'form', '{}'::jsonb);
  st := _form_state(v, p_channel);
  if st <> 'open' then return jsonb_build_object('ok', false, 'reason', st); end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 500
     or jsonb_typeof(vals) <> 'object'
     or pos is null or pos !~ '^[0-9A-Za-z]{1,80}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- only the fields on the form's layout (public: never files, the directory or a restricted field)
  select coalesce(array_agg(fl.id::text), '{}') into allowed
    from jsonb_array_elements(case when jsonb_typeof(f->'fields') = 'array' then f->'fields' else '[]'::jsonb end) q
    join fields fl on fl.sheet_id = v.sheet_id and fl.key = q->>'key' and fl.archived_at is null
   where p_channel <> 'public' or (not (fl.type = any(_public_form_hidden_types())) and fl.restricted_to is null);
  for k in select jsonb_object_keys(vals) loop
    if not (k = any(allowed)) then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  end loop;
  if p_channel = 'public' and f->'notice'->>'legalBasis' = 'consent' then
    if not coalesce(p_consent, false) then return jsonb_build_object('ok', false, 'reason', 'consent_required'); end if;
    consent_at := now();
  end if;
  for e in select x from jsonb_array_elements(case when jsonb_typeof(f->'prefill') = 'array' then f->'prefill'
                                                   else '[]'::jsonb end) x loop
    select id into fid from fields where sheet_id = v.sheet_id and key = e->>'key' and archived_at is null
                                     and not (type = any(non_value_types()));
    if fid is not null and e ? 'value' then vals := vals || jsonb_build_object(fid::text, e->'value'); end if;
  end loop;
  g := (select id from groups where sheet_id = v.sheet_id and id::text = f->>'groupId');
  g := coalesce(g, (select group_id from form_links where view_id = v.id and enabled and group_id is not null limit 1),
                (select id from groups where sheet_id = v.sheet_id order by position collate "C" limit 1));
  select position into last_pos from items where group_id = g and archived_at is null
   order by position collate "C" desc limit 1;
  if last_pos is not null and pos collate "C" <= last_pos collate "C" then pos := last_pos || 'V'; end if;
  src := jsonb_build_object('form_id', v.id, 'form_version', v.form_version, 'channel', p_channel,
                            'notice_version', case when p_channel = 'public' then f->'notice'->'version' end,
                            'consent_at', consent_at);
  it := _insert_item(v.sheet_id, g, btrim(p_name), pos, vals, p_actor_kind, p_actor_id, src);
  -- the people the form notifies (members who can read the item: the notifications guard drops the others)
  title := coalesce(nullif(btrim(f->>'title'), ''), v.name);
  for uid in select jsonb_array_elements_text(case when jsonb_typeof(f->'notify') = 'array' then f->'notify'
                                                   else '[]'::jsonb end) loop
    insert into notifications(org_id, user_id, item_id, kind, body)
    select v.org_id, m.user_id, it.id, 'notify', format('New answer to %s: %s %s', title, it.display_id, it.name)
      from memberships m where m.org_id = v.org_id and m.user_id::text = uid;
  end loop;
  return jsonb_build_object('ok', true, 'id', it.id, 'display_id', it.display_id, 'sheet_id', it.sheet_id,
                            'org_id', it.org_id, 'form_version', v.form_version);
end $$;

-- An internal form: editors (as before) who can edit the sheet.
create or replace function submit_internal_form(p_view uuid, p_name text, p_values jsonb, p_position text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o uuid; s uuid;
begin
  select org_id, sheet_id into o, s from views where id = p_view and type = 'form';
  if o is null or not is_member(o) or _sheet_level_for(auth.uid(), s) = 'none' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not is_editor(o) then raise exception 'not allowed'; end if;
  perform _need_sheet(s, 'editor');
  return _submit_form(p_view, 'internal', p_name, p_values, p_position, 'user', auth.uid(), false);
end $$;

create or replace function get_public_form(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare fl form_links; s sheets; v views; f jsonb; st text; g uuid; keys text[]; title text;
begin
  select * into fl from form_links where token = p_token and enabled;
  if fl.id is null then return null; end if;
  select * into s from sheets where id = fl.sheet_id and archived_at is null;
  if s.id is null then return null; end if;
  select * into v from views where id = fl.view_id and type = 'form';
  if v.id is null then return null; end if;
  f := coalesce(v.config->'form', '{}'::jsonb);
  st := _form_state(v, 'public');
  title := coalesce(nullif(btrim(f->>'title'), ''), v.name, s.name);
  if st <> 'open' then
    return jsonb_build_object('state', st, 'viewId', v.id, 'title', title,
                              'opensAt', case when st = 'scheduled' then f->>'opensAt' end,
                              'timeZone', (select time_zone from orgs where id = s.org_id));
  end if;
  select coalesce(array_agg(e->>'key'), '{}') into keys
    from jsonb_array_elements(case when jsonb_typeof(f->'fields') = 'array' then f->'fields' else '[]'::jsonb end) e;
  g := coalesce((select id from groups where sheet_id = s.id and id::text = f->>'groupId'), fl.group_id,
                (select id from groups where sheet_id = s.id order by position collate "C" limit 1));
  return jsonb_build_object(
    'state', 'open',
    'title', title,
    'sheet', jsonb_build_object('id', s.id, 'name', s.name, 'itemLabel', s.item_label, 'idPrefix', s.id_prefix,
                                'timeZone', (select time_zone from orgs where id = s.org_id)),
    'controller', (select name from orgs where id = s.org_id),
    'viewId', v.id,
    'formVersion', v.form_version,
    'form', jsonb_strip_nulls(jsonb_build_object('title', f->'title', 'description', f->'description',
                                                 'nameLabel', f->'nameLabel', 'fields', coalesce(f->'fields', '[]'),
                                                 'confirmation', f->'confirmation', 'access', 'public',
                                                 'status', 'open')),
    'notice', jsonb_strip_nulls(jsonb_build_object('purpose', f->'notice'->'purpose',
                                'legalBasis', f->'notice'->'legalBasis', 'recipients', f->'notice'->'recipients',
                                'retention', f->'notice'->'retention', 'rights', f->'notice'->'rights',
                                'url', f->'notice'->'url', 'version', f->'notice'->'version')),
    'fields', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', fd.id, 'key', fd.key, 'name', fd.name, 'type', fd.type, 'position', fd.position,
                          'required', fd.required, 'description', fd.description, 'config', fd.config,
                          'validation', fd.validation) order by fd.position collate "C")
                        from fields fd
                       where fd.sheet_id = s.id and fd.archived_at is null and fd.key = any(keys)
                         and not (fd.type = any(_public_form_hidden_types())) and fd.restricted_to is null), '[]'::jsonb),
    'lastPosition', (select position from items where group_id = g and archived_at is null
                      order by position collate "C" desc limit 1));
end $$;

-- ───────────────────────── grants ─────────────────────────
revoke all on function _field_visible_for(uuid, uuid, jsonb), _full_values(uuid, jsonb), _mask_value(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function restricted_activity_append_only(), restricted_values_guard(), items_restricted_split(),
  activity_a_mask(), fields_restricted_guard() from public, anon, authenticated;
revoke all on function hidden_field_ids(), hidden_field_keys(), field_visible(uuid), activity_value_masked(jsonb),
  field_hidden(fields), set_field_restriction(uuid, boolean, uuid[], text[]) from public, anon;
grant execute on function hidden_field_ids(), hidden_field_keys(), field_visible(uuid), activity_value_masked(jsonb),
  field_hidden(fields), set_field_restriction(uuid, boolean, uuid[], text[]) to authenticated;
grant execute on function hidden_field_ids(), field_visible(uuid), field_hidden(fields) to service_role;
