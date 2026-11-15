-- 0067_pending_upload_cleanup.sql · The scheduler finds uploads that were never confirmed (security review 9.1 item 2).
--
-- An upload is pending from the moment the browser puts the object in the `files` bucket (prepareUpload's signed
-- URL) until confirmUpload checks its hash and add_file writes its `files` row. A tab closed in between leaves the
-- object for good, readable only by its uploader (0054). There is no pending row in any table: `files` is written
-- only on confirmation, so a pending upload is an object under `org/<org>/item/…` whose path no `files` row holds.
--
-- `stale_pending_uploads(before, limit)` lists such objects last written before `before` and at least an hour ago
-- (never younger, whatever the caller passes), oldest first, at most `limit` (1 to 1000). The hourly job in the
-- scheduler route (src/server/scheduler/pending-uploads.ts, service role) removes them through the Storage API, which
-- deletes the object and its `storage.objects` row. Service role only: a person never lists other people's uploads.

create or replace function stale_pending_uploads(p_before timestamptz, p_limit int default 500)
returns table (org_id uuid, name text, written_at timestamptz)
language sql stable security definer set search_path = public as $$
  select split_part(o.name, '/', 2)::uuid, o.name, greatest(o.created_at, coalesce(o.updated_at, o.created_at))
    from storage.objects o
   where o.bucket_id = 'files'
     and split_part(o.name, '/', 1) = 'org'
     and split_part(o.name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and split_part(o.name, '/', 3) = 'item'
     and greatest(o.created_at, coalesce(o.updated_at, o.created_at))
         < least(p_before, now() - interval '1 hour')
     and not exists (select 1 from files f where f.storage_path = o.name)
   order by greatest(o.created_at, coalesce(o.updated_at, o.created_at)), o.name
   limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;
revoke all on function stale_pending_uploads(timestamptz, int) from public, anon, authenticated;
grant execute on function stale_pending_uploads(timestamptz, int) to service_role;
