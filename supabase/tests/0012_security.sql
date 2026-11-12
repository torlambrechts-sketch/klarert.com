-- M10 security review (docs/09): RLS is on for every table in public, every workspace table has org_id, and the
-- audit trigger and the activity log's append-only trigger are in place. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
     from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '{}'::text[],
  'every table in public has row level security on');

select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
     from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and c.relname not in ('orgs', 'profiles', 'form_rate_limits')
      and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)),
  '{}'::text[],
  'every workspace table has org_id (orgs, profiles and the per-IP rate limit are not workspace data)');

select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
     from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
      and c.relname not in ('scheduler_fired', 'outbound_webhooks', 'form_rate_limits')),
  '{}'::text[],
  'tables without policies are only the service-role ones (scheduler, webhook queue, form rate limit)');

select ok(exists (select 1 from pg_trigger where tgname = 'activity_no_change' and tgrelid = 'activity_log'::regclass
                  and tgenabled <> 'D'),
  'the activity log is append-only (trigger enabled)');
select ok(exists (select 1 from pg_trigger where tgname = 'activity_chain_bi' and tgrelid = 'activity_log'::regclass
                  and tgenabled <> 'D'),
  'the activity log is hash-chained (trigger enabled)');

select * from finish();
rollback;
