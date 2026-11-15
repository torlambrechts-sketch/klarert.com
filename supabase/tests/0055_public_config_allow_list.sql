-- Public form configs through an allow-list per field type (0066, security review 9.1 item 5). Run: pnpm db:test
-- The lists themselves are checked against the field registry by src/engine/fields/public-config.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into orgs (id, name, slug) values ('99550000-0000-0000-0000-00000000000a', 'Allow list', 'pgtap-allow-list');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('99550001-0000-0000-0000-000000000001', '99550000-0000-0000-0000-00000000000a', 'Reports', 'REP-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('99550002-0000-0000-0000-000000000001', '99550000-0000-0000-0000-00000000000a', '99550001-0000-0000-0000-000000000001',
   'New', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('99550003-0000-0000-0000-000000000001', '99550000-0000-0000-0000-00000000000a', '99550001-0000-0000-0000-000000000001',
   'kind', 'Kind', 'status', 'a0',
   '{"options":[{"id":"o1","label":"Near miss","color":"grey"}],"personalData":true,"internalNote":"for HR"}'),
  ('99550003-0000-0000-0000-000000000002', '99550000-0000-0000-0000-00000000000a', '99550001-0000-0000-0000-000000000001',
   'weight', 'Weight', 'number', 'a1', '{"unit":"kg","decimals":1,"futureSecret":"x"}'),
  ('99550003-0000-0000-0000-000000000003', '99550000-0000-0000-0000-00000000000a', '99550001-0000-0000-0000-000000000001',
   'what', 'What happened', 'text', 'a2', '{"anything":"else"}');
insert into views (id, org_id, sheet_id, name, type, config, position) values
  ('99550004-0000-0000-0000-000000000001', '99550000-0000-0000-0000-00000000000a', '99550001-0000-0000-0000-000000000001',
   'Report', 'form', '{"form":{"fields":[{"key":"kind"},{"key":"weight"},{"key":"what"}],"status":"open",
     "access":"public","notice":{"purpose":"Safety reports","legalBasis":"legal_obligation","recipients":"HSE team",
     "retention":"5 years","rights":"Ask privacy@allow.test","version":1,"reviewedVersion":1}}}', 'a0');
insert into form_links (org_id, sheet_id, view_id, token) values
  ('99550000-0000-0000-0000-00000000000a', '99550001-0000-0000-0000-000000000001',
   '99550004-0000-0000-0000-000000000001', repeat('5e', 32));

-- the function on its own
select is(_public_field_config('status', '{"options":[{"id":"o1"}],"targetSheetId":"x","personalData":true}'),
  '{"options":[{"id":"o1"}]}'::jsonb, 'a type''s allowed keys are kept, internal ones left out');
select is(_public_field_config('number', '{"unit":"kg","newKeyNobodyListed":1}'), '{"unit":"kg"}'::jsonb,
  'a key that is not on the type''s list is left out, even one no deny-list ever named');
select is(_public_field_config('no-such-type', '{"options":[]}'), '{}'::jsonb, 'an unknown type shows no config');
select is(_public_field_config('link', '{"targetSheetId":"x","multiple":true}'), '{}'::jsonb,
  'a type public forms never show (links) shows no config');
select is(_public_field_config('text', '[1,2]'), '{}'::jsonb, 'a config that is not an object shows nothing');
select hasnt_function('_public_field_config', array['jsonb'], 'the deny-list version is gone');

-- what a signed-out visitor gets
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select jsonb_object_agg(f->>'key', f->'config') from jsonb_array_elements(get_public_form(repeat('5e', 32))->'fields') f),
  '{"kind":{"options":[{"id":"o1","label":"Near miss","color":"grey"}]},"weight":{"unit":"kg","decimals":1},"what":{}}'::jsonb,
  'get_public_form gives each field only the keys its type allows');
select throws_ok($$ select _public_field_config('status', '{}') $$, '42501', null,
  'visitors cannot call the helper');
reset role;
set local role authenticated;
select throws_ok($$ select _public_field_config('status', '{}') $$, '42501', null,
  'nor can members');
reset role;

select * from finish();
rollback;
