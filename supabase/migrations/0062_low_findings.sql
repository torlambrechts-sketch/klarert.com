-- 0062_low_findings.sql · The cheap Low findings of the security review (L1, L2, L3, L4, L7, L9).
--
-- L1  Definer helpers that answered for any id now answer only for the caller's workspaces:
--     folder_hidden_sheet_count, sheet_in_org, pause_pair_ok, file_object_pending.
-- L2  A form link's token (the form's only key) is readable by owners and admins only (they share links), and
--     `get_public_form` gives anonymous visitors each field's config without internal ids or rules
--     (allowedUserIds, targetSheetId, inverseFieldId, formulas, audiences, personalData …).
-- L3  Workspace log entries about a restricted folder (folders.insert / update / delete) are readable by the people who
--     can see that folder, as the folder itself is.
-- L4  An auditor whose access has ended no longer lists the workspace's member names.
-- L7  Approval steps never take their approvers from a restricted field (a restricted "HR contact" would otherwise be
--     shown as the approver list), and the documents register's author check reads a restricted author field too.
-- L9  `retention_enqueue` and `claim_schedule_occurrence` called by a person need read access to the item's sheet.
--
-- Long functions that change by one line (get_public_form, _wf_resolve, retention_enqueue, claim_schedule_occurrence)
-- are patched from their current definition with replace(); each patch stops the migration if the line it changes is
-- not there, so a later redefinition cannot be overwritten silently.

-- L1
create or replace function folder_hidden_sheet_count(p_folder uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from sheets s
   where s.folder_id = p_folder and s.parent_sheet_id is null and is_member(s.org_id)
     and _sheet_level_for(auth.uid(), s.id) = 'none'
$$;

create or replace function sheet_in_org(p_sheet uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (is_member(p_org) or coalesce(auth.role(), '') = 'service_role')
     and exists (select 1 from sheets s where s.id = p_sheet and s.org_id = p_org)
$$;

create or replace function pause_pair_ok(p_automation uuid, p_item uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_member(p_org)
     and exists (select 1 from automations a join items i on i.sheet_id = a.sheet_id
                  where a.id = p_automation and i.id = p_item and a.org_id = p_org and i.org_id = p_org)
$$;

create or replace function file_object_pending(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_path, '/', 1) = 'org'
     and split_part(p_path, '/', 2) ~ '^[0-9a-f-]{36}$'
     and is_member(split_part(p_path, '/', 2)::uuid)
     and not exists (select 1 from files where storage_path = p_path)
$$;

-- L2: tokens for owners and admins; public forms without internal config
drop policy if exists form_links_read on form_links;
create policy form_links_read on form_links for select
  using (is_admin(org_id) and sheet_id in (select readable_sheet_ids()));

create or replace function _public_field_config(p_config jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(p_config, '{}'::jsonb)
         - array['allowedUserIds', 'targetSheetId', 'inverseFieldId', 'expr', 'formula', 'personalData', 'audience',
                 'versionFieldKey', 'sourceFieldKey', 'linkFieldKey', 'lookupFieldKey', 'rollupFieldKey',
                 'stopFieldKey', 'startFieldKey', 'sheetId', 'fieldKey', 'filter', 'conditions', 'rules',
                 'validDays', 'notify', 'userIds', 'teamIds', 'jobRoleIds']
$$;
revoke execute on function _public_field_config(jsonb) from public, anon, authenticated;

do $$
declare d text := pg_get_functiondef('get_public_form(text)'::regprocedure);
begin
  if position($s$'config', fd.config$s$ in d) = 0 then raise exception 'get_public_form changed: update 0062'; end if;
  execute replace(d, $s$'config', fd.config$s$, $s$'config', _public_field_config(fd.config)$s$);
end $$;

-- L3: folder entries of the workspace log follow the folder's own visibility
create or replace function folder_log_visible(p_old jsonb, p_new jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when f.id is null then not coalesce((coalesce(p_new, p_old) ->> 'restricted')::boolean, false)
                           or is_admin((coalesce(p_new, p_old) ->> 'org_id')::uuid)
    else not f.restricted or is_admin(f.org_id) or folder_access(f.id) <> 'none'
         or exists (select 1 from sheets s where s.folder_id = f.id and _sheet_level_for(auth.uid(), s.id) <> 'none')
  end
  from (select (coalesce(p_new, p_old) ->> 'id')::uuid as fid) x
  left join folders f on f.id = x.fid
$$;
revoke execute on function folder_log_visible(jsonb, jsonb) from public, anon;
grant execute on function folder_log_visible(jsonb, jsonb) to authenticated;

drop policy if exists activity_log_read on activity_log;
create policy activity_log_read on activity_log for select using (
  case when sheet_id is null then is_member(org_id) and (action !~~ 'folder.access%' or is_admin(org_id))
                                  and (action !~~ 'folders.%' or folder_log_visible(old_value, new_value))
       else sheet_id in (select readable_sheet_ids()) end
  and (field_id is null or not (field_id = any ((select hidden_field_ids())::uuid[]))
       or (activity_value_masked(old_value) and activity_value_masked(new_value)))
  and (new_value is null or jsonb_typeof(new_value) <> 'object' or jsonb_typeof(new_value -> 'values') <> 'object'
       or not ((new_value -> 'values') ?| (select hidden_field_keys()))
       or not exists (select 1 from jsonb_each(activity_log.new_value -> 'values') e(key, value)
                       where e.key = any ((select hidden_field_keys())::text[]) and not activity_value_masked(e.value)))
  and (action !~~ 'automations.%' or not activity_has_webhook_url(old_value, new_value) or is_admin(org_id)));

-- L4: an ended membership no longer lists the workspace's people
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (
  id = auth.uid()
  or exists (select 1 from memberships a join memberships b on a.org_id = b.org_id
              where a.user_id = auth.uid() and b.user_id = profiles.id
                and (a.expires_at is null or a.expires_at > now())));

-- L7: approvers never come from a restricted field
do $$
declare d text := pg_get_functiondef('_wf_resolve(items, jsonb)'::regprocedure);
        old text := $s$and archived_at is null and type = 'people';$s$;
begin
  if position(old in d) = 0 then raise exception '_wf_resolve changed: update 0062'; end if;
  execute replace(d, old, $s$and archived_at is null and type = 'people' and restricted_to is null;$s$);
end $$;

create or replace function _document_transition(it items, p_old jsonb, p_automation uuid, p_note text)
 RETURNS items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sf fields; was_done boolean; now_done boolean; f_author fields; f_approver fields; f_on fields; f_version fields;
        authors jsonb; cur files; prev files; tz text; today date; k text; old_v jsonb; new_v jsonb;
begin
  sf := _status_field(it.sheet_id);
  select * into f_approver from fields where sheet_id = it.sheet_id and key = 'approver' and archived_at is null;
  select * into f_on from fields where sheet_id = it.sheet_id and key = 'approved_on' and archived_at is null;
  -- the approval writes these two; a person cannot set them by hand
  for k in select unnest(array[f_approver.id::text, f_on.id::text]) loop
    if k is not null and (p_old -> k) is distinct from (it."values" -> k)
       and (sf.id is null or (p_old -> sf.id::text) is not distinct from (it."values" -> sf.id::text)) then
      raise exception 'document: Approver and Approved on are filled in when a document is approved.';
    end if;
  end loop;
  if sf.id is null or (p_old -> sf.id::text) is not distinct from (it."values" -> sf.id::text) then return it; end if;
  was_done := _option_done(sf, p_old -> sf.id::text);
  now_done := _option_done(sf, it."values" -> sf.id::text);
  if was_done and not now_done then
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'document: add a comment to change the status of an approved document.';
    end if;
    return it;
  end if;
  if now_done = was_done then return it; end if;
  -- approving
  if p_automation is not null or auth.uid() is null then
    raise exception 'document: only a person can approve a document.';
  end if;
  select * into f_author from fields where sheet_id = it.sheet_id and key = 'author' and archived_at is null;
  -- L7: a restricted author field counts too (its value lives in restricted_values)
  authors := coalesce(case when f_author.id is not null then _full_values(it.id, it."values") -> f_author.id::text end,
                      jsonb_build_array(it.created_by));
  if jsonb_typeof(authors) = 'array' and authors ? auth.uid()::text then
    raise exception 'document: the author cannot approve their own document. Ask another person to approve it.';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'document: add a version note to approve.';
  end if;
  select * into cur from files
   where item_id = it.id and field_id is null and replaced_by is null and archived_at is null
   order by (category = 'document') desc nulls last, created_at desc limit 1;
  if cur.id is null then
    raise exception 'document: upload the document file before approving it.';
  end if;
  if cur.scan_status = 'blocked' then raise exception 'document: this file is blocked and cannot be approved.'; end if;
  select * into prev from files where item_id = it.id and approved_at is not null and superseded_at is null
                                  and id <> cur.id order by approved_at desc limit 1;
  update files set superseded_at = now()
   where item_id = it.id and approved_at is not null and superseded_at is null and id <> cur.id;
  update files set approved_at = now(), approved_by = auth.uid(),
                   version_note = coalesce(version_note, nullif(btrim(p_note), ''))
   where id = cur.id;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'file.approved',
          case when prev.id is not null then jsonb_build_object('file_id', prev.id, 'filename', prev.filename,
                                                                'version_no', prev.version_no) end,
          jsonb_build_object('file_id', cur.id, 'filename', cur.filename, 'version_no', cur.version_no,
                             'sha256', cur.sha256),
          p_note);
  select time_zone into tz from orgs where id = it.org_id;
  today := (now() at time zone coalesce(tz, 'Europe/London'))::date;
  select * into f_version from fields where sheet_id = it.sheet_id and key = 'version' and archived_at is null;
  for k, new_v in
    select x.k, x.v from (values (f_approver.id::text, jsonb_build_array(auth.uid())),
                                 (f_on.id::text, to_jsonb(today::text)),
                                 (f_version.id::text, case when f_version.type = 'number' then to_jsonb(cur.version_no)
                                                           else to_jsonb(cur.version_no::text) end)) x(k, v)
     where x.k is not null loop
    old_v := it."values" -> k;
    if old_v is distinct from new_v then
      it."values" := jsonb_set(it."values", array[k], new_v, true);
      insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value)
      values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'value.changed', k::uuid, old_v, new_v);
    end if;
  end loop;
  return it;
end $function$;

-- L9: people need read access to the sheet
do $$
declare d text;
begin
  d := pg_get_functiondef('retention_enqueue(uuid, jsonb)'::regprocedure);
  if position($s$if it.id is null then raise exception 'retention: item not in the workspace'; end if;$s$ in d) = 0 then
    raise exception 'retention_enqueue changed: update 0062';
  end if;
  execute replace(d, $s$if it.id is null then raise exception 'retention: item not in the workspace'; end if;$s$,
    $s$if it.id is null then raise exception 'retention: item not in the workspace'; end if;
    perform _need_sheet(it.sheet_id, 'viewer');$s$);
  d := pg_get_functiondef('claim_schedule_occurrence(uuid, uuid, text)'::regprocedure);
  if position($s$if not (coalesce(auth.role(), '') = 'service_role' or is_admin(a.org_id)) then raise exception 'not allowed'; end if;$s$ in d) = 0 then
    raise exception 'claim_schedule_occurrence changed: update 0062';
  end if;
  execute replace(d, $s$if not (coalesce(auth.role(), '') = 'service_role' or is_admin(a.org_id)) then raise exception 'not allowed'; end if;$s$,
    $s$if not (coalesce(auth.role(), '') = 'service_role' or is_admin(a.org_id)) then raise exception 'not allowed'; end if;
  perform _need_sheet(a.sheet_id, 'viewer');$s$);
end $$;
