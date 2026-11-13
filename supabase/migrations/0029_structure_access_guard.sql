-- 0029_structure_access_guard.sql · P2 access control, part 5: a sheet's structure, whoever writes it.
-- Groups, fields, views, form links and automations are written under RLS by commands (0026 narrows those policies to
-- sheets the person can edit), but a few definer functions write them too: delete_group, the form link functions
-- (form_link_create / _regenerate / _disable, which checked only that the caller is an admin) and archive and install
-- of packs. The same rule as for items holds them: a person needs edit access to the sheet; a personal view needs
-- read access. Automations, the seed and migrations are not people (docs/02 §16).

-- SECURITY INVOKER on purpose: a direct write runs as `authenticated` and RLS already decides (with its own message);
-- a write from inside a definer function runs as the function's owner, and this check applies.
create or replace function structure_access_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  if current_user = 'authenticated' then return coalesce(new, old); end if;
  if tg_table_name = 'views' and (r->>'owner_id') is not null then
    perform _need_sheet((r->>'sheet_id')::uuid, 'viewer');
  else
    perform _need_sheet((r->>'sheet_id')::uuid, 'editor');
  end if;
  return coalesce(new, old);
end $$;
revoke all on function structure_access_guard() from public, anon, authenticated;

create trigger groups_access_guard before insert or update or delete on groups
  for each row execute function structure_access_guard();
create trigger fields_access_guard before insert or update or delete on fields
  for each row execute function structure_access_guard();
create trigger views_access_guard before insert or update or delete on views
  for each row execute function structure_access_guard();
create trigger form_links_access_guard before insert or update or delete on form_links
  for each row execute function structure_access_guard();
create trigger automations_access_guard before insert or update or delete on automations
  for each row execute function structure_access_guard();

-- Storage (0026): an object is readable when its files row is. Between the upload and the files row (confirmUpload
-- downloads the object to check its SHA-256), editors of the item's sheet read objects that have no files row yet.
create or replace function file_object_pending(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from files where storage_path = p_path)
$$;
revoke all on function file_object_pending(text) from public, anon;
grant execute on function file_object_pending(text) to authenticated;

drop policy files_read on storage.objects;
create policy files_read on storage.objects for select using (
  bucket_id = 'files' and (storage.foldername(name))[1] = 'org'
  and public.is_member(((storage.foldername(name))[2])::uuid)
  and (exists (select 1 from public.files f where f.storage_path = name)
       or ((storage.foldername(name))[3] = 'item' and public.file_object_pending(name)
           and exists (select 1 from public.items i where i.id::text = (storage.foldername(name))[4]
                         and i.sheet_id in (select public.editable_sheet_ids())))));
