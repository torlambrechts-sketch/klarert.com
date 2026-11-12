-- 0016_dashboards.sql · dashboards stored as data
-- A dashboard is a named list of widgets ({ widgets: [{ id, type, title, sheetId?, fieldKey?, conditions?, days? }] },
-- docs/02 §1). Widget types are a registry in the engine (src/engine/dashboards); the database stores the config only.
-- Members read; editors write through the dashboard commands (RLS checks again here). Changes are audited like the
-- other schema tables: audit_schema writes dashboards.insert/update/delete on the workspace chain ('sheet:<org_id>',
-- as a dashboard belongs to no sheet).

create table dashboards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  position    text not null,
  config      jsonb not null default '{"widgets":[]}'::jsonb
              check (jsonb_typeof(config) = 'object' and jsonb_typeof(config -> 'widgets') = 'array'
                     and jsonb_array_length(config -> 'widgets') <= 24),
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index dashboards_org_idx on dashboards(org_id, position);

alter table dashboards enable row level security;
create policy dashboards_read on dashboards for select using (is_member(org_id));
create policy dashboards_insert on dashboards for insert
  with check (is_editor(org_id) and created_by = auth.uid());
create policy dashboards_update on dashboards for update
  using (is_editor(org_id)) with check (is_editor(org_id));
create policy dashboards_delete on dashboards for delete using (is_editor(org_id));

-- the workspace and the creator never change
create or replace function dashboards_guard() returns trigger language plpgsql as $$
begin
  if new.org_id <> old.org_id or new.created_by is distinct from old.created_by then
    raise exception 'not allowed';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger dashboards_guard_bu before update on dashboards for each row execute function dashboards_guard();

create trigger dashboards_audit after insert or update or delete on dashboards
  for each row execute function audit_schema();
