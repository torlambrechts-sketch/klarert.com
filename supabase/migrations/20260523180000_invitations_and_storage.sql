-- Invitations + per-org evidence storage.

-- =============================================================================
-- klarert.invitations
-- =============================================================================

create table if not exists klarert.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references klarert.organizations(id) on delete cascade,
  email text not null check (length(email) between 3 and 320 and email like '%_@_%.__%'),
  role_key text not null references klarert.roles(key) on update cascade,
  token text not null unique check (length(token) between 32 and 128),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

comment on table klarert.invitations is 'Per-org invitations to join. Token is URL-safe random; the server action stores email lower-cased.';

create unique index if not exists invitations_org_email_pending_idx
  on klarert.invitations (organization_id, lower(email))
  where status = 'pending';
create index if not exists invitations_org_idx on klarert.invitations (organization_id);
create index if not exists invitations_created_by_idx on klarert.invitations (created_by);
create index if not exists invitations_accepted_by_idx on klarert.invitations (accepted_by);

alter table klarert.invitations enable row level security;

drop policy if exists invitations_select_same_org on klarert.invitations;
create policy invitations_select_same_org on klarert.invitations
  for select to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('user.read')));

drop policy if exists invitations_insert_inviter on klarert.invitations;
create policy invitations_insert_inviter on klarert.invitations
  for insert to authenticated
  with check (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('user.invite')));

drop policy if exists invitations_update_inviter on klarert.invitations;
create policy invitations_update_inviter on klarert.invitations
  for update to authenticated
  using (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('user.invite')))
  with check (organization_id in (select klarert_private.user_org_ids())
    and (select klarert_private.has_permission('user.invite')));

drop trigger if exists audit_invitations on klarert.invitations;
create trigger audit_invitations
  after insert or update or delete on klarert.invitations
  for each row execute function klarert.audit_trigger();

-- =============================================================================
-- Storage: evidence bucket. Files live under <organization_id>/...
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

drop policy if exists evidence_select_same_org on storage.objects;
create policy evidence_select_same_org on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and (storage.foldername(name))[1]::uuid in (select klarert_private.user_org_ids())
  );

drop policy if exists evidence_insert_same_org on storage.objects;
create policy evidence_insert_same_org on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and (storage.foldername(name))[1]::uuid in (select klarert_private.user_org_ids())
  );

drop policy if exists evidence_update_same_org on storage.objects;
create policy evidence_update_same_org on storage.objects
  for update to authenticated
  using (
    bucket_id = 'evidence'
    and ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and (storage.foldername(name))[1]::uuid in (select klarert_private.user_org_ids())
  )
  with check (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1]::uuid in (select klarert_private.user_org_ids())
  );

drop policy if exists evidence_delete_same_org on storage.objects;
create policy evidence_delete_same_org on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidence'
    and ((select auth.jwt()) ->> 'is_anonymous') is distinct from 'true'
    and (storage.foldername(name))[1]::uuid in (select klarert_private.user_org_ids())
  );
