-- The scheduler, the webhook worker, requests and the inbox (0012_scheduler_inbox.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(29);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c0c1', 'owner@si.test'),
  ('00000000-0000-0000-0000-00000000c0c2', 'editor@si.test'),
  ('00000000-0000-0000-0000-00000000c0c3', 'outsider@si.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@si.test';
insert into orgs (id, name, slug) values
  ('c0c0c0c0-0000-0000-0000-000000000000', 'Scheduler Org', 'scheduler-org'),
  ('c0c0c0c0-0000-0000-0000-00000000000b', 'Other Scheduler Org', 'other-scheduler-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000c0c1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000c0c2', 'editor');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c3","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values ('c0c0c0c0-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000c0c3', 'owner');
select set_config('request.jwt.claims', '', true);

insert into sheets (id, org_id, name, id_prefix, position) values
  ('c0c0c0c0-1111-0000-0000-000000000001', 'c0c0c0c0-0000-0000-0000-000000000000', 'Actions', 'SI-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('c0c0c0c0-2222-0000-0000-000000000001', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-1111-0000-0000-000000000001', 'Open', 'a0'),
  ('c0c0c0c0-2222-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-1111-0000-0000-000000000001', 'Done', 'a1');
insert into fields (id, org_id, sheet_id, key, name, type, position) values
  ('c0c0c0c0-3333-0000-0000-000000000001', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-1111-0000-0000-000000000001', 'owner', 'Owner', 'people', 'a0'),
  ('c0c0c0c0-3333-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-1111-0000-0000-000000000001', 'note', 'Note', 'text', 'a1');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by) values
  ('c0c0c0c0-4444-0000-0000-000000000001', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-1111-0000-0000-000000000001',
   'Due soon', '{"type":"date_arrives","fieldKey":"due","offsetDays":-3}', '[]', '00000000-0000-0000-0000-00000000c0c2');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position, "values") values
  ('c0c0c0c0-5555-0000-0000-000000000001', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-1111-0000-0000-000000000001',
   'c0c0c0c0-2222-0000-0000-000000000001', 1, 'SI-001', 'Fix the gate', 'a0',
   '{"c0c0c0c0-3333-0000-0000-000000000001": ["00000000-0000-0000-0000-00000000c0c2"]}'),
  ('c0c0c0c0-5555-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-1111-0000-0000-000000000001',
   'c0c0c0c0-2222-0000-0000-000000000001', 2, 'SI-002', 'Paint the fence', 'a1', '{}');
insert into outbound_webhooks (id, org_id, automation_id, item_id, url, payload, status, attempts, next_attempt_at) values
  ('c0c0c0c0-6666-0000-0000-000000000001', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-4444-0000-0000-000000000001',
   'c0c0c0c0-5555-0000-0000-000000000001', 'https://hooks.example.com/a', '{}', 'queued', 0, now() - interval '1 minute'),
  ('c0c0c0c0-6666-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-4444-0000-0000-000000000001',
   'c0c0c0c0-5555-0000-0000-000000000001', 'https://hooks.example.com/b', '{}', 'retrying', 4, now() - interval '1 minute'),
  ('c0c0c0c0-6666-0000-0000-000000000003', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-4444-0000-0000-000000000001',
   'c0c0c0c0-5555-0000-0000-000000000001', 'https://hooks.example.com/c', '{}', 'retrying', 1, now() + interval '1 hour'),
  ('c0c0c0c0-6666-0000-0000-000000000004', 'c0c0c0c0-0000-0000-0000-000000000000', 'c0c0c0c0-4444-0000-0000-000000000001',
   'c0c0c0c0-5555-0000-0000-000000000001', 'https://hooks.example.com/d', '{}', 'sent', 0, now() - interval '1 hour');

-- rows other tests or a local run left behind are not due in this transaction (rolled back at the end)
update outbound_webhooks set next_attempt_at = now() + interval '1 day'
 where org_id <> 'c0c0c0c0-0000-0000-0000-000000000000';

-- ───────────── grants ─────────────
select ok(not has_function_privilege('authenticated', 'claim_outbound_webhooks(integer)', 'execute')
       and not has_function_privilege('anon', 'claim_outbound_webhooks(integer)', 'execute')
       and has_function_privilege('service_role', 'claim_outbound_webhooks(integer)', 'execute'),
  'only the service role claims webhooks');
select ok(not has_function_privilege('authenticated', 'record_webhook_attempt(uuid, text, timestamptz, text)', 'execute')
       and has_function_privilege('service_role', 'record_webhook_attempt(uuid, text, timestamptz, text)', 'execute'),
  'only the service role records webhook attempts');
select ok(not has_function_privilege('anon', 'claim_schedule_occurrence(uuid, uuid, text)', 'execute')
       and has_function_privilege('authenticated', 'claim_schedule_occurrence(uuid, uuid, text)', 'execute'),
  'signed-in people may call the scheduler claim, which checks the role itself');
select ok(not has_function_privilege('authenticated', '_request_done()', 'execute'),
  'the request trigger function is internal');

-- ───────────── scheduler dedupe ─────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c2","role":"authenticated"}', true);
select throws_ok($$ select claim_schedule_occurrence('c0c0c0c0-4444-0000-0000-000000000001', 'c0c0c0c0-5555-0000-0000-000000000001', '2026-11-20') $$,
  'P0001', 'not allowed', 'an editor cannot run date checks');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c3","role":"authenticated"}', true);
select throws_ok($$ select claim_schedule_occurrence('c0c0c0c0-4444-0000-0000-000000000001', 'c0c0c0c0-5555-0000-0000-000000000001', '2026-11-20') $$,
  'P0001', 'not allowed', 'an owner of another workspace cannot run this workspace''s date checks');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c1","role":"authenticated"}', true);
select is(claim_schedule_occurrence('c0c0c0c0-4444-0000-0000-000000000001', 'c0c0c0c0-5555-0000-0000-000000000001', '2026-11-20'),
  true, 'an owner claims an occurrence the first time');
select is(claim_schedule_occurrence('c0c0c0c0-4444-0000-0000-000000000001', 'c0c0c0c0-5555-0000-0000-000000000001', '2026-11-20'),
  false, 'the same occurrence is never claimed twice');
select is(claim_schedule_occurrence('c0c0c0c0-4444-0000-0000-000000000001', 'c0c0c0c0-5555-0000-0000-000000000001', '2026-11-21'),
  true, 'a changed date is a new occurrence');
select is(claim_schedule_occurrence('c0c0c0c0-4444-0000-0000-000000000001', 'c0c0c0c0-5555-0000-0000-000000000002', '2026-11-20'),
  true, 'each item has its own occurrences');
select is_empty($$ select * from scheduler_fired $$, 'people cannot read scheduler_fired');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(claim_schedule_occurrence('c0c0c0c0-4444-0000-0000-000000000001', 'c0c0c0c0-5555-0000-0000-000000000001', '2026-11-20'),
  false, 'the cron route (service role) sees the same dedupe');
select is((select count(*)::int from scheduler_fired where automation_id = 'c0c0c0c0-4444-0000-0000-000000000001'), 3,
  'three occurrences recorded');

-- ───────────── webhook worker ─────────────
select bag_eq($$ select id::text from claim_outbound_webhooks(50) $$,
  $$ values ('c0c0c0c0-6666-0000-0000-000000000001'), ('c0c0c0c0-6666-0000-0000-000000000002') $$,
  'claims due queued and retrying rows only');
select is_empty($$ select id from claim_outbound_webhooks(50) $$, 'claimed rows are leased: a second worker gets none');
select is((select status from record_webhook_attempt('c0c0c0c0-6666-0000-0000-000000000001', 'retrying',
                                                     now() + interval '1 minute', 'HTTP 500')),
  'retrying', 'a failure is retried');
select results_eq($$ select attempts, last_error from outbound_webhooks where id = 'c0c0c0c0-6666-0000-0000-000000000001' $$,
  $$ values (1, 'HTTP 500'::text) $$, 'the failed attempt is counted with its error');
select is((select status from record_webhook_attempt('c0c0c0c0-6666-0000-0000-000000000002', 'dead_letter', null, 'HTTP 404')),
  'dead_letter', 'the fifth failure is a dead letter');
select results_eq($$ select user_id::text, kind, automation_id::text, body like '%could not send its webhook for SI-001 after 5 attempts: HTTP 404'
                      from notifications where automation_id = 'c0c0c0c0-4444-0000-0000-000000000001' $$,
  $$ values ('00000000-0000-0000-0000-00000000c0c2', 'system', 'c0c0c0c0-4444-0000-0000-000000000001', true) $$,
  'the automation''s creator is told about the dead letter');
select is((select status from record_webhook_attempt('c0c0c0c0-6666-0000-0000-000000000002', 'sent', null, null)),
  'dead_letter', 'a settled row does not change again');
select is((select status from record_webhook_attempt('c0c0c0c0-6666-0000-0000-000000000004', 'retrying', now(), 'x')),
  'sent', 'a sent row stays sent');
reset role;

-- ───────────── requests and the inbox ─────────────
insert into notifications (id, org_id, user_id, item_id, kind, body) values
  ('c0c0c0c0-7777-0000-0000-000000000001', 'c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000c0c2',
   'c0c0c0c0-5555-0000-0000-000000000001', 'request', 'Please update SI-001'),
  ('c0c0c0c0-7777-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000c0c1',
   'c0c0c0c0-5555-0000-0000-000000000001', 'request', 'Please update SI-001 too');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c1","role":"authenticated"}', true);
select is_empty($$ select id from notifications where user_id <> '00000000-0000-0000-0000-00000000c0c1' $$,
  'people read only their own notifications');
update notifications set read_at = now() where id = 'c0c0c0c0-7777-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0c2","role":"authenticated"}', true);
select results_eq($$ select read_at is null from notifications where id = 'c0c0c0c0-7777-0000-0000-000000000001' $$,
  $$ values (true) $$, 'nobody marks another person''s notification read');
select throws_ok($$ update notifications set done_at = now() where id = 'c0c0c0c0-7777-0000-0000-000000000001' $$,
  '42501', null, 'people cannot mark a request done themselves');
select lives_ok($$ update notifications set read_at = now() where id = 'c0c0c0c0-7777-0000-0000-000000000001' $$,
  'people mark their own notifications read');
select lives_ok($$ select set_item_values('c0c0c0c0-5555-0000-0000-000000000001',
                    '{"c0c0c0c0-3333-0000-0000-000000000002": "Done it"}') $$,
  'the requested person changes the item');
select results_eq($$ select done_at is not null from notifications where id = 'c0c0c0c0-7777-0000-0000-000000000001' $$,
  $$ values (true) $$, 'their request is marked done');
select results_eq($$ select (select count(*)::int from items_for_people('c0c0c0c0-0000-0000-0000-000000000000',
                                                                        array['00000000-0000-0000-0000-00000000c0c2']::uuid[], 50)),
                            (select count(*)::int from items_for_people('c0c0c0c0-0000-0000-0000-00000000000b',
                                                                        array['00000000-0000-0000-0000-00000000c0c2']::uuid[], 50)) $$,
  $$ values (1, 0) $$, 'items_for_people finds the items a person is in, within RLS');
reset role;
select results_eq($$ select done_at is null from notifications where id = 'c0c0c0c0-7777-0000-0000-000000000002' $$,
  $$ values (true) $$, 'a request to someone else stays open');

select * from finish();
rollback;
