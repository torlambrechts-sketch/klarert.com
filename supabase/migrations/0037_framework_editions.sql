-- 0037_framework_editions.sql · Edition status of frameworks and moving a library to a new edition (docs/12).
--
-- 1. Edition status. Each framework version says where it stands at its publisher: current, withdrawn (replaced by
--    superseded_by), superseded-in-transition, or revision-in-progress (with the stage and when the next edition is
--    expected). transition_ends is the date certificates to a replaced edition stop being valid (certification
--    bodies confirm it). status_checked_on is when the status was last checked (the Standards watch, monthly). These
--    columns are catalogue metadata, not content: the seed updates them in place, without a new revision.
-- 2. Editions side by side. A framework is adopted once per version: adopting ISO 14001:2026 while the ISO
--    14001:2015 library is live is allowed (each edition's library pack has its own key, docs/12).
-- 3. Moving to a new edition. move_framework_edition copies the workspace's answers from the old library to the new
--    one where the edition mapping (cross-walks between the two versions) says a requirement is the same, one to one;
--    repeats its control links; locks the old library's items and marks the old sheet as moved. One transaction,
--    every change logged (set_item_values, set_item_links, set_item_lock) and framework.moved on the workspace chain.

-- ───────────────────────── 1. edition status ─────────────────────────
alter table frameworks
  add column status            text not null default 'current'
    check (status in ('current', 'withdrawn', 'superseded-in-transition', 'revision-in-progress')),
  add column superseded_by     text check (superseded_by is null or superseded_by ~ '^[a-z0-9][a-z0-9-]{0,39}@[0-9A-Za-z.-]{1,20}$'),
  add column transition_ends   date,
  add column revision_stage    text check (revision_stage is null or char_length(revision_stage) between 1 and 20),
  add column revision_expected text check (revision_expected is null or char_length(revision_expected) between 1 and 20),
  add column status_note       text check (status_note is null or char_length(status_note) between 1 and 500),
  add column status_checked_on date;
alter table frameworks add constraint frameworks_status_successor_check
  check ((status in ('withdrawn', 'superseded-in-transition')) = (superseded_by is not null)
         and (transition_ends is null or status in ('withdrawn', 'superseded-in-transition')));

-- ───────────────────────── 2. adopt one edition at a time, editions side by side ─────────────────────────
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
                             'install_id', inst, 'requirements', n));
  return out || jsonb_build_object('sheet_id', lib, 'requirements', n);
end $$;

-- ───────────────────────── 3. move a library to the new edition ─────────────────────────
-- p_copies: [{ from_item, to_item, patch: { <new library field id>: value } }], one per requirement the edition
-- mapping says is the same (equivalent) one to one; p_links: [{ field_id, from_item, to_item }], the copied
-- requirements' control links on the new items. Planned in TypeScript (planEditionMove), checked here.
create or replace function move_framework_edition(p_org uuid, p_from_sheet uuid, p_to_sheet uuid,
                                                  p_copies jsonb, p_links jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a sheets; b sheets; fa frameworks; fb frameworks; e jsonb; fi items; ti items; n_copied int := 0;
        n_links int := 0; n_locked int := 0; note text; it record;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins move a library to a new edition'; end if;
  select * into a from sheets where id = p_from_sheet and org_id = p_org and is_library and archived_at is null;
  select * into b from sheets where id = p_to_sheet and org_id = p_org and is_library and archived_at is null;
  if a.id is null or b.id is null then raise exception 'move: both libraries must be live in this workspace'; end if;
  select * into fa from frameworks where key = a.settings->'framework'->>'key' and version = a.settings->'framework'->>'version';
  select * into fb from frameworks where key = b.settings->'framework'->>'key' and version = b.settings->'framework'->>'version';
  if fa.key is null or fb.key is null or fa.key <> fb.key then raise exception 'move: not two editions of one framework'; end if;
  if fa.superseded_by is distinct from fb.key || '@' || fb.version then
    raise exception 'move: % does not replace %', fb.title, fa.title;
  end if;
  if a.settings->'framework' ? 'movedTo' then raise exception 'move: % was already moved', fa.title; end if;
  perform _need_sheet(a.id, 'editor');
  perform _need_sheet(b.id, 'editor');
  note := 'Copied from ' || fa.title || ' (move to ' || fb.title || ')';

  for e in select * from jsonb_array_elements(coalesce(p_copies, '[]')) loop
    select * into fi from items where id = (e->>'from_item')::uuid and sheet_id = a.id;
    select * into ti from items where id = (e->>'to_item')::uuid and sheet_id = b.id and archived_at is null;
    if fi.id is null or ti.id is null then raise exception 'move: an item is not in its library'; end if;
    if not exists (select 1 from crosswalks c
                    where c.relation = 'equivalent'
                      and ((c.from_framework || '@' || c.from_version || '#' || c.from_ref = fi.requirement_ref
                            and c.to_framework || '@' || c.to_version || '#' || c.to_ref = ti.requirement_ref)
                        or (c.to_framework || '@' || c.to_version || '#' || c.to_ref = fi.requirement_ref
                            and c.from_framework || '@' || c.from_version || '#' || c.from_ref = ti.requirement_ref))) then
      raise exception 'move: % is not the same requirement as %', ti.requirement_ref, fi.requirement_ref;
    end if;
    if jsonb_typeof(e->'patch') <> 'object' then raise exception 'move: bad patch'; end if;
    perform set_item_values(ti.id, e->'patch', null, null, note);
    n_copied := n_copied + 1;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_links, '[]')) loop
    -- one end is a new library item that took over an old one's answers
    if not exists (select 1 from items x where x.sheet_id = b.id
                     and x.id in ((e->>'from_item')::uuid, (e->>'to_item')::uuid)) then
      raise exception 'move: a link must end at the new library';
    end if;
    perform set_item_links((e->>'field_id')::uuid, (e->>'from_item')::uuid, array[(e->>'to_item')::uuid], 'add');
    n_links := n_links + 1;
  end loop;

  -- the old library becomes read-only: its items are locked and the sheet says where the work moved
  for it in select id from items where sheet_id = a.id and archived_at is null and not locked loop
    perform set_item_lock(it.id, true, 'Moved to ' || fb.title);
    n_locked := n_locked + 1;
  end loop;
  update sheets set settings = jsonb_set(settings, '{framework,movedTo}',
                                         jsonb_build_object('sheetId', b.id, 'version', fb.version, 'title', fb.title,
                                                            'at', now()))
   where id = a.id;

  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'framework.moved',
          jsonb_build_object('framework', fa.key, 'from', fa.version, 'to', fb.version, 'from_sheet', a.id,
                             'to_sheet', b.id, 'copied', n_copied, 'links', n_links, 'locked', n_locked));
  return jsonb_build_object('copied', n_copied, 'links', n_links, 'locked', n_locked);
end $$;

revoke all on function move_framework_edition(uuid, uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function move_framework_edition(uuid, uuid, uuid, jsonb, jsonb) to authenticated;
