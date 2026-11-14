-- 0047_create_bundle_settings.sql · Pack settings chosen in the Create wizard (docs/05 §4 Create, docs/11 Bundles and
-- Pack settings; owner decision 14 Nov 2026). A ready-made set whose pack declares settings (NIS2's country) can be
-- created with the choices made in Create's Details step. create_bundle now reads `p_bundle.settings` (setting key →
-- choice id) and, after install_pack and in the same transaction, records them with set_pack_settings: the same
-- checks as Workspace admin › Packs › Settings (known settings and choices only, owners and admins), the same
-- `pack.settings_changed` entry. The plan already carries the defaults the choices set (the planner resolves the
-- `$setting:` tokens), so no field is named here. An unknown setting or choice rolls the whole set back. The settings
-- stay editable later in Packs. Without settings (or with an empty object) create_bundle behaves as before.

create or replace function create_bundle(p_org uuid, p_plan jsonb, p_bundle jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; inst uuid; pk packs;
  v_name text := btrim(coalesce(p_bundle->>'name', ''));
  v_owner uuid := nullif(p_bundle->>'owner_id', '')::uuid;
  v_review date := nullif(p_bundle->>'review_by', '')::date;
  v_settings jsonb := coalesce(p_bundle->'settings', '{}'::jsonb);
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
  if jsonb_typeof(v_settings) <> 'object' then raise exception 'bundle: settings must be an object'; end if;

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

  -- the choices made in Create (docs/11 Pack settings): checked and logged as in Packs › Settings
  if v_settings <> '{}'::jsonb then
    perform set_pack_settings(inst, v_settings, '[]'::jsonb);
  end if;
  return r || jsonb_build_object('install_id', inst, 'settings', v_settings);
end $$;

-- rule 6 (migration 0008): API roles run it only through this grant; the internal helpers stay ungranted
revoke all on function create_bundle(uuid, jsonb, jsonb) from public, anon;
grant execute on function create_bundle(uuid, jsonb, jsonb) to authenticated;
