-- 0075_private_packs.sql · P9: "Save your setup", a workspace's own packs (docs/11 Your own packs, docs/02 §15;
-- owner decisions of 16 Nov 2026).
--
-- A workspace (the publisher) saves its setup as a private pack and installs it in other workspaces. Nothing new about
-- the manifest: a private pack is a row of `packs` with `owner_org_id` (0074), so preview, install, upgrade and archive
-- are the catalogue's own paths.
--
-- 1. `packs` gains `published_by`, `published_at`, `withdrawn_at` and `withdrawn_by`. A private pack's key has the
--    reserved form of 0074, `w<first 8 hex of the publisher's id>-<slug>` (packs_owner_key). Versions are written once:
--    an update of a `packs` row may only withdraw it (packs_write_once).
-- 2. `pack_shares(pack_key, org_id, granted_by, granted_at)`: the workspaces a private pack was installed into. The
--    first install into another workspace needs a person who is owner or admin in both workspaces; it writes the share
--    (`pack.shared` on the publisher's chain). From then on every owner and admin of that workspace previews and takes
--    updates. Written only by install_pack; nobody changes or deletes a share (it goes with either workspace).
-- 3. Reads: a pack is visible when it is ours (`owner_org_id` null), the person is a member of its publisher, or it is
--    shared to a workspace the person belongs to (pack_visible). A workspace's own framework listed by such a pack is
--    shared with it (framework_shared_to_me): its framework, requirements and library pack are readable there, and
--    adopt_framework adopts it there.
-- 4. RPCs (SECURITY DEFINER, granted to `authenticated` only):
--    * publish_pack: owners and admins of the publisher. The manifest's schema (packManifestSchema, Zod) is checked by
--      the command (src/server/commands/pack-publish.ts), which also computes the canonical hash; this function
--      re-checks in SQL what can be checked on the JSON: the key and version, write-once and a higher version, the
--      hash's form, and the safety rules (owner decision 3): every automation in test mode, no outbound action, no
--      example items, personal-data sheets restricted, no people or user ids, required packs from our catalogue and
--      frameworks ours or the publisher's own. Logs `pack.published` (version, hash, counts, what was left out).
--    * withdraw_pack: stops new installs; installed copies keep working and keep taking updates. `pack.withdrawn`.
--    * install_pack and upgrade_pack check visibility and shares explicitly, and their `pack.installed` /
--      `pack.extended` / `pack.upgraded` entries carry `source: private` and the publisher's id on the target's chain.

-- ───────────────────────── 1. packs: who published, withdrawn ─────────────────────────
alter table packs
  add column published_by uuid references profiles(id) on delete set null,
  add column published_at timestamptz,
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid references profiles(id) on delete set null;
alter table packs add constraint packs_published_owner
  check ((published_at is null and withdrawn_at is null) or owner_org_id is not null);

-- A version is written once (docs/11): an update may only withdraw it (withdraw_pack), nothing else about it changes.
create or replace function packs_write_once() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_by') is distinct from (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_by')
     or old.withdrawn_at is not null then
    raise exception 'a pack version is written once: publish a new version';
  end if;
  return new;
end $$;
revoke all on function packs_write_once() from public, anon, authenticated;
create trigger packs_write_once before update on packs for each row execute function packs_write_once();

-- Own rows (0074) are written only by the RPCs: publish_framework sets app.framework_op, publish_pack and withdraw_pack
-- set app.pack_publish (packs only).
create or replace function own_framework_guard() returns trigger language plpgsql as $$
begin
  if coalesce(to_jsonb(new)->>'org_id', to_jsonb(new)->>'owner_org_id') is not null
     and coalesce(current_setting('app.framework_op', true), '') <> 'on'
     and not (tg_table_name = 'packs' and coalesce(current_setting('app.pack_publish', true), '') = 'on') then
    if tg_table_name = 'packs' then
      raise exception 'a workspace''s own pack is written only by publish_framework or publish_pack';
    end if;
    raise exception 'a workspace''s own framework is written only by publish_framework';
  end if;
  return new;
end $$;
revoke all on function own_framework_guard() from public, anon, authenticated;

-- ───────────────────────── 2. shares ─────────────────────────
create table pack_shares (
  pack_key   text not null check (pack_key ~ '^w[0-9a-f]{8}-'),
  org_id     uuid not null references orgs(id) on delete cascade,
  granted_by uuid references profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (pack_key, org_id)
);
create index pack_shares_org_idx on pack_shares(org_id);
alter table pack_shares enable row level security;
revoke all on pack_shares from anon;
revoke insert, update, delete, truncate on pack_shares from authenticated;

-- A share never changes; it goes only with its workspace (or the publisher's pack rows).
create or replace function pack_shares_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from orgs where id = old.org_id) then return old; end if;
  if tg_op = 'DELETE' and not exists (select 1 from packs where key = old.pack_key) then return old; end if;
  if tg_op = 'INSERT' and coalesce(current_setting('app.pack_share', true), '') = 'on' then return new; end if;
  raise exception 'a pack share is written only by install_pack and never changes';
end $$;
revoke all on function pack_shares_guard() from public, anon, authenticated;
create trigger pack_shares_guard before insert or update or delete on pack_shares
  for each row execute function pack_shares_guard();

-- The publisher of a private pack (null: ours, or no such pack). Definer: RLS on packs reads pack_shares and the reverse.
create or replace function pack_owner(p_key text) returns uuid
language sql stable security definer set search_path = public as $$
  select owner_org_id from packs where key = p_key order by created_at limit 1
$$;

-- A workspace's own framework is shared with the private packs that list it (`frameworks`): readable by the members of
-- every workspace such a pack is shared to.
create or replace function framework_shared_to_me(p_owner uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner is not null and exists (
    select 1 from pack_shares s
      join packs p on p.key = s.pack_key and p.owner_org_id = p_owner
     where is_member(s.org_id)
       and exists (select 1 from jsonb_array_elements(coalesce(p.manifest->'frameworks', '[]')) x where x->>'key' = p_key))
$$;
-- Whether a pack is visible to the person: ours, a member of its publisher, or shared to a workspace they belong to; a
-- workspace's own framework library (`framework-w…`) when its framework is shared with them (below).
create or replace function pack_visible(p_key text, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner is null or is_member(p_owner)
      or exists (select 1 from pack_shares s where s.pack_key = p_key and is_member(s.org_id))
      or (p_key like 'framework-w%' and exists (
            select 1 from frameworks f where f.pack_key = p_key and f.org_id = p_owner
               and framework_shared_to_me(f.org_id, f.key)))
$$;

revoke all on function pack_owner(text), pack_visible(text, uuid), framework_shared_to_me(uuid, text) from public, anon;
-- RLS policies call them as the querying person
grant execute on function pack_owner(text), pack_visible(text, uuid), framework_shared_to_me(uuid, text) to authenticated;

-- The publisher's name for a pack the person can see (install previews name it; a client admin who is not a member of
-- the publisher cannot read its row of `orgs`). Null for ours and for packs they cannot see.
create or replace function pack_publisher(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select o.name from packs p join orgs o on o.id = p.owner_org_id
   where p.key = p_key and pack_visible(p.key, p.owner_org_id)
   order by p.created_at limit 1
$$;
revoke all on function pack_publisher(text) from public, anon;
grant execute on function pack_publisher(text) to authenticated;

create policy pack_shares_read on pack_shares for select to authenticated
  using (is_member(org_id) or is_member(pack_owner(pack_key)));

-- ───────────────────────── 3. reads ─────────────────────────
drop policy if exists packs_read on packs;
drop policy if exists frameworks_read on frameworks;
drop policy if exists requirements_read on requirements;
create policy packs_read on packs for select to authenticated using (pack_visible(key, owner_org_id));
create policy frameworks_read on frameworks for select to authenticated
  using (org_id is null or is_member(org_id) or framework_shared_to_me(org_id, key));
create policy requirements_read on requirements for select to authenticated
  using (org_id is null or is_member(org_id) or framework_shared_to_me(org_id, framework_key));

-- ───────────────────────── helpers (never granted) ─────────────────────────
-- Semver as numbers, for ordering versions.
create or replace function _semver(p text) returns int[] language sql immutable as $$
  select string_to_array(p, '.')::int[]
$$;

-- Whether p_org may install (or adopt) a pack of another workspace now, and whether that is a first install:
-- 'shared' (a share exists), 'first' (the caller is owner or admin of both and the pack is not withdrawn), or null.
-- A workspace's own framework library goes with the private packs that list its framework.
create or replace function _private_access(p_pack packs, p_org uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare fw frameworks;
begin
  if p_pack.owner_org_id is null or p_pack.owner_org_id = p_org then return 'own'; end if;
  if p_pack.key like 'framework-w%' then
    select * into fw from frameworks where pack_key = p_pack.key and org_id = p_pack.owner_org_id limit 1;
    if fw.key is null then return null; end if;
    return _framework_access(fw, p_org);
  end if;
  if exists (select 1 from pack_shares where pack_key = p_pack.key and org_id = p_org) then return 'shared'; end if;
  if is_admin(p_pack.owner_org_id) and is_admin(p_org) and p_pack.withdrawn_at is null then return 'first'; end if;
  return null;
end $$;

create or replace function _framework_access(p_fw frameworks, p_org uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if p_fw.org_id is null or p_fw.org_id = p_org then return 'own'; end if;
  -- listed by a private pack of its workspace that is shared to p_org, or that the caller may install there first
  if exists (select 1 from packs p
              where p.owner_org_id = p_fw.org_id and p.key not like 'framework-%'
                and exists (select 1 from jsonb_array_elements(coalesce(p.manifest->'frameworks', '[]')) x
                             where x->>'key' = p_fw.key)
                and (exists (select 1 from pack_shares s where s.pack_key = p.key and s.org_id = p_org)
                     or (p.withdrawn_at is null and is_admin(p_fw.org_id) and is_admin(p_org)))) then
    return 'shared';
  end if;
  return null;
end $$;
revoke all on function _semver(text), _private_access(packs, uuid), _framework_access(frameworks, uuid)
  from public, anon, authenticated, service_role;

-- `source: private` and the publisher on the target's pack.installed / pack.extended / pack.upgraded entry
-- (app.pack_source, set by install_pack and upgrade_pack for a private pack). Runs before the chain trigger.
create or replace function activity_b_pack_source() returns trigger language plpgsql as $$
declare v text := coalesce(current_setting('app.pack_source', true), '');
begin
  if v <> '' and new.chain_key = '' and new.action in ('pack.installed', 'pack.extended', 'pack.upgraded') then
    new.new_value := coalesce(new.new_value, '{}'::jsonb) || v::jsonb;
  end if;
  return new;
end $$;
revoke all on function activity_b_pack_source() from public, anon, authenticated;
create trigger activity_b_pack_source_bi before insert on activity_log
  for each row execute function activity_b_pack_source();

-- ───────────────────────── 4. publish and withdraw ─────────────────────────
-- Publish a version of the workspace's own pack (docs/11 Your own packs). p_pack is what the command built and checked
-- against the manifest schema: { key, version, title, description, manifest, hash, counts, left_out }.
create or replace function publish_pack(p_org uuid, p_pack jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := p_pack->>'key';
  v_version text := p_pack->>'version';
  m jsonb := p_pack->'manifest';
  v_title text := btrim(coalesce(p_pack->>'title', ''));
  latest packs; bad text; v_left jsonb := coalesce(p_pack->'left_out', '[]');
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins publish packs'; end if;
  if v_key is null or v_key !~ '^w[0-9a-f]{8}-[a-z0-9][a-z0-9-]{0,39}$' or substr(v_key, 2, 8) <> left(p_org::text, 8) then
    raise exception 'publish: the key is not this workspace''s';
  end if;
  if coalesce(v_version, '') !~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$' then raise exception 'publish: the version is not 1.2.3'; end if;
  if char_length(v_title) not between 1 and 120 then raise exception 'publish: the name is 1 to 120 characters'; end if;
  if char_length(coalesce(p_pack->>'description', '')) > 2000 then raise exception 'publish: the description is too long'; end if;
  if coalesce(p_pack->>'hash', '') !~ '^[0-9a-f]{64}$' then raise exception 'publish: no hash'; end if;
  if jsonb_typeof(m) is distinct from 'object' or m->>'key' is distinct from v_key or m->>'version' is distinct from v_version
     or m->>'title' is distinct from v_title then
    raise exception 'publish: the manifest is not this pack''s';
  end if;
  if jsonb_typeof(v_left) <> 'array' or jsonb_array_length(v_left) > 500 then raise exception 'publish: bad left-out report'; end if;

  -- write-once, and every version higher than the last
  perform 1 from packs where key = v_key for update;
  select * into latest from packs where key = v_key order by _semver(version) desc limit 1;
  if latest.key is not null and latest.owner_org_id is distinct from p_org then
    raise exception 'publish: the key is not this workspace''s';
  end if;
  if latest.key is not null and _semver(v_version) <= _semver(latest.version) then
    raise exception 'publish: version % is not higher than %', v_version, latest.version;
  end if;

  -- ── the safety rules (owner decision 3), whatever the command sent
  if m @? '$.sheets[*].items[*]' or m @? '$.extends[*].items[*]' then
    raise exception 'publish: example items come later';
  end if;
  if m @? '$.automations[*] ? (!(exists(@.startInTestMode)) || @.startInTestMode != true)'
     or m @? '$.extends[*].automations[*] ? (!(exists(@.startInTestMode)) || @.startInTestMode != true)' then
    raise exception 'publish: every automation starts in test mode';
  end if;
  if m @? '$.**.actions[*] ? (@.type == "webhook" || @.type == "send_email" || @.type == "email")' then
    raise exception 'publish: an automation sends outside the workspace';
  end if;
  if m @? '$.sheets[*] ? (@.personalData == true && @.restricted == false)' then
    raise exception 'publish: a sheet with personal data installs restricted';
  end if;
  if m @? '$.**.approvers ? (@.kind == "people")' or m @? '$.**.allowedUserIds[*]'
     or m @? '$.**.notify[*]' or m::text ~ '"user:[0-9a-fA-F-]{36}"' then
    raise exception 'publish: people belong to a workspace and are never copied';
  end if;
  if coalesce((m->>'system')::boolean, false) or jsonb_array_length(coalesce(m->'apps', '[]')) > 0 then
    raise exception 'publish: a workspace''s pack is not a system pack and carries no apps';
  end if;
  select string_agg(r->>'pack', ', ') into bad from jsonb_array_elements(coalesce(m->'requires', '[]')) r
   where not exists (select 1 from packs p where p.key = r->>'pack' and p.owner_org_id is null);
  if bad is not null then raise exception 'publish: it requires packs that are not ours: %', bad; end if;
  select string_agg((x->>'key') || '@' || (x->>'version'), ', ') into bad from jsonb_array_elements(coalesce(m->'frameworks', '[]')) x
   where not exists (select 1 from frameworks f where f.key = x->>'key' and f.version = x->>'version'
                                                 and (f.org_id is null or f.org_id = p_org));
  if bad is not null then raise exception 'publish: unknown frameworks: %', bad; end if;

  perform set_config('app.pack_publish', 'on', true);
  insert into packs (key, version, title, description, manifest, hash, owner_org_id, published_by, published_at,
                     withdrawn_at, withdrawn_by)
  values (v_key, v_version, v_title, coalesce(p_pack->>'description', ''), m, p_pack->>'hash', p_org, auth.uid(), now(),
          -- a withdrawn pack stays withdrawn: a new version reaches the copies installed, never a new workspace
          latest.withdrawn_at, latest.withdrawn_by);
  perform set_config('app.pack_publish', '', true);

  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'pack.published',
          jsonb_build_object('pack_key', v_key, 'version', v_version, 'title', v_title, 'hash', p_pack->>'hash',
                             'from_version', latest.version, 'counts', coalesce(p_pack->'counts', '{}'),
                             'left_out', v_left));
  return jsonb_build_object('key', v_key, 'version', v_version, 'withdrawn', latest.withdrawn_at is not null);
end $$;

-- Withdraw a workspace's own pack: no new installs anywhere; installed copies keep working and taking updates.
create or replace function withdraw_pack(p_org uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; v_title text; v_shares int;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins withdraw packs'; end if;
  if not exists (select 1 from packs where key = p_key and owner_org_id = p_org) or p_key like 'framework-%' then
    raise exception 'pack not found';
  end if;
  perform set_config('app.pack_publish', 'on', true);
  update packs set withdrawn_at = now(), withdrawn_by = auth.uid()
   where key = p_key and owner_org_id = p_org and withdrawn_at is null;
  get diagnostics n = row_count;
  perform set_config('app.pack_publish', '', true);
  if n = 0 then raise exception 'pack already withdrawn'; end if;
  select title into v_title from packs where key = p_key order by _semver(version) desc limit 1;
  select count(*) into v_shares from pack_shares where pack_key = p_key;
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'pack.withdrawn',
          jsonb_build_object('pack_key', p_key, 'title', v_title, 'versions', n, 'shared_with', v_shares));
  return jsonb_build_object('key', p_key, 'versions', n, 'shared_with', v_shares);
end $$;

-- ───────────────────────── 5. install, upgrade, adopt: visibility and shares ─────────────────────────
-- install_pack (0074) with the private-pack rules: a pack of another workspace installs only where it is shared, or as
-- a first install by a person who is owner or admin in both workspaces (which shares it, `pack.shared` on the
-- publisher's chain); a withdrawn pack never installs anew. The target's entry says `source: private`.
create or replace function install_pack(p_org uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; pk packs; e jsonb; s sheets; v_id text; n int := 0; v_list jsonb; v_access text;
begin
  select * into pk from packs where key = p_plan->'pack'->>'key' and version = p_plan->'pack'->>'version';
  if pk.key is not null and pk.owner_org_id is not null then
    v_access := _private_access(pk, p_org);
    if v_access is null then
      if pk.withdrawn_at is not null and is_member(pk.owner_org_id) then raise exception 'pack withdrawn: it takes no new installs'; end if;
      if pack_visible(pk.key, pk.owner_org_id) then
        raise exception 'not allowed: the first install needs an owner or admin of both workspaces';
      end if;
      raise exception 'pack not found';
    end if;
    if pk.withdrawn_at is not null and nullif(p_plan->>'extend_install', '') is null then
      raise exception 'pack withdrawn: it takes no new installs';
    end if;
    if pk.owner_org_id <> p_org then
      perform set_config('app.pack_source',
                         jsonb_build_object('source', 'private', 'publisher_org_id', pk.owner_org_id)::text, true);
    end if;
  end if;
  r := _install_pack_rows(p_org, p_plan);
  perform set_config('app.pack_source', '', true);
  if v_access = 'first' then
    perform set_config('app.pack_share', 'on', true);
    insert into pack_shares (pack_key, org_id, granted_by) values (pk.key, p_org, auth.uid());
    perform set_config('app.pack_share', '', true);
    insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
    values (pk.owner_org_id, '', 'user', auth.uid(), 'pack.shared',
            jsonb_build_object('pack_key', pk.key, 'version', pk.version, 'title', pk.title, 'org_id', p_org,
                               'org_name', (select name from orgs where id = p_org)));
  end if;
  if jsonb_typeof(p_plan->'workflows') = 'array' and jsonb_array_length(p_plan->'workflows') > 0 then
    perform set_config('app.pack_op', 'install', true);
    for e in select x from jsonb_array_elements(p_plan->'workflows') x loop
      v_id := e->'workflow'->>'id';
      if jsonb_typeof(e->'workflow') is distinct from 'object' or not _pack_owns_workflow(pk.key, v_id)
         or not _wf_valid(e->'workflow') then
        raise exception 'pack plan: an approval workflow on another pack''s sheet needs an id in the pack''s namespace';
      end if;
      select * into s from sheets where id = (e->>'sheet_id')::uuid for update;
      if s.id is null or not _pack_extend_target(p_org, pk.manifest, s.id) then
        raise exception 'pack plan: approval workflows go on a sheet of a pack this one requires';
      end if;
      -- the manifest ships it on that sheet
      if not exists (
        select 1 from jsonb_array_elements(coalesce(pk.manifest->'extends', '[]')) x
                 join pack_installs pi on pi.id = s.pack_install_id and pi.pack_key = x->>'pack',
             jsonb_array_elements(coalesce(x->'workflows', '[]')) w
         where x->>'sheet' = s.pack_ref and w->>'id' = v_id) then
        raise exception 'pack plan: the pack does not ship the approval workflow % on this sheet', v_id;
      end if;
      v_list := case when jsonb_typeof(s.settings->'workflows') = 'array' then s.settings->'workflows' else '[]'::jsonb end;
      if exists (select 1 from jsonb_array_elements(v_list) w where w->>'id' = v_id) then continue; end if;
      update sheets set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{workflows}', v_list || jsonb_build_array(e->'workflow')),
                        updated_at = now()
       where id = s.id;
      n := n + 1;
    end loop;
    perform set_config('app.pack_op', '', true);
  end if;
  return r || jsonb_build_object('workflows', n);
end $$;

-- upgrade_pack (0074): a version of another workspace's pack only where the pack is shared (or, for an own framework's
-- library, where its framework is); withdrawn packs keep taking updates. The entry says `source: private`.
create or replace function upgrade_pack(p_install uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i pack_installs; pk packs; r jsonb; v_access text;
begin
  select * into i from pack_installs where id = p_install;
  if i.id is null or not is_member(i.org_id) then raise exception 'pack install not found'; end if;
  select * into pk from packs where key = i.pack_key and version = p_plan->'pack'->>'version';
  if pk.key is not null and pk.owner_org_id is not null and pk.owner_org_id is distinct from i.org_id then
    v_access := _private_access(pk, i.org_id);
    -- an update never shares: the install was shared when it was made
    if v_access is distinct from 'shared' then raise exception 'pack version not found'; end if;
    perform set_config('app.pack_source',
                       jsonb_build_object('source', 'private', 'publisher_org_id', pk.owner_org_id)::text, true);
  end if;
  r := _upgrade_pack_rows(p_install, p_plan);
  perform set_config('app.pack_source', '', true);
  return r;
end $$;

-- adopt_framework (0074): a workspace's own framework of another workspace is adopted where a private pack that lists
-- it is shared, or on the first install of such a pack (the caller is owner or admin of both).
create or replace function adopt_framework(p_org uuid, p_framework text, p_version text, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fw frameworks; out jsonb; inst uuid; lib uuid; rf uuid; bad text; n int; want int;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins adopt frameworks'; end if;
  select * into fw from frameworks where key = p_framework and version = p_version;
  if fw.key is null or _framework_access(fw, p_org) is null then raise exception 'framework not found'; end if;
  if (p_plan->'pack'->>'key', p_plan->'pack'->>'version') is distinct from (fw.pack_key, fw.pack_version) then
    raise exception 'adopt: the plan is not this framework''s library';
  end if;
  if exists (select 1 from sheets s where s.org_id = p_org and s.archived_at is null
               and s.settings->'framework'->>'key' = fw.key and s.settings->'framework'->>'version' = fw.version) then
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
                             'install_id', inst, 'requirements', n)
          || case when fw.org_id is not null and fw.org_id <> p_org
                  then jsonb_build_object('source', 'private', 'publisher_org_id', fw.org_id) else '{}'::jsonb end);
  return out || jsonb_build_object('sheet_id', lib, 'requirements', n);
end $$;

-- ───────────────────────── grants (0008: nothing is executable unless granted) ─────────────────────────
revoke all on function publish_pack(uuid, jsonb), withdraw_pack(uuid, text), install_pack(uuid, jsonb),
  upgrade_pack(uuid, jsonb), adopt_framework(uuid, text, text, jsonb) from public, anon;
grant execute on function publish_pack(uuid, jsonb), withdraw_pack(uuid, text), upgrade_pack(uuid, jsonb),
  adopt_framework(uuid, text, text, jsonb) to authenticated;
-- the seed's service role installs catalogue packs (0024)
grant execute on function install_pack(uuid, jsonb) to authenticated, service_role;
