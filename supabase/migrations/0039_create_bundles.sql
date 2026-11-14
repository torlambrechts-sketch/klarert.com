-- 0039_create_bundles.sql · Create wizard (docs/05 §4 Create, docs/11 Bundles). A ready-made app made from the Create
-- wizard is a pack install with a name, a named owner, a review date and its origin. Until the owner marks it reviewed
-- its sheets show "Generated from template, not yet reviewed" (the auditor's rule). create_bundle runs install_pack and
-- stamps the install in the same transaction, then logs bundle.created on the workspace chain ("created via Create
-- from <pack> <version>"); mark_bundle_reviewed is the owner's sign-off, logged as bundle.reviewed with who and when.
-- Archiving the whole set stays archive_pack (owners and admins).

alter table pack_installs
  add column bundle_name text check (bundle_name is null or char_length(bundle_name) between 1 and 120),
  add column owner_id    uuid references profiles(id),
  add column review_by   date,
  add column origin      text check (origin is null or origin = 'create'),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references profiles(id),
  add check ((reviewed_at is null) = (reviewed_by is null));

-- p_bundle: { name, owner_id, review_by (yyyy-mm-dd or null) }
create or replace function create_bundle(p_org uuid, p_plan jsonb, p_bundle jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; inst uuid; pk packs;
  v_name text := btrim(coalesce(p_bundle->>'name', ''));
  v_owner uuid := nullif(p_bundle->>'owner_id', '')::uuid;
  v_review date := nullif(p_bundle->>'review_by', '')::date;
begin
  if auth.uid() is null or not is_admin(p_org) then
    raise exception 'not allowed: only owners and admins create ready-made apps';
  end if;
  if char_length(v_name) not between 1 and 120 then raise exception 'bundle: a name is required'; end if;
  if v_owner is null or not exists (select 1 from memberships where org_id = p_org and user_id = v_owner) then
    raise exception 'bundle: the owner must be a member of the workspace';
  end if;
  if nullif(p_plan->>'extend_install', '') is not null then
    raise exception 'bundle: a level is added from Workspace admin, Packs';
  end if;

  r := install_pack(p_org, p_plan);
  inst := (r->>'install_id')::uuid;
  select * into pk from packs where key = p_plan->'pack'->>'key' and version = p_plan->'pack'->>'version';
  update pack_installs set bundle_name = v_name, owner_id = v_owner, review_by = v_review, origin = 'create'
   where id = inst;

  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (p_org, '', 'user', auth.uid(), 'bundle.created',
          jsonb_build_object('install_id', inst, 'name', v_name, 'pack_key', pk.key, 'version', pk.version,
                             'title', pk.title, 'owner_id', v_owner, 'review_by', v_review,
                             'level', p_plan->'pack'->>'level', 'counts', r->'counts'),
          'created via Create from ' || pk.title || ' ' || pk.version);
  return r || jsonb_build_object('install_id', inst);
end $$;

create or replace function mark_bundle_reviewed(p_install uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i pack_installs; at timestamptz := now();
begin
  select * into i from pack_installs where id = p_install for update;
  if i.id is null or not is_member(i.org_id) then raise exception 'bundle not found'; end if;
  if i.origin is distinct from 'create' then raise exception 'bundle not found'; end if;
  if i.status <> 'installed' then raise exception 'bundle: archived'; end if;
  if i.owner_id is distinct from auth.uid() then
    raise exception 'not allowed: only the named owner marks it reviewed';
  end if;
  if i.reviewed_at is not null then raise exception 'bundle: already reviewed'; end if;
  update pack_installs set reviewed_at = at, reviewed_by = auth.uid() where id = i.id;
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (i.org_id, '', 'user', auth.uid(), 'bundle.reviewed',
          jsonb_build_object('install_id', i.id, 'name', i.bundle_name, 'pack_key', i.pack_key,
                             'version', i.version, 'reviewed_at', at),
          'Marked reviewed by ' || _member_name(auth.uid()));
  return jsonb_build_object('install_id', i.id, 'reviewed_at', at, 'reviewed_by', auth.uid());
end $$;

-- migration 0008: new functions are not executable by API roles unless granted
revoke all on function create_bundle(uuid, jsonb, jsonb) from public, anon;
revoke all on function mark_bundle_reviewed(uuid) from public, anon;
grant execute on function create_bundle(uuid, jsonb, jsonb) to authenticated;
grant execute on function mark_bundle_reviewed(uuid) to authenticated;
