-- Audit exports (0034_audit_exports.sql, docs/11 Audit outputs): any member, auditors too, logs an export on the
-- workspace chain; outsiders and auditors whose access ended cannot; the scope is a flat object of known keys.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'aud-viewer@a.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'aud-auditor@a.test'),
  ('00000000-0000-0000-0000-0000000000e3', 'aud-outsider@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000e1', 'Audit Viewer', 'AV'),
  ('00000000-0000-0000-0000-0000000000e2', 'Audit Auditor', 'AA'),
  ('00000000-0000-0000-0000-0000000000e3', 'Audit Outsider', 'AO');
insert into orgs (id, name, slug) values ('e0e0e0e0-0000-0000-0000-000000000000', 'Org E', 'pgtap-audit');
insert into memberships (org_id, user_id, role, expires_at) values
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'viewer', null),
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e2', 'auditor', now() + interval '30 days');

select ok(has_function_privilege('authenticated', 'log_audit_export(uuid, text, jsonb)', 'execute'),
  'authenticated may call log_audit_export');
select ok(not has_function_privilege('anon', 'log_audit_export(uuid, text, jsonb)', 'execute'),
  'anon may not');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select lives_ok($$ select log_audit_export('e0e0e0e0-0000-0000-0000-000000000000', 'audit_pack',
  '{"scope": "folder", "folder_id": "x", "from": "2026-01-01", "to": "2026-12-31", "sheets": 3, "chains_ok": 10, "chains_broken": 0}') $$,
  'an auditor logs an audit pack export');
select is((select action || '|' || chain_key || '|' || (new_value->>'kind') || '|' || (new_value->>'sheets')
             from activity_log where org_id = 'e0e0e0e0-0000-0000-0000-000000000000' order by id desc limit 1),
  'audit.exported|sheet:e0e0e0e0-0000-0000-0000-000000000000|audit_pack|3', 'on the workspace chain, with the scope');
select ok((select actor_id = '00000000-0000-0000-0000-0000000000e2' and hash <> '' from activity_log
            where org_id = 'e0e0e0e0-0000-0000-0000-000000000000' order by id desc limit 1),
  'the actor is the caller and the entry is hash-chained');
select throws_ok($$ select log_audit_export('e0e0e0e0-0000-0000-0000-000000000000', 'anything', '{}') $$,
  'audit: unknown export kind', 'only known kinds');
select throws_ok($$ select log_audit_export('e0e0e0e0-0000-0000-0000-000000000000', 'soa.csv', '{"note": "free text"}') $$,
  'audit: bad scope', 'only known scope keys');
select throws_ok($$ select log_audit_export('e0e0e0e0-0000-0000-0000-000000000000', 'soa.csv', '{"sheets": {"a": 1}}') $$,
  'audit: bad scope', 'only scalar scope values');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
select throws_ok($$ select log_audit_export('e0e0e0e0-0000-0000-0000-000000000000', 'soa.csv', '{}') $$,
  'not allowed', 'not a member: refused');

reset role;
update memberships set expires_at = now() - interval '1 minute'
 where user_id = '00000000-0000-0000-0000-0000000000e2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select throws_ok($$ select log_audit_export('e0e0e0e0-0000-0000-0000-000000000000', 'soa.csv', '{}') $$,
  'not allowed', 'an auditor whose access ended: refused');

select * from finish();
rollback;
