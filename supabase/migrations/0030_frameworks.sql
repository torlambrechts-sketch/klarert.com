-- 0030_frameworks.sql · P3: the requirement library and cross-walks (docs/12, docs/02 §17).
-- Frameworks and their requirements are shared, versioned reference data: reference numbers with OUR OWN short
-- titles and guidance, never a standard's text (docs/12 Licensing). Cross-walks say how requirements of two
-- frameworks relate (equivalent, partial, related) and who mapped them. All three tables are global (no org_id),
-- readable by every signed-in person and written only by the catalogue path (scripts/seed.ts, service role).
--
-- A workspace ADOPTS a framework: adopt_framework installs the framework's library pack through install_pack (one
-- transaction, provenance, pack.installed) and stamps every library item with its requirement key
-- (items.requirement_ref = '<framework>@<version>#<ref>'), which never changes afterwards, nor does the item's Ref
-- value. Library sheets are ordinary sheets: RLS and sheet access (_sheet_levels, 0026) apply to them unchanged.
-- Requirement and control link fields with no target sheet link to items of any library sheet of the workspace.

-- ───────────────────────── catalogue ─────────────────────────
create table frameworks (
  key           text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  version       text not null check (version ~ '^[0-9A-Za-z.-]{1,20}$'),
  revision      integer not null default 1 check (revision between 1 and 999),
  title         text not null check (char_length(title) between 1 and 120),
  short_title   text not null check (char_length(short_title) between 1 and 12),
  publisher     text not null check (char_length(publisher) between 1 and 120),
  kind          text not null check (kind in ('standard', 'law', 'regulation', 'internal')),
  source        text not null check (char_length(source) between 1 and 500),
  -- what may be shipped; shown with the library (docs/12 Licensing)
  licence       text not null check (char_length(licence) between 1 and 500),
  url           text not null check (url ~ '^https://'),
  -- titles are always our own words; the column makes that explicit
  titles        text not null default 'own-words' check (titles = 'own-words'),
  -- the library pack adoption installs (docs/11): framework-<key>, <edition>.<revision>.0
  pack_key      text not null,
  pack_version  text not null,
  hash          text not null check (hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  primary key (key, version),
  foreign key (pack_key, pack_version) references packs(key, version)
);

create table requirements (
  framework_key     text not null,
  framework_version text not null,
  ref               text not null check (char_length(ref) between 1 and 40 and ref !~ '[#@]'),
  parent_ref        text,
  kind              text not null check (kind in ('clause', 'control', 'article', 'paragraph', 'theme')),
  position          integer not null check (position >= 0),
  -- our own words, short (docs/12 Licensing)
  title             text not null check (char_length(title) between 1 and 80),
  guidance          text check (guidance is null or char_length(guidance) between 1 and 2000),
  tags              text[] not null default '{}',
  primary key (framework_key, framework_version, ref),
  foreign key (framework_key, framework_version) references frameworks(key, version),
  foreign key (framework_key, framework_version, parent_ref) references requirements(framework_key, framework_version, ref),
  check ((kind = 'theme') = (parent_ref is null))
);
create index requirements_order_idx on requirements(framework_key, framework_version, position);

create table crosswalks (
  id            bigint generated always as identity primary key,
  from_framework text not null,
  from_version   text not null,
  from_ref       text not null,
  to_framework   text not null,
  to_version     text not null,
  to_ref         text not null,
  relation       text not null check (relation in ('equivalent', 'partial', 'related')),
  note           text not null default '' check (char_length(note) <= 300),
  -- who mapped it and the mapping's version: 'Klarert mapping v1'
  source         text not null check (char_length(source) between 1 and 80),
  created_at     timestamptz not null default now(),
  foreign key (from_framework, from_version, from_ref) references requirements(framework_key, framework_version, ref),
  foreign key (to_framework, to_version, to_ref) references requirements(framework_key, framework_version, ref),
  unique (from_framework, from_version, from_ref, to_framework, to_version, to_ref),
  check ((from_framework, from_version) is distinct from (to_framework, to_version))
);
create index crosswalks_to_idx on crosswalks(to_framework, to_version, to_ref);

-- Reference numbers are for ever: a requirement is never deleted and its ref, parent and kind never change (a
-- revision may reword our titles and guidance and add requirements; docs/12). Frameworks are never deleted.
create or replace function catalogue_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'the requirement catalogue is append-only'; end if;
  if tg_table_name = 'requirements' and (new.framework_key, new.framework_version, new.ref, new.parent_ref, new.kind)
       is distinct from (old.framework_key, old.framework_version, old.ref, old.parent_ref, old.kind) then
    raise exception 'a requirement''s ref, parent and kind never change';
  end if;
  if tg_table_name = 'frameworks' and (new.key, new.version) is distinct from (old.key, old.version) then
    raise exception 'a framework''s key and version never change';
  end if;
  if tg_table_name = 'crosswalks' then raise exception 'a cross-walk never changes: add a new mapping version'; end if;
  return new;
end $$;
revoke all on function catalogue_guard() from public, anon, authenticated;
create trigger frameworks_guard before update or delete on frameworks for each row execute function catalogue_guard();
create trigger requirements_guard before update or delete on requirements for each row execute function catalogue_guard();
create trigger crosswalks_guard before update or delete on crosswalks for each row execute function catalogue_guard();

alter table frameworks enable row level security;
alter table requirements enable row level security;
alter table crosswalks enable row level security;
-- every signed-in person may read the catalogue; nobody writes it through the API (the seed uses the service role)
create policy frameworks_read on frameworks for select to authenticated using (true);
create policy requirements_read on requirements for select to authenticated using (true);
create policy crosswalks_read on crosswalks for select to authenticated using (true);
revoke all on frameworks, requirements, crosswalks from anon;
revoke insert, update, delete, truncate on frameworks, requirements, crosswalks from authenticated;

-- ───────────────────────── library items ─────────────────────────
alter table items add column requirement_ref text
  check (requirement_ref is null or requirement_ref ~ '^[a-z0-9][a-z0-9-]{0,39}@[0-9A-Za-z.-]{1,20}#[^#@]{1,40}$');
-- one item per requirement in a library sheet; adopted requirements of a workspace by key
create unique index items_requirement_ref_key on items(sheet_id, requirement_ref) where requirement_ref is not null;
create index items_org_requirement_idx on items(org_id, requirement_ref) where requirement_ref is not null;

-- The id of a library sheet's Ref field (sheets.settings.framework.refFieldKey), or null.
create or replace function _library_ref_field(p_sheet uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select f.id from fields f join sheets s on s.id = f.sheet_id
   where f.sheet_id = p_sheet and f.key = s.settings->'framework'->>'refFieldKey' and f.archived_at is null
   limit 1
$$;
revoke all on function _library_ref_field(uuid) from public, anon, authenticated;

-- requirement_ref is written only by adopt_framework (app.pack_op = 'adopt'), once, and never changes; neither does the
-- item's Ref value, so renaming an item, a field or an option never breaks the link to the catalogue. (Restricting
-- the Ref field moves its values to restricted_values; set_field_restriction marks its transaction with app.access_op.)
create or replace function items_requirement_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare rf uuid;
begin
  if tg_op = 'INSERT' then
    if new.requirement_ref is not null then raise exception 'requirement_ref is written only by adopt_framework'; end if;
    return new;
  end if;
  if new.requirement_ref is distinct from old.requirement_ref then
    if old.requirement_ref is not null or coalesce(current_setting('app.pack_op', true), '') <> 'adopt' then
      raise exception 'a library item''s requirement never changes';
    end if;
    return new;
  end if;
  if old.requirement_ref is not null and new."values" is distinct from old."values"
     and coalesce(current_setting('app.access_op', true), '') <> 'on' then
    rf := _library_ref_field(new.sheet_id);
    if rf is not null and (new."values" -> rf::text) is distinct from (old."values" -> rf::text) then
      raise exception 'locked: the reference number of a requirement never changes';
    end if;
  end if;
  return new;
end $$;
revoke all on function items_requirement_guard() from public, anon, authenticated;
create trigger items_requirement_guard before insert or update on items
  for each row execute function items_requirement_guard();

-- ───────────────────────── adopt ─────────────────────────
-- Adopt a framework: install its library pack (install_pack: owners and admins, one transaction, provenance) and stamp
-- every library item with its requirement key from the plan (`items[].requirement_ref`). Checks that the pack is the
-- framework's library pack, that the plan's library sheet names the framework, that every key is a requirement of
-- that framework and is the item's Ref value, and that every requirement that is not a theme has its item. Logs
-- `framework.adopted` on the workspace chain. Any failure leaves nothing behind.
create or replace function adopt_framework(p_org uuid, p_framework text, p_version text, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fw frameworks; out jsonb; inst uuid; lib uuid; rf uuid; bad text; n int; want int;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins adopt frameworks'; end if;
  select * into fw from frameworks where key = p_framework and version = p_version;
  if fw.key is null then raise exception 'framework not found'; end if;
  if (p_plan->'pack'->>'key', p_plan->'pack'->>'version') is distinct from (fw.pack_key, fw.pack_version) then
    raise exception 'adopt: the plan is not this framework''s library';
  end if;
  if exists (select 1 from sheets s where s.org_id = p_org and s.archived_at is null
               and s.settings->'framework'->>'key' = fw.key) then
    raise exception 'framework already adopted';
  end if;

  out := install_pack(p_org, p_plan);
  inst := (out->>'install_id')::uuid;
  select id into lib from sheets
   where pack_install_id = inst and is_library and parent_sheet_id is null
     and settings->'framework'->>'key' = fw.key and settings->'framework'->>'version' = fw.version;
  if lib is null or (select count(*) from sheets where pack_install_id = inst) <> 1 then
    raise exception 'adopt: the plan must hold exactly the framework''s library sheet';
  end if;
  rf := _library_ref_field(lib);
  if rf is null then raise exception 'adopt: the library has no Ref field'; end if;

  perform set_config('app.pack_op', 'adopt', true);
  update items i set requirement_ref = e->>'requirement_ref'
    from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e
   where i.id = (e->>'id')::uuid and i.pack_install_id = inst and i.sheet_id = lib
     and nullif(e->>'requirement_ref', '') is not null;
  perform set_config('app.pack_op', '', true);

  select string_agg(coalesce(i.requirement_ref, i.display_id), ', ') into bad from items i
   where i.sheet_id = lib and (
     i.requirement_ref is null
     or not exists (select 1 from requirements r
                     where i.requirement_ref = r.framework_key || '@' || r.framework_version || '#' || r.ref
                       and r.framework_key = fw.key and r.framework_version = fw.version and r.kind <> 'theme')
     or (i."values" ->> rf::text) is distinct from split_part(i.requirement_ref, '#', 2));
  if bad is not null then raise exception 'adopt: not requirements of %: %', fw.title, left(bad, 300); end if;
  select count(*) into n from items where sheet_id = lib;
  select count(*) into want from requirements where framework_key = fw.key and framework_version = fw.version and kind <> 'theme';
  if n <> want then raise exception 'adopt: % has % requirements, the plan %', fw.title, want, n; end if;

  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'framework.adopted',
          jsonb_build_object('framework', fw.key, 'version', fw.version, 'title', fw.title, 'sheet_id', lib,
                             'install_id', inst, 'requirements', n));
  return out || jsonb_build_object('sheet_id', lib, 'requirements', n);
end $$;

-- ───────────────────────── links to any library ─────────────────────────
-- set_item_links (0001) with one more rule: a requirement or control link field with no target sheet links to items
-- of any library sheet of the workspace (a control can cover requirements of several frameworks).
create or replace function set_item_links(p_field uuid, p_from uuid, p_to uuid[], p_mode text,
                                          p_automation uuid default null) returns setof item_links
language plpgsql security definer set search_path = public as $$
declare f fields; it items; before uuid[]; after uuid[];
begin
  select * into f from fields where id = p_field and type in ('link','requirement','controllink');
  select * into it from items where id = p_from and archived_at is null;
  if f.id is null or it.id is null or f.sheet_id <> it.sheet_id then raise exception 'bad link field or item'; end if;
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
  return query select * from item_links where field_id = p_field and from_item = p_from order by position;
end $$;

-- ───────────────────────── grants (0008: nothing is executable unless granted) ─────────────────────────
revoke all on function adopt_framework(uuid, text, text, jsonb), set_item_links(uuid, uuid, uuid[], text, uuid)
  from public, anon;
grant execute on function adopt_framework(uuid, text, text, jsonb) to authenticated;
grant execute on function set_item_links(uuid, uuid, uuid[], text, uuid) to authenticated;
