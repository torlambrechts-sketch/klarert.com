-- Design health (0048_design_health.sql, docs/05 §3.8): design_health returns per automation only counts of failed
-- and partly done runs in the last 30 days, the last failure and dead-letter and retrying webhook deliveries; members
-- see the automations of sheets they can read, others nothing; anon cannot call it. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000048a1', 'design-editor@a.test'),
  ('00000000-0000-0000-0000-0000000048a2', 'design-outsider@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000048a1', 'Design Editor', 'DE'),
  ('00000000-0000-0000-0000-0000000048a2', 'Design Outsider', 'DO');
insert into orgs (id, name, slug) values
  ('a48a48a4-0000-0000-0000-000000000000', 'Org Design', 'pgtap-design'),
  ('a48a48a4-0000-0000-0000-000000000001', 'Org Other', 'pgtap-design-other');
insert into memberships (org_id, user_id, role) values
  ('a48a48a4-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000048a1', 'editor'),
  ('a48a48a4-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000048a2', 'admin');
insert into sheets (id, org_id, name, item_label, position) values
  ('a48b0000-0000-4000-8000-000000000001', 'a48a48a4-0000-0000-0000-000000000000', 'Hooks', 'Item', 'a0');
insert into automations (id, org_id, sheet_id, name, trigger, actions) values
  ('a48c0000-0000-4000-8000-000000000001', 'a48a48a4-0000-0000-0000-000000000000',
   'a48b0000-0000-4000-8000-000000000001', 'Send to Teams', '{"type":"item_created"}',
   '[{"type":"webhook","url":"https://hooks.example.com/secret","preset":"teams"}]'),
  ('a48c0000-0000-4000-8000-000000000002', 'a48a48a4-0000-0000-0000-000000000000',
   'a48b0000-0000-4000-8000-000000000001', 'Quiet', '{"type":"item_created"}', '[]');
insert into automation_runs (org_id, automation_id, sheet_id, event, status, chain_id, started_at) values
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'a48b0000-0000-4000-8000-000000000001', '{}', 'failed', gen_random_uuid(), now() - interval '40 days'),
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'a48b0000-0000-4000-8000-000000000001', '{}', 'failed', gen_random_uuid(), now() - interval '2 days'),
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'a48b0000-0000-4000-8000-000000000001', '{}', 'failed', gen_random_uuid(), now() - interval '1 day'),
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'a48b0000-0000-4000-8000-000000000001', '{}', 'partial', gen_random_uuid(), now()),
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'a48b0000-0000-4000-8000-000000000001', '{}', 'done', gen_random_uuid(), now());
insert into outbound_webhooks (org_id, automation_id, url, payload, status) values
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'https://hooks.example.com/secret', '{}', 'dead_letter'),
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'https://hooks.example.com/secret', '{}', 'dead_letter'),
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'https://hooks.example.com/secret', '{}', 'retrying'),
  ('a48a48a4-0000-0000-0000-000000000000', 'a48c0000-0000-4000-8000-000000000001', 'https://hooks.example.com/secret', '{}', 'sent');

select function_returns('design_health', array['uuid'], 'setof record', 'design_health returns rows of aggregates');
select ok(not has_function_privilege('anon', 'design_health(uuid)', 'execute'), 'anon cannot call design_health');
select ok(has_function_privilege('authenticated', 'design_health(uuid)', 'execute'), 'members call it');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000048a1","role":"authenticated"}', true);
select results_eq(
  $$ select automation_id, failed_runs, partial_runs, dead_letters, retrying
       from design_health('a48a48a4-0000-0000-0000-000000000000') order by automation_id $$,
  $$ values ('a48c0000-0000-4000-8000-000000000001'::uuid, 2, 1, 2, 1),
            ('a48c0000-0000-4000-8000-000000000002'::uuid, 0, 0, 0, 0) $$,
  'a member sees failures in the last 30 days and the webhook queue''s problems, as counts');
select ok(
  (select last_failed_at > now() - interval '2 days' from design_health('a48a48a4-0000-0000-0000-000000000000')
    where automation_id = 'a48c0000-0000-4000-8000-000000000001'),
  'the last failure is the latest failed run');
select is_empty(
  $$ select 1 from outbound_webhooks $$,
  'members still cannot read the webhook queue itself');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000048a2","role":"authenticated"}', true);
select is_empty(
  $$ select 1 from design_health('a48a48a4-0000-0000-0000-000000000000') $$,
  'someone outside the workspace sees nothing');
reset role;

select * from finish();
rollback;
