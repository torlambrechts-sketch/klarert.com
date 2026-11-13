-- 0028_access_packs_invites.sql · P2 access control, part 4: packs and invites (docs/02 §16, docs/11).
-- 1. install_pack honours `restricted` on a manifest's folders and sheets: they are created restricted and the person
--    installing is listed as an editor (logged as a grant), so an admin keeps access to what they installed. Owners see
--    everything anyway. Rows are written in the same single transaction as before.
-- 2. Invites carry an end date (required for auditors, 0026); accepting copies it to the membership.

create or replace function install_pack(p_org uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pk packs; inst uuid := gen_random_uuid(); refs jsonb; counts jsonb; bad text; s record; n int; first_seq int;
  v_actor text := case when auth.uid() is null then 'system' else 'user' end;
  plan_sheets uuid[]; plan_fields uuid[]; plan_items uuid[]; plan_groups uuid[];
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
  if exists (select 1 from pack_installs where org_id = p_org and pack_key = pk.key and status = 'installed') then
    raise exception 'pack already installed';
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
      union all select 'dashboard', e->>'ref' from jsonb_array_elements(coalesce(p_plan->'dashboards', '[]')) e) x
     group by kind, r having count(*) > 1 or r is null or r = '') d;
  if bad is not null then raise exception 'pack plan: refs missing or repeated (%)', bad; end if;

  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_sheets from jsonb_array_elements(coalesce(p_plan->'sheets', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_fields from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_groups from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into plan_items from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e;

  -- the ref → id map, kept on the install for later upgrades
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into refs from (
    select 'folder:' || (e->>'ref') k, e->'id' v from jsonb_array_elements(coalesce(p_plan->'folders', '[]')) e
    union all select 'sheet:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'sheets', '[]')) e
    union all select 'field:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e
    union all select 'group:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e
    union all select 'view:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'views', '[]')) e
    union all select 'item:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e
    union all select 'automation:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'automations', '[]')) e
    union all select 'dashboard:' || (e->>'ref'), e->'id' from jsonb_array_elements(coalesce(p_plan->'dashboards', '[]')) e) m;

  insert into pack_installs (id, org_id, pack_key, version, installed_by, manifest_hash, ref_map)
  values (inst, p_org, pk.key, pk.version, auth.uid(), pk.hash, refs);
  perform set_config('app.pack_op', 'install', true);

  -- folders
  insert into folders (id, org_id, name, position, restricted, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, e->>'name', e->>'position', coalesce((e->>'restricted')::boolean, false),
         inst, e->>'ref', _pack_hash(e)
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
    select p_org, fo.id, auth.uid(), 'editor', auth.uid() from folders fo where fo.pack_install_id = inst and fo.restricted;
    insert into access_grants (org_id, sheet_id, user_id, level, granted_by)
    select p_org, sh.id, auth.uid(), 'editor', auth.uid() from sheets sh
     where sh.pack_install_id = inst and sh.restricted and not sh.access_inherit;
    insert into activity_log (org_id, sheet_id, chain_key, actor_kind, actor_id, action, new_value, note)
    select p_org, g.sheet_id, '', 'user', auth.uid(),
           case when g.folder_id is not null then 'folder.access.granted' else 'access.granted' end,
           jsonb_build_object('user_id', g.user_id, 'level', g.level, 'folder_id', g.folder_id),
           _member_name(g.user_id) || ': editor on ' || coalesce(sh.name, fo.name) || ' (pack install)'
      from access_grants g left join sheets sh on sh.id = g.sheet_id left join folders fo on fo.id = g.folder_id
     where (sh.pack_install_id = inst or fo.pack_install_id = inst);
    perform _access_changed();
  end if;

  -- groups, fields and views of the plan's sheets only
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e where not ((e->>'sheet_id')::uuid = any(plan_sheets)))
     or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e where not ((e->>'sheet_id')::uuid = any(plan_sheets)))
     or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'views', '[]')) e where not ((e->>'sheet_id')::uuid = any(plan_sheets)))
     or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e where not ((e->>'sheet_id')::uuid = any(plan_sheets))
                  or not ((e->>'group_id')::uuid = any(plan_groups)))
     or exists (select 1 from jsonb_array_elements(coalesce(p_plan->'automations', '[]')) e where not ((e->>'sheet_id')::uuid = any(plan_sheets))) then
    raise exception 'pack plan: rows must belong to the plan''s sheets';
  end if;

  insert into groups (id, org_id, sheet_id, name, color, position, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, (e->>'sheet_id')::uuid, e->>'name', coalesce(e->>'color', 'blue'), e->>'position',
         inst, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'groups', '[]')) e;

  insert into fields (id, org_id, sheet_id, key, name, type, position, width, required, locked, description, config,
                      rules, visibility, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, (e->>'sheet_id')::uuid, e->>'key', e->>'name', e->>'type', e->>'position',
         (e->>'width')::int, coalesce((e->>'required')::boolean, false), coalesce((e->>'locked')::boolean, false),
         e->>'description', coalesce(e->'config', '{}'::jsonb), coalesce(e->'rules', '[]'::jsonb),
         nullif(e->'visibility', 'null'::jsonb), inst, e->>'ref', _pack_hash(e)
    from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) e;
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
    from items i where i.pack_install_id = inst order by i.sheet_id, i.seq;

  -- links between the plan's items, through the plan's link fields; one link.changed entry per field and item
  if exists (select 1 from jsonb_array_elements(coalesce(p_plan->'links', '[]')) e
              where not ((e->>'field_id')::uuid = any(plan_fields)) or not ((e->>'from_item')::uuid = any(plan_items))
                 or not ((e->>'to_item')::uuid = any(plan_items))) then
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
   where it.pack_install_id = inst and l.field_id = any(plan_fields)
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

  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', v_actor, auth.uid(), 'pack.installed',
          jsonb_build_object('install_id', inst, 'pack_key', pk.key, 'version', pk.version, 'title', pk.title,
                             'manifest_hash', pk.hash, 'counts', counts));
  perform set_config('app.pack_op', '', true);
  return jsonb_build_object('install_id', inst, 'ref_map', refs, 'counts', counts);
end $$;


drop function if exists get_invite(text);
create function get_invite(p_token text)
returns table (org_name text, org_slug text, email text, role member_role, invited_by_name text, accepted boolean,
               expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.name, o.slug, i.email, i.role, p.display_name, i.accepted_at is not null, i.expires_at
    from invites i join orgs o on o.id = i.org_id left join profiles p on p.id = i.invited_by
   where i.token = p_token and auth.uid() is not null
$$;

create or replace function accept_invite(p_token text) returns orgs
language plpgsql security definer set search_path = public as $$
declare i invites; o orgs; jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'profile required'; end if;
  select * into i from invites where token = p_token for update;
  if i.id is null then raise exception 'invite not found'; end if;
  if i.accepted_at is not null then raise exception 'invite already used'; end if;
  if lower(i.email) <> jwt_email then raise exception 'invite is for another email address'; end if;
  if i.expires_at is not null and i.expires_at <= now() then raise exception 'invite expired'; end if;
  insert into memberships(org_id, user_id, role, expires_at) values (i.org_id, auth.uid(), i.role, i.expires_at)
    on conflict (org_id, user_id) do nothing;
  update invites set accepted_at = now() where id = i.id;
  select * into o from orgs where id = i.org_id;
  return o;
end $$;

revoke all on function install_pack(uuid, jsonb), accept_invite(text) from public, anon;
grant execute on function install_pack(uuid, jsonb) to authenticated, service_role;
grant execute on function accept_invite(text) to authenticated;
revoke all on function get_invite(text) from public, anon;
grant execute on function get_invite(text) to authenticated;
