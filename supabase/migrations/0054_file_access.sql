-- 0054_file_access.sql · Files are read, written and downloaded only the way download_file allows
-- (security review SA-4 / M3, SA-9, M2 for files, M4 for files).
--
-- Before: the Storage read policy asked only that the `files` row be readable, so anyone who could read a row (its
-- `storage_path` included) could fetch the object straight from Storage: a quarantined (blocked) file, an archived file
-- (admin-only), an erased file not yet removed, all with no `file_access_log` entry. Editors could also insert `files`
-- rows directly (forged hash, dates, approval), and the file functions did not check a restricted field's visibility.
--
-- Now:
-- 1. Storage `files_read` (bucket `files`): an object is readable when `file_object_readable(path)` says so: its
--    `files` row exists, is not blocked or erased, is archived only for owners and admins, its sheet is readable and its
--    field (if any) visible to the person, **and** the person has a `file_access_log` entry for it from the last two
--    minutes. Only `download_file` writes that log, so every read from Storage (a signed link, a preview, the audit
--    pack) follows a logged download. A pending upload (no `files` row yet) is readable only by the person who
--    uploaded it (`owner_id`), for the server's hash check.
-- 2. SA-9: `files_discard_pending` lets the uploader delete their own pending object, so a refused upload is removed
--    (confirmUpload does it). The bucket takes only the content types the app sends: PDF and the previewable images
--    (typed from the extension) and `application/octet-stream` for everything else, never HTML or SVG.
-- 3. M2: `files_field_guard` (files insert/update) and `file_access_log_field_guard` refuse a person who cannot see the
--    file's restricted field: add_file, set_file_meta, archive_file, restore_file and download_file alike.
-- 4. `download_file` also refuses erased files.
-- 5. M4: no direct insert into `files` for API roles (`add_file` is the only way, with the server's hash check and
--    `file.added` in the log).

-- 1. Storage reads
create or replace function file_object_readable(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from files f join items i on i.id = f.item_id
     where f.storage_path = p_path and f.erased_at is null and f.scan_status <> 'blocked'
       and (f.archived_at is null or is_admin(f.org_id))
       and is_member(f.org_id)
       and _sheet_level_for(auth.uid(), i.sheet_id) <> 'none'
       and (f.field_id is null or field_visible(f.field_id))
       and exists (select 1 from file_access_log l where l.file_id = f.id and l.user_id = auth.uid()
                     and l.at > now() - interval '2 minutes'))
$$;
revoke execute on function file_object_readable(text) from public, anon;
grant execute on function file_object_readable(text) to authenticated;
create index if not exists file_access_log_user_file_idx on file_access_log (user_id, file_id, at desc);

drop policy if exists files_read on storage.objects;
create policy files_read on storage.objects for select using (
  bucket_id = 'files'
  and (storage.foldername(name))[1] = 'org'
  and is_member(((storage.foldername(name))[2])::uuid)
  and (file_object_readable(name)
       or ((storage.foldername(name))[3] = 'item'
           and coalesce(owner_id, owner::text) = auth.uid()::text
           and file_object_pending(name)
           and exists (select 1 from items i
                        where i.id::text = (storage.foldername(objects.name))[4]
                          and i.sheet_id in (select editable_sheet_ids())))));

-- 2. SA-9: refused uploads are removed by their uploader; only the types the app sends
drop policy if exists files_discard_pending on storage.objects;
create policy files_discard_pending on storage.objects for delete using (
  bucket_id = 'files'
  and (storage.foldername(name))[1] = 'org'
  and coalesce(owner_id, owner::text) = auth.uid()::text
  and file_object_pending(name));

update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
                                  'application/octet-stream']
 where id = 'files';

-- 3. M2: a restricted field's files are for people who see the field
create or replace function files_field_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if not _is_person() or coalesce(current_setting('app.workflow_op', true), '') = 'on' then return new; end if;
  if tg_table_name = 'file_access_log' then
    select field_id into fid from files where id = new.file_id;
  else
    fid := new.field_id;
  end if;
  if fid is not null and not field_visible(fid) then
    raise exception using errcode = '42501', message = 'file not found';
  end if;
  return new;
end $$;
create trigger files_field_guard before insert or update on files
  for each row execute function files_field_guard();
create trigger file_access_log_field_guard before insert on file_access_log
  for each row execute function files_field_guard();
revoke execute on function files_field_guard() from public, anon, authenticated;

-- 4. downloads of erased files
create or replace function download_file(p_file uuid) returns files
language plpgsql security definer set search_path = public as $$
declare f files;
begin
  select * into f from files where id = p_file;
  if f.id is null or not is_member(f.org_id) or f.erased_at is not null then raise exception 'file not found'; end if;
  if f.scan_status = 'blocked' then raise exception 'file blocked'; end if;
  if f.archived_at is not null and not is_admin(f.org_id) then raise exception 'file archived'; end if;
  insert into file_access_log(org_id, file_id, item_id, user_id) values (f.org_id, f.id, f.item_id, auth.uid());
  return f;
end $$;

-- 5. M4: files only through add_file
-- (files have no update or delete policy: those were already refused)
drop policy if exists files_insert on files;
revoke insert on files from anon, authenticated;
