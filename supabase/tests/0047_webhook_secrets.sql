-- Webhook addresses never reach members; each automation has a signing key (0056, SA-5, SA-12). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000092001', 'wh-admin@a.test'),
  ('00000000-0000-0000-0000-000000092002', 'wh-eve@a.test'),
  ('00000000-0000-0000-0000-000000092003', 'wh-aud@a.test'),
  ('00000000-0000-0000-0000-000000092004', 'wh-other@b.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000092001', 'Ada Admin', 'AA'),
  ('00000000-0000-0000-0000-000000092002', 'Eve Editor', 'EE'),
  ('00000000-0000-0000-0000-000000092003', 'Aud Itor', 'AI'),
  ('00000000-0000-0000-0000-000000092004', 'Bob Other', 'BO');
insert into orgs (id, name, slug) values
  ('92000000-0000-0000-0000-00000000000a', 'Hooks A', 'pgtap-hooks-a'),
  ('92000000-0000-0000-0000-00000000000b', 'Hooks B', 'pgtap-hooks-b');
insert into memberships (org_id, user_id, role, expires_at) values
  ('92000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000092001', 'owner', null),
  ('92000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000092002', 'editor', null),
  ('92000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000092003', 'auditor', now() + interval '30 days'),
  ('92000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000092004', 'owner', null);
insert into sheets (id, org_id, name, id_prefix, position) values
  ('92000001-0000-0000-0000-000000000001', '92000000-0000-0000-0000-00000000000a', 'Incidents', 'INC-', 'a0'),
  ('92000001-0000-0000-0000-000000000002', '92000000-0000-0000-0000-00000000000b', 'Other', 'OTH-', 'a0');
-- an automation of workspace B with its own address
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by) values
  ('92000007-0000-0000-0000-00000000000b', '92000000-0000-0000-0000-00000000000b', '92000001-0000-0000-0000-000000000002',
   'B', '{"type":"item_created"}', '[{"type":"webhook","url":"https://b.example.com/secret-b","preset":"generic"}]',
   '00000000-0000-0000-0000-000000092004');
-- a log entry written before 0056, with an address in clear
insert into activity_log (org_id, sheet_id, chain_key, actor_kind, action, new_value)
values ('92000000-0000-0000-0000-00000000000a', '92000001-0000-0000-0000-000000000001', '', 'system', 'automations.insert',
        '{"name":"Old","actions":[{"type":"webhook","url":"https://hooks.slack.com/services/OLD/SECRET"}]}');

create temp table b_ref as select actions -> 0 ->> 'urlRef' as ref from automations
                            where id = '92000007-0000-0000-0000-00000000000b';
grant select on b_ref to authenticated;
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009200' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;

select pg_temp.as_user('2');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by) values
  ('92000007-0000-0000-0000-000000000001', '92000000-0000-0000-0000-00000000000a', '92000001-0000-0000-0000-000000000001',
   'To Slack', '{"type":"item_created"}',
   '[{"type":"webhook","url":"https://hooks.slack.com/services/T0/B0/s3cr3t","preset":"slack"}]', auth.uid());
select is((select actions -> 0 ->> 'urlHost' from automations where id = '92000007-0000-0000-0000-000000000001'),
  'hooks.slack.com', 'the saved action keeps the host');
select ok((select not (actions::text like '%s3cr3t%') and actions -> 0 ? 'urlRef'
             from automations where id = '92000007-0000-0000-0000-000000000001'),
  'and a key, never the address');
select throws_ok($$ select * from automation_secrets $$, '42501', null, 'members cannot read the addresses');
select ok(not exists (select 1 from activity_log where sheet_id = '92000001-0000-0000-0000-000000000001'
                       and action = 'automations.insert' and new_value::text like '%s3cr3t%'),
  'the sheet''s log holds the host only');
-- Duplicate: the key is copied as its own address; a key from another workspace is not
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by)
select '92000007-0000-0000-0000-000000000002', org_id, sheet_id, 'Copy', trigger, actions, auth.uid()
  from automations where id = '92000007-0000-0000-0000-000000000001';
select isnt((select actions -> 0 ->> 'urlRef' from automations where id = '92000007-0000-0000-0000-000000000002'),
  (select actions -> 0 ->> 'urlRef' from automations where id = '92000007-0000-0000-0000-000000000001'),
  'a duplicate gets its own copy of the address');
reset role;
select is((select webhook_urls ->> (a.actions -> 0 ->> 'urlRef') from automation_secrets s join automations a
             on a.id = s.automation_id where a.id = '92000007-0000-0000-0000-000000000002'),
  'https://hooks.slack.com/services/T0/B0/s3cr3t', 'with the same address');
set local role authenticated;
select pg_temp.as_user('2');
update automations set actions = jsonb_build_array(jsonb_build_object('type', 'webhook', 'preset', 'generic',
  'urlRef', (select ref from b_ref)))
 where id = '92000007-0000-0000-0000-000000000002';
select ok((select ref from b_ref) is not null
          and not ((select actions -> 0 from automations where id = '92000007-0000-0000-0000-000000000002') ? 'urlRef'),
  'a key from another workspace gives no address');
-- an edit that keeps the key keeps the address; a new address replaces it
update automations set name = 'To Slack (renamed)', actions = actions
 where id = '92000007-0000-0000-0000-000000000001';
reset role;
select is((select webhook_urls ->> (a.actions -> 0 ->> 'urlRef') from automation_secrets s join automations a
             on a.id = s.automation_id where a.id = '92000007-0000-0000-0000-000000000001'),
  'https://hooks.slack.com/services/T0/B0/s3cr3t', 'saving with the key keeps the address');
set local role authenticated;
select pg_temp.as_user('2');
update automations set actions = '[{"type":"webhook","url":"https://hooks.example.com/new","preset":"generic"}]'
 where id = '92000007-0000-0000-0000-000000000001';
reset role;
select is((select webhook_urls from automation_secrets where automation_id = '92000007-0000-0000-0000-000000000001'),
  jsonb_build_object((select actions -> 0 ->> 'urlRef' from automations where id = '92000007-0000-0000-0000-000000000001'),
                     'https://hooks.example.com/new'), 'a new address replaces the old one, which is dropped');
set local role authenticated;

-- the auditor
select pg_temp.as_user('3');
select ok(not exists (select 1 from automations where actions::text like '%https://%'),
  'an auditor reads no webhook address in automations');
select is((select count(*)::int from activity_log where action = 'automations.insert'
            and new_value::text like '%OLD/SECRET%'), 0, 'nor in log entries written before the change');
select pg_temp.as_user('1');
select is((select count(*)::int from activity_log where action = 'automations.insert'
            and new_value::text like '%OLD/SECRET%'), 1, 'which owners and admins still read');

-- SA-12: the signing key
select pg_temp.as_user('2');
select throws_ok($$ select automation_signing_key('92000007-0000-0000-0000-000000000001') $$,
  'automation not found', 'an editor cannot read the signing key');
select pg_temp.as_user('1');
select matches(automation_signing_key('92000007-0000-0000-0000-000000000001'), '^[0-9a-f]{64}$',
  'an owner reads the automation''s signing key');
select is((select count(*)::int from activity_log where action = 'automation.key_viewed'
            and new_value ->> 'automation_id' = '92000007-0000-0000-0000-000000000001'), 1, 'and that look is logged');
reset role;
set local role service_role;
select is((select count(*)::int from automation_secrets where automation_id = '92000007-0000-0000-0000-000000000001'), 1,
  'the runner and the worker (service role) read the address and key');
reset role;

select * from finish();
rollback;
