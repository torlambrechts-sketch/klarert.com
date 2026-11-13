-- 0023_item_files.sql · Files on items and controlled documents (docs/02 §8, §14).
-- 1. Item files: files.field_id may be null for files uploaded to the item's Files tab (source 'upload' only). The
--    storage path is unchanged (org/<org>/item/<item>/<file>/<name>); there is no hidden system field.
-- 2. Per-version metadata: description, category (an option id of orgs.settings.fileCategories, stored by id),
--    version_no (the replaced version's + 1), version_note, classification, personal_data, scan_status (downloads are
--    refused when 'blocked'; the scanner comes later) and the approval marks of controlled documents.
-- 3. RPCs: add_file takes a null field and the metadata; set_file_meta (file.updated), archive_file and restore_file
--    (admins, the whole version chain, file.archived / file.restored). Files stay immutable otherwise; no delete.
-- 4. Downloads: file_access_log, written only by download_file (members; refuses blocked or, for non-admins,
--    archived files). Read by members of the workspace.
-- 5. Controlled documents: a sheet with settings.register = 'documents' is a documents register. In it, the status
--    field's done option is Approved. set_item_values enforces the approval workflow: only a person approves, never
--    the author (field key `author`, else the item's creator), a version note (the change's comment) and a current item
--    file are required; the approver, approval date and version (keys `approver`, `approved_on`, `version`) are
--    written by the approval itself; the file approved is marked and the previously approved file superseded.
--    Leaving Approved needs a comment. A new document cannot start Approved. Only admins change the register flag.

-- ───────────────────────── files: columns ─────────────────────────

alter table files alter column field_id drop not null;
alter table files add constraint files_field_or_upload check (field_id is not null or source = 'upload');
alter table files
  add column description    text check (char_length(description) <= 2000),
  add column category       text check (category ~ '^[a-z][a-z0-9_]{0,39}$'),
  add column version_no     integer not null default 1 check (version_no >= 1),
  add column version_note   text check (char_length(version_note) <= 1000),
  add column classification text not null default 'internal'
                            check (classification in ('public', 'internal', 'confidential', 'restricted')),
  add column personal_data  boolean not null default false,
  add column archived_at    timestamptz,
  add column archived_by    uuid references profiles(id),
  add column scan_status    text not null default 'not_scanned' check (scan_status in ('not_scanned', 'clean', 'blocked')),
  add column approved_at    timestamptz,
  add column approved_by    uuid references profiles(id),
  add column superseded_at  timestamptz;

-- existing version chains: v1 is the file nothing replaced into, each replacement one more
with recursive chain as (
  select f.id, f.replaced_by, 1 as n from files f
   where not exists (select 1 from files p where p.replaced_by = f.id)
  union all
  select f.id, f.replaced_by, c.n + 1 from files f join chain c on f.id = c.replaced_by
)
update files f set version_no = chain.n from chain where chain.id = f.id and chain.n > 1;

create index files_item_current_idx on files(item_id) where replaced_by is null and archived_at is null;

-- 25 MB per file (decision with the product owner; was a 50 MB placeholder)
update storage.buckets set file_size_limit = 26214400 where id = 'files';

-- ───────────────────────── downloads ─────────────────────────

create table file_access_log (
  id       bigint generated always as identity primary key,
  org_id   uuid not null references orgs(id) on delete cascade,
  file_id  uuid not null references files(id) on delete cascade,
  item_id  uuid not null references items(id) on delete cascade,
  user_id  uuid references profiles(id),
  at       timestamptz not null default now()
);
create index file_access_log_file_idx on file_access_log(file_id, at desc);
alter table file_access_log enable row level security;
create policy file_access_log_read on file_access_log for select using (is_member(org_id));
-- no insert, update or delete policies: rows are written by download_file only

-- ───────────────────────── internal helpers (never granted) ─────────────────────────

-- Every version in the chain of a file (older and newer).
create or replace function _file_chain(p_file uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive back as (
    select id, replaced_by from files where id = p_file
    union
    select f.id, f.replaced_by from files f join back b on f.replaced_by = b.id
  ), fwd as (
    select id, replaced_by from files where id = p_file
    union
    select f.id, f.replaced_by from files f join fwd w on f.id = w.replaced_by
  )
  select id from back union select id from fwd
$$;

create or replace function _document_register(p_sheet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select settings->>'register' = 'documents' from sheets where id = p_sheet), false)
$$;

-- The activity entry for a file event. No grant: called by the file RPCs below.
create or replace function log_file_event(p_item uuid, p_field uuid, p_file uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare it items; f files; old_f files;
begin
  if p_action not in ('file.added', 'file.replaced') then raise exception 'bad file action %', p_action; end if;
  select * into it from items where id = p_item;
  select * into f from files where id = p_file and item_id = p_item and field_id is not distinct from p_field;
  if it.id is null or f.id is null then raise exception 'bad file or item'; end if;
  select * into old_f from files where replaced_by = p_file;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), p_action, p_field,
          case when old_f.id is not null then jsonb_build_object('file_id', old_f.id, 'filename', old_f.filename,
                                                                 'sha256', old_f.sha256, 'version_no', old_f.version_no) end,
          jsonb_build_object('file_id', f.id, 'filename', f.filename, 'sha256', f.sha256, 'size_bytes', f.size_bytes,
                             'valid_until', f.valid_until, 'version_no', f.version_no, 'category', f.category),
          f.version_note);
end $$;
revoke all on function log_file_event(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ───────────────────────── add_file ─────────────────────────

drop function add_file(uuid, uuid, uuid, text, text, text, bigint, text, uuid);

-- p_field null: an item file (Files tab). p_meta: { description, category, version_note, valid_until, classification,
-- personal_data }. A new version keeps the replaced version's description, category, classification and personal
-- data marker unless given.
create or replace function add_file(p_item uuid, p_field uuid, p_file uuid, p_path text, p_filename text,
                                    p_mime text, p_size bigint, p_sha256 text, p_replaces uuid default null,
                                    p_meta jsonb default '{}'::jsonb)
returns files language plpgsql security definer set search_path = public as $$
declare it items; fld fields; tz text; today date; old_f files; f files; m jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not is_editor(it.org_id) then raise exception 'not allowed'; end if;
  if it.locked and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  if p_field is not null then
    select * into fld from fields where id = p_field and sheet_id = it.sheet_id and archived_at is null
                                    and type in ('evidence', 'attachment');
    if fld.id is null then raise exception 'bad file field'; end if;
  end if;
  if p_path <> 'org/' || it.org_id || '/item/' || it.id || '/' || p_file || '/' || p_filename then
    raise exception 'bad file path';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = p_path) then
    raise exception 'file not uploaded';
  end if;
  if p_replaces is not null then
    select * into old_f from files where id = p_replaces and item_id = p_item
                                     and field_id is not distinct from p_field for update;
    if old_f.id is null or old_f.archived_at is not null then raise exception 'file not found'; end if;
    if old_f.replaced_by is not null then raise exception 'file already replaced'; end if;
  end if;
  select time_zone into tz from orgs where id = it.org_id;
  today := (now() at time zone coalesce(tz, 'Europe/London'))::date;
  insert into files(id, org_id, item_id, field_id, storage_path, filename, mime_type, size_bytes, sha256, source,
                    collected_at, valid_until, uploaded_by, description, category, version_no, version_note,
                    classification, personal_data)
  values (p_file, it.org_id, it.id, fld.id, p_path, p_filename, coalesce(nullif(p_mime, ''), 'application/octet-stream'),
          p_size, p_sha256, 'upload', today,
          case when fld.type = 'evidence'
               then today + coalesce(nullif(fld.config->>'validDays', '')::int, 365)
               else nullif(m->>'valid_until', '')::date end,
          auth.uid(),
          coalesce(nullif(btrim(m->>'description'), ''), old_f.description),
          coalesce(nullif(m->>'category', ''), old_f.category),
          coalesce(old_f.version_no + 1, 1),
          nullif(btrim(m->>'version_note'), ''),
          coalesce(nullif(m->>'classification', ''), old_f.classification, 'internal'),
          coalesce((m->>'personal_data')::boolean, old_f.personal_data, false))
  returning * into f;
  if old_f.id is not null then
    update files set replaced_by = f.id where id = old_f.id;
  end if;
  perform log_file_event(it.id, fld.id, f.id, case when old_f.id is null then 'file.added' else 'file.replaced' end);
  return f;
end $$;

-- ───────────────────────── details, archive, restore ─────────────────────────

-- Editors change a version's details (admins on locked items). Logged as file.updated with the fields that changed.
create or replace function set_file_meta(p_file uuid, p_meta jsonb)
returns files language plpgsql security definer set search_path = public as $$
declare f files; it items; n files; m jsonb := coalesce(p_meta, '{}'::jsonb); old_v jsonb; new_v jsonb;
begin
  select * into f from files where id = p_file for update;
  if f.id is null then raise exception 'file not found'; end if;
  select * into it from items where id = f.item_id and archived_at is null;
  if it.id is null then raise exception 'item not found'; end if;
  if not is_editor(f.org_id) then raise exception 'not allowed'; end if;
  if it.locked and not is_admin(f.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  if f.archived_at is not null then raise exception 'file archived'; end if;
  update files set
    description    = case when m ? 'description' then nullif(btrim(m->>'description'), '') else description end,
    category       = case when m ? 'category' then nullif(m->>'category', '') else category end,
    valid_until    = case when m ? 'valid_until' then nullif(m->>'valid_until', '')::date else valid_until end,
    classification = case when m ? 'classification' then m->>'classification' else classification end,
    personal_data  = case when m ? 'personal_data' then (m->>'personal_data')::boolean else personal_data end
   where id = f.id returning * into n;
  select coalesce(jsonb_object_agg(k, o), '{}'::jsonb), coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    into old_v, new_v
    from (select k, to_jsonb(f) -> k as o, to_jsonb(n) -> k as v
            from unnest(array['description', 'category', 'valid_until', 'classification', 'personal_data']) k) d
   where o is distinct from v;
  if new_v <> '{}'::jsonb then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value)
    values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'file.updated', f.field_id,
            old_v || jsonb_build_object('file_id', f.id, 'filename', f.filename),
            new_v || jsonb_build_object('file_id', f.id, 'filename', f.filename));
  end if;
  return n;
end $$;

-- Admins archive a file: every version of it. Archived files leave the Files tab, the evidence library and the
-- expiry checks; nothing is deleted.
create or replace function archive_file(p_file uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare f files; it items;
begin
  select * into f from files where id = p_file;
  if f.id is null then raise exception 'file not found'; end if;
  if not is_admin(f.org_id) then raise exception 'not allowed'; end if;
  select * into it from items where id = f.item_id;
  if f.archived_at is not null then return; end if;
  update files set archived_at = now(), archived_by = auth.uid()
   where id in (select _file_chain(f.id)) and archived_at is null;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'file.archived', f.field_id,
          jsonb_build_object('file_id', f.id, 'filename', f.filename, 'version_no', f.version_no),
          nullif(btrim(p_note), ''));
end $$;

create or replace function restore_file(p_file uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f files; it items;
begin
  select * into f from files where id = p_file;
  if f.id is null then raise exception 'file not found'; end if;
  if not is_admin(f.org_id) then raise exception 'not allowed'; end if;
  select * into it from items where id = f.item_id;
  if f.archived_at is null then return; end if;
  update files set archived_at = null, archived_by = null where id in (select _file_chain(f.id));
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, new_value)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'file.restored', f.field_id,
          jsonb_build_object('file_id', f.id, 'filename', f.filename, 'version_no', f.version_no));
end $$;

-- A download: members of the file's workspace, never a blocked file, archived files for admins only. Logs the access
-- and returns the file (the command then signs a short-lived URL for its storage path).
create or replace function download_file(p_file uuid)
returns files language plpgsql security definer set search_path = public as $$
declare f files;
begin
  select * into f from files where id = p_file;
  if f.id is null or not is_member(f.org_id) then raise exception 'file not found'; end if;
  if f.scan_status = 'blocked' then raise exception 'file blocked'; end if;
  if f.archived_at is not null and not is_admin(f.org_id) then raise exception 'file archived'; end if;
  insert into file_access_log(org_id, file_id, item_id, user_id) values (f.org_id, f.id, f.item_id, auth.uid());
  return f;
end $$;

-- ───────────────────────── controlled documents ─────────────────────────

-- Called by set_item_values with the item as it will be saved (it) and its values before the change. Returns the item
-- with the approval's own values set. Raises 'document: …' messages for people.
create or replace function _document_transition(it items, p_old jsonb, p_automation uuid, p_note text)
returns items language plpgsql security definer set search_path = public as $$
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
  authors := coalesce(case when f_author.id is not null then it."values" -> f_author.id::text end,
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
end $$;

-- set_item_values (0020) with the documents register's workflow
create or replace function set_item_values(p_item uuid, p_patch jsonb, p_name text default null,
                                           p_automation uuid default null, p_note text default null)
returns items language plpgsql security definer set search_path = public as $$
declare it items; f fields; k text; old_v jsonb; new_v jsonb; par items; sf fields; settings jsonb; open text[];
        label text; listed text; before jsonb;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if it.locked and p_automation is null and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  if it.parent_id is not null and p_automation is null and not is_admin(it.org_id) then
    select * into par from items where id = it.parent_id;
    if par.locked and coalesce((_subitem_settings(par.sheet_id)->>'lockCascade')::boolean, false) then
      raise exception 'item locked: %', coalesce(par.lock_reason, 'approved');
    end if;
  end if;
  before := it."values";
  if p_name is not null and p_name <> it.name then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
    values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
            'item.renamed', to_jsonb(it.name), to_jsonb(p_name), p_note);
    it.name := p_name;
  end if;
  settings := case when it.parent_id is null then _subitem_settings(it.sheet_id) else '{}'::jsonb end;
  if coalesce((settings->>'blockClose')::boolean, false) then sf := _status_field(it.sheet_id); end if;
  for k in select jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) loop
    select * into f from fields where id::text = k and sheet_id = it.sheet_id and archived_at is null;
    if f.id is null then raise exception 'field % not in sheet', k; end if;
    if f.type = any(non_value_types()) then raise exception 'field % (%) is not set through values', f.name, f.type; end if;
    if f.type = 'workflowstep' and p_automation is null and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'workflow step is set by automations only';
    end if;
    old_v := it."values" -> k;
    new_v := p_patch -> k;
    if new_v is null or new_v = 'null'::jsonb then
      it."values" := it."values" - k; new_v := null;
    else
      it."values" := jsonb_set(it."values", array[k], new_v, true);
    end if;
    -- the gate: the parent's status may not become done while a sub-item is open
    if sf.id = f.id and _option_done(f, new_v) and not _option_done(f, old_v) then
      open := _open_subitems(it.id);
      if cardinality(open) > 0 then
        label := coalesce(nullif(settings->>'label', ''), 'Sub-items');
        listed := array_to_string(open[1:5], ', ')
                  || case when cardinality(open) > 5 then ' and ' || (cardinality(open) - 5) || ' more' else '' end;
        raise exception 'subitems open: % still open: %. Close them before closing %.', label, listed, it.display_id;
      end if;
    end if;
    if old_v is distinct from new_v then
      insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value, note)
      values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
              'value.changed', f.id, old_v, new_v, p_note);
    end if;
  end loop;
  if _document_register(it.sheet_id) then
    it := _document_transition(it, before, p_automation, p_note);
  end if;
  update items set name = it.name, "values" = it."values", updated_at = now(), updated_by = auth.uid()
   where id = it.id returning * into it;
  return it;
end $$;

-- A new document starts as a draft: it is approved through the workflow above.
create or replace function items_document_insert_guard() returns trigger language plpgsql
security definer set search_path = public as $$
declare sf fields;
begin
  if not _document_register(new.sheet_id) then return new; end if;
  sf := _status_field(new.sheet_id);
  if sf.id is not null and _option_done(sf, new."values" -> sf.id::text) then
    raise exception 'document: a new document starts as a draft. Approve it once its file is uploaded.';
  end if;
  return new;
end $$;
create trigger items_document_insert_guard before insert on items
  for each row execute function items_document_insert_guard();

-- Only owners and admins make a sheet a documents register or stop it being one (sessions only; the service role and
-- migrations are not people).
create or replace function sheets_register_guard() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if (old.settings->'register') is distinct from (new.settings->'register')
     and auth.uid() is not null and not is_admin(new.org_id) then
    raise exception 'not allowed: only owners and admins change the documents register setting';
  end if;
  return new;
end $$;
create trigger sheets_register_guard before update on sheets
  for each row execute function sheets_register_guard();

-- ───────────────────────── grants ─────────────────────────
revoke all on function _file_chain(uuid), _document_register(uuid), _document_transition(items, jsonb, uuid, text)
  from public, anon, authenticated;
revoke all on function items_document_insert_guard(), sheets_register_guard() from public, anon, authenticated;
revoke all on function add_file(uuid, uuid, uuid, text, text, text, bigint, text, uuid, jsonb), set_file_meta(uuid, jsonb),
  archive_file(uuid, text), restore_file(uuid), download_file(uuid) from public, anon;
grant execute on function add_file(uuid, uuid, uuid, text, text, text, bigint, text, uuid, jsonb), set_file_meta(uuid, jsonb),
  archive_file(uuid, text), restore_file(uuid), download_file(uuid) to authenticated;
