-- 0024_packs.sql · P1: the pack framework (docs/11, docs/02 §15)
-- A pack is an installable bundle of the core as data: folders, sheets, fields, groups, views and forms, items,
-- links, automations and dashboards, all named by stable refs. The catalogue (`packs`) is global and read-only to
-- people: it is written from the repository's pack files by the seed path (scripts/seed.ts, service role). An install
-- (`pack_installs`) belongs to one workspace and keeps the ref → id map, so later upgrades (P6) can find each object.
-- Every row an install creates carries its provenance: pack_install_id, pack_ref and pack_hash (the sha-256 of the
-- row as shipped). install_pack writes every row, the item and link entries and a `pack.installed` workspace entry in
-- one transaction (all or nothing); archive_pack archives what the install made and never deletes items or the log.

-- ───────────────────────── catalogue ─────────────────────────
create table packs (
  key          text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  version      text not null check (version ~ '^\d+\.\d+\.\d+$'),
  title        text not null check (char_length(title) between 1 and 120),
  description  text not null default '',
  manifest     jsonb not null check (jsonb_typeof(manifest) = 'object'),
  hash         text not null check (hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  primary key (key, version)
);

alter table packs enable row level security;
-- every signed-in person may read the catalogue; nobody writes it through the API (the seed uses the service role)
create policy packs_read on packs for select to authenticated using (true);
revoke all on packs from anon;
revoke insert, update, delete, truncate on packs from authenticated;

-- ───────────────────────── installs ─────────────────────────
create table pack_installs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  pack_key       text not null,
  version        text not null,
  status         text not null default 'installed' check (status in ('installed', 'archived')),
  installed_by   uuid references profiles(id),
  installed_at   timestamptz not null default now(),
  archived_by    uuid references profiles(id),
  archived_at    timestamptz,
  manifest_hash  text not null,
  ref_map        jsonb not null default '{}'::jsonb check (jsonb_typeof(ref_map) = 'object'),
  foreign key (pack_key, version) references packs(key, version),
  check ((status = 'archived') = (archived_at is not null))
);
-- a pack is installed at most once per workspace at a time (an archived install may be installed again)
create unique index pack_installs_live_key on pack_installs(org_id, pack_key) where status = 'installed';
create index pack_installs_org_idx on pack_installs(org_id, installed_at desc);

alter table pack_installs enable row level security;
create policy pack_installs_read on pack_installs for select using (is_member(org_id));
-- written only by install_pack and archive_pack
revoke insert, update, delete, truncate on pack_installs from anon, authenticated;

-- ───────────────────────── provenance on every object a pack makes ─────────────────────────
alter table folders     add column pack_install_id uuid references pack_installs(id), add column pack_ref text, add column pack_hash text;
alter table sheets      add column pack_install_id uuid references pack_installs(id), add column pack_ref text, add column pack_hash text;
alter table fields      add column pack_install_id uuid references pack_installs(id), add column pack_ref text, add column pack_hash text;
alter table groups      add column pack_install_id uuid references pack_installs(id), add column pack_ref text, add column pack_hash text;
alter table views       add column pack_install_id uuid references pack_installs(id), add column pack_ref text, add column pack_hash text;
alter table automations add column pack_install_id uuid references pack_installs(id), add column pack_ref text, add column pack_hash text;
alter table dashboards  add column pack_install_id uuid references pack_installs(id), add column pack_ref text, add column pack_hash text;
alter table items       add column pack_install_id uuid references pack_installs(id), add column pack_ref text, add column pack_hash text;

create unique index folders_pack_ref_key     on folders(org_id, pack_install_id, pack_ref)     where pack_install_id is not null;
create unique index sheets_pack_ref_key      on sheets(org_id, pack_install_id, pack_ref)      where pack_install_id is not null;
create unique index fields_pack_ref_key      on fields(org_id, pack_install_id, pack_ref)      where pack_install_id is not null;
create unique index groups_pack_ref_key      on groups(org_id, pack_install_id, pack_ref)      where pack_install_id is not null;
create unique index views_pack_ref_key       on views(org_id, pack_install_id, pack_ref)       where pack_install_id is not null;
create unique index automations_pack_ref_key on automations(org_id, pack_install_id, pack_ref) where pack_install_id is not null;
create unique index dashboards_pack_ref_key  on dashboards(org_id, pack_install_id, pack_ref)  where pack_install_id is not null;
create unique index items_pack_ref_key       on items(org_id, pack_install_id, pack_ref)       where pack_install_id is not null;

-- Provenance is written only by install_pack (which sets app.pack_op for its transaction) and never changes.
create or replace function pack_provenance_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if (new.pack_install_id is not null or new.pack_ref is not null or new.pack_hash is not null)
       and coalesce(current_setting('app.pack_op', true), '') <> 'install' then
      raise exception 'pack provenance is written only by install_pack';
    end if;
  elsif new.pack_install_id is distinct from old.pack_install_id or new.pack_ref is distinct from old.pack_ref
        or new.pack_hash is distinct from old.pack_hash then
    raise exception 'pack provenance never changes';
  end if;
  return new;
end $$;
revoke all on function pack_provenance_guard() from public, anon, authenticated;
create trigger folders_pack_guard     before insert or update on folders     for each row execute function pack_provenance_guard();
create trigger sheets_pack_guard      before insert or update on sheets      for each row execute function pack_provenance_guard();
create trigger fields_pack_guard      before insert or update on fields      for each row execute function pack_provenance_guard();
create trigger groups_pack_guard      before insert or update on groups      for each row execute function pack_provenance_guard();
create trigger views_pack_guard       before insert or update on views       for each row execute function pack_provenance_guard();
create trigger automations_pack_guard before insert or update on automations for each row execute function pack_provenance_guard();
create trigger dashboards_pack_guard  before insert or update on dashboards  for each row execute function pack_provenance_guard();
create trigger items_pack_guard       before insert or update on items       for each row execute function pack_provenance_guard();

-- Dashboards can be archived (by archive_pack); the dashboard pages list live ones only.
alter table dashboards add column archived_at timestamptz;

-- ───────────────────────── helpers (never granted) ─────────────────────────
create or replace function _pack_hash(p jsonb) returns text language sql immutable as $$
  select encode(extensions.digest(p::text, 'sha256'), 'hex')
$$;
revoke all on function _pack_hash(jsonb) from public, anon, authenticated;

-- ───────────────────────── install ─────────────────────────
-- p_plan (built by src/engine/packs/plan.ts from the catalogue manifest; docs/02 §15):
--   { pack: { key, version, hash },
--     folders: [{ id, ref, name, position }],
--     sheets: [{ id, ref, folder_id, name, description, item_label, id_prefix, is_library, settings, position,
--                parent_sheet_id }],
--     fields: [{ id, ref, sheet_id, key, name, type, position, width, required, locked, description, config, rules,
--                visibility }],
--     groups: [{ id, ref, sheet_id, name, color, position }],
--     views: [{ id, ref, sheet_id, name, type, config, position }],
--     items: [{ id, ref, sheet_id, group_id, name, position, values }],
--     links: [{ field_id, from_item, to_item }],
--     automations: [{ id, ref, sheet_id, name, enabled, trigger, conditions, actions }],
--     dashboards: [{ id, ref, name, position, config }] }
-- Every row goes into p_org whatever the plan says; every reference must point inside the plan or the workspace.
-- Owners and admins only (the seed may install with the service role). Returns { install_id, ref_map, counts }.
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
  insert into folders (id, org_id, name, position, pack_install_id, pack_ref, pack_hash)
  select (e->>'id')::uuid, p_org, e->>'name', e->>'position', inst, e->>'ref', _pack_hash(e)
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
                        created_by, parent_sheet_id, pack_install_id, pack_ref, pack_hash)
    values ((s.e->>'id')::uuid, p_org, (s.e->>'folder_id')::uuid, s.e->>'name', nullif(s.e->>'description', ''),
            coalesce(s.e->>'item_label', 'Item'), s.e->>'id_prefix', coalesce((s.e->>'is_library')::boolean, false),
            coalesce(s.e->'settings', '{}'::jsonb), s.e->>'position', auth.uid(), (s.e->>'parent_sheet_id')::uuid,
            inst, s.e->>'ref', _pack_hash(s.e));
  end loop;

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

-- ───────────────────────── archive ─────────────────────────
-- Archives what an install made: its sheets (one timestamp, restorable from Workspace admin › Archived), its folders
-- when nothing else is left in them, its dashboards; its automations are turned off. Items, links and the activity log
-- stay as they are. Owners and admins of the install's workspace. Returns the counts.
create or replace function archive_pack(p_install uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i pack_installs; at timestamptz := now(); n_sheets int; n_folders int; n_autos int; n_dash int; pk packs; counts jsonb;
begin
  select * into i from pack_installs where id = p_install;
  if i.id is null or not is_member(i.org_id) then raise exception 'pack install not found'; end if;
  if not is_admin(i.org_id) then raise exception 'not allowed: only owners and admins archive packs'; end if;
  if i.status <> 'installed' then raise exception 'pack already archived'; end if;
  select * into pk from packs where key = i.pack_key and version = i.version;

  update automations set enabled = false where pack_install_id = i.id and enabled;
  get diagnostics n_autos = row_count;
  update sheets set archived_at = at
   where pack_install_id = i.id and org_id = i.org_id and parent_sheet_id is null and archived_at is null;
  get diagnostics n_sheets = row_count;
  update folders f set archived_at = at
   where f.pack_install_id = i.id and f.org_id = i.org_id and f.archived_at is null
     and not exists (select 1 from sheets s where s.folder_id = f.id and s.archived_at is null);
  get diagnostics n_folders = row_count;
  update dashboards set archived_at = at where pack_install_id = i.id and archived_at is null;
  get diagnostics n_dash = row_count;
  update pack_installs set status = 'archived', archived_at = at, archived_by = auth.uid() where id = i.id;

  counts := jsonb_build_object('sheets', n_sheets, 'folders', n_folders, 'automations', n_autos, 'dashboards', n_dash);
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (i.org_id, '', 'user', auth.uid(), 'pack.archived',
          jsonb_build_object('install_id', i.id, 'pack_key', i.pack_key, 'version', i.version,
                             'title', coalesce(pk.title, i.pack_key), 'manifest_hash', i.manifest_hash,
                             'counts', counts));
  return counts;
end $$;

-- ───────────────────────── people a pack's example values name ─────────────────────────
-- Packs name example people by email (`people` in the manifest); the planner matches them to the workspace's members.
-- Emails live in auth.users, so owners and admins (and the seed) read their members' emails through this.
create or replace function pack_member_emails(p_org uuid) returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_admin(p_org) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not allowed: only owners and admins install packs';
  end if;
  return query select m.user_id, u.email::text from memberships m join auth.users u on u.id = m.user_id
                where m.org_id = p_org;
end $$;

-- ───────────────────────── grants ─────────────────────────
revoke all on function install_pack(uuid, jsonb), archive_pack(uuid), pack_member_emails(uuid) from public, anon;
grant execute on function pack_member_emails(uuid) to authenticated, service_role;
grant execute on function install_pack(uuid, jsonb) to authenticated, service_role;
grant execute on function archive_pack(uuid) to authenticated;
