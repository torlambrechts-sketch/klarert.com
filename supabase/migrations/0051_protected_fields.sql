-- 0051_protected_fields.sql · Who sees a protected field is an owner's or admin's decision (security review H2).
--
-- Before: any editor of a sheet could add themselves to a protected field's `config.allowedUserIds` (field settings or
-- a direct PATCH) and then read every protected value (passwords, keys, bank details). `protected_values` also had a
-- write policy, so listed editors could overwrite or delete values with no `protected.changed` entry.
--
-- Now:
-- 1. `fields_protected_guard`: for people, a change to a protected field's list (or a type change into or out of
--    `protected`) needs an owner or admin of the workspace. The change is logged by the fields audit trigger
--    (`fields.update` on the sheet's chain, before and after). Creating a new protected field is not a change.
-- 2. `protected_values` has no write policy and no write grant for API roles: values are written only by the definer
--    function `set_protected_value`, which logs `protected.changed` / `protected.cleared`, and by retention erasure.

create or replace function fields_protected_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not _is_person() then return new; end if;
  if (old.type = 'protected' or new.type = 'protected')
     and (old.type is distinct from new.type
          or coalesce(old.config -> 'allowedUserIds', '[]'::jsonb) is distinct from coalesce(new.config -> 'allowedUserIds', '[]'::jsonb))
     and not is_admin(new.org_id) then
    raise exception using errcode = '42501',
      message = 'access: Only owners and admins can change who sees a protected field.';
  end if;
  return new;
end $$;
create trigger fields_protected_guard before update on fields
  for each row execute function fields_protected_guard();
revoke execute on function fields_protected_guard() from public, anon, authenticated;

drop policy if exists protected_write on protected_values;
revoke insert, update, delete, truncate on protected_values from anon, authenticated;
