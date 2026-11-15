-- The data-flow record export (0049_data_flow_export_log.sql, docs/05 §4): owners, admins and auditors log it as
-- `audit.exported` with kind data_flow_record and the filters used, on the workspace chain; editors, viewers,
-- outsiders and auditors whose access ended cannot; only known scope keys with scalar values; anon cannot call it.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000049a1', 'dfr-admin@a.test'),
  ('00000000-0000-0000-0000-0000000049a2', 'dfr-auditor@a.test'),
  ('00000000-0000-0000-0000-0000000049a3', 'dfr-editor@a.test'),
  ('00000000-0000-0000-0000-0000000049a4', 'dfr-outsider@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000049a1', 'Flow Admin', 'FA'),
  ('00000000-0000-0000-0000-0000000049a2', 'Flow Auditor', 'FU'),
  ('00000000-0000-0000-0000-0000000049a3', 'Flow Editor', 'FE'),
  ('00000000-0000-0000-0000-0000000049a4', 'Flow Outsider', 'FO');
insert into orgs (id, name, slug) values ('a49a49a4-0000-0000-0000-000000000000', 'Org Flow', 'pgtap-flow');
insert into memberships (org_id, user_id, role, expires_at) values
  ('a49a49a4-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000049a1', 'admin', null),
  ('a49a49a4-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000049a2', 'auditor', now() + interval '30 days'),
  ('a49a49a4-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000049a3', 'editor', null);

select ok(has_function_privilege('authenticated', 'log_audit_export(uuid, text, jsonb)', 'execute'),
  'authenticated may call log_audit_export');
select ok(not has_function_privilege('anon', 'log_audit_export(uuid, text, jsonb)', 'execute'),
  'anon may not');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000049a1","role":"authenticated"}', true);
select lives_ok($$ select log_audit_export('a49a49a4-0000-0000-0000-000000000000', 'data_flow_record',
  '{"app": "capa", "pack": "core", "folder_id": "none", "domain": "Quality", "differs": true, "sheets": 4, "destinations": 2}') $$,
  'an admin logs a data-flow record export with its filters');
select is((select action || '|' || chain_key || '|' || (new_value->>'kind') || '|' || (new_value->>'app') || '|'
                  || (new_value->>'differs') || '|' || (new_value->>'destinations') || '|' || note
             from activity_log where org_id = 'a49a49a4-0000-0000-0000-000000000000' order by id desc limit 1),
  'audit.exported|sheet:a49a49a4-0000-0000-0000-000000000000|data_flow_record|capa|true|2|Flow Admin exported data flow record',
  'on the workspace chain, with the kind, the filters and who');
select ok((select actor_id = '00000000-0000-0000-0000-0000000049a1' and hash <> '' and at is not null
             from activity_log where org_id = 'a49a49a4-0000-0000-0000-000000000000' order by id desc limit 1),
  'the actor is the caller, the entry has its time and is hash-chained');
select throws_ok($$ select log_audit_export('a49a49a4-0000-0000-0000-000000000000', 'data_flow_record',
  '{"url": "https://hooks.slack.com/services/x"}') $$,
  'audit: bad scope', 'an address is not a known scope key');
select throws_ok($$ select log_audit_export('a49a49a4-0000-0000-0000-000000000000', 'data_flow_record',
  '{"app": ["a", "b"]}') $$,
  'audit: bad scope', 'only scalar scope values');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000049a2","role":"authenticated"}', true);
select lives_ok($$ select log_audit_export('a49a49a4-0000-0000-0000-000000000000', 'data_flow_record', '{"sheets": 9}') $$,
  'an auditor logs it');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000049a3","role":"authenticated"}', true);
select throws_ok($$ select log_audit_export('a49a49a4-0000-0000-0000-000000000000', 'data_flow_record', '{}') $$,
  'not allowed', 'an editor does not see the record: refused');
select lives_ok($$ select log_audit_export('a49a49a4-0000-0000-0000-000000000000', 'soa.print', '{"items": 1}') $$,
  'an editor still logs the other exports');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000049a4","role":"authenticated"}', true);
select throws_ok($$ select log_audit_export('a49a49a4-0000-0000-0000-000000000000', 'data_flow_record', '{}') $$,
  'not allowed', 'not a member: refused');

reset role;
update memberships set expires_at = now() - interval '1 minute'
 where user_id = '00000000-0000-0000-0000-0000000049a2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000049a2","role":"authenticated"}', true);
select throws_ok($$ select log_audit_export('a49a49a4-0000-0000-0000-000000000000', 'data_flow_record', '{}') $$,
  'not allowed', 'an auditor whose access ended: refused');

select * from finish();
rollback;
