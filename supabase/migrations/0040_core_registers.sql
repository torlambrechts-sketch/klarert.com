-- 0040_core_registers.sql · Core registers and extends (docs/11 Extends and Core registers, docs/02 §15).
-- A pack may add to the sheets of a pack it requires (an add-on to the Core registers): columns, groups, views,
-- forms, example items, automations and options of existing option fields. Every row it adds is its own (its
-- provenance and ref map), so upgrade and archive stay per pack. This migration:
--   · folders.domain: the domain folders of shared registers (Registers in the side menu);
--   · fields.system: system columns (the Core registers' and what add-ons add to them): they can be hidden and
--     renamed, never deleted, retyped or re-keyed, except by a pack's install, upgrade or archive;
--   · field keys are unique among a sheet's live fields (an archived add-on's column keeps its key, and installing
--     the add-on again adds a new column);
--   · install_pack and upgrade_pack accept rows on live sheets of packs the manifest requires and merge options
--     into those sheets' option fields by id (`options`, ref map `option:<ref>` → the field);
--   · archive_pack refuses a pack another live install builds on, and archives an add-on's own columns, removes its
--     views and empty groups and its standard's option from the shared sheets; items and the log are never touched.

-- ───────────────────────── columns ─────────────────────────
alter table folders add column domain text
  check (domain is null or domain ~ '^[a-z][a-z0-9_-]{0,39}$');
alter table fields add column system boolean not null default false;

alter table fields drop constraint fields_sheet_id_key_key;
create unique index fields_sheet_key_live on fields(sheet_id, key) where archived_at is null;

-- System columns: only a pack's install, upgrade or archive makes, archives or changes the type or key of one.
create or replace function fields_system_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.pack_op', true), '') in ('install', 'upgrade', 'archive') then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.system then raise exception 'a system column is made only by a pack'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- a sheet or workspace being deleted takes its columns with it
    if old.system and pg_trigger_depth() = 1
       and exists (select 1 from sheets s where s.id = old.sheet_id) then
      raise exception 'a system column cannot be deleted: hide it in a view';
    end if;
    return old;
  end if;
  if old.system then
    if new.system is distinct from old.system then raise exception 'a system column stays a system column'; end if;
    if new.key is distinct from old.key then raise exception 'a system column keeps its key'; end if;
    if new.type is distinct from old.type then raise exception 'a system column keeps its type'; end if;
    if new.archived_at is not null and old.archived_at is null then
      raise exception 'a system column cannot be deleted: hide it in a view';
    end if;
  elsif new.system then
    raise exception 'a system column is made only by a pack';
  end if;
  return new;
end $$;
revoke all on function fields_system_guard() from public, anon, authenticated;
create trigger fields_system_guard before insert or update or delete on fields
  for each row execute function fields_system_guard();

-- ───────────────────────── helpers (never granted) ─────────────────────────
-- A live top-level sheet of a live install, in the workspace, of a pack the manifest requires.
create or replace function _pack_extend_target(p_org uuid, p_manifest jsonb, p_sheet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sheets s join pack_installs pi on pi.id = s.pack_install_id
     where s.id = p_sheet and s.org_id = p_org and s.archived_at is null and s.parent_sheet_id is null
       and pi.org_id = p_org and pi.status = 'installed'
       and pi.pack_key in (select r->>'pack' from jsonb_array_elements(coalesce(p_manifest->'requires', '[]')) r))
$$;
revoke all on function _pack_extend_target(uuid, jsonb, uuid) from public, anon, authenticated;

-- A plan row's sheet: one of the plan's sheets or an extend target.
create or replace function _pack_row_sheet_ok(p_org uuid, p_manifest jsonb, p_sheets uuid[], p_row jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_row->>'sheet_id')::uuid = any(p_sheets) or _pack_extend_target(p_org, p_manifest, (p_row->>'sheet_id')::uuid)
$$;
revoke all on function _pack_row_sheet_ok(uuid, jsonb, uuid[], jsonb) from public, anon, authenticated;

-- Options added to option fields of extend targets: [{ ref, field_id, option: { id, label, color?, done? } }].
-- Merged by id: an option already there is left as it is. Returns how many were added.
create or replace function _pack_add_options(p_org uuid, p_manifest jsonb, p_options jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; f fields; n int := 0;
begin
  for e in select x from jsonb_array_elements(coalesce(p_options, '[]')) x loop
    select * into f from fields where id = (e->>'field_id')::uuid and archived_at is null for update;
    if f.id is null or f.org_id <> p_org or not _pack_extend_target(p_org, p_manifest, f.sheet_id) then
      raise exception 'pack plan: options go into a field of a pack this one requires';
    end if;
    if jsonb_typeof(f.config->'options') <> 'array' then
      raise exception 'pack plan: % has no options', f.name;
    end if;
    if coalesce(e->'option'->>'id', '') !~ '^[a-z][a-z0-9_]{0,39}$'
       or char_length(coalesce(e->'option'->>'label', '')) not between 1 and 80 then
      raise exception 'pack plan: an option needs an id and a label';
    end if;
    if exists (select 1 from jsonb_array_elements(f.config->'options') o where o->>'id' = e->'option'->>'id') then
      continue;
    end if;
    update fields set config = jsonb_set(config, '{options}', (config->'options') || jsonb_build_array(
             jsonb_strip_nulls(jsonb_build_object('id', e->'option'->>'id', 'label', e->'option'->>'label',
               'color', e->'option'->>'color', 'done', (e->'option'->>'done')::boolean)))),
           updated_at = now()
     where id = f.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function _pack_add_options(uuid, jsonb, jsonb) from public, anon, authenticated;

create or replace function install_pack(p_org uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pk packs; inst uuid := gen_random_uuid(); refs jsonb; counts jsonb; bad text; s record; n int; first_seq int;
  v_actor text := case when auth.uid() is null then 'system' else 'user' end;
  plan_sheets uuid[]; plan_fields uuid[]; plan_items uuid[]; plan_groups uuid[]; plan_folders uuid[];
  v_level text := nullif(p_plan->'pack'->>'level', ''); v_extend uuid := nullif(p_plan->>'extend_install', '')::uuid;
  live pack_installs; v_level_name text;
begin
  if not (is_admin(p_org) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not allowed: only owners and admins install packs';
  end if;
  if not exists (select 1 from orgs where id = p_org) then raise exception 'workspace not found'; end if;
  select * into pk from packs where key = p_plan->'pack'->>'key' and version = p_plan->'pack'->>'version';
  if pk.key is null then raise exception 'pack not found'; end if;
  if pk.hash is distinct from p_plan->'pack'->>'hash' then
    raise exception 'pack changed: preview it again';
  end if;
  -- a level (docs/11 Levels) is one of the manifest's
  if v_level is not null then
    select l->>'name' into v_level_name from jsonb_array_elements(coalesce(pk.manifest->'levels', '[]')) l
     where l->>'key' = v_level;
    if v_level_name is null then raise exception 'pack plan: unknown level %', v_level; end if;
  end if;
  if v_extend is null then
    if exists (select 1 from pack_installs where org_id = p_org and pack_key = pk.key and status = 'installed') then
      raise exception 'pack already installed';
    end if;
  else
    -- a higher level joins the live install of the same version; nothing it already made is written again
    select * into live from pack_installs where id = v_extend for update;
    if live.id is null or live.org_id <> p_org or live.status <> 'installed' or live.pack_key <> pk.key
       or live.version <> pk.version then
      raise exception 'pack plan: the install to extend is not this pack''s live install';
    end if;
    if v_level is null or v_level = coalesce(live.level, '') then
      raise exception 'pack plan: this level is installed already';
    end if;
    inst := live.id;
  end if;

  -- refs: one per kind, unique within the plan
  select string_agg(kind || ':' || coalesce(r, '?'), ', ') into bad from (
    select kind, r from (
      select 'folder' kind, e->>'ref' r from jsonb_array_elements(coalesce(p_plan->'folders', '[]')) e
      union all select 'sheet', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'sheets', '[]')) e
      union all select 'field', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e
      union all select 'group', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e
      union all select 'view', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'views', '[]')) e
      union all select 'item', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e
      union all select 'automation', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'automations', '[]')) e
      union all select 'dashboard', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'dashboards', '[]')) e
      union all select 'option', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'options', '[]')) e) x
     group by kind, r having count(*) > 1 or r is null or r = '') d;
  if bad is not null then raise exception 'pack plan: refs missing or repeated (%)', bad; end if;

  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_sheets from jsonb_array_elements(coalesce(p_plan->'sheets', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_fields from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_groups from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_items from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_folders from jsonb_array_elements(coalesce(p_plan->'folders', '[]')) e;

  -- the ref → id map, kept on the install for later upgrades
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into refs from (
    select 'folder:' || (e->>'ref') k, e->'id' v from jsonb_array_elements(coalesce(p_plan->'folders', '[]')) e
    union all select 'sheet:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'sheets', '[]')) e
    union all select 'field:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e
    union all select 'group:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e
    union all select 'view:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'views', '[]')) e
    union all select 'item:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e
    union all select 'automation:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'automations', '[]')) e
    union all select 'dashboard:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'dashboards', '[]')) e
    union all select 'option:' || (e->>'ref'), e->'field_id' from jsonb_array_elements(coalesce(p_plan->'options', '[]')) e) m;

  if live.id is null then
    insert into pack_installs (id, org_id, pack_key, version, installed_by, manifest_hash, ref_map, level)
    values (inst, p_org, pk.key, pk.version, auth.uid(), pk.hash, refs, v_level);
  else
    select string_agg(k, ', ') into bad from jsonb_object_keys(refs) k where live.ref_map ? k;
    if bad is not null then raise exception 'pack plan: refs already installed (%)', bad; end if;
    update pack_installs set ref_map = ref_map || refs, level = v_level where id = inst;
  end if;
  perform set_config('app.pack_op', 'install', true);

  -- folders
  insert into folders (id, org_id, name, position, restricted, domain, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, e->>'name', e->>'position', coalesce((e->>'restricted')::boolean, false),
         nullif(e->>'domain', ''), inst, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'folders', '[]')) e;

  -- sheets: parents first (a sub-item sheet names its parent); a folder is one of the workspace's
  for s in select e from jsonb_array_elements(coalesce(p_plan->'sheets', '[]')) e
            order by (e->>'parent_sheet_id') is not null loop
    if s.e->>'folder_id' is not null
       and not exists (select 1 from folders f where f.id = (s.e->>'folder_id')::uuid and f.org_id = p_org) then
      raise exception 'pack plan: folder not in workspace';
    end if;
    if s.e->>'parent_sheet_id' is not null and not ((s.e->>'parent_sheet_id')::uuid = any(plan_sheets)) then
      raise exception 'pack plan: a sub-item sheet''s parent must be in the plan';
    end if;
    insert into sheets (id, org_id, folder_id, name, description, item_label, id_prefix, is_library, settings, position,
                        created_by, parent_sheet_id, restricted, access_inherit, pack_install_id, pack_ref, pack_hash)
    values ((s.e->>'id')::uuid, p_org, (s.e->>'folder_id')::uuid, s.e->>'name', nullif(s.e->>'description', ''),
            coalesce(s.e->>'item_label', 'Item'), s.e->>'id_prefix', coalesce((s.e->>'is_library')::boolean, false),
            coalesce(s.e->'settings', '{}'::jsonb), s.e->>'position', auth.uid(), (s.e->>'parent_sheet_id')::uuid,
            coalesce((s.e->>'restricted')::boolean, false), not coalesce((s.e->>'restricted')::boolean, false),
            inst, s.e->>'ref', _pack_hash(s.e));
  end loop;

  -- restricted folders and sheets (docs/02 §16): the installer is listed as an editor, logged like any grant
  if auth.uid() is not null then
    insert into access_grants (org_id, folder_id, user_id, level, granted_by)
    select p_org, fo.id, auth.uid(), 'editor', auth.uid() from folders fo
     where fo.pack_install_id = inst and fo.restricted and fo.id = any(plan_folders);
    insert into access_grants (org_id, sheet_id, user_id, level, granted_by)
    select p_org, sh.id, auth.uid(), 'editor', auth.uid() from sheets sh
     where sh.pack_install_id = inst and sh.restricted and not sh.access_inherit and sh.id = any(plan_sheets);
    insert into activity_log (org_id, sheet_id, chain_key, actor_kind, actor_id, action, new_value, note)
    select p_org, g.sheet_id, '', 'user', auth.uid(),
           case when g.folder_id is not null then 'folder.access.granted' else 'access.granted' end,
           jsonb_build_object('user_id', g.user_id, 'level', g.level, 'folder_id', g.folder_id),
           _member_name(g.user_id) || ': editor on ' || coalesce(sh.name, fo.name) || ' (pack install)'
      from access_grants g left join sheets sh on sh.id = g.sheet_id left join folders fo on fo.id = g.folder_id
     where (sh.id = any(plan_sheets) or fo.id = any(plan_folders));
    perform _access_changed();
  end if;

  -- groups, fields, views, items and automations of the plan's sheets, or of a live sheet of a pack the manifest
  -- requires (0040, docs/11 Extends: what an add-on adds to the Core registers)
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e where not _pack_row_sheet_ok(p_org, pk.manifest, plan_sheets, e))
     or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e where not _pack_row_sheet_ok(p_org, pk.manifest, plan_sheets, e))
     or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'views', '[]')) e where not _pack_row_sheet_ok(p_org, pk.manifest, plan_sheets, e))
     or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e where not _pack_row_sheet_ok(p_org, pk.manifest, plan_sheets, e)
                  or not ((e->>'group_id')::uuid = any(plan_groups)
                          or exists (select 1 from groups g where g.id = (e->>'group_id')::uuid
                                        and g.sheet_id = (e->>'sheet_id')::uuid and not (g.sheet_id = any(plan_sheets)))))
     or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'automations', '[]')) e where not _pack_row_sheet_ok(p_org, pk.manifest, plan_sheets, e)) then
    raise exception 'pack plan: rows must belong to the plan''s sheets';
  end if;

  insert into groups (id, org_id, sheet_id, name, color, position, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, (e->>'sheet_id')::uuid, e->>'name', coalesce(e->>'color', 'blue'), e->>'position',
         inst, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e;

  insert into fields (id, org_id, sheet_id, key, name, type, position, width, required, locked, description, config,
                      rules, visibility, system, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, (e->>'sheet_id')::uuid, e->>'key', e->>'name', e->>'type', e->>'position',
         (e->>'width')::int, coalesce((e->>'required')::boolean, false), coalesce((e->>'locked')::boolean, false),
         e->>'description', coalesce(e->'config', '{}'::jsonb), coalesce(e->'rules', '[]'::jsonb),
         nullif(e->'visibility', 'null'::jsonb), coalesce((e->>'system')::boolean, false), inst, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e;
  -- options added to option fields of a required pack's sheets, merged by id (0040)
  perform _pack_add_options(p_org, pk.manifest, coalesce(p_plan->'options', '[]'));
  -- link fields point at sheets of this workspace
  if exists (select 1 from fields f where f.pack_install_id = inst and f.config ? 'targetSheetId'
               and nullif(f.config->>'targetSheetId', '') is not null
               and not exists (select 1 from sheets t where t.id::text = f.config->>'targetSheetId' and t.org_id = p_org)) then
    raise exception 'pack plan: a link field points outside the workspace';
  end if;

  insert into views (id, org_id, sheet_id, name, type, config, owner_id, position, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, (e->>'sheet_id')::uuid, e->>'name', e->>'type', coalesce(e->'config', '{}'::jsonb),
         null, e->>'position', inst, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'views', '[]')) e;

  -- example items, per sheet in plan order, numbered like create_items; each logged on its own chain
  for s in select e->>'sheet_id' sid, count(*) cnt from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e
            group by e->>'sheet_id' loop
    if exists (select 1 from sheets where id = s.sid::uuid and parent_sheet_id is not null) then
      raise exception 'pack plan: sub-items come from the sub-item template, not example items';
    end if;
    update sheets set next_seq = next_seq + s.cnt::int, updated_at = now() where id = s.sid::uuid
      returning next_seq - s.cnt::int into first_seq;
    insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by,
                       pack_install_id, pack_ref, pack_hash)
    select (r.e->>'id')::uuid, p_org, s.sid::uuid, (r.e->>'group_id')::uuid, first_seq + r.ord::int - 1,
           sh.id_prefix || lpad((first_seq + r.ord::int - 1)::text, greatest(3, length((first_seq + r.ord::int - 1)::text)), '0'),
           r.e->>'name', coalesce(r.e->'values', '{}'::jsonb), r.e->>'position', auth.uid(), auth.uid(),
           inst, r.e->>'ref', _pack_hash(r.e)
      from (select a.e, row_number() over (order by a.idx) ord
              from jsonb_array_elements(p_plan->'items') with ordinality as a(e, idx)
             where a.e->>'sheet_id' = s.sid) r, sheets sh
     where sh.id = s.sid::uuid;
  end loop;
  select string_agg(k, ', ') into bad from (
    select distinct k from items i, jsonb_object_keys(i."values") k
     where i.pack_install_id = inst
       and not exists (select 1 from fields f where f.sheet_id = i.sheet_id and f.id::text = k and f.archived_at is null
                         and not (f.type = any(non_value_types())))) x;
  if bad is not null then raise exception 'pack plan: fields % cannot hold a value', bad; end if;
  insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  select i.org_id, i.sheet_id, i.id, '', v_actor, auth.uid(), 'item.created',
         jsonb_build_object('name', i.name, 'group_id', i.group_id, 'values', i."values"), 'Pack install'
    from items i where i.pack_install_id = inst and i.id = any(plan_items) order by i.sheet_id, i.seq;

  -- links between the plan's items, through the plan's link fields; one link.changed entry per field and item
  -- (0033) or, through a requirement or control link field, a live item of one of the workspace's library sheets
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'links', '[]')) e
              where not ((e->>'field_id')::uuid = any(plan_fields)
                         -- a link field of a required pack's sheet, from an item this plan adds there (0040)
                         or exists (select 1 from fields x where x.id = (e->>'field_id')::uuid
                                     and _pack_extend_target(p_org, pk.manifest, x.sheet_id)))
                 or not ((e->>'from_item')::uuid = any(plan_items))
                 or not ((e->>'to_item')::uuid = any(plan_items)
                         or exists (select 1 from items x where x.id = (e->>'to_item')::uuid and x.pack_install_id = inst)
                         or exists (select 1 from items x join sheets t on t.id = x.sheet_id
                                     where x.id = (e->>'to_item')::uuid and x.org_id = p_org and x.archived_at is null
                                       and t.is_library and t.archived_at is null
                                       and exists (select 1 from jsonb_array_elements(p_plan->'fields') pf
                                                    where pf->>'id' = e->>'field_id'
                                                      and pf->>'type' in ('requirement', 'controllink'))))) then
    raise exception 'pack plan: links must join the plan''s items';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'links', '[]')) e
               join fields f on f.id = (e->>'field_id')::uuid
               join items a on a.id = (e->>'from_item')::uuid
               join items b on b.id = (e->>'to_item')::uuid
              where f.type not in ('link', 'requirement', 'controllink') or a.sheet_id <> f.sheet_id
                 or b.sheet_id::text <> coalesce(nullif(f.config->>'targetSheetId', ''), b.sheet_id::text)) then
    raise exception 'pack plan: link target not allowed';
  end if;
  insert into item_links (org_id, field_id, from_item, to_item)
  select distinct p_org, (e->>'field_id')::uuid, (e->>'from_item')::uuid, (e->>'to_item')::uuid
    from jsonb_array_elements(coalesce(p_plan->'links', '[]')) e
  on conflict do nothing;
  insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value)
  select it.org_id, it.sheet_id, it.id, '', v_actor, auth.uid(), 'link.changed', l.field_id, '[]'::jsonb,
         to_jsonb(array_agg(l.to_item order by l.position, l.to_item))
    from item_links l join items it on it.id = l.from_item
   where it.pack_install_id = inst
     and (l.field_id = any(plan_fields)
          or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'links', '[]')) e
                      where (e->>'from_item')::uuid = l.from_item and (e->>'field_id')::uuid = l.field_id))
   group by it.org_id, it.sheet_id, it.id, l.field_id;

  -- automations (as the installer), each with its stable ref; actions may only name sheets of the workspace
  insert into automations (id, org_id, sheet_id, name, enabled, trigger, conditions, actions, source, version,
                           created_by, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, (e->>'sheet_id')::uuid, e->>'name', coalesce((e->>'enabled')::boolean, true),
         e->'trigger', coalesce(e->'conditions', '[]'::jsonb), e->'actions', 'pack:' || pk.key, 1, auth.uid(),
         inst, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'automations', '[]')) e;
  if exists (select 1 from automations a, jsonb_array_elements(a.actions) x
              where a.pack_install_id = inst and nullif(x->>'sheetId', '') is not null
                and not exists (select 1 from sheets t where t.id::text = x->>'sheetId' and t.org_id = p_org)) then
    raise exception 'pack plan: an automation names a sheet outside the workspace';
  end if;

  -- dashboards: widgets name sheets of the workspace
  insert into dashboards (id, org_id, name, position, config, created_by, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, e->>'name', e->>'position', e->'config', auth.uid(), inst, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'dashboards', '[]')) e;
  if exists (select 1 from dashboards d, jsonb_array_elements(d.config->'widgets') w
              where d.pack_install_id = inst and nullif(w->>'sheetId', '') is not null
                and not exists (select 1 from sheets t where t.id::text = w->>'sheetId' and t.org_id = p_org)) then
    raise exception 'pack plan: a dashboard names a sheet outside the workspace';
  end if;

  counts := jsonb_build_object(
    'folders', (select count(*) from folders where pack_install_id = inst),
    'sheets', (select count(*) from sheets where pack_install_id = inst and parent_sheet_id is null),
    'fields', (select count(*) from fields where pack_install_id = inst),
    'groups', (select count(*) from groups where pack_install_id = inst),
    'views', (select count(*) from views where pack_install_id = inst and type <> 'form'),
    'forms', (select count(*) from views where pack_install_id = inst and type = 'form'),
    'items', (select count(*) from items where pack_install_id = inst),
    'links', (select count(*) from item_links l join fields f on f.id = l.field_id where f.pack_install_id = inst),
    'automations', (select count(*) from automations where pack_install_id = inst),
    'dashboards', (select count(*) from dashboards where pack_install_id = inst));

  if live.id is not null then
    -- what this level added, not the whole install
    counts := jsonb_build_object(
      'folders', cardinality(plan_folders),
      'sheets', (select count(*) from sheets where id = any(plan_sheets) and parent_sheet_id is null),
      'fields', cardinality(plan_fields),
      'groups', cardinality(plan_groups),
      'views', (select count(*) from jsonb_array_elements(coalesce(p_plan->'views', '[]')) e where e->>'type' <> 'form'),
      'forms', (select count(*) from jsonb_array_elements(coalesce(p_plan->'views', '[]')) e where e->>'type' = 'form'),
      'items', cardinality(plan_items),
      'links', jsonb_array_length(coalesce(p_plan->'links', '[]')),
      'automations', jsonb_array_length(coalesce(p_plan->'automations', '[]')),
      'dashboards', jsonb_array_length(coalesce(p_plan->'dashboards', '[]')));
  end if;
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', v_actor, auth.uid(), case when live.id is null then 'pack.installed' else 'pack.extended' end,
          jsonb_build_object('install_id', inst, 'pack_key', pk.key, 'version', pk.version, 'title', pk.title,
                             'manifest_hash', pk.hash, 'counts', counts, 'level', v_level, 'level_name', v_level_name,
                             'from_level', live.level));
  perform set_config('app.pack_op', '', true);
  return jsonb_build_object('install_id', inst, 'ref_map', refs, 'counts', counts);
end $$;

create or replace function upgrade_pack(p_install uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i pack_installs; pk packs; refs jsonb; bad text; s record; ue jsonb; it items; f fields; vk text;
  old_v jsonb; new_v jsonb; first_seq int; v_org uuid; counts jsonb; v_at timestamptz := now();
  add_folders uuid[]; add_sheets uuid[]; add_fields uuid[]; add_groups uuid[]; add_items uuid[];
  n_changed int := 0; n int; n_items_changed int := 0; n_archived int := 0; n_disabled int := 0;
  v_actor text := case when auth.uid() is null then 'system' else 'user' end;
begin
  select * into i from pack_installs where id = p_install for update;
  if i.id is null or not is_member(i.org_id) then raise exception 'pack install not found'; end if;
  if not is_admin(i.org_id) then raise exception 'not allowed: only owners and admins update packs'; end if;
  if i.status <> 'installed' then raise exception 'pack install archived'; end if;
  v_org := i.org_id;
  if p_plan->>'install' is distinct from i.id::text or p_plan->'pack'->>'key' is distinct from i.pack_key then
    raise exception 'upgrade plan: not this install';
  end if;
  -- the plan was made against the version installed now, and the catalogue's version is the one previewed
  if p_plan->'pack'->>'from_version' is distinct from i.version
     or p_plan->'pack'->>'from_hash' is distinct from i.manifest_hash then
    raise exception 'pack changed: preview the update again';
  end if;
  select * into pk from packs where key = i.pack_key and version = p_plan->'pack'->>'version';
  if pk.key is null then raise exception 'pack version not found'; end if;
  if pk.hash is distinct from p_plan->'pack'->>'hash' then raise exception 'pack changed: preview the update again'; end if;
  if string_to_array(pk.version, '.')::int[] <= string_to_array(i.version, '.')::int[] then
    raise exception 'upgrade plan: % is not newer than %', pk.version, i.version;
  end if;

  -- ── every row the plan updates, archives or turns off is this install's own
  select string_agg(t || ' ' || id, ', ') into bad from (
    select 'folder' t, e->>'id' id from jsonb_array_elements(coalesce(p_plan->'update'->'folders', '[]')) e
     where not exists (select 1 from folders x where x.id::text = e->>'id' and x.pack_install_id = i.id)
    union all select 'sheet', e->>'id' from jsonb_array_elements(coalesce(p_plan->'update'->'sheets', '[]')) e
     where not exists (select 1 from sheets x where x.id::text = e->>'id' and x.pack_install_id = i.id)
    union all select 'field', e->>'id' from jsonb_array_elements(coalesce(p_plan->'update'->'fields', '[]')) e
     where not exists (select 1 from fields x where x.id::text = e->>'id' and x.pack_install_id = i.id)
    union all select 'group', e->>'id' from jsonb_array_elements(coalesce(p_plan->'update'->'groups', '[]')) e
     where not exists (select 1 from groups x where x.id::text = e->>'id' and x.pack_install_id = i.id)
    union all select 'view', e->>'id' from jsonb_array_elements(coalesce(p_plan->'update'->'views', '[]')) e
     where not exists (select 1 from views x where x.id::text = e->>'id' and x.pack_install_id = i.id)
    union all select 'item', e->>'id' from jsonb_array_elements(coalesce(p_plan->'update'->'items', '[]')) e
     where not exists (select 1 from items x where x.id::text = e->>'id' and x.pack_install_id = i.id)
    union all select 'automation', e->>'id' from jsonb_array_elements(coalesce(p_plan->'update'->'automations', '[]')) e
     where not exists (select 1 from automations x where x.id::text = e->>'id' and x.pack_install_id = i.id)
    union all select 'dashboard', e->>'id' from jsonb_array_elements(coalesce(p_plan->'update'->'dashboards', '[]')) e
     where not exists (select 1 from dashboards x where x.id::text = e->>'id' and x.pack_install_id = i.id)
    union all select 'folder', a from jsonb_array_elements_text(coalesce(p_plan->'archive'->'folders', '[]')) a
     where not exists (select 1 from folders x where x.id::text = a and x.pack_install_id = i.id)
    union all select 'sheet', a from jsonb_array_elements_text(coalesce(p_plan->'archive'->'sheets', '[]')) a
     where not exists (select 1 from sheets x where x.id::text = a and x.pack_install_id = i.id and x.parent_sheet_id is null)
    union all select 'item', a from jsonb_array_elements_text(coalesce(p_plan->'archive'->'items', '[]')) a
     where not exists (select 1 from items x where x.id::text = a and x.pack_install_id = i.id and x.requirement_ref is null)
    union all select 'dashboard', a from jsonb_array_elements_text(coalesce(p_plan->'archive'->'dashboards', '[]')) a
     where not exists (select 1 from dashboards x where x.id::text = a and x.pack_install_id = i.id)
    union all select 'automation', a from jsonb_array_elements_text(coalesce(p_plan->'disable'->'automations', '[]')) a
     where not exists (select 1 from automations x where x.id::text = a and x.pack_install_id = i.id)) x;
  if bad is not null then raise exception 'upgrade plan: not rows of this install (%)', left(bad, 300); end if;

  -- ── refs of the added rows: unique, and new to the install
  select string_agg(kind || ':' || coalesce(r, '?'), ', ') into bad from (
    select kind, r from (
      select 'folder' kind, e->>'ref' r from jsonb_array_elements(coalesce(p_plan->'add'->'folders', '[]')) e
      union all select 'sheet', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'add'->'sheets', '[]')) e
      union all select 'field', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'add'->'fields', '[]')) e
      union all select 'group', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'add'->'groups', '[]')) e
      union all select 'view', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'add'->'views', '[]')) e
      union all select 'item', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'add'->'items', '[]')) e
      union all select 'automation', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'add'->'automations', '[]')) e
      union all select 'dashboard', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'add'->'dashboards', '[]')) e
      union all select 'option', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'add'->'options', '[]')) e) x
     group by kind, r having count(*) > 1 or r is null or r = '' or i.ref_map ? (kind || ':' || r)) d;
  if bad is not null then raise exception 'upgrade plan: refs missing, repeated or installed already (%)', left(bad, 300); end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into refs from (
    select 'folder:' || (e->>'ref') k, e->'id' v from jsonb_array_elements(coalesce(p_plan->'add'->'folders', '[]')) e
    union all select 'sheet:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'add'->'sheets', '[]')) e
    union all select 'field:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'add'->'fields', '[]')) e
    union all select 'group:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'add'->'groups', '[]')) e
    union all select 'view:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'add'->'views', '[]')) e
    union all select 'item:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'add'->'items', '[]')) e
    union all select 'automation:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'add'->'automations', '[]')) e
    union all select 'dashboard:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'add'->'dashboards', '[]')) e
    union all select 'option:' || (e->>'ref'), e->'field_id' from jsonb_array_elements(coalesce(p_plan->'add'->'options', '[]')) e) m;

  select coalesce(array_agg((e->>'id')::uuid), '{}') into add_folders from jsonb_array_elements(coalesce(p_plan->'add'->'folders', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into add_sheets from jsonb_array_elements(coalesce(p_plan->'add'->'sheets', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into add_fields from jsonb_array_elements(coalesce(p_plan->'add'->'fields', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into add_groups from jsonb_array_elements(coalesce(p_plan->'add'->'groups', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into add_items from jsonb_array_elements(coalesce(p_plan->'add'->'items', '[]')) e;

  -- ═════════════ updates: only the columns the plan names ═════════════
  perform set_config('app.pack_op', 'upgrade', true);
  update folders x set name = coalesce(e->>'name', x.name), pack_hash = _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'update'->'folders', '[]')) e where x.id = (e->>'id')::uuid;
  get diagnostics n = row_count; n_changed := n_changed + n;
  update sheets x set name = coalesce(e->>'name', x.name),
         description = case when e ? 'description' then nullif(e->>'description', '') else x.description end,
         item_label = coalesce(e->>'item_label', x.item_label), updated_at = now(), pack_hash = _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'update'->'sheets', '[]')) e where x.id = (e->>'id')::uuid;
  get diagnostics n = row_count; n_changed := n_changed + n;
  -- fields are add-only: never a new type (the plan cannot name one), never an option removed
  select string_agg(x.name, ', ') into bad
    from jsonb_array_elements(coalesce(p_plan->'update'->'fields', '[]')) e join fields x on x.id = (e->>'id')::uuid
   where e ? 'config' and exists (
     select 1 from jsonb_array_elements(case when jsonb_typeof(x.config->'options') = 'array' then x.config->'options' else '[]' end) o
      where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e->'config'->'options') = 'array' then e->'config'->'options' else '[]' end) nw
                         where nw->>'id' = o->>'id'));
  if bad is not null then raise exception 'upgrade plan: options cannot be removed (%)', bad; end if;
  update fields x set name = coalesce(e->>'name', x.name),
         description = case when e ? 'description' then e->>'description' else x.description end,
         required = coalesce((e->>'required')::boolean, x.required),
         locked = coalesce((e->>'locked')::boolean, x.locked),
         config = coalesce(e->'config', x.config), pack_hash = _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'update'->'fields', '[]')) e where x.id = (e->>'id')::uuid;
  get diagnostics n = row_count; n_changed := n_changed + n;
  update groups x set name = coalesce(e->>'name', x.name), color = coalesce(e->>'color', x.color), pack_hash = _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'update'->'groups', '[]')) e where x.id = (e->>'id')::uuid;
  get diagnostics n = row_count; n_changed := n_changed + n;
  update views x set name = coalesce(e->>'name', x.name), config = coalesce(e->'config', x.config), pack_hash = _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'update'->'views', '[]')) e where x.id = (e->>'id')::uuid;
  get diagnostics n = row_count; n_changed := n_changed + n;
  -- automations: what they do; their on/off state stays the client's
  update automations x set name = coalesce(e->>'name', x.name), trigger = coalesce(e->'trigger', x.trigger),
         conditions = coalesce(e->'conditions', x.conditions), actions = coalesce(e->'actions', x.actions),
         version = x.version + case when e ?| array['trigger', 'conditions', 'actions'] then 1 else 0 end,
         pack_hash = _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'update'->'automations', '[]')) e where x.id = (e->>'id')::uuid;
  get diagnostics n = row_count; n_changed := n_changed + n;
  update dashboards x set name = coalesce(e->>'name', x.name), config = coalesce(e->'config', x.config), pack_hash = _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'update'->'dashboards', '[]')) e where x.id = (e->>'id')::uuid;
  get diagnostics n = row_count; n_changed := n_changed + n;


  -- ═════════════ additions: rows as install_pack writes them, on the same install ═════════════
  perform set_config('app.pack_op', 'upgrade', true);
  insert into folders (id, org_id, name, position, restricted, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, v_org, e->>'name', e->>'position', coalesce((e->>'restricted')::boolean, false),
         i.id, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'add'->'folders', '[]')) e;

  for s in select e from jsonb_array_elements(coalesce(p_plan->'add'->'sheets', '[]')) e
            order by (e->>'parent_sheet_id') is not null loop
    if s.e->>'folder_id' is not null
       and not exists (select 1 from folders x where x.id = (s.e->>'folder_id')::uuid and x.org_id = v_org) then
      raise exception 'upgrade plan: folder not in workspace';
    end if;
    if s.e->>'parent_sheet_id' is not null and not ((s.e->>'parent_sheet_id')::uuid = any(add_sheets)) then
      raise exception 'upgrade plan: a sub-item sheet''s parent must be added with it';
    end if;
    insert into sheets (id, org_id, folder_id, name, description, item_label, id_prefix, is_library, settings, position,
                        created_by, parent_sheet_id, restricted, access_inherit, pack_install_id, pack_ref, pack_hash)
    values ((s.e->>'id')::uuid, v_org, (s.e->>'folder_id')::uuid, s.e->>'name', nullif(s.e->>'description', ''),
            coalesce(s.e->>'item_label', 'Item'), s.e->>'id_prefix', coalesce((s.e->>'is_library')::boolean, false),
            coalesce(s.e->'settings', '{}'::jsonb), s.e->>'position', auth.uid(), (s.e->>'parent_sheet_id')::uuid,
            coalesce((s.e->>'restricted')::boolean, false), not coalesce((s.e->>'restricted')::boolean, false),
            i.id, s.e->>'ref', _pack_hash(s.e));
  end loop;

  -- restricted folders and sheets (docs/02 §16): the person upgrading is listed as an editor, logged like any grant
  if auth.uid() is not null and (cardinality(add_folders) > 0 or cardinality(add_sheets) > 0) then
    insert into access_grants (org_id, folder_id, user_id, level, granted_by)
    select v_org, fo.id, auth.uid(), 'editor', auth.uid() from folders fo where fo.id = any(add_folders) and fo.restricted;
    insert into access_grants (org_id, sheet_id, user_id, level, granted_by)
    select v_org, sh.id, auth.uid(), 'editor', auth.uid() from sheets sh
     where sh.id = any(add_sheets) and sh.restricted and not sh.access_inherit;
    insert into activity_log (org_id, sheet_id, chain_key, actor_kind, actor_id, action, new_value, note)
    select v_org, g.sheet_id, '', 'user', auth.uid(),
           case when g.folder_id is not null then 'folder.access.granted' else 'access.granted' end,
           jsonb_build_object('user_id', g.user_id, 'level', g.level, 'folder_id', g.folder_id),
           _member_name(g.user_id) || ': editor on ' || coalesce(sh.name, fo.name) || ' (pack update)'
      from access_grants g left join sheets sh on sh.id = g.sheet_id left join folders fo on fo.id = g.folder_id
     where (sh.id = any(add_sheets) or fo.id = any(add_folders));
    perform _access_changed();
  end if;

  -- groups, fields, views, items and automations belong to an added sheet or to one of the install's sheets
  if exists (select 1 from (
       select e->>'sheet_id' sid from jsonb_array_elements(coalesce(p_plan->'add'->'groups', '[]')) e
       union all select e->>'sheet_id' from jsonb_array_elements(coalesce(p_plan->'add'->'fields', '[]')) e
       union all select e->>'sheet_id' from jsonb_array_elements(coalesce(p_plan->'add'->'views', '[]')) e
       union all select e->>'sheet_id' from jsonb_array_elements(coalesce(p_plan->'add'->'items', '[]')) e
       union all select e->>'sheet_id' from jsonb_array_elements(coalesce(p_plan->'add'->'automations', '[]')) e) x
      where not ((x.sid)::uuid = any(add_sheets))
        and not exists (select 1 from sheets sh where sh.id::text = x.sid and sh.pack_install_id = i.id)
        -- or a live sheet of a pack the new version requires (0040, docs/11 Extends)
        and not _pack_extend_target(v_org, pk.manifest, (x.sid)::uuid)) then
    raise exception 'upgrade plan: rows must belong to the install''s sheets';
  end if;

  insert into groups (id, org_id, sheet_id, name, color, position, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, v_org, (e->>'sheet_id')::uuid, e->>'name', coalesce(e->>'color', 'blue'), e->>'position',
         i.id, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'add'->'groups', '[]')) e;

  insert into fields (id, org_id, sheet_id, key, name, type, position, width, required, locked, description, config,
                      rules, visibility, system, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, v_org, (e->>'sheet_id')::uuid, e->>'key', e->>'name', e->>'type', e->>'position',
         (e->>'width')::int, coalesce((e->>'required')::boolean, false), coalesce((e->>'locked')::boolean, false),
         e->>'description', coalesce(e->'config', '{}'::jsonb), coalesce(e->'rules', '[]'::jsonb),
         nullif(e->'visibility', 'null'::jsonb), coalesce((e->>'system')::boolean, false), i.id, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'add'->'fields', '[]')) e;
  -- options new to option fields of a required pack's sheets, merged by id (0040)
  perform _pack_add_options(v_org, pk.manifest, coalesce(p_plan->'add'->'options', '[]'));
  if exists (select 1 from fields x where x.id = any(add_fields) and x.config ? 'targetSheetId'
               and nullif(x.config->>'targetSheetId', '') is not null
               and not exists (select 1 from sheets t where t.id::text = x.config->>'targetSheetId' and t.org_id = v_org)) then
    raise exception 'upgrade plan: a link field points outside the workspace';
  end if;

  insert into views (id, org_id, sheet_id, name, type, config, owner_id, position, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, v_org, (e->>'sheet_id')::uuid, e->>'name', e->>'type', coalesce(e->'config', '{}'::jsonb),
         null, e->>'position', i.id, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'add'->'views', '[]')) e;

  -- items, per sheet in plan order, numbered like create_items, in a group of their own sheet
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'add'->'items', '[]')) e
              where not exists (select 1 from groups g where g.id::text = e->>'group_id' and g.sheet_id::text = e->>'sheet_id')) then
    raise exception 'upgrade plan: an item''s group is not in its sheet';
  end if;
  for s in select e->>'sheet_id' sid, count(*) cnt from jsonb_array_elements(coalesce(p_plan->'add'->'items', '[]')) e
            group by e->>'sheet_id' loop
    if exists (select 1 from sheets where id = s.sid::uuid and parent_sheet_id is not null) then
      raise exception 'upgrade plan: sub-items come from the sub-item template, not example items';
    end if;
    update sheets set next_seq = next_seq + s.cnt::int, updated_at = now() where id = s.sid::uuid
      returning next_seq - s.cnt::int into first_seq;
    insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by,
                       pack_install_id, pack_ref, pack_hash)
    select (r.e->>'id')::uuid, v_org, s.sid::uuid, (r.e->>'group_id')::uuid, first_seq + r.ord::int - 1,
           sh.id_prefix || lpad((first_seq + r.ord::int - 1)::text, greatest(3, length((first_seq + r.ord::int - 1)::text)), '0'),
           r.e->>'name', coalesce(r.e->'values', '{}'::jsonb), r.e->>'position', auth.uid(), auth.uid(),
           i.id, r.e->>'ref', _pack_hash(r.e)
      from (select a.e, row_number() over (order by a.idx) ord
              from jsonb_array_elements(p_plan->'add'->'items') with ordinality as a(e, idx)
             where a.e->>'sheet_id' = s.sid) r, sheets sh
     where sh.id = s.sid::uuid;
  end loop;
  select string_agg(k, ', ') into bad from (
    select distinct k from items x, jsonb_object_keys(x."values") k
     where x.id = any(add_items)
       and not exists (select 1 from fields y where y.sheet_id = x.sheet_id and y.id::text = k and y.archived_at is null
                         and not (y.type = any(non_value_types())))) z;
  if bad is not null then raise exception 'upgrade plan: fields % cannot hold a value', bad; end if;

  -- a library's new requirements get their requirement key (as adopt_framework does): a requirement of the library's
  -- framework, and the item's Ref value
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'add'->'items', '[]')) e
              where nullif(e->>'requirement_ref', '') is not null) then
    perform set_config('app.pack_op', 'adopt', true);
    update items x set requirement_ref = e->>'requirement_ref'
      from jsonb_array_elements(p_plan->'add'->'items') e
     where x.id = (e->>'id')::uuid and x.id = any(add_items) and nullif(e->>'requirement_ref', '') is not null;
    perform set_config('app.pack_op', 'upgrade', true);
    select string_agg(x.requirement_ref, ', ') into bad from items x join sheets sh on sh.id = x.sheet_id
     where x.id = any(add_items) and x.requirement_ref is not null and (
       not sh.is_library
       or not exists (select 1 from requirements r
                       where x.requirement_ref = r.framework_key || '@' || r.framework_version || '#' || r.ref
                         and r.framework_key = sh.settings->'framework'->>'key'
                         and r.framework_version = sh.settings->'framework'->>'version' and r.kind <> 'theme')
       or (x."values" ->> _library_ref_field(sh.id)::text) is distinct from split_part(x.requirement_ref, '#', 2));
    if bad is not null then raise exception 'upgrade plan: not requirements of the library: %', left(bad, 300); end if;
  end if;
  insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  select x.org_id, x.sheet_id, x.id, '', v_actor, auth.uid(), 'item.created',
         jsonb_build_object('name', x.name, 'group_id', x.group_id, 'values', x."values"), 'Pack update'
    from items x where x.id = any(add_items) order by x.sheet_id, x.seq;

  -- links from an added item or through an added field, to an item of the install (or added now) or, through a
  -- requirement or control link field, a live item of one of the workspace's library sheets
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'add'->'links', '[]')) e
              where not ((e->>'from_item')::uuid = any(add_items) or (e->>'field_id')::uuid = any(add_fields))
                 or not ((e->>'field_id')::uuid = any(add_fields)
                         or exists (select 1 from fields x where x.id = (e->>'field_id')::uuid and x.pack_install_id = i.id)
                         or exists (select 1 from fields x where x.id = (e->>'field_id')::uuid
                                     and _pack_extend_target(v_org, pk.manifest, x.sheet_id)))
                 or not ((e->>'from_item')::uuid = any(add_items)
                         or exists (select 1 from items x where x.id = (e->>'from_item')::uuid and x.pack_install_id = i.id))
                 or not ((e->>'to_item')::uuid = any(add_items)
                         or exists (select 1 from items x where x.id = (e->>'to_item')::uuid and x.pack_install_id = i.id)
                         or exists (select 1 from items x join sheets t on t.id = x.sheet_id join fields y on y.id = (e->>'field_id')::uuid
                                     where x.id = (e->>'to_item')::uuid and x.org_id = v_org and x.archived_at is null
                                       and t.is_library and t.archived_at is null
                                       and y.type in ('requirement', 'controllink')))) then
    raise exception 'upgrade plan: links must join the install''s items';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'add'->'links', '[]')) e
               join fields y on y.id = (e->>'field_id')::uuid
               join items a on a.id = (e->>'from_item')::uuid
               join items b on b.id = (e->>'to_item')::uuid
              where y.type not in ('link', 'requirement', 'controllink') or a.sheet_id <> y.sheet_id
                 or b.sheet_id::text <> coalesce(nullif(y.config->>'targetSheetId', ''), b.sheet_id::text)) then
    raise exception 'upgrade plan: link target not allowed';
  end if;
  insert into item_links (org_id, field_id, from_item, to_item)
  select distinct v_org, (e->>'field_id')::uuid, (e->>'from_item')::uuid, (e->>'to_item')::uuid
    from jsonb_array_elements(coalesce(p_plan->'add'->'links', '[]')) e
  on conflict do nothing;
  insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value, note)
  select it2.org_id, it2.sheet_id, it2.id, '', v_actor, auth.uid(), 'link.changed', l.field_id, '[]'::jsonb,
         to_jsonb(array_agg(l.to_item order by l.position, l.to_item)), 'Pack update'
    from item_links l join items it2 on it2.id = l.from_item
   where exists (select 1 from jsonb_array_elements(coalesce(p_plan->'add'->'links', '[]')) e
                  where (e->>'from_item')::uuid = l.from_item and (e->>'field_id')::uuid = l.field_id)
   group by it2.org_id, it2.sheet_id, it2.id, l.field_id;

  insert into automations (id, org_id, sheet_id, name, enabled, trigger, conditions, actions, source, version,
                           created_by, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, v_org, (e->>'sheet_id')::uuid, e->>'name', coalesce((e->>'enabled')::boolean, true),
         e->'trigger', coalesce(e->'conditions', '[]'::jsonb), e->'actions', 'pack:' || pk.key, 1, auth.uid(),
         i.id, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'add'->'automations', '[]')) e;
  if exists (select 1 from automations a, jsonb_array_elements(a.actions) x
              where a.pack_install_id = i.id and nullif(x->>'sheetId', '') is not null
                and not exists (select 1 from sheets t where t.id::text = x->>'sheetId' and t.org_id = v_org)) then
    raise exception 'upgrade plan: an automation names a sheet outside the workspace';
  end if;

  insert into dashboards (id, org_id, name, position, config, created_by, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, v_org, e->>'name', e->>'position', e->'config', auth.uid(), i.id, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'add'->'dashboards', '[]')) e;
  if exists (select 1 from dashboards d, jsonb_array_elements(d.config->'widgets') w
              where d.pack_install_id = i.id and d.archived_at is null and nullif(w->>'sheetId', '') is not null
                and not exists (select 1 from sheets t where t.id::text = w->>'sheetId' and t.org_id = v_org)) then
    raise exception 'upgrade plan: a dashboard names a sheet outside the workspace';
  end if;

  -- items (after the additions: a value may be for a field this update adds): name, group and the values the
  -- plan names, each change logged on the item's chain
  for ue in select x from jsonb_array_elements(coalesce(p_plan->'update'->'items', '[]')) x loop
    select * into it from items where id = (ue->>'id')::uuid for update;
    if it.archived_at is not null then continue; end if;
    if ue ? 'name' and ue->>'name' is distinct from it.name then
      insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
      values (it.org_id, it.sheet_id, it.id, '', v_actor, auth.uid(), 'item.renamed', to_jsonb(it.name), ue->'name', 'Pack update');
      it.name := ue->>'name';
    end if;
    if ue ? 'group_id' and (ue->>'group_id')::uuid is distinct from it.group_id then
      if not exists (select 1 from groups g where g.id = (ue->>'group_id')::uuid and g.sheet_id = it.sheet_id) then
        raise exception 'upgrade plan: group not in sheet';
      end if;
      insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
      values (it.org_id, it.sheet_id, it.id, '', v_actor, auth.uid(), 'item.moved', to_jsonb(it.group_id), ue->'group_id', 'Pack update');
      it.group_id := (ue->>'group_id')::uuid;
    end if;
    for vk in select jsonb_object_keys(coalesce(ue->'values', '{}'::jsonb)) loop
      select * into f from fields where id::text = vk and sheet_id = it.sheet_id and archived_at is null;
      if f.id is null then raise exception 'upgrade plan: field % not in sheet', vk; end if;
      if f.type = any(non_value_types()) then raise exception 'upgrade plan: field % is not set through values', f.name; end if;
      old_v := it."values" -> vk;
      new_v := ue->'values'->vk;
      if new_v is null or new_v = 'null'::jsonb then
        it."values" := it."values" - vk; new_v := null;
      else
        it."values" := jsonb_set(it."values", array[vk], new_v, true);
      end if;
      if old_v is distinct from new_v then
        insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value, note)
        values (it.org_id, it.sheet_id, it.id, '', v_actor, auth.uid(), 'value.changed', f.id, old_v, new_v, 'Pack update');
      end if;
    end loop;
    update items set name = it.name, group_id = it.group_id, "values" = it."values", updated_at = now(),
                     updated_by = auth.uid(), pack_hash = _pack_hash(ue)
     where id = it.id;
    n_items_changed := n_items_changed + 1;
  end loop;

  -- ═════════════ what the new version no longer ships: archived (never deleted), automations off ═════════════
  update automations set enabled = false
   where id in (select a::uuid from jsonb_array_elements_text(coalesce(p_plan->'disable'->'automations', '[]')) a) and enabled;
  get diagnostics n_disabled = row_count;
  -- a sheet is archived only when it holds nothing the client added
  if exists (select 1 from jsonb_array_elements_text(coalesce(p_plan->'archive'->'sheets', '[]')) a
               join items x on x.sheet_id = a::uuid
              where x.archived_at is null and x.pack_install_id is null) then
    raise exception 'upgrade plan: a sheet with items you added is not archived';
  end if;
  update sheets set archived_at = v_at
   where id in (select a::uuid from jsonb_array_elements_text(coalesce(p_plan->'archive'->'sheets', '[]')) a)
     and archived_at is null;
  get diagnostics n = row_count; n_archived := n_archived + n;
  update dashboards set archived_at = v_at
   where id in (select a::uuid from jsonb_array_elements_text(coalesce(p_plan->'archive'->'dashboards', '[]')) a)
     and archived_at is null;
  get diagnostics n = row_count; n_archived := n_archived + n;
  -- folders only when nothing live is left in them
  update folders fo set archived_at = v_at
   where fo.id in (select a::uuid from jsonb_array_elements_text(coalesce(p_plan->'archive'->'folders', '[]')) a)
     and fo.archived_at is null
     and not exists (select 1 from sheets sh where sh.folder_id = fo.id and sh.archived_at is null);
  get diagnostics n = row_count; n_archived := n_archived + n;
  for it in select * from items
             where id in (select a::uuid from jsonb_array_elements_text(coalesce(p_plan->'archive'->'items', '[]')) a)
               and archived_at is null for update loop
    update items set archived_at = v_at, updated_at = now(), updated_by = auth.uid() where id = it.id;
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, note)
    values (it.org_id, it.sheet_id, it.id, '', v_actor, auth.uid(), 'item.archived', 'Pack update');
    n_archived := n_archived + 1;
  end loop;
  perform set_config('app.pack_op', '', true);

  -- ═════════════ the install moves to the new version ═════════════
  update pack_installs set version = pk.version, manifest_hash = pk.hash, ref_map = ref_map || refs where id = i.id;
  counts := jsonb_build_object(
    'added', jsonb_build_object(
      'folders', cardinality(add_folders),
      'sheets', (select count(*) from sheets where id = any(add_sheets) and parent_sheet_id is null),
      'fields', cardinality(add_fields),
      'groups', cardinality(add_groups),
      'views', (select count(*) from jsonb_array_elements(coalesce(p_plan->'add'->'views', '[]')) e where e->>'type' <> 'form'),
      'forms', (select count(*) from jsonb_array_elements(coalesce(p_plan->'add'->'views', '[]')) e where e->>'type' = 'form'),
      'items', cardinality(add_items),
      'links', jsonb_array_length(coalesce(p_plan->'add'->'links', '[]')),
      'automations', jsonb_array_length(coalesce(p_plan->'add'->'automations', '[]')),
      'dashboards', jsonb_array_length(coalesce(p_plan->'add'->'dashboards', '[]'))),
    'changed', n_changed + n_items_changed,
    'archived', n_archived,
    'turned_off', n_disabled);
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
  values (v_org, '', v_actor, auth.uid(), 'pack.upgraded',
          jsonb_build_object('version', i.version, 'manifest_hash', i.manifest_hash),
          jsonb_build_object('install_id', i.id, 'pack_key', pk.key, 'from_version', i.version, 'version', pk.version,
                             'title', pk.title, 'manifest_hash', pk.hash, 'counts', counts,
                             'summary', coalesce(p_plan->'summary', '{}'::jsonb)));
  return jsonb_build_object('install_id', i.id, 'version', pk.version, 'ref_map', refs, 'counts', counts);
end $$;

-- ───────────────────────── archive ─────────────────────────
-- As 0024, and: a pack another live install builds on (names it in requires) is not archived; what an add-on added
-- to another pack's sheets goes with it: its columns archived (restorable from Workspace admin › Archived), its views
-- removed, its groups removed when they hold no items (kept otherwise), its standard's option taken out of the shared
-- Standards fields (items keep the id: installing the add-on again brings the tag back). Other options it added stay
-- (items may use them). Items, links and the activity log are never touched.
create or replace function archive_pack(p_install uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i pack_installs; at timestamptz := now(); n_sheets int; n_folders int; n_autos int; n_dash int; pk packs; counts jsonb;
  n_fields int := 0; n_views int := 0; n_groups int := 0; n_kept_groups int := 0; n_options int := 0; n int;
  dep text; v_standard text; o record;
begin
  select * into i from pack_installs where id = p_install;
  if i.id is null or not is_member(i.org_id) then raise exception 'pack install not found'; end if;
  if not is_admin(i.org_id) then raise exception 'not allowed: only owners and admins archive packs'; end if;
  if i.status <> 'installed' then raise exception 'pack already archived'; end if;
  select * into pk from packs where key = i.pack_key and version = i.version;

  -- packs that build on this one go first
  select string_agg(coalesce(p2.title, d.pack_key), ', ' order by d.installed_at) into dep
    from pack_installs d left join packs p2 on p2.key = d.pack_key and p2.version = d.version
   where d.org_id = i.org_id and d.status = 'installed' and d.id <> i.id
     and exists (select 1 from jsonb_array_elements(coalesce(p2.manifest->'requires', '[]')) r
                  where r->>'pack' = i.pack_key);
  if dep is not null then raise exception 'not allowed: archive % first, it builds on this pack', dep; end if;
  perform set_config('app.pack_op', 'archive', true);

  update automations set enabled = false where pack_install_id = i.id and enabled;
  get diagnostics n_autos = row_count;
  update sheets set archived_at = at
   where pack_install_id = i.id and org_id = i.org_id and parent_sheet_id is null and archived_at is null;
  get diagnostics n_sheets = row_count;

  -- what it added to other packs' sheets
  update fields f set archived_at = at, updated_at = now()
   where f.pack_install_id = i.id and f.org_id = i.org_id and f.archived_at is null
     and not exists (select 1 from sheets s where s.id = f.sheet_id and s.pack_install_id = i.id);
  get diagnostics n_fields = row_count;
  delete from views v
   where v.pack_install_id = i.id and v.org_id = i.org_id
     and not exists (select 1 from sheets s where s.id = v.sheet_id and s.pack_install_id = i.id);
  get diagnostics n_views = row_count;
  delete from groups g
   where g.pack_install_id = i.id and g.org_id = i.org_id
     and not exists (select 1 from sheets s where s.id = g.sheet_id and s.pack_install_id = i.id)
     and not exists (select 1 from items x where x.group_id = g.id);
  get diagnostics n_groups = row_count;
  select count(*) into n_kept_groups from groups g
   where g.pack_install_id = i.id and g.org_id = i.org_id
     and not exists (select 1 from sheets s where s.id = g.sheet_id and s.pack_install_id = i.id);
  v_standard := nullif(pk.manifest->'standard'->>'id', '');
  if v_standard is not null then
    for o in select k, (v #>> '{}')::uuid fid from jsonb_each(i.ref_map) as m(k, v)
              where k like 'option:%' and split_part(k, '.', array_length(string_to_array(k, '.'), 1)) = v_standard loop
      update fields set config = jsonb_set(config, '{options}', coalesce((
               select jsonb_agg(x) from jsonb_array_elements(config->'options') x where x->>'id' <> v_standard), '[]')),
             updated_at = now()
       where id = o.fid and org_id = i.org_id and jsonb_typeof(config->'options') = 'array'
         and exists (select 1 from jsonb_array_elements(config->'options') x where x->>'id' = v_standard)
         -- a field keeps at least one option
         and jsonb_array_length(config->'options') > 1;
      get diagnostics n = row_count;
      n_options := n_options + n;
    end loop;
  end if;

  update folders f set archived_at = at
   where f.pack_install_id = i.id and f.org_id = i.org_id and f.archived_at is null
     and not exists (select 1 from sheets s where s.folder_id = f.id and s.archived_at is null);
  get diagnostics n_folders = row_count;
  update dashboards set archived_at = at where pack_install_id = i.id and archived_at is null;
  get diagnostics n_dash = row_count;
  update pack_installs set status = 'archived', archived_at = at, archived_by = auth.uid() where id = i.id;
  perform set_config('app.pack_op', '', true);

  counts := jsonb_build_object('sheets', n_sheets, 'folders', n_folders, 'automations', n_autos, 'dashboards', n_dash);
  -- what an add-on took back from other packs' sheets, when it added anything there
  if n_fields + n_views + n_groups + n_kept_groups + n_options > 0 then
    counts := counts || jsonb_build_object('fields', n_fields, 'views', n_views, 'groups', n_groups,
                                           'groups_kept', n_kept_groups, 'options', n_options);
  end if;
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (i.org_id, '', 'user', auth.uid(), 'pack.archived',
          jsonb_build_object('install_id', i.id, 'pack_key', i.pack_key, 'version', i.version,
                             'title', coalesce(pk.title, i.pack_key), 'manifest_hash', i.manifest_hash,
                             'counts', counts));
  return counts;
end $$;

-- ───────────────────────── grants ─────────────────────────
revoke all on function install_pack(uuid, jsonb), upgrade_pack(uuid, jsonb), archive_pack(uuid) from public, anon;
grant execute on function install_pack(uuid, jsonb) to authenticated, service_role;
grant execute on function upgrade_pack(uuid, jsonb) to authenticated;
grant execute on function archive_pack(uuid) to authenticated;
