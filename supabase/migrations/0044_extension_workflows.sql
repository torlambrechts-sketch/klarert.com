-- 0044_extension_workflows.sql · Approval workflows in extends, tab sets in upgrades (docs/11 Extends, Upgrades;
-- Core registers 1.1.0).
-- 1. install_pack writes p_plan.workflows: [{ ref, sheet_id, workflow }], approval workflows an add-on adds to a sheet of
--    a pack it requires (docs/11 Extends), merged by id into that sheet's settings.workflows (an id already there is
--    left as it is). The id starts with the pack's namespace (its key without "-", then "_"), the manifest names the
--    workflow on that sheet, and the definition has the shape the approval RPCs rely on (_wf_valid). The rows of the
--    plan are written by the install as before (0042), renamed _install_pack_rows; install_pack calls it, then writes
--    the workflows, in one transaction. create_bundle and adopt_framework call install_pack and get both.
-- 2. apply_pack_upgrade (0040) also writes a list on another pack's sheet: only the entries in this pack's namespace
--    may differ from what the sheet holds (everything else is kept exactly, in its order). And it writes
--    p_plan.update.tabs: [{ sheet_id, tabs, tabsDefault, defaultViewId }], the tab set of the install's own sheets
--    (a built-in view type or a view of that sheet per tab).
-- 3. archive_pack takes an add-on's approval workflows (ids in its namespace) off the sheets of the packs it requires,
--    after the archive as 0041 (renamed _archive_pack_rows). Approvals in progress keep the copy they started with.

-- ───────────────────────── helpers (never granted) ─────────────────────────
-- A workflow id that belongs to a pack's namespace: `<namespace>_…`.
create or replace function _pack_owns_workflow(p_pack_key text, p_id text) returns boolean
language sql immutable as $$
  select coalesce(p_id, '') <> ''
     and left(p_id, length(regexp_replace(p_pack_key, '[^a-z0-9]', '', 'g')) + 1)
         = regexp_replace(p_pack_key, '[^a-z0-9]', '', 'g') || '_'
$$;
revoke all on function _pack_owns_workflow(text, text) from public, anon, authenticated;

-- A sheet's workflow list without the entries of a pack's namespace, in order.
create or replace function _pack_other_workflows(p_list jsonb, p_pack_key text) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(w order by o), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end)
         with ordinality as a(w, o)
   where not _pack_owns_workflow(p_pack_key, w->>'id')
$$;
revoke all on function _pack_other_workflows(jsonb, text) from public, anon, authenticated;

-- ───────────────────────── install: rows, then the extension workflows ─────────────────────────
alter function install_pack(uuid, jsonb) rename to _install_pack_rows;
revoke all on function _install_pack_rows(uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function install_pack(p_org uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; pk packs; e jsonb; s sheets; v_id text; n int := 0; v_list jsonb;
begin
  r := _install_pack_rows(p_org, p_plan);
  if jsonb_typeof(p_plan->'workflows') = 'array' and jsonb_array_length(p_plan->'workflows') > 0 then
    select * into pk from packs where key = p_plan->'pack'->>'key' and version = p_plan->'pack'->>'version';
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
revoke all on function install_pack(uuid, jsonb) from public, anon;
grant execute on function install_pack(uuid, jsonb) to authenticated, service_role;

-- ───────────────────────── upgrade: workflows on required packs' sheets, tab sets ─────────────────────────
create or replace function apply_pack_upgrade(p_install uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; e jsonb; t jsonb; n int := 0; nt int := 0; i pack_installs; pk packs; s sheets;
begin
  r := upgrade_pack(p_install, p_plan);
  select * into i from pack_installs where id = p_install;
  select * into pk from packs where key = i.pack_key and version = p_plan->'pack'->>'version';
  perform set_config('app.pack_op', 'upgrade', true);
  for e in select x from jsonb_array_elements(case when jsonb_typeof(p_plan->'update'->'workflows') = 'array'
                                                   then p_plan->'update'->'workflows' else '[]'::jsonb end) x loop
    if jsonb_typeof(e->'workflows') is distinct from 'array' then
      raise exception 'upgrade plan: approval workflows must be a list';
    end if;
    select * into s from sheets where id = (e->>'sheet_id')::uuid for update;
    if s.id is null or s.org_id <> i.org_id then
      raise exception 'upgrade plan: a sheet that is not the install''s own (%)', e->>'sheet_id';
    end if;
    if s.pack_install_id is distinct from p_install then
      -- another pack's sheet (docs/11 Extends): only this pack's own entries change
      if not _pack_extend_target(i.org_id, pk.manifest, s.id) then
        raise exception 'upgrade plan: a sheet that is not the install''s own (%)', e->>'sheet_id';
      end if;
      if _pack_other_workflows(s.settings->'workflows', i.pack_key) <> _pack_other_workflows(e->'workflows', i.pack_key) then
        raise exception 'upgrade plan: on another pack''s sheet only the pack''s own approval workflows change';
      end if;
      if exists (select 1 from jsonb_array_elements(e->'workflows') w
                  where _pack_owns_workflow(i.pack_key, w->>'id') and not _wf_valid(w)) then
        raise exception 'upgrade plan: an approval workflow is not valid';
      end if;
    end if;
    update sheets set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{workflows}', e->'workflows'),
                      updated_at = now()
     where id = s.id;
    n := n + 1;
  end loop;
  for e in select x from jsonb_array_elements(case when jsonb_typeof(p_plan->'update'->'tabs') = 'array'
                                                   then p_plan->'update'->'tabs' else '[]'::jsonb end) x loop
    select * into s from sheets where id = (e->>'sheet_id')::uuid and pack_install_id = p_install for update;
    if s.id is null then
      raise exception 'upgrade plan: a sheet that is not the install''s own (%)', e->>'sheet_id';
    end if;
    if jsonb_typeof(e->'tabs') is distinct from 'array' or jsonb_array_length(e->'tabs') not between 1 and 40 then
      raise exception 'upgrade plan: a tab set is a list of 1 to 40 tabs';
    end if;
    for t in select x from jsonb_array_elements(e->'tabs' || coalesce(nullif(e->'tabsDefault', 'null'::jsonb), '[]'::jsonb)) x loop
      if not (t->>'id' in ('table', 'insights', 'kanban', 'calendar', 'form')
              or exists (select 1 from views v where v.id::text = t->>'id' and v.sheet_id = s.id)) then
        raise exception 'upgrade plan: a tab names a view of another sheet';
      end if;
    end loop;
    update sheets
       set settings = (coalesce(settings, '{}'::jsonb) - 'defaultViewId')
                      || jsonb_build_object('tabs', e->'tabs', 'tabsDefault', coalesce(nullif(e->'tabsDefault', 'null'::jsonb), e->'tabs'))
                      || case when jsonb_typeof(e->'defaultViewId') = 'string'
                              then jsonb_build_object('defaultViewId', e->'defaultViewId') else '{}'::jsonb end,
           updated_at = now()
     where id = s.id;
    nt := nt + 1;
  end loop;
  perform set_config('app.pack_op', '', true);
  return r || jsonb_build_object('workflows', n, 'tabs', nt);
end $$;
revoke all on function apply_pack_upgrade(uuid, jsonb) from public, anon;
grant execute on function apply_pack_upgrade(uuid, jsonb) to authenticated;

-- ───────────────────────── archive: an add-on's workflows leave the shared sheets ─────────────────────────
alter function archive_pack(uuid) rename to _archive_pack_rows;
revoke all on function _archive_pack_rows(uuid) from public, anon, authenticated, service_role;

create or replace function archive_pack(p_install uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; i pack_installs; pk packs; n int;
begin
  r := _archive_pack_rows(p_install);
  select * into i from pack_installs where id = p_install;
  select * into pk from packs where key = i.pack_key and version = i.version;
  perform set_config('app.pack_op', 'archive', true);
  update sheets s
     set settings = jsonb_set(s.settings, '{workflows}', _pack_other_workflows(s.settings->'workflows', i.pack_key)),
         updated_at = now()
   where s.org_id = i.org_id and s.pack_install_id is distinct from i.id
     and jsonb_typeof(s.settings->'workflows') = 'array'
     and exists (select 1 from jsonb_array_elements(s.settings->'workflows') w
                  where _pack_owns_workflow(i.pack_key, w->>'id'))
     and _pack_extend_target(i.org_id, pk.manifest, s.id);
  get diagnostics n = row_count;
  perform set_config('app.pack_op', '', true);
  if n > 0 then r := r || jsonb_build_object('workflow_sheets', n); end if;
  return r;
end $$;
revoke all on function archive_pack(uuid) from public, anon;
grant execute on function archive_pack(uuid) to authenticated;
