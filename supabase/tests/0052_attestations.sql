-- Acknowledgements and signatures are recorded by the database for the person who makes them (0061, C-01).
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000097001', 'att-ceo@a.test'),
  ('00000000-0000-0000-0000-000000097002', 'att-eve@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000097001', 'Cora CEO', 'CC'),
  ('00000000-0000-0000-0000-000000097002', 'Eve Editor', 'EE');
insert into orgs (id, name, slug) values ('97000000-0000-0000-0000-00000000000a', 'Attest A', 'pgtap-attest-a');
insert into memberships (org_id, user_id, role) values
  ('97000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000097001', 'owner'),
  ('97000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000097002', 'editor');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('97000001-0000-0000-0000-000000000001', '97000000-0000-0000-0000-00000000000a', 'Policies', 'POL-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('97000003-0000-0000-0000-000000000001', '97000000-0000-0000-0000-00000000000a', '97000001-0000-0000-0000-000000000001', 'All', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('97000004-0000-0000-0000-000000000001', '97000000-0000-0000-0000-00000000000a', '97000001-0000-0000-0000-000000000001',
   'read', 'Read and understood', 'ack', 'a0',
   '{"audience":{"userIds":["00000000-0000-0000-0000-000000097001","00000000-0000-0000-0000-000000097002"],"teamIds":[],"jobRoleIds":[]},"versionFieldKey":null}'),
  ('97000004-0000-0000-0000-000000000002', '97000000-0000-0000-0000-00000000000a', '97000001-0000-0000-0000-000000000001',
   'signoff', 'Sign-off', 'signature', 'a1', '{"meaning":"Approved","clearOnChange":true}'),
  ('97000004-0000-0000-0000-000000000003', '97000000-0000-0000-0000-00000000000a', '97000001-0000-0000-0000-000000000001',
   'summary', 'Summary', 'text', 'a2', '{}');
-- the CEO acknowledged earlier (as recorded)
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position, "values") values
  ('97000005-0000-0000-0000-000000000001', '97000000-0000-0000-0000-00000000000a', '97000001-0000-0000-0000-000000000001',
   '97000003-0000-0000-0000-000000000001', 1, 'POL-001', 'Acceptable use', 'a0',
   '{"97000004-0000-0000-0000-000000000001": [{"userId":"00000000-0000-0000-0000-000000097001","at":"2026-11-01T09:00:00.000Z","version":null}],
     "97000004-0000-0000-0000-000000000003": "Use systems for work"}');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by) values
  ('97000007-0000-0000-0000-000000000001', '97000000-0000-0000-0000-00000000000a', '97000001-0000-0000-0000-000000000001',
   'A', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-000000097001');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009700' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
create function pg_temp.ack(entries text) returns text language sql as $$
  select format($f$select set_item_values('97000005-0000-0000-0000-000000000001',
                  jsonb_build_object('97000004-0000-0000-0000-000000000001', %L::jsonb))$f$, entries)
$$;
grant execute on function pg_temp.ack(text) to authenticated, service_role;
set local role authenticated;
select pg_temp.as_user('2');

select throws_ok(pg_temp.ack('[{"userId":"00000000-0000-0000-0000-000000097001","at":"2026-11-01T09:00:00.000Z","version":null},
                               {"userId":"00000000-0000-0000-0000-000000097001","at":"2026-11-02T09:00:00.000Z","version":"v2.0"}]'),
  '42501', 'access: You can record only your own acknowledgement.',
  'an editor cannot record that someone else acknowledged');
select throws_ok(pg_temp.ack('[]'), '42501', 'access: You cannot change or remove someone else''s acknowledgement.',
  'nor remove someone else''s acknowledgement');
select throws_ok(pg_temp.ack('[{"userId":"00000000-0000-0000-0000-000000097001","at":"2025-01-01T00:00:00.000Z","version":null}]'),
  '42501', null, 'nor change its time');
select lives_ok(pg_temp.ack('[{"userId":"00000000-0000-0000-0000-000000097001","at":"2026-11-01T09:00:00.000Z","version":null},
                              {"userId":"00000000-0000-0000-0000-000000097002","at":"2001-01-01T00:00:00.000Z","version":null}]'),
  'an editor records her own acknowledgement');
select ok((select (e ->> 'at')::timestamptz > now() - interval '1 minute'
             from items i, jsonb_array_elements(i."values" -> '97000004-0000-0000-0000-000000000001') e
            where i.id = '97000005-0000-0000-0000-000000000001' and e ->> 'userId' = auth.uid()::text),
  'its time is the database''s, not the one sent');
select is((select e ->> 'at' from items i, jsonb_array_elements(i."values" -> '97000004-0000-0000-0000-000000000001') e
            where i.id = '97000005-0000-0000-0000-000000000001' and e ->> 'userId' = '00000000-0000-0000-0000-000000097001'),
  '2026-11-01T09:00:00.000Z', 'the earlier acknowledgement is untouched');

-- signatures
select throws_ok($$ select set_item_values('97000005-0000-0000-0000-000000000001', jsonb_build_object(
  '97000004-0000-0000-0000-000000000002', jsonb_build_object('by', '00000000-0000-0000-0000-000000097001',
    'at', '2026-11-01T09:00:00.000Z', 'meaning', 'Approved', 'hash', repeat('a', 64)))) $$,
  '42501', 'access: You can sign only as yourself.', 'an editor cannot sign as someone else');
select lives_ok($$ select set_item_values('97000005-0000-0000-0000-000000000001', jsonb_build_object(
  '97000004-0000-0000-0000-000000000002', jsonb_build_object('by', auth.uid(),
    'at', '2001-01-01T00:00:00.000Z', 'meaning', 'Approved', 'hash', repeat('f', 64)))) $$,
  'an editor signs as herself');
reset role;
select is((select "values" -> '97000004-0000-0000-0000-000000000002' ->> 'hash' from items
            where id = '97000005-0000-0000-0000-000000000001'),
  (select encode(digest(_canonical_json(("values" - '97000004-0000-0000-0000-000000000002')), 'sha256'), 'hex')
     from items where id = '97000005-0000-0000-0000-000000000001'),
  'the database recomputes the hash over the other values (the one sent is ignored)');
select ok((select ("values" -> '97000004-0000-0000-0000-000000000002' ->> 'at')::timestamptz > now() - interval '1 minute'
             and "values" -> '97000004-0000-0000-0000-000000000002' ->> 'by' = '00000000-0000-0000-0000-000000097002'
             from items where id = '97000005-0000-0000-0000-000000000001'),
  'and stamps the signer and the time');
set local role authenticated;
select pg_temp.as_user('2');
select lives_ok($$ select set_item_values('97000005-0000-0000-0000-000000000001',
                    jsonb_build_object('97000004-0000-0000-0000-000000000002', null)) $$,
  'a signature can be cleared');
reset role;

-- automations (service role) never acknowledge or sign
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select set_item_values('97000005-0000-0000-0000-000000000001', jsonb_build_object(
  '97000004-0000-0000-0000-000000000001', (select "values" -> '97000004-0000-0000-0000-000000000001' from items
                                            where id = '97000005-0000-0000-0000-000000000001')
     || '[{"userId":"00000000-0000-0000-0000-000000097002","at":"2026-11-03T00:00:00.000Z","version":"v9.0"}]'::jsonb),
  null, '97000007-0000-0000-0000-000000000001') $$,
  '42501', 'access: An acknowledgement is recorded only by the person who read the item.',
  'an automation cannot record an acknowledgement');
select throws_ok($$ select set_item_values('97000005-0000-0000-0000-000000000001', jsonb_build_object(
  '97000004-0000-0000-0000-000000000002', jsonb_build_object('by', '00000000-0000-0000-0000-000000097001',
    'at', '2026-11-01T09:00:00.000Z', 'meaning', 'Approved', 'hash', repeat('a', 64))),
  null, '97000007-0000-0000-0000-000000000001') $$,
  '42501', 'access: A signature is made only by the person signing.', 'nor sign');
reset role;

select * from finish();
rollback;
