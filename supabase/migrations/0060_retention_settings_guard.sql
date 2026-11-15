-- 0060_retention_settings_guard.sql · Retention rules and the personal-data flag are owners' and admins' decisions
-- (security review M7, docs/02 §18).
--
-- Before: docs/02 §18 says retention rules are "written by owners and admins", but only the command checked it; any
-- editor could rewrite `sheets.settings.retention` directly (removing a rule, or turning `personalNames` off), or turn
-- a field's `config.personalData` off, after which new personal data entered the log in clear and could never be
-- erased.
--
-- Now, for people (packs install and upgrade as the owner or admin who runs them; copies made by `insert` start with
-- the copied settings as before):
-- * `sheets_retention_guard`: a change to `settings.retention` (rules and `personalNames`) needs an owner or admin.
-- * `fields_personal_guard`: turning `config.personalData` on or off on an existing field needs an owner or admin.
-- Both changes stay logged by the audit triggers (`sheets.update`, `fields.update`).

create or replace function sheets_retention_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if _is_person() and (old.settings -> 'retention') is distinct from (new.settings -> 'retention')
     and not is_admin(new.org_id) then
    raise exception using errcode = '42501', message = 'access: Only owners and admins change retention rules.';
  end if;
  return new;
end $$;
create trigger sheets_retention_guard before update on sheets
  for each row execute function sheets_retention_guard();

create or replace function fields_personal_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if _is_person()
     and coalesce(old.config -> 'personalData', 'false'::jsonb) is distinct from coalesce(new.config -> 'personalData', 'false'::jsonb)
     and not is_admin(new.org_id) then
    raise exception using errcode = '42501',
      message = 'access: Only owners and admins change whether a field holds personal data.';
  end if;
  return new;
end $$;
create trigger fields_personal_guard before update on fields
  for each row execute function fields_personal_guard();

revoke execute on function sheets_retention_guard(), fields_personal_guard() from public, anon, authenticated;
