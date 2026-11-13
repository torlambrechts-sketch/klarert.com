-- 0021_folders_organise.sql · organise folders and sheets from the side menu (docs/02 §1 folders, docs/05 §2.1)
-- Folders can be archived and restored. A folder is archived together with its sheets (one transaction, the same
-- timestamp on the folder and on each sheet), so restoring the folder restores exactly the sheets archived with it;
-- sheets archived on their own before stay archived.
-- Folders are audited like the other schema tables: audit_schema writes folders.insert/update/delete on the
-- workspace chain ('sheet:<org_id>', as a folder belongs to no sheet). Sheet moves and reorders are already logged
-- by sheets_audit (sheets.update with folder_id or position).
-- Permissions (docs/02 §6): owners and admins rename, reorder, archive and delete folders; editors may create one
-- (the wizard puts a sheet made from a template into the template's folder, creating it when it is missing).

alter table folders add column archived_at timestamptz;
create index folders_org_idx on folders(org_id, position);

-- the workspace never changes
create or replace function folders_guard() returns trigger language plpgsql as $$
begin
  if new.org_id <> old.org_id then
    raise exception 'not allowed';
  end if;
  return new;
end $$;
create trigger folders_guard_bu before update on folders for each row execute function folders_guard();
revoke all on function folders_guard() from public, anon, authenticated;

create trigger folders_audit after insert or update or delete on folders
  for each row execute function audit_schema();

drop policy folders_write on folders;
create policy folders_insert on folders for insert with check (is_editor(org_id));
create policy folders_update on folders for update using (is_admin(org_id)) with check (is_admin(org_id));
create policy folders_delete on folders for delete using (is_admin(org_id));

-- Archive (p_archived = true) or restore a folder with its sheets. Runs as the caller: RLS applies to both updates,
-- and the admin check gives a readable error first. Returns the number of sheets archived or restored with it.
create or replace function set_folder_archived(p_folder uuid, p_archived boolean) returns integer
language plpgsql security invoker set search_path = public as $$
declare f folders; at timestamptz := now(); n integer;
begin
  select * into f from folders where id = p_folder;
  if f.id is null then raise exception 'folder not found'; end if;
  if not is_admin(f.org_id) then raise exception 'only owners and admins can archive folders'; end if;
  if p_archived then
    if f.archived_at is not null then return 0; end if;
    update sheets set archived_at = at
     where folder_id = f.id and org_id = f.org_id and archived_at is null and parent_sheet_id is null;
    get diagnostics n = row_count;
    update folders set archived_at = at where id = f.id;
  else
    if f.archived_at is null then return 0; end if;
    update sheets set archived_at = null
     where folder_id = f.id and org_id = f.org_id and archived_at = f.archived_at and parent_sheet_id is null;
    get diagnostics n = row_count;
    update folders set archived_at = null where id = f.id;
  end if;
  return n;
end $$;
revoke all on function set_folder_archived(uuid, boolean) from public, anon;
grant execute on function set_folder_archived(uuid, boolean) to authenticated;
