-- 0002_storage_realtime.sql · Supabase-specific setup (storage bucket, storage policies, realtime)
-- Kept apart from 0001 because these objects only exist on Supabase (0001 is plain Postgres and is unit-tested).

-- private bucket for evidence and attachments; path: org/<org_id>/item/<item_id>/<file_id>/<filename>
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)          -- 50 MB placeholder, see docs/01 §7
on conflict (id) do nothing;

create policy files_read on storage.objects for select using (
  bucket_id = 'files' and (storage.foldername(name))[1] = 'org'
  and public.is_member(((storage.foldername(name))[2])::uuid));

create policy files_upload on storage.objects for insert with check (
  bucket_id = 'files' and (storage.foldername(name))[1] = 'org'
  and public.is_editor(((storage.foldername(name))[2])::uuid));

-- no update/delete policies: files are immutable; replacing a file uploads a new object (files.replaced_by)

-- realtime: grid and panel subscribe to these
alter publication supabase_realtime add table public.items, public.item_links, public.item_updates,
  public.notifications, public.fields, public.groups;
