-- 0025_auditor_role.sql · P2 access control, part 1: the auditor role and membership expiry (docs/02 §16).
-- 1. member_role gets 'auditor': read-only, like a viewer, for a limited time. The new value is added in a migration
--    of its own because Postgres cannot use an enum value in the transaction that adds it (0026 uses it).
-- 2. memberships.expires_at (and invites.expires_at, copied when the invite is accepted): after it, the membership
--    no longer counts. is_member and has_role check it, so every RLS policy and every definer function that asks
--    "is this person a member" ends the access automatically, with no job to run. Required for auditors (0026).

alter type member_role add value if not exists 'auditor';

alter table memberships add column expires_at timestamptz;
alter table invites add column expires_at timestamptz;

create or replace function is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = o and m.user_id = auth.uid()
                   and (m.expires_at is null or m.expires_at > now()))
$$;

create or replace function has_role(o uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = o and m.user_id = auth.uid() and m.role = any(roles)
                   and (m.expires_at is null or m.expires_at > now()))
$$;
