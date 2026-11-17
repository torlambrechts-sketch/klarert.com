-- 0076_pack_restricted_fields.sql · P9: restricted columns travel with a pack, and a publisher with installs cannot be
-- deleted by accident (docs/11 Your own packs, docs/02 §15 and §16; owner decisions of 17 Nov 2026).
--
-- 1. A pack field may say `restrictedTo: { roles }` (the manifest's optional field property). The planner writes it on
--    the plan's field row as `restricted_to: { userIds: [], roles }`. Roles only: people are never carried.
--    * install_pack applies it to the fields the plan just made (_pack_restrict_field, `field.restricted` on the sheet
--      chain, like set_field_restriction). Such a column carries no example values, links or files: the install's own
--      log entries would hold them in clear (the item trigger masks only what is restricted when it is written).
--    * upgrade_pack applies it to the fields an update adds, and changes it on the install's fields the update names
--      (`update.fields[].restricted_to`, an object or null): the planner sends a change only where the workspace has
--      not changed the column's roles, or where the person took the pack's in a conflict. The people the workspace
--      listed stay (the plan may keep them, never add one); values move in or out of the store as
--      set_field_restriction moves them, and changing it needs what set_field_restriction needs (an owner, or an admin
--      with edit access to the sheet).
-- 2. publish_pack refuses a manifest whose restricted column names people or a role that is not admin, editor, viewer
--    or auditor (owners always see).
-- 3. orgs_publisher_guard: a workspace that published a pack another workspace has installed cannot be deleted; the
--    message says so in words instead of the pack_installs foreign key error. It covers every path that deletes a
--    workspace (the app has none today; the GDPR "delete workspace" job and support will).

-- ───────────────────────── 1. a restricted column of a pack ─────────────────────────
-- Set (or clear, p_next null) a pack field's restriction. p_new: a field the plan just made (no values allowed).
create or replace function _pack_restrict_field(p_field uuid, p_next jsonb, p_new boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f fields; nxt jsonb; act text;
  v_actor text := case when auth.uid() is null then 'system' else 'user' end;
begin
  select * into f from fields where id = p_field and archived_at is null;
  if f.id is null then raise exception 'pack plan: field % not found', p_field; end if;
  if p_next is not null then
    if jsonb_typeof(p_next) <> 'object'
       or exists (select 1 from jsonb_object_keys(p_next) k where k not in ('roles', 'userIds'))
       or jsonb_typeof(coalesce(p_next->'roles', '[]')) <> 'array'
       or jsonb_typeof(coalesce(p_next->'userIds', '[]')) <> 'array' then
      raise exception 'pack plan: a restricted column names its roles';
    end if;
    if exists (select 1 from jsonb_array_elements(p_next->'roles') r
                where jsonb_typeof(r) <> 'string' or r #>> '{}' not in ('admin', 'editor', 'viewer', 'auditor')) then
      raise exception 'pack plan: a restricted column names admin, editor, viewer or auditor';
    end if;
    -- people are never carried: an update may keep the people the workspace listed, never add one
    if exists (select 1 from jsonb_array_elements(coalesce(p_next->'userIds', '[]')) u
                where jsonb_typeof(u) <> 'string' or p_new
                   or not (coalesce(f.restricted_to->'userIds', '[]'::jsonb) ? (u #>> '{}'))) then
      raise exception 'pack plan: people belong to a workspace and are never copied';
    end if;
    nxt := jsonb_build_object(
      'userIds', (select coalesce(jsonb_agg(distinct u #>> '{}'), '[]'::jsonb) from jsonb_array_elements(coalesce(p_next->'userIds', '[]')) u),
      'roles', (select coalesce(jsonb_agg(distinct r #>> '{}'), '[]'::jsonb) from jsonb_array_elements(coalesce(p_next->'roles', '[]')) r));
  end if;
  if nxt is not distinct from f.restricted_to then return; end if;

  if p_new then
    if exists (select 1 from items i where i.sheet_id = f.sheet_id and i."values" ? f.id::text)
       or exists (select 1 from restricted_values rv where rv.field_id = f.id)
       or exists (select 1 from item_links l where l.field_id = f.id)
       or exists (select 1 from files x where x.field_id = f.id) then
      raise exception 'pack plan: a restricted column carries no example values';
    end if;
  elsif _is_person() and not (has_role(f.org_id, array['owner']::member_role[])
                              or (is_admin(f.org_id) and _level_rank(_sheet_level_for(auth.uid(), f.sheet_id)) >= 3)) then
    raise exception 'not allowed: only owners and admins with access to the sheet change who sees a restricted column';
  end if;

  perform set_config('app.access_op', 'on', true);
  if f.restricted_to is null then
    -- on: the values move to the store (the items trigger does it as the key leaves the row)
    update fields set restricted_to = nxt where id = f.id;
    insert into restricted_values(org_id, sheet_id, item_id, field_id, value)
    select i.org_id, i.sheet_id, i.id, f.id, i."values" -> f.id::text from items i
     where i.sheet_id = f.sheet_id and i."values" ? f.id::text
    on conflict (item_id, field_id) do update set value = excluded.value;
    update items set "values" = "values" - f.id::text where sheet_id = f.sheet_id and "values" ? f.id::text;
    act := 'field.restricted';
  elsif nxt is null then
    -- off: back into the rows
    update fields set restricted_to = null where id = f.id;
    update items i set "values" = i."values" || jsonb_build_object(f.id::text, rv.value)
      from restricted_values rv where rv.item_id = i.id and rv.field_id = f.id;
    delete from restricted_values where field_id = f.id;
    act := 'field.unrestricted';
  else
    update fields set restricted_to = nxt where id = f.id;
    act := 'field.restriction_changed';
  end if;
  perform set_config('app.access_op', '', true);
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (f.org_id, f.sheet_id, '', v_actor, auth.uid(), act,
          case when f.restricted_to is not null then jsonb_build_object('field_id', f.id) || f.restricted_to end,
          case when nxt is not null then jsonb_build_object('field_id', f.id) || nxt end,
          f.name);
end $$;
revoke all on function _pack_restrict_field(uuid, jsonb, boolean) from public, anon, authenticated, service_role;

-- install_pack (0075) + the restricted columns of the plan's fields.
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
  -- restricted columns (0076): every field of the plan was made just now by _install_pack_rows
  perform _pack_restrict_field((x->>'id')::uuid, x->'restricted_to', true)
     from jsonb_array_elements(coalesce(p_plan->'fields', '[]')) x
    where jsonb_typeof(x->'restricted_to') = 'object';
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

-- upgrade_pack (0075) + restricted columns: those an update adds, and a change to those it names.
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
  -- _upgrade_pack_rows checks that every field the plan updates is this install's, and makes the ones it adds
  r := _upgrade_pack_rows(p_install, p_plan);
  perform set_config('app.pack_source', '', true);
  perform _pack_restrict_field((x->>'id')::uuid, x->'restricted_to', true)
     from jsonb_array_elements(coalesce(p_plan->'add'->'fields', '[]')) x
    where jsonb_typeof(x->'restricted_to') = 'object';
  perform _pack_restrict_field((x->>'id')::uuid,
                               case when jsonb_typeof(x->'restricted_to') = 'object' then x->'restricted_to' end, false)
     from jsonb_array_elements(coalesce(p_plan->'update'->'fields', '[]')) x
    where x ? 'restricted_to';
  return r;
end $$;

-- ───────────────────────── 2. publish: roles only ─────────────────────────
-- publish_pack (0075) + a restricted column names roles, never people.
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
     or m @? '$.**.notify[*]' or m::text ~ '"user:[0-9a-fA-F-]{36}"'
     -- a restricted column carries its roles, never its people (0076)
     or m @? '$.**.restrictedTo ? (exists(@.userIds))' then
    raise exception 'publish: people belong to a workspace and are never copied';
  end if;
  if m @? '$.**.restrictedTo ? (@.type() != "object" || !(exists(@.roles)) || @.roles.type() != "array")'
     or m @? '$.**.restrictedTo.roles[*] ? (@ != "admin" && @ != "editor" && @ != "viewer" && @ != "auditor")' then
    raise exception 'publish: a restricted column names admin, editor, viewer or auditor';
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

-- ───────────────────────── 3. a publisher with installs elsewhere is not deleted ─────────────────────────
create or replace function orgs_publisher_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_titles text; v_n int;
begin
  select string_agg(distinct p.title, ', '), count(distinct pi.org_id) into v_titles, v_n
    from packs p join pack_installs pi on pi.pack_key = p.key and pi.version = p.version
   where p.owner_org_id = old.id and pi.org_id <> old.id;
  if v_n > 0 then
    raise exception using errcode = '23503',
      message = format('This workspace published packs that %s other %s installed (%s). It cannot be deleted while they are installed there.',
                       v_n, case when v_n = 1 then 'workspace has' else 'workspaces have' end, v_titles),
      hint = 'The copies installed elsewhere need the versions this workspace published.';
  end if;
  return old;
end $$;
revoke all on function orgs_publisher_guard() from public, anon, authenticated, service_role;
create trigger orgs_publisher_guard before delete on orgs for each row execute function orgs_publisher_guard();

-- ───────────────────────── grants (0008) ─────────────────────────
revoke all on function publish_pack(uuid, jsonb), install_pack(uuid, jsonb), upgrade_pack(uuid, jsonb) from public, anon;
grant execute on function publish_pack(uuid, jsonb), upgrade_pack(uuid, jsonb) to authenticated;
-- the seed's service role installs catalogue packs (0024)
grant execute on function install_pack(uuid, jsonb) to authenticated, service_role;
