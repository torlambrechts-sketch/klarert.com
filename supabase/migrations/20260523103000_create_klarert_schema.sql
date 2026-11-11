-- All klarert.com objects live in the `klarert` schema; every table, function
-- and trigger must be schema-qualified. supabase/config.toml exposes the
-- schema locally; on a hosted project add `klarert` under
-- Project Settings -> API -> Exposed schemas.

create schema if not exists klarert;

grant usage on schema klarert to authenticated, anon, service_role;

alter default privileges in schema klarert
  grant all on tables to service_role;
alter default privileges in schema klarert
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema klarert
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema klarert
  grant execute on functions to authenticated, anon, service_role;

comment on schema klarert is 'klarert.com compliance platform.';
