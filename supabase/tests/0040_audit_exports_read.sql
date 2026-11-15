-- The Exports list and the audit pack's workspace entries (owner decision 15 Nov 2026, docs/11 Audit outputs) read the
-- workspace chain (`sheet:<org>`, no sheet and no item) under the activity_log policy as it is (0027): owners, admins
-- and auditors whose access has not ended read `audit.exported` and the other workspace entries, folder access
-- entries only owners and admins; an auditor whose access ended and an outsider read nothing; the chain verifies.
-- No new grant: this pins down that none is needed.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000050a1', 'exp-owner@a.test'),
  ('00000000-0000-0000-0000-0000000050a2', 'exp-admin@a.test'),
  ('00000000-0000-0000-0000-0000000050a3', 'exp-auditor@a.test'),
  ('00000000-0000-0000-0000-0000000050a4', 'exp-editor@a.test'),
  ('00000000-0000-0000-0000-0000000050a5', 'exp-ended@a.test'),
  ('00000000-0000-0000-0000-0000000050a6', 'exp-outsider@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000050a1', 'Export Owner', 'EO'),
  ('00000000-0000-0000-0000-0000000050a2', 'Export Admin', 'EA'),
  ('00000000-0000-0000-0000-0000000050a3', 'Export Auditor', 'EU'),
  ('00000000-0000-0000-0000-0000000050a4', 'Export Editor', 'EE'),
  ('00000000-0000-0000-0000-0000000050a5', 'Ended Auditor', 'ED'),
  ('00000000-0000-0000-0000-0000000050a6', 'Export Outsider', 'EX');
insert into orgs (id, name, slug) values ('a50a50a5-0000-0000-0000-000000000000', 'Org Exports', 'pgtap-exports');
insert into memberships (org_id, user_id, role, expires_at) values
  ('a50a50a5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000050a1', 'owner', null),
  ('a50a50a5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000050a2', 'admin', null),
  ('a50a50a5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000050a3', 'auditor', now() + interval '30 days'),
  ('a50a50a5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000050a4', 'editor', null),
  ('a50a50a5-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000050a5', 'auditor', now() + interval '30 days');

-- workspace entries: the five members' member.added (written by the database; every join is logged since 0057, not
-- only auditors'), a pack install and a folder access change
insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value) values
  ('a50a50a5-0000-0000-0000-000000000000', '', 'user', '00000000-0000-0000-0000-0000000050a2', 'pack.installed',
   '{"pack_key": "core"}'),
  ('a50a50a5-0000-0000-0000-000000000000', '', 'user', '00000000-0000-0000-0000-0000000050a2',
   'folder.access.granted', '{"folder_id": "x"}');

create temp table seen (who text, exports int, workspace int, folder_access int) on commit drop;
grant insert, select on seen to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000050a2","role":"authenticated"}', true);
select lives_ok($$ select log_audit_export('a50a50a5-0000-0000-0000-000000000000', 'audit_pack',
  '{"scope": "workspace", "from": "2026-01-01", "to": "2026-11-15", "sheets": 3}') $$,
  'an admin exports an audit pack');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000050a3","role":"authenticated"}', true);
select lives_ok($$ select log_audit_export('a50a50a5-0000-0000-0000-000000000000', 'data_flow_record',
  '{"app": "capa", "sheets": 2, "destinations": 1}') $$,
  'an auditor exports the data-flow record');

-- the Exports list's read: audit.exported on the workspace chain, newest first

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000050a1","role":"authenticated"}', true);
insert into seen select 'owner',
  (select count(*) from activity_log where org_id = 'a50a50a5-0000-0000-0000-000000000000'
     and chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000' and action = 'audit.exported'),
  (select count(*) from activity_log where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000'),
  (select count(*) from activity_log where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000'
     and action like 'folder.access%');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000050a2","role":"authenticated"}', true);
insert into seen select 'admin',
  (select count(*) from activity_log where org_id = 'a50a50a5-0000-0000-0000-000000000000'
     and chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000' and action = 'audit.exported'),
  (select count(*) from activity_log where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000'),
  (select count(*) from activity_log where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000'
     and action like 'folder.access%');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000050a3","role":"authenticated"}', true);
insert into seen select 'auditor',
  (select count(*) from activity_log where org_id = 'a50a50a5-0000-0000-0000-000000000000'
     and chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000' and action = 'audit.exported'),
  (select count(*) from activity_log where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000'),
  (select count(*) from activity_log where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000'
     and action like 'folder.access%');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000050a6","role":"authenticated"}', true);
insert into seen select 'outsider',
  (select count(*) from activity_log where org_id = 'a50a50a5-0000-0000-0000-000000000000'
     and chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000' and action = 'audit.exported'),
  (select count(*) from activity_log where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000'),
  0;

select is((select exports || '|' || workspace || '|' || folder_access from seen where who = 'owner'), '2|9|1',
  'an owner reads both exports and every workspace entry, folder access included');
select is((select exports || '|' || workspace || '|' || folder_access from seen where who = 'admin'), '2|9|1',
  'an admin too');
select is((select exports || '|' || workspace || '|' || folder_access from seen where who = 'auditor'), '2|8|0',
  'an auditor reads both exports and the workspace entries, not folder access');
select is((select exports || '|' || workspace from seen where who = 'outsider'), '0|0',
  'an outsider reads nothing');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000050a3","role":"authenticated"}', true);
select is((select string_agg(new_value->>'kind', ',' order by id desc) from activity_log
            where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000' and action = 'audit.exported'),
  'data_flow_record,audit_pack', 'newest first, with the kind');
select is((select new_value->>'app' || '|' || note from activity_log
            where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000' and action = 'audit.exported'
            order by id desc limit 1),
  'capa|Export Auditor exported data flow record', 'with the filters used and who');
select is((verify_activity_chain('sheet:a50a50a5-0000-0000-0000-000000000000')->>'ok')::boolean, true,
  'an auditor verifies the workspace chain');
select is((verify_activity_chain('sheet:a50a50a5-0000-0000-0000-000000000000')->>'entries')::int, 9,
  'the whole chain, the entries the auditor cannot read included');

reset role;
update memberships set expires_at = now() - interval '1 minute'
 where user_id = '00000000-0000-0000-0000-0000000050a5';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000050a5","role":"authenticated"}', true);
select is((select count(*)::int from activity_log
            where chain_key = 'sheet:a50a50a5-0000-0000-0000-000000000000'), 0,
  'an auditor whose access ended reads nothing');
select throws_ok($$ select verify_activity_chain('sheet:a50a50a5-0000-0000-0000-000000000000') $$,
  'not allowed', 'nor verifies the chain');

select * from finish();
rollback;
