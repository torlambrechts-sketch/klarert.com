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
