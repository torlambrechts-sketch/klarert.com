-- When an organization is deleted, every user whose
-- app_metadata.current_org_id points at the gone org should have that claim
-- cleared. Otherwise they land on /<deleted-slug> -> notFound -> dead end.
--
-- Trigger runs SECURITY DEFINER so it can update auth.users — which the
-- service_role can normally do but a regular delete cascade cannot.

create or replace function klarert_private.tg_clear_current_org_on_org_delete() returns trigger
language plpgsql
security definer
set search_path = klarert, pg_temp
as $$
begin
  update auth.users
  set raw_app_meta_data = raw_app_meta_data - 'current_org_id'
  where (raw_app_meta_data ->> 'current_org_id')::uuid = OLD.id;
  return OLD;
end;
$$;

revoke all on function klarert_private.tg_clear_current_org_on_org_delete()
  from public, anon, authenticated;

drop trigger if exists clear_current_org_after_org_delete on klarert.organizations;
create trigger clear_current_org_after_org_delete
  after delete on klarert.organizations
  for each row execute function klarert_private.tg_clear_current_org_on_org_delete();
