-- 0026_sheet_access.sql · P2 access control, part 2: who may read, comment on and edit each sheet (docs/02 §16).
-- Open by default: everyone in the workspace keeps the access their workspace role gives. An owner, or an admin who
-- has access, can mark a folder or a sheet Restricted and list people with a level (editor, commenter, viewer). A sheet
-- follows its folder unless it has its own setting (its own list then replaces the folder's). Sub-item sheets follow
-- their parent sheet. Owners always have access (break-glass, logged as restricted.accessed). A grant never gives more
-- than the workspace role: viewers and auditors read only, whatever level they are listed with.
--
-- One resolution, _sheet_levels(user, sheet), answers owner | editor | commenter | viewer | none. Everything else uses
-- it: sheet_access(sheet) for commands and definer functions, readable_sheet_ids() / commentable_sheet_ids() /
-- editable_sheet_ids() in RLS policies (a set evaluated once per statement, then a hash lookup per row), and guard
-- triggers on the tables definer functions write (items, links, files, updates, pauses, protected values), so every
-- RPC, old or new, is held to the same rule without repeating it. Notifications to people who cannot read the item are
-- dropped by a trigger, whoever sends them.

-- ───────────────────────── auditors ─────────────────────────
alter table memberships add constraint memberships_auditor_expires
  check (role <> 'auditor' or expires_at is not null);
alter table invites add constraint invites_auditor_expires
  check (role <> 'auditor' or expires_at is not null);

-- Role changes, auditor end dates, auditors added and people removed are audited on the workspace chain.
create or replace function memberships_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op = 'INSERT' and new.role <> 'auditor' then return null; end if;
  if tg_op = 'UPDATE' and new.role is not distinct from old.role and new.expires_at is not distinct from old.expires_at then
    return null;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from orgs where id = old.org_id) then return null; end if;
  insert into activity_log(org_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (o, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          'member.' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'removed' end,
          case when tg_op <> 'INSERT' then jsonb_build_object('user_id', old.user_id, 'role', old.role,
                                                             'expires_at', old.expires_at) end,
          case when tg_op <> 'DELETE' then jsonb_build_object('user_id', new.user_id, 'role', new.role,
                                                             'expires_at', new.expires_at) end,
          (select display_name from profiles where id = coalesce(new.user_id, old.user_id)));
  return null;
end $$;
create trigger memberships_audit after insert or update or delete on memberships
  for each row execute function memberships_audit();

-- ───────────────────────── columns ─────────────────────────
alter table folders add column restricted boolean not null default false;
alter table sheets add column restricted boolean not null default false,
                   add column access_inherit boolean not null default true;

-- ───────────────────────── grants ─────────────────────────
create table access_grants (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  folder_id   uuid references folders(id) on delete cascade,
  sheet_id    uuid references sheets(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  level       text not null check (level in ('editor', 'commenter', 'viewer')),
  granted_by  uuid references profiles(id),
  granted_at  timestamptz not null default now(),
  check (num_nonnulls(folder_id, sheet_id) = 1)
);
create unique index access_grants_sheet_user_key on access_grants(sheet_id, user_id) where sheet_id is not null;
create unique index access_grants_folder_user_key on access_grants(folder_id, user_id) where folder_id is not null;
create index access_grants_user_idx on access_grants(user_id, org_id);
alter table access_grants enable row level security;
revoke insert, update, delete, truncate on access_grants from anon, authenticated;

-- ───────────────────────── resolution (internal) ─────────────────────────
create or replace function _level_rank(p_level text) returns int language sql immutable as $$
  select case p_level when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end
$$;

-- Every sheet of the person's live memberships with their level (p_sheet null), or one sheet.
create or replace function _sheet_levels(p_user uuid, p_sheet uuid default null)
returns table (sheet_id uuid, org_id uuid, level text, restricted boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_id,
         case
           when m.role = 'owner' then 'owner'
           when not e.restricted then case when m.role in ('admin', 'editor') then 'editor' else 'viewer' end
           when g.level is null then 'none'
           when m.role in ('viewer', 'auditor') then 'viewer'
           else g.level
         end,
         e.restricted
    from sheets s
    join memberships m on m.org_id = s.org_id and m.user_id = p_user
                      and (m.expires_at is null or m.expires_at > now())
    left join sheets p on p.id = s.parent_sheet_id
    cross join lateral (select coalesce(p.id, s.id) as sid,
                               case when p.id is null then s.folder_id else p.folder_id end as fid,
                               coalesce(p.access_inherit, s.access_inherit) as inherit,
                               coalesce(p.restricted, s.restricted) as own) b
    left join folders f on f.id = b.fid
    cross join lateral (select case when b.inherit then coalesce(f.restricted, false) else b.own end as restricted) e
    left join access_grants g on g.user_id = p_user
         and ((b.inherit and g.folder_id = b.fid) or (not b.inherit and g.sheet_id = b.sid))
   where p_user is not null and (p_sheet is null or s.id = p_sheet)
$$;

create or replace function _sheet_level_for(p_user uuid, p_sheet uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select level from _sheet_levels(p_user, p_sheet)), 'none')
$$;

-- A person: a signed-in session acting as the authenticated role (not the service role, a migration or the seed).
-- `role` is the SET ROLE of the request, which SECURITY DEFINER does not change.
create or replace function _is_person() returns boolean language sql stable as $$
  select auth.uid() is not null and coalesce(current_setting('role', true), '') = 'authenticated'
     and coalesce(auth.role(), '') <> 'service_role'
$$;

-- The caller's level on a sheet, cached for the transaction (bulk inserts check every row).
create or replace function _need_sheet(p_sheet uuid, p_min text) returns void
language plpgsql security definer set search_path = public as $$
declare k text := 'app.access_' || p_min; tag text := coalesce(p_sheet::text, '') || ':' || coalesce(auth.uid()::text, '');
        lvl text;
begin
  if not _is_person() then return; end if;
  if position(tag in coalesce(current_setting(k, true), '')) > 0 then return; end if;
  lvl := _sheet_level_for(auth.uid(), p_sheet);
  if _level_rank(lvl) < _level_rank(p_min) then
    raise exception using errcode = '42501',
      message = 'no access: ' || case p_min when 'editor' then 'you cannot edit this sheet'
                                            when 'commenter' then 'you cannot comment on this sheet'
                                            else 'you cannot read this sheet' end;
  end if;
  perform set_config(k, left(coalesce(current_setting(k, true), '') || '|' || tag, 4000), true);
end $$;

-- Forget cached checks (an access change inside the same transaction).
create or replace function _access_changed() returns void language plpgsql as $$
begin
  perform set_config('app.access_editor', '', true);
  perform set_config('app.access_commenter', '', true);
  perform set_config('app.access_viewer', '', true);
end $$;

-- Whether a folder is restricted for someone, and their level on it (for folder-level managing and menus).
create or replace function _folder_level_for(p_user uuid, p_folder uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when m.role = 'owner' then 'owner'
             when not f.restricted then case when m.role in ('admin', 'editor') then 'editor' else 'viewer' end
             when g.level is null then 'none'
             when m.role in ('viewer', 'auditor') then 'viewer'
             else g.level
           end
      from folders f
      join memberships m on m.org_id = f.org_id and m.user_id = p_user
                        and (m.expires_at is null or m.expires_at > now())
      left join access_grants g on g.folder_id = f.id and g.user_id = p_user
     where f.id = p_folder), 'none')
$$;

-- ───────────────────────── resolution (callable: commands, RLS) ─────────────────────────
create or replace function sheet_access(p_sheet uuid) returns text
language sql stable security definer set search_path = public as $$
  select _sheet_level_for(auth.uid(), p_sheet)
$$;

create or replace function folder_access(p_folder uuid) returns text
language sql stable security definer set search_path = public as $$
  select _folder_level_for(auth.uid(), p_folder)
$$;

create or replace function readable_sheet_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select sheet_id from _sheet_levels(auth.uid(), null) where level <> 'none'
$$;

create or replace function commentable_sheet_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select sheet_id from _sheet_levels(auth.uid(), null) where _level_rank(level) >= 2
$$;

create or replace function editable_sheet_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select sheet_id from _sheet_levels(auth.uid(), null) where _level_rank(level) >= 3
$$;

-- The sheets of a workspace for the side menu and pickers: the ones the caller can read, and for owners and admins
-- also the restricted ones they cannot open (name only; the menu shows them as Restricted).
create or replace function my_sheet_access(p_org uuid)
returns table (sheet_id uuid, name text, folder_id uuid, parent_sheet_id uuid, "position" text, archived_at timestamptz,
               level text, restricted boolean, own_setting boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.folder_id, s.parent_sheet_id, s.position, s.archived_at, l.level, l.restricted,
         not s.access_inherit
    from _sheet_levels(auth.uid(), null) l join sheets s on s.id = l.sheet_id
   where s.org_id = p_org and (l.level <> 'none' or is_admin(p_org))
$$;

-- Levels of the given sheets ('none' for sheets the caller cannot read or that do not exist): link targets and
-- dashboard widgets show "Restricted" / "No access" instead of looking empty.
create or replace function sheet_levels(p_sheets uuid[])
returns table (sheet_id uuid, level text)
language sql stable security definer set search_path = public as $$
  select x.id, coalesce(l.level, 'none')
    from unnest(coalesce(p_sheets, '{}')) x(id)
    left join _sheet_levels(auth.uid(), null) l on l.sheet_id = x.id
$$;

-- ───────────────────────── who may manage access ─────────────────────────
-- Owners, and admins who have access themselves (decision 1). Sub-item sheets follow their parent.
create or replace function _can_manage_sheet(p_sheet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sheets s where s.id = p_sheet
                   and (has_role(s.org_id, array['owner']::member_role[])
                        or (is_admin(s.org_id) and _sheet_level_for(auth.uid(), s.id) <> 'none')))
$$;

create or replace function _can_manage_folder(p_folder uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from folders f where f.id = p_folder
                   and (has_role(f.org_id, array['owner']::member_role[])
                        or (is_admin(f.org_id) and _folder_level_for(auth.uid(), f.id) <> 'none')))
$$;

-- ───────────────────────── RLS: grants ─────────────────────────
-- Who has access is visible to the people who have it and to owners and admins; nobody writes grants directly.
create policy access_grants_read on access_grants for select using (
  is_member(org_id) and (user_id = auth.uid() or is_admin(org_id)
                         or (sheet_id is not null and sheet_id in (select readable_sheet_ids()))
                         or (folder_id is not null and folder_access(folder_id) <> 'none')));

-- ───────────────────────── RLS: structure ─────────────────────────
drop policy folders_read on folders;
create policy folders_read on folders for select using (
  is_member(org_id) and (not restricted or is_admin(org_id) or folder_access(id) <> 'none'
                         or exists (select 1 from sheets s where s.folder_id = folders.id)));
drop policy folders_update on folders;
create policy folders_update on folders for update using (is_admin(org_id) and folder_access(id) <> 'none')
  with check (is_admin(org_id) and folder_access(id) <> 'none');
drop policy folders_delete on folders;
create policy folders_delete on folders for delete using (is_admin(org_id) and folder_access(id) <> 'none');

drop policy sheets_read on sheets;
drop policy sheets_write on sheets;
create policy sheets_read on sheets for select using (id in (select readable_sheet_ids()));
create policy sheets_insert on sheets for insert with check (
  is_editor(org_id)
  and (parent_sheet_id is null or parent_sheet_id in (select editable_sheet_ids()))
  and (folder_id is null or folder_access(folder_id) in ('owner', 'editor')));
create policy sheets_update on sheets for update using (id in (select editable_sheet_ids()))
  with check (is_editor(org_id));
create policy sheets_delete on sheets for delete using (id in (select editable_sheet_ids()));

drop policy groups_read on groups;
drop policy groups_write on groups;
create policy groups_read on groups for select using (sheet_id in (select readable_sheet_ids()));
create policy groups_write on groups for all using (is_editor(org_id) and sheet_id in (select editable_sheet_ids()))
  with check (is_editor(org_id) and sheet_id in (select editable_sheet_ids()));

drop policy fields_read on fields;
drop policy fields_insert on fields;
drop policy fields_update on fields;
drop policy fields_delete on fields;
create policy fields_read on fields for select using (sheet_id in (select readable_sheet_ids()));
create policy fields_insert on fields for insert
  with check (is_editor(org_id) and sheet_id in (select editable_sheet_ids()));
create policy fields_update on fields for update
  using ((is_admin(org_id) or (is_editor(org_id) and not locked)) and sheet_id in (select editable_sheet_ids()))
  with check ((is_admin(org_id) or (is_editor(org_id) and not locked)) and sheet_id in (select editable_sheet_ids()));
create policy fields_delete on fields for delete
  using ((is_admin(org_id) or (is_editor(org_id) and not locked)) and sheet_id in (select editable_sheet_ids()));

drop policy views_read on views;
drop policy views_write on views;
create policy views_read on views for select
  using (sheet_id in (select readable_sheet_ids()) and (owner_id is null or owner_id = auth.uid()));
create policy views_write on views for all
  using (sheet_id in (select readable_sheet_ids()) and (
         (type <> 'form' and ((owner_id = auth.uid() and is_member(org_id))
                              or (owner_id is null and is_editor(org_id) and sheet_id in (select editable_sheet_ids()))))
         or (type = 'form' and owner_id is null and is_admin(org_id) and sheet_id in (select editable_sheet_ids()))))
  with check (sheet_id in (select readable_sheet_ids()) and (
         (type <> 'form' and ((owner_id = auth.uid() and is_member(org_id))
                              or (owner_id is null and is_editor(org_id) and sheet_id in (select editable_sheet_ids()))))
         or (type = 'form' and owner_id is null and is_admin(org_id) and sheet_id in (select editable_sheet_ids()))));

drop policy form_links_read on form_links;
drop policy form_links_write on form_links;
create policy form_links_read on form_links for select using (sheet_id in (select readable_sheet_ids()));
create policy form_links_write on form_links for all
  using (is_admin(org_id) and sheet_id in (select editable_sheet_ids()))
  with check (is_admin(org_id) and sheet_id in (select editable_sheet_ids()));

drop policy automations_read on automations;
drop policy automations_insert on automations;
drop policy automations_update on automations;
drop policy automations_delete on automations;
create policy automations_read on automations for select using (sheet_id in (select readable_sheet_ids()));
create policy automations_insert on automations for insert with check (
  is_editor(org_id) and sheet_in_org(sheet_id, org_id) and created_by = auth.uid()
  and run_count = 0 and last_run_at is null and sheet_id in (select editable_sheet_ids()));
create policy automations_update on automations for update
  using ((is_admin(org_id) or (is_editor(org_id) and not locked)) and sheet_id in (select editable_sheet_ids()))
  with check ((is_admin(org_id) or (is_editor(org_id) and not locked)) and sheet_in_org(sheet_id, org_id)
              and sheet_id in (select editable_sheet_ids()));
create policy automations_delete on automations for delete
  using ((is_admin(org_id) or (is_editor(org_id) and not locked)) and sheet_id in (select editable_sheet_ids()));

drop policy automation_pauses_read on automation_pauses;
drop policy automation_pauses_write on automation_pauses;
create policy automation_pauses_read on automation_pauses for select
  using (exists (select 1 from automations a where a.id = automation_id));
create policy automation_pauses_write on automation_pauses for all
  using (is_editor(org_id) and exists (select 1 from automations a where a.id = automation_id
                                         and a.sheet_id in (select editable_sheet_ids())))
  with check (is_editor(org_id) and pause_pair_ok(automation_id, item_id, org_id)
              and exists (select 1 from automations a where a.id = automation_id
                            and a.sheet_id in (select editable_sheet_ids())));

drop policy automation_runs_read on automation_runs;
create policy automation_runs_read on automation_runs for select using (
  (sheet_id is null and is_admin(org_id)) or sheet_id in (select readable_sheet_ids()));

-- ───────────────────────── RLS: item data ─────────────────────────
drop policy items_read on items;
create policy items_read on items for select using (sheet_id in (select readable_sheet_ids()));

drop policy item_updates_read on item_updates;
drop policy item_updates_insert on item_updates;
create policy item_updates_read on item_updates for select
  using (exists (select 1 from items i where i.id = item_id));
-- commenters and up post as themselves (editors as before; viewers and auditors never)
create policy item_updates_insert on item_updates for insert
  with check (is_editor(org_id) and author_id = auth.uid() and kind = 'update'
              and exists (select 1 from items i where i.id = item_id and i.sheet_id in (select commentable_sheet_ids())));

drop policy file_access_log_read on file_access_log;
create policy file_access_log_read on file_access_log for select
  using (exists (select 1 from items i where i.id = item_id));

drop policy notifications_read on notifications;
create policy notifications_read on notifications for select
  using (user_id = auth.uid() and (item_id is null or exists (select 1 from items i where i.id = item_id)));

-- ───────────────────────── guards on the tables definer functions write ─────────────────────────
-- A person writing items (create_item, set_item_values, imports, sub-items, forms, packs …) needs edit access to the
-- item's sheet. Automations (service role) were authorised when they were saved (docs/04 §7).
create or replace function items_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _need_sheet(new.sheet_id, 'editor');
  return new;
end $$;
create trigger items_access_guard before insert or update on items
  for each row execute function items_access_guard();

-- Links: edit access to the item they start from, read access to the item they point at (a two-way link writes both
-- directions, so it needs edit access to both sheets).
create or replace function item_links_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r item_links := coalesce(new, old); a uuid; b uuid;
begin
  if not _is_person() then return coalesce(new, old); end if;
  select sheet_id into a from items where id = r.from_item;
  select sheet_id into b from items where id = r.to_item;
  perform _need_sheet(a, 'editor');
  perform _need_sheet(b, 'viewer');
  return coalesce(new, old);
end $$;
create trigger item_links_access_guard before insert or update or delete on item_links
  for each row execute function item_links_access_guard();

-- Item-scoped rows: the level the person needs on the item's sheet.
create or replace function item_rows_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old)); s uuid;
begin
  if not _is_person() then return coalesce(new, old); end if;
  select sheet_id into s from items where id = (r->>'item_id')::uuid;
  perform _need_sheet(s, tg_argv[0]);
  return coalesce(new, old);
end $$;
create trigger item_updates_access_guard before insert or update or delete on item_updates
  for each row execute function item_rows_access_guard('commenter');
create trigger files_access_guard before insert or update on files
  for each row execute function item_rows_access_guard('editor');
create trigger file_access_log_access_guard before insert on file_access_log
  for each row execute function item_rows_access_guard('viewer');
create trigger protected_values_access_guard before insert or update or delete on protected_values
  for each row execute function item_rows_access_guard('editor');
create trigger automation_pauses_access_guard before insert or delete on automation_pauses
  for each row execute function item_rows_access_guard('editor');

-- Notifications reach only people who can read the item (mentions, forms, automations, webhook failures alike).
create or replace function notifications_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if new.item_id is null then return new; end if;
  select sheet_id into s from items where id = new.item_id;
  if s is null or _sheet_level_for(new.user_id, s) = 'none' then return null; end if;
  return new;
end $$;
create trigger notifications_access_guard before insert on notifications
  for each row execute function notifications_access_guard();

-- Access settings change only through the access functions below (app.access_op), and pack installs. Moving a sheet
-- into or out of a restricted folder changes who can see it: only people who can manage both folders may.
create or replace function sheets_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare op text := coalesce(current_setting('app.access_op', true), '');
        old_r boolean; new_r boolean;
begin
  if tg_op = 'INSERT' then
    if (new.restricted or not new.access_inherit) and op <> 'on'
       and coalesce(current_setting('app.pack_op', true), '') <> 'install' then
      raise exception 'access: Restrict a sheet from its Access settings.';
    end if;
    return new;
  end if;
  if (new.restricted is distinct from old.restricted or new.access_inherit is distinct from old.access_inherit)
     and op <> 'on' then
    raise exception 'access: Restrict a sheet from its Access settings.';
  end if;
  if new.folder_id is distinct from old.folder_id and new.folder_id is not null and _is_person()
     and folder_access(new.folder_id) not in ('owner', 'editor') then
    raise exception using errcode = '42501', message = 'no access: you cannot add sheets to this folder';
  end if;
  if new.folder_id is distinct from old.folder_id and new.access_inherit and new.parent_sheet_id is null
     and _is_person() then
    select coalesce((select restricted from folders where id = old.folder_id), false) into old_r;
    select coalesce((select restricted from folders where id = new.folder_id), false) into new_r;
    if (old_r or new_r)
       and not ((old.folder_id is null or _can_manage_folder(old.folder_id))
                and (new.folder_id is null or _can_manage_folder(new.folder_id))) then
      raise exception 'access: Only owners and admins with access can move a sheet into or out of a restricted folder.';
    end if;
  end if;
  return new;
end $$;
create trigger sheets_access_guard before insert or update on sheets
  for each row execute function sheets_access_guard();

create or replace function folders_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.restricted and coalesce(current_setting('app.access_op', true), '') <> 'on'
       and coalesce(current_setting('app.pack_op', true), '') <> 'install' then
      raise exception 'access: Restrict a folder from its Access settings.';
    end if;
  elsif new.restricted is distinct from old.restricted and coalesce(current_setting('app.access_op', true), '') <> 'on' then
    raise exception 'access: Restrict a folder from its Access settings.';
  end if;
  return new;
end $$;
create trigger folders_access_guard before insert or update on folders
  for each row execute function folders_access_guard();

-- Archiving a folder archives its sheets as the caller (RLS): refuse when it holds sheets the caller cannot see,
-- instead of leaving them behind.
create or replace function folder_hidden_sheet_count(p_folder uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from sheets s
   where s.folder_id = p_folder and s.parent_sheet_id is null and _sheet_level_for(auth.uid(), s.id) = 'none'
$$;

create or replace function set_folder_archived(p_folder uuid, p_archived boolean) returns integer
language plpgsql security invoker set search_path = public as $$
declare f folders; at timestamptz := now(); n integer;
begin
  select * into f from folders where id = p_folder;
  if f.id is null then raise exception 'folder not found'; end if;
  if not is_admin(f.org_id) then raise exception 'only owners and admins can archive folders'; end if;
  if folder_hidden_sheet_count(f.id) > 0 then
    raise exception 'access: This folder holds restricted sheets you do not have access to.';
  end if;
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

-- ───────────────────────── storage ─────────────────────────
-- An object is readable when its files row is (the item's sheet and, for a file field, the field); uploads go to
-- items of sheets the person can edit.
drop policy files_read on storage.objects;
create policy files_read on storage.objects for select using (
  bucket_id = 'files' and (storage.foldername(name))[1] = 'org'
  and public.is_member(((storage.foldername(name))[2])::uuid)
  and exists (select 1 from public.files f where f.storage_path = name));
drop policy files_upload on storage.objects;
create policy files_upload on storage.objects for insert with check (
  bucket_id = 'files' and (storage.foldername(name))[1] = 'org'
  and public.is_editor(((storage.foldername(name))[2])::uuid)
  and (storage.foldername(name))[3] = 'item'
  and exists (select 1 from public.items i where i.id::text = (storage.foldername(name))[4]
                and i.sheet_id in (select public.editable_sheet_ids())));

-- ───────────────────────── managing access ─────────────────────────
create or replace function _member_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from profiles where id = p_user), 'Former member')
$$;

-- p_mode: 'inherit' (follow the folder), 'restricted' (only the sheet's list), 'open' (everyone by workspace role).
-- Restricting a sheet that has no list yet starts it from the folder's list, and lists the admin who restricts it.
create or replace function set_sheet_access(p_sheet uuid, p_mode text) returns text
language plpgsql security definer set search_path = public as $$
declare s sheets; old_mode text; f folders;
begin
  select * into s from sheets where id = p_sheet;
  if s.id is null or not is_member(s.org_id) then raise exception 'no access: sheet not found'; end if;
  if s.parent_sheet_id is not null then raise exception 'access: Sub-items follow the access of their sheet.'; end if;
  if not _can_manage_sheet(s.id) then raise exception 'not allowed: only owners and admins with access manage access'; end if;
  if p_mode not in ('inherit', 'restricted', 'open') then raise exception 'access: bad mode'; end if;
  old_mode := case when s.access_inherit then 'inherit' when s.restricted then 'restricted' else 'open' end;
  if old_mode = p_mode then return p_mode; end if;
  perform set_config('app.access_op', 'on', true);
  if p_mode = 'restricted' and not exists (select 1 from access_grants where sheet_id = s.id) then
    select * into f from folders where id = s.folder_id;
    if s.access_inherit and coalesce(f.restricted, false) then
      insert into access_grants(org_id, sheet_id, user_id, level, granted_by)
      select s.org_id, s.id, g.user_id, g.level, auth.uid() from access_grants g where g.folder_id = f.id;
    end if;
  end if;
  update sheets set access_inherit = (p_mode = 'inherit'), restricted = (p_mode = 'restricted') where id = s.id;
  if p_mode = 'restricted' and auth.uid() is not null and not has_role(s.org_id, array['owner']::member_role[]) then
    insert into access_grants(org_id, sheet_id, user_id, level, granted_by)
    values (s.org_id, s.id, auth.uid(), 'editor', auth.uid())
    on conflict (sheet_id, user_id) where sheet_id is not null do update set level = 'editor';
  end if;
  perform set_config('app.access_op', '', true);
  perform _access_changed();
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (s.org_id, s.id, '', 'user', auth.uid(), 'access.changed',
          jsonb_build_object('mode', old_mode), jsonb_build_object('mode', p_mode,
            'grants', (select coalesce(jsonb_agg(jsonb_build_object('user_id', g.user_id, 'level', g.level)
                                                  order by g.granted_at), '[]'::jsonb)
                         from access_grants g where g.sheet_id = s.id)),
          case p_mode when 'restricted' then 'Restricted ' || s.name
                      when 'open' then 'Opened ' || s.name || ' to the workspace'
                      else s.name || ' follows its folder' end);
  return p_mode;
end $$;

create or replace function set_folder_access(p_folder uuid, p_restricted boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare f folders;
begin
  select * into f from folders where id = p_folder;
  if f.id is null or not is_member(f.org_id) then raise exception 'no access: folder not found'; end if;
  if not _can_manage_folder(f.id) then raise exception 'not allowed: only owners and admins with access manage access'; end if;
  if f.restricted = p_restricted then return p_restricted; end if;
  perform set_config('app.access_op', 'on', true);
  update folders set restricted = p_restricted where id = f.id;
  if p_restricted and auth.uid() is not null and not has_role(f.org_id, array['owner']::member_role[]) then
    insert into access_grants(org_id, folder_id, user_id, level, granted_by)
    values (f.org_id, f.id, auth.uid(), 'editor', auth.uid())
    on conflict (folder_id, user_id) where folder_id is not null do update set level = 'editor';
  end if;
  perform set_config('app.access_op', '', true);
  perform _access_changed();
  insert into activity_log(org_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (f.org_id, '', 'user', auth.uid(), 'folder.access_changed',
          jsonb_build_object('folder_id', f.id, 'restricted', f.restricted),
          jsonb_build_object('folder_id', f.id, 'restricted', p_restricted),
          case when p_restricted then 'Restricted folder ' || f.name else 'Opened folder ' || f.name || ' to the workspace' end);
  return p_restricted;
end $$;

-- Give, change or remove (p_level null) one person's access to a sheet (p_kind 'sheet') or a folder (p_kind 'folder').
create or replace function set_access_grant(p_kind text, p_target uuid, p_user uuid, p_level text) returns text
language plpgsql security definer set search_path = public as $$
declare o uuid; tname text; old_level text; s sheets; f folders; act text;
begin
  if p_kind = 'sheet' then
    select * into s from sheets where id = p_target;
    if s.id is null or not is_member(s.org_id) then raise exception 'no access: sheet not found'; end if;
    if s.parent_sheet_id is not null then raise exception 'access: Sub-items follow the access of their sheet.'; end if;
    if not _can_manage_sheet(s.id) then raise exception 'not allowed: only owners and admins with access manage access'; end if;
    o := s.org_id; tname := s.name;
    select level into old_level from access_grants where sheet_id = s.id and user_id = p_user;
  elsif p_kind = 'folder' then
    select * into f from folders where id = p_target;
    if f.id is null or not is_member(f.org_id) then raise exception 'no access: folder not found'; end if;
    if not _can_manage_folder(f.id) then raise exception 'not allowed: only owners and admins with access manage access'; end if;
    o := f.org_id; tname := f.name;
    select level into old_level from access_grants where folder_id = f.id and user_id = p_user;
  else
    raise exception 'access: bad target';
  end if;
  if p_level is not null and p_level not in ('editor', 'commenter', 'viewer') then raise exception 'access: bad level'; end if;
  if p_level is not null and not exists (select 1 from memberships m where m.org_id = o and m.user_id = p_user) then
    raise exception 'access: Only members of the workspace can be given access.';
  end if;
  if old_level is not distinct from p_level then return p_level; end if;
  if p_level is null then
    delete from access_grants where user_id = p_user and (sheet_id = s.id or folder_id = f.id);
    act := 'access.revoked';
  elsif old_level is null then
    insert into access_grants(org_id, folder_id, sheet_id, user_id, level, granted_by)
    values (o, f.id, s.id, p_user, p_level, auth.uid());
    act := 'access.granted';
  else
    update access_grants set level = p_level, granted_by = auth.uid(), granted_at = now()
     where user_id = p_user and (sheet_id = s.id or folder_id = f.id);
    act := 'access.level_changed';
  end if;
  perform _access_changed();
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
  values (o, s.id, '', 'user', auth.uid(), case when p_kind = 'folder' then 'folder.' || act else act end,
          case when old_level is not null then jsonb_build_object('user_id', p_user, 'level', old_level,
                                                                  'folder_id', f.id) end,
          case when p_level is not null then jsonb_build_object('user_id', p_user, 'level', p_level,
                                                                'folder_id', f.id) end,
          _member_name(p_user) || ': ' || coalesce(p_level, 'no access') || ' on ' || tname);
  return p_level;
end $$;

-- What the Access panel shows: the effective setting, where it comes from, the list, and whether the caller manages it.
create or replace function sheet_access_info(p_sheet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s sheets; root sheets; f folders; src text; restricted boolean; lvl text;
begin
  select * into s from sheets where id = p_sheet;
  if s.id is null or not is_member(s.org_id) then return null; end if;
  lvl := _sheet_level_for(auth.uid(), s.id);
  if lvl = 'none' and not is_admin(s.org_id) then return null; end if;
  root := s;
  if s.parent_sheet_id is not null then select * into root from sheets where id = s.parent_sheet_id; end if;
  select * into f from folders where id = root.folder_id;
  src := case when root.access_inherit then 'folder' else 'sheet' end;
  restricted := case when root.access_inherit then coalesce(f.restricted, false) else root.restricted end;
  return jsonb_build_object(
    'sheetId', root.id, 'name', root.name, 'level', lvl,
    'mode', case when root.access_inherit then 'inherit' when root.restricted then 'restricted' else 'open' end,
    'restricted', restricted, 'source', src,
    'folder', case when f.id is null then null
                   else jsonb_build_object('id', f.id, 'name', f.name, 'restricted', f.restricted) end,
    'canManage', _can_manage_sheet(root.id),
    'grants', case when lvl = 'none' then '[]'::jsonb else (
                select coalesce(jsonb_agg(jsonb_build_object('userId', g.user_id, 'level', g.level,
                                  'grantedBy', g.granted_by, 'grantedAt', g.granted_at) order by g.granted_at), '[]'::jsonb)
                  from access_grants g
                 where (src = 'sheet' and g.sheet_id = root.id) or (src = 'folder' and g.folder_id = f.id)) end,
    'sheetGrants', case when lvl = 'none' then '[]'::jsonb else (
                select coalesce(jsonb_agg(jsonb_build_object('userId', g.user_id, 'level', g.level) order by g.granted_at),
                                '[]'::jsonb)
                  from access_grants g where g.sheet_id = root.id) end,
    'members', case when lvl = 'none' then '[]'::jsonb else (
                select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role,
                                  'level', _sheet_level_for(m.user_id, root.id)) order by m.created_at), '[]'::jsonb)
                  from memberships m where m.org_id = s.org_id and (m.expires_at is null or m.expires_at > now())) end);
end $$;

create or replace function folder_access_info(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f folders; lvl text;
begin
  select * into f from folders where id = p_folder;
  if f.id is null or not is_member(f.org_id) then return null; end if;
  lvl := _folder_level_for(auth.uid(), f.id);
  if lvl = 'none' and not is_admin(f.org_id) then return null; end if;
  return jsonb_build_object(
    'folderId', f.id, 'name', f.name, 'level', lvl, 'restricted', f.restricted,
    'canManage', _can_manage_folder(f.id),
    'grants', case when lvl = 'none' then '[]'::jsonb else (
                select coalesce(jsonb_agg(jsonb_build_object('userId', g.user_id, 'level', g.level,
                                  'grantedBy', g.granted_by, 'grantedAt', g.granted_at) order by g.granted_at), '[]'::jsonb)
                  from access_grants g where g.folder_id = f.id) end,
    'members', case when lvl = 'none' then '[]'::jsonb else (
                select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role,
                                  'level', _folder_level_for(m.user_id, f.id)) order by m.created_at), '[]'::jsonb)
                  from memberships m where m.org_id = f.org_id and (m.expires_at is null or m.expires_at > now())) end);
end $$;

-- Break-glass (decision 2): an owner opening a restricted sheet they are not listed on is logged on the sheet's
-- chain, at most once per person per day. Called by the sheet page.
create or replace function note_sheet_opened(p_sheet uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare s sheets; root uuid; l record;
begin
  select * into s from sheets where id = p_sheet;
  if s.id is null or auth.uid() is null then return false; end if;
  root := coalesce(s.parent_sheet_id, s.id);
  select * into l from _sheet_levels(auth.uid(), root);
  if l.level is distinct from 'owner' or not l.restricted then return false; end if;
  if exists (select 1 from access_grants g join sheets r on r.id = root
              where g.user_id = auth.uid()
                and ((r.access_inherit and g.folder_id = r.folder_id) or (not r.access_inherit and g.sheet_id = r.id))) then
    return false;
  end if;
  if exists (select 1 from activity_log a where a.chain_key = 'sheet:' || root and a.action = 'restricted.accessed'
               and a.actor_id = auth.uid() and a.at > date_trunc('day', now())) then
    return false;
  end if;
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, note)
  values (s.org_id, root, '', 'user', auth.uid(), 'restricted.accessed',
          _member_name(auth.uid()) || ' opened a restricted sheet they are not listed on (owner access)');
  return true;
end $$;

-- ───────────────────────── reading the log: the chain's sheet must be readable ─────────────────────────
create or replace function verify_activity_chain(p_chain_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; prev text := 'genesis'; n int := 0; o uuid; s uuid;
begin
  select org_id, sheet_id into o, s from activity_log where chain_key = p_chain_key limit 1;
  if o is null then return jsonb_build_object('ok', true, 'entries', 0); end if;
  if not is_member(o) then raise exception 'not allowed'; end if;
  if s is not null and _sheet_level_for(auth.uid(), s) = 'none' then raise exception 'not allowed'; end if;
  for r in select * from activity_log where chain_key = p_chain_key order by id loop
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> activity_hash(r.prev_hash, r.at, r.actor_kind, r.actor_id, r.action,
                                                       r.field_id, r.old_value, r.new_value, r.note) then
      return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', r.id);
    end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'entries', n, 'last_hash', prev);
end $$;

-- activity_log: entries of a sheet or its items need read access to the sheet; workspace entries need membership
-- (folder access entries: owners and admins, as they name restricted folders and people).
drop policy activity_log_read on activity_log;
create policy activity_log_read on activity_log for select using (
  case when sheet_id is null then is_member(org_id) and (action not like 'folder.access%' or is_admin(org_id))
       else sheet_id in (select readable_sheet_ids()) end);

-- ───────────────────────── grants ─────────────────────────
revoke all on function _level_rank(text), _sheet_levels(uuid, uuid), _sheet_level_for(uuid, uuid), _is_person(),
  _need_sheet(uuid, text), _access_changed(), _folder_level_for(uuid, uuid), _can_manage_sheet(uuid),
  _can_manage_folder(uuid), _member_name(uuid)
  from public, anon, authenticated;
revoke all on function items_access_guard(), item_links_access_guard(), item_rows_access_guard(),
  notifications_access_guard(), sheets_access_guard(), folders_access_guard(), memberships_audit() from public, anon, authenticated;
revoke all on function sheet_access(uuid), folder_access(uuid), readable_sheet_ids(), commentable_sheet_ids(),
  editable_sheet_ids(), my_sheet_access(uuid), sheet_levels(uuid[]), folder_hidden_sheet_count(uuid),
  set_sheet_access(uuid, text), set_folder_access(uuid, boolean), set_access_grant(text, uuid, uuid, text),
  sheet_access_info(uuid), folder_access_info(uuid), note_sheet_opened(uuid)
  from public, anon;
grant execute on function sheet_access(uuid), folder_access(uuid), readable_sheet_ids(), commentable_sheet_ids(),
  editable_sheet_ids(), my_sheet_access(uuid), sheet_levels(uuid[]), folder_hidden_sheet_count(uuid),
  set_sheet_access(uuid, text), set_folder_access(uuid, boolean), set_access_grant(text, uuid, uuid, text),
  sheet_access_info(uuid), folder_access_info(uuid), note_sheet_opened(uuid)
  to authenticated;
grant execute on function sheet_access(uuid), readable_sheet_ids(), sheet_levels(uuid[]) to service_role;
