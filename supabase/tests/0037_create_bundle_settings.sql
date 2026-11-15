-- Pack settings chosen in Create (0047_create_bundle_settings.sql, docs/11 Bundles and Pack settings): create_bundle
-- records `p_bundle.settings` with set_pack_settings in the same transaction (checked and logged as in Packs ›
-- Settings); an unknown setting or choice rolls the whole set back; without settings nothing changes. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000047a1', 'cbs-admin@a.test'),
  ('00000000-0000-0000-0000-0000000047a2', 'cbs-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000047a1', 'Settings Admin', 'SA'),
  ('00000000-0000-0000-0000-0000000047a2', 'Settings Editor', 'SE');
insert into orgs (id, name, slug) values ('a47a47a4-0000-0000-0000-000000000000', 'Org S', 'pgtap-bundle-settings');
insert into memberships (org_id, user_id, role) values
  ('a47a47a4-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000047a1', 'admin'),
  ('a47a47a4-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000047a2', 'editor');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-bundle-set', '1.0.0', 'Cyber reports', $j${ "settings": [{
     "key": "country", "label": "Country", "description": "Where you are.",
     "values": [{ "key": "csirt", "label": "CSIRT" }],
     "choices": [
       { "id": "no", "label": "Norway", "values": { "csirt": "NorCERT" }, "verified": false, "sources": [] },
       { "id": "de", "label": "Germany", "values": { "csirt": "CERT-Bund" }, "verified": false, "sources": [] }
     ] }] }$j$, repeat('f', 64)),
  ('pgtap-bundle-plain', '1.0.0', 'Plain set', '{}', repeat('d', 64));

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
insert into plans values ('set', $j${
  "pack": { "key": "pgtap-bundle-set", "version": "1.0.0", "hash": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
  "folders": [],
  "sheets": [{ "id": "a4720000-0000-4000-8000-000000000001", "ref": "reports", "folder_id": null,
      "name": "Cyber reports", "item_label": "Report", "id_prefix": "CRS-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "a4730000-0000-4000-8000-000000000001", "ref": "reports.open", "sheet_id": "a4720000-0000-4000-8000-000000000001", "name": "Open", "color": "green", "position": "a0" }],
  "fields": [], "views": [], "items": [], "links": [], "automations": [], "dashboards": []
}$j$), ('plain', $j${
  "pack": { "key": "pgtap-bundle-plain", "version": "1.0.0", "hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
  "folders": [],
  "sheets": [{ "id": "a4720000-0000-4000-8000-000000000002", "ref": "log", "folder_id": null,
      "name": "Plain log", "item_label": "Entry", "id_prefix": "PLN-", "settings": {}, "position": "a1" }],
  "groups": [{ "id": "a4730000-0000-4000-8000-000000000002", "ref": "log.open", "sheet_id": "a4720000-0000-4000-8000-000000000002", "name": "Open", "color": "green", "position": "a0" }],
  "fields": [], "views": [], "items": [], "links": [], "automations": [], "dashboards": []
}$j$);

select ok(has_function_privilege('authenticated', 'create_bundle(uuid, jsonb, jsonb)', 'execute'),
  'authenticated may run create_bundle');
select ok(not has_function_privilege('anon', 'create_bundle(uuid, jsonb, jsonb)', 'execute'),
  'anon may not run create_bundle');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000047a2","role":"authenticated"}', true);
select throws_ok($$ select create_bundle('a47a47a4-0000-0000-0000-000000000000', (select p from plans where name = 'set'),
    '{"name": "Cyber reports", "owner_id": "00000000-0000-0000-0000-0000000047a2", "settings": {"country": "no"}}') $$,
  'not allowed: only owners and admins create ready-made apps', 'an editor cannot create a set with settings');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000047a1","role":"authenticated"}', true);
select throws_ok($$ select create_bundle('a47a47a4-0000-0000-0000-000000000000', (select p from plans where name = 'set'),
    '{"name": "Cyber reports", "owner_id": "00000000-0000-0000-0000-0000000047a1", "settings": {"country": "xx"}}') $$,
  'unknown pack setting or choice (country)', 'a choice the pack does not offer is refused');
select throws_ok($$ select create_bundle('a47a47a4-0000-0000-0000-000000000000', (select p from plans where name = 'set'),
    '{"name": "Cyber reports", "owner_id": "00000000-0000-0000-0000-0000000047a1", "settings": {"region": "no"}}') $$,
  'unknown pack setting or choice (region)', 'a setting the pack does not declare is refused');
select throws_ok($$ select create_bundle('a47a47a4-0000-0000-0000-000000000000', (select p from plans where name = 'set'),
    '{"name": "Cyber reports", "owner_id": "00000000-0000-0000-0000-0000000047a1", "settings": ["no"]}') $$,
  'bundle: settings must be an object', 'settings are an object');
select is((select count(*)::int from pack_installs where org_id = 'a47a47a4-0000-0000-0000-000000000000'), 0,
  'a refused setting leaves nothing behind: the install is rolled back');

select lives_ok($$ select create_bundle('a47a47a4-0000-0000-0000-000000000000', (select p from plans where name = 'set'),
    '{"name": "Cyber reports", "owner_id": "00000000-0000-0000-0000-0000000047a1", "review_by": "2027-02-14", "settings": {"country": "no"}}') $$,
  'an admin creates a set with a country chosen');
select results_eq($$ select bundle_name, origin, settings from pack_installs where pack_key = 'pgtap-bundle-set' $$,
  $$ values ('Cyber reports'::text, 'create'::text, '{"country": "no"}'::jsonb) $$,
  'the install carries the set''s name and the choices');
select is((select new_value->'labels' from activity_log
            where action = 'pack.settings_changed' and org_id = 'a47a47a4-0000-0000-0000-000000000000'),
  '{"Country": "Norway"}'::jsonb, 'pack.settings_changed is logged with the choice''s label');
select is((select count(*)::int from activity_log
            where action in ('pack.installed', 'bundle.created') and org_id = 'a47a47a4-0000-0000-0000-000000000000'),
  2, 'the install and the set are logged in the same call');

select lives_ok($$ select create_bundle('a47a47a4-0000-0000-0000-000000000000', (select p from plans where name = 'plain'),
    '{"name": "Plain set", "owner_id": "00000000-0000-0000-0000-0000000047a1"}') $$,
  'a set without settings is created as before');
select is((select count(*)::int from activity_log
            where action = 'pack.settings_changed' and org_id = 'a47a47a4-0000-0000-0000-000000000000'
              and new_value->>'pack_key' = 'pgtap-bundle-plain'),
  0, 'no settings, no settings entry');

select * from finish();
rollback;
