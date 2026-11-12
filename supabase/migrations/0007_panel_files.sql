-- 0007_panel_files.sql · M5: the item panel's write paths.
-- 1. Files (docs/02 §8): after the upload command has checked the SHA-256 server-side, add_file writes the files row,
--    marks the replaced version (replaced_by) and logs file.added / file.replaced through log_file_event, all in one
--    transaction. Files stay immutable: no update or delete policy on files or on storage objects.
-- 2. Mentions (docs/01 FR-36): notify_mention inserts the notifications for the people an update mentions. The caller
--    must be the update's author; only members of the update's workspace are notified. No service role needed.
-- 3. Updates: the author may edit or delete their own update for 15 minutes; both are logged on the item's chain.
-- 4. Updates must belong to the workspace of their item (the insert policy checks the workspace, this the item).

-- ───────────────────────── files ─────────────────────────

-- Internal: the activity entry for a file event. Called by add_file only (no grant).
create or replace function log_file_event(p_item uuid, p_field uuid, p_file uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare it items; f files; old_f files;
begin
  if p_action not in ('file.added', 'file.replaced') then raise exception 'bad file action %', p_action; end if;
  select * into it from items where id = p_item;
  select * into f from files where id = p_file and item_id = p_item and field_id = p_field;
  if it.id is null or f.id is null then raise exception 'bad file or item'; end if;
  select * into old_f from files where replaced_by = p_file;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), p_action, p_field,
          case when old_f.id is not null then jsonb_build_object('file_id', old_f.id, 'filename', old_f.filename,
                                                                 'sha256', old_f.sha256) end,
          jsonb_build_object('file_id', f.id, 'filename', f.filename, 'sha256', f.sha256, 'size_bytes', f.size_bytes,
                             'valid_until', f.valid_until));
end $$;
-- Supabase grants execute on new functions to anon and authenticated by default: take it back explicitly.
revoke all on function log_file_event(uuid, uuid, uuid, text) from public, anon, authenticated;

-- p_path must be org/<org_id>/item/<item_id>/<file_id>/<filename> and the object must already be in the bucket.
-- Evidence: collected today (workspace time zone), valid for the field's validDays (default 365).
create or replace function add_file(p_item uuid, p_field uuid, p_file uuid, p_path text, p_filename text,
                                    p_mime text, p_size bigint, p_sha256 text, p_replaces uuid default null)
returns files language plpgsql security definer set search_path = public as $$
declare it items; fld fields; tz text; today date; old_f files; f files;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not is_editor(it.org_id) then raise exception 'not allowed'; end if;
  if it.locked and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  select * into fld from fields where id = p_field and sheet_id = it.sheet_id and archived_at is null
                                  and type in ('evidence', 'attachment');
  if fld.id is null then raise exception 'bad file field'; end if;
  if p_path <> 'org/' || it.org_id || '/item/' || it.id || '/' || p_file || '/' || p_filename then
    raise exception 'bad file path';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = p_path) then
    raise exception 'file not uploaded';
  end if;
  if p_replaces is not null then
    select * into old_f from files where id = p_replaces and item_id = p_item and field_id = p_field for update;
    if old_f.id is null then raise exception 'file not found'; end if;
    if old_f.replaced_by is not null then raise exception 'file already replaced'; end if;
  end if;
  select time_zone into tz from orgs where id = it.org_id;
  today := (now() at time zone coalesce(tz, 'Europe/London'))::date;
  insert into files(id, org_id, item_id, field_id, storage_path, filename, mime_type, size_bytes, sha256, source,
                    collected_at, valid_until, uploaded_by)
  values (p_file, it.org_id, it.id, fld.id, p_path, p_filename, coalesce(nullif(p_mime, ''), 'application/octet-stream'),
          p_size, p_sha256, 'upload', today,
          case when fld.type = 'evidence'
               then today + coalesce(nullif(fld.config->>'validDays', '')::int, 365) end,
          auth.uid())
  returning * into f;
  if old_f.id is not null then
    update files set replaced_by = f.id where id = old_f.id;
  end if;
  perform log_file_event(it.id, fld.id, f.id, case when old_f.id is null then 'file.added' else 'file.replaced' end);
  return f;
end $$;

-- ───────────────────────── mentions ─────────────────────────

-- Notify the given people about an update that mentions them. Only the update's author may call it, only people the
-- update lists in `mentions` are notified, and only if they are members of the update's workspace. Returns the count.
create or replace function notify_mention(p_update uuid, p_user_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare u item_updates; it items; who text; n int;
begin
  select * into u from item_updates where id = p_update;
  if u.id is null or u.author_id is distinct from auth.uid() or not is_member(u.org_id) then
    raise exception 'not allowed';
  end if;
  select * into it from items where id = u.item_id;
  select display_name into who from profiles where id = u.author_id;
  insert into notifications(org_id, user_id, item_id, kind, body)
  select u.org_id, m.user_id, u.item_id, 'mention',
         left(coalesce(who, 'Someone') || ' mentioned you on ' || it.display_id || ' ' || it.name || ': ' || u.body, 500)
    from memberships m
   where m.org_id = u.org_id
     and m.user_id = any(p_user_ids)
     and m.user_id = any(u.mentions)
     and m.user_id <> u.author_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────────────────── edit and delete own updates ─────────────────────────

create or replace function _own_recent_update(p_update uuid) returns item_updates
language plpgsql security definer set search_path = public as $$
declare u item_updates;
begin
  select * into u from item_updates where id = p_update for update;
  if u.id is null then raise exception 'update not found'; end if;
  if u.kind <> 'update' or u.author_id is distinct from auth.uid() or not is_editor(u.org_id) then
    raise exception 'not allowed';
  end if;
  if u.created_at < now() - interval '15 minutes' then raise exception 'update too old to change'; end if;
  return u;
end $$;
revoke all on function _own_recent_update(uuid) from public, anon, authenticated;

create or replace function edit_update(p_update uuid, p_body text, p_mentions uuid[] default '{}')
returns item_updates language plpgsql security definer set search_path = public as $$
declare u item_updates; it items;
begin
  u := _own_recent_update(p_update);
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'update body required'; end if;
  select * into it from items where id = u.item_id;
  if p_body is distinct from u.body then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
    values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'update.edited', to_jsonb(u.body), to_jsonb(p_body),
            u.id::text);
  end if;
  update item_updates set body = p_body, mentions = coalesce(p_mentions, '{}') where id = u.id returning * into u;
  return u;
end $$;

create or replace function delete_update(p_update uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u item_updates; it items;
begin
  u := _own_recent_update(p_update);
  select * into it from items where id = u.item_id;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'update.deleted', to_jsonb(u.body), u.id::text);
  delete from item_updates where id = u.id;
end $$;

-- ───────────────────────── updates belong to their item's workspace ─────────────────────────

create or replace function item_updates_same_org() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if not exists (select 1 from items i where i.id = new.item_id and i.org_id = new.org_id) then
    raise exception 'update must belong to the item''s workspace';
  end if;
  return new;
end $$;
create trigger item_updates_same_org before insert or update on item_updates
  for each row execute function item_updates_same_org();

-- ───────────────────────── grants ─────────────────────────
revoke all on function add_file, notify_mention, edit_update, delete_update from public, anon;
revoke all on function item_updates_same_org from public, anon, authenticated;
grant execute on function add_file, notify_mention, edit_update, delete_update to authenticated;
