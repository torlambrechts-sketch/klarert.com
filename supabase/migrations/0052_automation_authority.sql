-- 0052_automation_authority.sql · An automation writes only where the person behind it may edit, for as long as
-- they may (security review SA-1 High, M1).
--
-- Before: the rule "actions that write to sheets the author cannot edit are refused" (docs/02 §16) lived only in the
-- automation commands. An editor could insert an automation by direct API whose `create_item`, `update_linked` or
-- `sync_requirement_checks` action targets a restricted sheet, and the runner (service role) wrote there. Once saved,
-- an automation ran for ever: a removed or demoted member's webhook kept posting item values.
--
-- Now:
-- 1. `automations.acts_as`: the person whose access the automation uses: whoever created it, then whoever last
--    changed it (any change by a person other than only switching it off or its mode). Null for rows written by the
--    system (seed); the runner then falls back to `created_by`.
-- 2. `_automation_targets(sheet, actions)`: every other sheet the actions write to: an action's `sheetId`
--    (create_item, sync_requirement_checks), `path.sheetId` of update_linked "in", and the target of the link field
--    update_linked "out" follows (for a requirement or control link without a target: every library sheet of the
--    workspace).
-- 3. `automations_targets_guard` (BEFORE INSERT OR UPDATE): for people, every target must be a sheet of the same
--    workspace that the person can edit; otherwise `access: You cannot edit <sheet>, so this automation cannot write
--    to it.` Switching an automation off (or its mode) is never refused.
-- 4. `automation_authority(ids)` (service role only): for each automation, why it must not run now, in words: the
--    person it acts as is no longer a member, is no longer an editor, or can no longer edit its sheet or a target.
--    The runner records such a run as `stopped` with that reason and performs nothing.

alter table automations add column if not exists acts_as uuid references auth.users(id) on delete set null;

create or replace function _automation_targets(p_sheet uuid, p_actions jsonb) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare a jsonb; out uuid[] := '{}'; f fields; o uuid;
begin
  select org_id into o from sheets where id = p_sheet;
  if jsonb_typeof(p_actions) is distinct from 'array' then return out; end if;
  for a in select * from jsonb_array_elements(p_actions) loop
    if jsonb_typeof(a) <> 'object' then continue; end if;
    if jsonb_typeof(a -> 'sheetId') = 'string' and a ->> 'sheetId' ~ '^[0-9a-f-]{36}$' then
      out := out || (a ->> 'sheetId')::uuid;
    end if;
    if a ->> 'type' = 'update_linked' and jsonb_typeof(a -> 'path') = 'object' then
      if a -> 'path' ->> 'direction' = 'in' then
        if a -> 'path' ->> 'sheetId' ~ '^[0-9a-f-]{36}$' then out := out || (a -> 'path' ->> 'sheetId')::uuid; end if;
      else
        select * into f from fields where sheet_id = p_sheet and key = a -> 'path' ->> 'linkFieldKey'
                                      and archived_at is null limit 1;
        if f.id is not null then
          if coalesce(f.config ->> 'targetSheetId', '') ~ '^[0-9a-f-]{36}$' then
            out := out || (f.config ->> 'targetSheetId')::uuid;
          elsif f.type in ('requirement', 'controllink') then
            out := out || coalesce((select array_agg(id) from sheets where org_id = o and is_library
                                       and archived_at is null), '{}');
          end if;
        end if;
      end if;
    end if;
  end loop;
  return coalesce((select array_agg(distinct t) from unnest(out) t where t <> p_sheet), '{}');
end $$;

-- The name a person may see for a sheet: its name if they can read it.
create or replace function _sheet_name_for(p_user uuid, p_sheet uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when _sheet_level_for(p_user, p_sheet) <> 'none'
              then coalesce((select name from sheets where id = p_sheet), 'a sheet that no longer exists')
              else 'a sheet you cannot open' end
$$;

create or replace function automations_targets_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not _is_person() then
    if tg_op = 'INSERT' then new.acts_as := coalesce(new.acts_as, new.created_by); end if;
    return new;
  end if;
  -- switching an automation off, or only its mode, never needs access to its targets
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['enabled', 'mode', 'updated_at', 'run_count', 'last_run_at'])
         = (to_jsonb(old) - array['enabled', 'mode', 'updated_at', 'run_count', 'last_run_at'])
     and (not new.enabled or new.enabled = old.enabled) then
    return new;
  end if;
  foreach t in array _automation_targets(new.sheet_id, new.actions) loop
    if not exists (select 1 from sheets where id = t and org_id = new.org_id) then
      raise exception using errcode = '42501',
        message = 'access: This automation writes to a sheet that is not in this workspace.';
    end if;
    if _sheet_level_for(auth.uid(), t) not in ('owner', 'editor') then
      raise exception using errcode = '42501',
        message = format('access: You cannot edit %s, so this automation cannot write to it.',
                         _sheet_name_for(auth.uid(), t));
    end if;
  end loop;
  new.acts_as := auth.uid();
  return new;
end $$;
create trigger automations_targets_guard before insert or update on automations
  for each row execute function automations_targets_guard();

-- Why each automation must not run now (null: it may run). The runner calls it once per sheet's list.
create or replace function automation_authority(p_automations uuid[])
returns table (automation_id uuid, stop_reason text)
language plpgsql stable security definer set search_path = public as $$
declare a record; who uuid; nm text; m memberships; t uuid; lvl text; reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  for a in select x.* from automations x where x.id = any (p_automations) loop
    reason := null;
    who := coalesce(a.acts_as, a.created_by);
    if who is not null then
      nm := coalesce((select display_name from profiles where id = who), 'The person who set it up');
      select * into m from memberships where org_id = a.org_id and user_id = who
                                         and (expires_at is null or expires_at > now());
      if m.user_id is null then
        reason := format('Stopped: %s is no longer a member of this workspace. An owner, admin or editor can save '
                         'the automation again to run it as themselves.', nm);
      elsif m.role not in ('owner', 'admin', 'editor') then
        reason := format('Stopped: %s can no longer edit in this workspace. An owner, admin or editor can save the '
                         'automation again to run it as themselves.', nm);
      else
        foreach t in array (array[a.sheet_id] || _automation_targets(a.sheet_id, a.actions)) loop
          lvl := _sheet_level_for(who, t);
          if lvl not in ('owner', 'editor') then
            reason := format('Stopped: %s can no longer edit %s. Someone who can should save the automation again.',
                             nm, coalesce((select name from sheets where id = t), 'a sheet that no longer exists'));
            exit;
          end if;
        end loop;
      end if;
    end if;
    automation_id := a.id; stop_reason := reason;
    return next;
  end loop;
end $$;

revoke execute on function _automation_targets(uuid, jsonb), _sheet_name_for(uuid, uuid),
  automations_targets_guard(), automation_authority(uuid[]) from public, anon, authenticated;
grant execute on function automation_authority(uuid[]) to service_role;
