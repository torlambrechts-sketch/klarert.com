-- 0043_pack_settings.sql · Pack settings (docs/11 Pack settings; owner decision 14 Nov 2026 for the NIS2 country rules).
-- A pack may ship settings: choices shipped as data in its manifest (`settings`, e.g. NIS2's country with its
-- competent authority, CSIRT and registration route) that set the defaults of fields on the pack's own sheets.
-- 1. pack_installs.settings: the workspace's choices, setting key → choice id. Empty until chosen.
-- 2. set_pack_settings(install, settings, fields): an owner or admin records the choices (each key a setting of the
--    install's manifest, each value one of its choices) and, in the same transaction, sets or clears `config.default`
--    on the install's own fields the command names (fields made by this install only: pack_install_id = install).
--    Each field change is logged by the schema audit trigger on its sheet's chain; the workspace chain gets
--    `pack.settings_changed` with the choices' labels. The install writes its defaults through install_pack (the plan
--    carries them) and then records the choices with this function.

alter table pack_installs add column if not exists settings jsonb not null default '{}'::jsonb
  check (jsonb_typeof(settings) = 'object');
comment on column pack_installs.settings is
  'The workspace''s choices for the pack''s settings (docs/11 Pack settings): setting key → choice id.';

create or replace function set_pack_settings(p_install uuid, p_settings jsonb, p_fields jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  i pack_installs; pk packs; v_title text; n integer := 0; bad text; labels jsonb;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'settings must be an object';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then raise exception 'fields must be a list'; end if;
  select * into i from pack_installs where id = p_install for update;
  if i.id is null then raise exception 'pack install not found'; end if;
  if not is_admin(i.org_id) then raise exception 'only owners and admins change pack settings'; end if;
  if i.status <> 'installed' then raise exception 'this pack is no longer installed'; end if;
  select * into pk from packs where key = i.pack_key and version = i.version;
  v_title := pk.title;

  -- every key a setting of the manifest, every value one of its choices
  select string_agg(k, ', ') into bad from jsonb_each(p_settings) e(k, v)
   where jsonb_typeof(v) <> 'string'
      or not exists (select 1 from jsonb_array_elements(coalesce(pk.manifest->'settings', '[]')) s
                      where s->>'key' = k
                        and exists (select 1 from jsonb_array_elements(coalesce(s->'choices', '[]')) c
                                     where c->>'id' = e.v #>> '{}'));
  if bad is not null then raise exception 'unknown pack setting or choice (%)', bad; end if;

  -- the fields: this install's own, live, each named once, with a text default or none
  select string_agg(coalesce(f->>'id', '?'), ', ') into bad from jsonb_array_elements(p_fields) f
   where jsonb_typeof(f) <> 'object'
      or (f ? 'default' and jsonb_typeof(f->'default') not in ('string', 'null'))
      or not exists (select 1 from fields x where x.id::text = f->>'id' and x.org_id = i.org_id
                       and x.pack_install_id = i.id and x.archived_at is null);
  if bad is not null then raise exception 'pack settings: fields not of this install (%)', bad; end if;
  if (select count(*) from jsonb_array_elements(p_fields)) <>
     (select count(distinct f->>'id') from jsonb_array_elements(p_fields) f) then
    raise exception 'pack settings: a field is named twice';
  end if;

  update fields x
     set config = case when nullif(f.e->>'default', '') is null then x.config - 'default'
                       else jsonb_set(x.config, '{default}', to_jsonb(f.e->>'default')) end,
         updated_at = now()
    from jsonb_array_elements(p_fields) f(e)
   where x.id::text = f.e->>'id' and x.pack_install_id = i.id
     and (x.config->'default') is distinct from
         case when nullif(f.e->>'default', '') is null then null else to_jsonb(f.e->>'default') end;
  get diagnostics n = row_count;

  if i.settings is distinct from p_settings or n > 0 then
    update pack_installs set settings = p_settings where id = i.id;
    select coalesce(jsonb_object_agg(s->>'label', c->>'label'), '{}'::jsonb) into labels
      from jsonb_array_elements(coalesce(pk.manifest->'settings', '[]')) s
      join jsonb_array_elements(coalesce(s->'choices', '[]')) c on c->>'id' = p_settings->>(s->>'key');
    insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
    values (i.org_id, '', 'user', auth.uid(), 'pack.settings_changed',
            jsonb_build_object('install_id', i.id, 'pack_key', i.pack_key, 'title', v_title,
                               'version', i.version, 'settings', p_settings, 'labels', labels, 'fields', n));
  end if;
  return n;
end $$;

revoke all on function set_pack_settings(uuid, jsonb, jsonb) from public, anon;
grant execute on function set_pack_settings(uuid, jsonb, jsonb) to authenticated;
