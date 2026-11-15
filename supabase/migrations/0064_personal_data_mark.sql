-- 0064_personal_data_mark.sql · Editors may mark a field as holding personal data; only owners and admins unmark it
-- (owner decision 15 Nov 2026, refining 0060 / security review M7).
--
-- Marking is the safe direction: from then on values stay out of the activity log in clear and can be erased under
-- the sheet's retention rules. Unmarking lets personal data into the log in clear, so it stays an owner's or admin's
-- decision. Both changes stay logged by the audit trigger (`fields.update`).

create or replace function fields_personal_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if _is_person()
     and coalesce(old.config -> 'personalData', 'false'::jsonb) = 'true'::jsonb
     and coalesce(new.config -> 'personalData', 'false'::jsonb) <> 'true'::jsonb
     and not is_admin(new.org_id) then
    raise exception using errcode = '42501',
      message = 'access: Only owners and admins turn off personal data on a field.';
  end if;
  return new;
end $$;

revoke execute on function fields_personal_guard() from public, anon, authenticated;
