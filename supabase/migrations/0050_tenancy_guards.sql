-- 0050_tenancy_guards.sql · A row never leaves its workspace or its sheet (security review H1, SA-14, L8).
--
-- Before: `sheets_update` and `fields_update` checked the *new* row's org with `is_editor(org_id)`, so an editor who
-- created a second workspace could move a field (dropping its restriction for everyone) or a whole sheet (with its
-- items, links, files and history) into it. Only automations (0011), dashboards (0016) and folders (0021) froze
-- `org_id`.
--
-- Now:
-- 1. `_tenancy_fixed(columns…)`: a BEFORE UPDATE trigger on every workspace table refuses a change to `org_id` and,
--    where the table has them, to its parent keys (`sheet_id`, `item_id`, `field_id` …), whoever writes (people,
--    definer functions, the service role). Nothing in the product moves a row between workspaces or sheets.
-- 2. `_org_matches_parent(table, column)`: a BEFORE INSERT OR UPDATE trigger checks that a row's `org_id` is its
--    sheet's (fields, groups, views, form links, sheets' folder and parent) or its item's (files, protected values,
--    automation pauses, restricted values, file downloads). SA-14: a member of two workspaces could insert a field
--    with workspace A's id on a sheet of workspace B.
-- 3. `hidden_field_ids()` and `field_visible()` judge a restricted field by its sheet's workspace and the sheets the
--    person can read, never by the field's own `org_id` column, so the check cannot be escaped by that column.
-- 4. L8: `sheets.next_seq` (the display id counter) is written only by the definer functions that create items,
--    never by a direct update (an editor could reset it and make item creation collide on (sheet_id, seq)).

create or replace function _tenancy_fixed() returns trigger
language plpgsql set search_path = public as $$
declare c text; o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
begin
  foreach c in array tg_argv loop
    if (o -> c) is distinct from (n -> c) then
      raise exception using errcode = '42501',
        message = format('access: A row of %s cannot move to another %s.', replace(tg_table_name, '_', ' '),
                         case c when 'org_id' then 'workspace' else replace(replace(c, '_id', ''), '_', ' ') end);
    end if;
  end loop;
  return new;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
      ('sheets',            array['org_id']),
      ('fields',            array['org_id', 'sheet_id']),
      ('groups',            array['org_id', 'sheet_id']),
      ('views',             array['org_id', 'sheet_id']),
      ('form_links',        array['org_id', 'sheet_id', 'view_id']),
      ('items',             array['org_id', 'sheet_id']),
      ('item_links',        array['org_id', 'field_id', 'from_item']),
      ('item_updates',      array['org_id', 'item_id']),
      ('files',             array['org_id', 'item_id', 'field_id']),
      ('file_access_log',   array['org_id', 'item_id', 'file_id']),
      ('protected_values',  array['org_id', 'item_id', 'field_id']),
      ('restricted_values', array['org_id', 'sheet_id', 'item_id', 'field_id']),
      ('automation_pauses', array['org_id', 'automation_id', 'item_id']),
      ('automation_runs',   array['org_id', 'automation_id']),
      ('notifications',     array['org_id', 'user_id']),
      ('memberships',       array['org_id', 'user_id']),
      ('invites',           array['org_id']),
      ('teams',             array['org_id']),
      ('team_members',      array['org_id']),
      ('job_roles',         array['org_id']),
      ('entities',          array['org_id']),
      ('sites',             array['org_id']),
      ('access_grants',     array['org_id', 'folder_id', 'sheet_id', 'user_id']),
      ('pack_installs',     array['org_id']),
      ('retention_queue',   array['org_id', 'sheet_id', 'item_id']),
      ('retention_holds',   array['org_id', 'item_id']),
      ('workflow_instances', array['org_id', 'sheet_id', 'item_id']),
      ('outbound_webhooks', array['org_id', 'automation_id']),
      ('scheduler_fired',   array['org_id', 'automation_id'])) v(tbl, cols) loop
    execute format('create trigger %I before update on %I for each row execute function _tenancy_fixed(%s)',
                   t.tbl || '_tenancy_fixed', t.tbl,
                   (select string_agg(quote_literal(c), ', ') from unnest(t.cols) c));
  end loop;
end $$;

-- A row's workspace is its parent's: tg_argv[0] = the parent table (sheets, items, folders, views), tg_argv[1] = the
-- column holding the parent's id. A null parent id is checked by the column's own constraints.
create or replace function _org_matches_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid text := to_jsonb(new) ->> tg_argv[1]; o uuid;
begin
  if pid is null then return new; end if;
  execute format('select org_id from %I where id = $1', tg_argv[0]) into o using pid::uuid;
  if o is distinct from new.org_id then
    raise exception using errcode = '42501',
      message = format('access: This %s belongs to another workspace.', rtrim(tg_argv[0], 's'));
  end if;
  return new;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
      ('fields', 'sheets', 'sheet_id'),
      ('groups', 'sheets', 'sheet_id'),
      ('views', 'sheets', 'sheet_id'),
      ('form_links', 'sheets', 'sheet_id'),
      ('form_links', 'views', 'view_id'),
      ('sheets', 'folders', 'folder_id'),
      ('sheets', 'sheets', 'parent_sheet_id'),
      ('files', 'items', 'item_id'),
      ('protected_values', 'items', 'item_id'),
      ('automation_pauses', 'items', 'item_id'),
      ('restricted_values', 'sheets', 'sheet_id'),
      ('file_access_log', 'items', 'item_id')) v(tbl, parent, col) loop
    execute format('create trigger %I before insert or update of %I, org_id on %I for each row '
                   'execute function _org_matches_parent(%L, %L)',
                   t.tbl || '_same_org_' || t.col, t.col, t.tbl, t.parent, t.col);
  end loop;
end $$;

-- Restricted fields: the fields of every sheet the person can read, judged by that sheet's workspace.
create or replace function hidden_field_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f.id), '{}') from fields f join sheets s on s.id = f.sheet_id
   where f.restricted_to is not null
     and f.sheet_id in (select readable_sheet_ids())
     and not _field_visible_for(auth.uid(), s.org_id, f.restricted_to)
$$;

create or replace function field_visible(p_field uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select _field_visible_for(auth.uid(), s.org_id, f.restricted_to)
                     from fields f join sheets s on s.id = f.sheet_id where f.id = p_field), false)
$$;

-- L8: the display id counter belongs to the functions that create items.
create or replace function sheets_seq_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and new.next_seq is distinct from old.next_seq then
    raise exception using errcode = '42501', message = 'access: The item counter of a sheet cannot be changed.';
  end if;
  return new;
end $$;
create trigger sheets_seq_guard before update of next_seq on sheets for each row execute function sheets_seq_guard();

revoke execute on function _tenancy_fixed(), _org_matches_parent(), sheets_seq_guard() from public, anon, authenticated;
