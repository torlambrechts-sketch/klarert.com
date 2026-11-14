-- Pack settings (0043_pack_settings.sql, docs/11 Pack settings): set_pack_settings records a workspace's choices
-- (known settings and choices only) and rewrites the defaults of the install's own fields in one transaction; owners
-- and admins only; logged on the workspace chain. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'settings-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'settings-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000e1', 'Settings Admin', 'SA'),
  ('00000000-0000-0000-0000-0000000000e2', 'Settings Editor', 'SE');
insert into orgs (id, name, slug) values ('e0e0e0e0-0000-0000-0000-000000000000', 'Org E', 'pgtap-settings');
insert into memberships (org_id, user_id, role) values
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'admin'),
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e2', 'editor');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-settings', '1.0.0', 'Settings pack', $j${ "settings": [{ "key": "country", "label": "Country",
     "choices": [{ "id": "no", "label": "Norway" }, { "id": "de", "label": "Germany" }] }] }$j$, repeat('b', 64));

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
insert into plans values ('settings', $j${
  "pack": { "key": "pgtap-settings", "version": "1.0.0", "hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  "folders": [],
  "sheets": [{ "id": "e2000000-0000-4000-8000-000000000001", "ref": "reports", "folder_id": null,
      "name": "Reports", "item_label": "Report", "id_prefix": "RS-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "e3000000-0000-4000-8000-000000000001", "ref": "reports.open", "sheet_id": "e2000000-0000-4000-8000-000000000001", "name": "Open", "color": "blue", "position": "a0" }],
  "fields": [{ "id": "e4000000-0000-4000-8000-000000000001", "ref": "reports.recipient", "sheet_id": "e2000000-0000-4000-8000-000000000001", "key": "recipient", "name": "Report to", "type": "text", "position": "a0", "width": 160, "config": { "default": "NCSC" } }],
  "views": [], "items": [], "links": [], "dashboards": [], "automations": []
}$j$);

select has_column('pack_installs', 'settings', 'pack installs keep their settings');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select lives_ok($$ select install_pack('e0e0e0e0-0000-0000-0000-000000000000', (select p from plans where name = 'settings')) $$,
  'an admin installs the pack');
select is((select settings from pack_installs where pack_key = 'pgtap-settings'), '{}'::jsonb,
  'no choices until the workspace makes them');

-- only owners and admins
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select throws_ok($$ select set_pack_settings((select id from pack_installs where pack_key = 'pgtap-settings'), '{"country":"de"}', '[]') $$,
  'only owners and admins change pack settings', 'an editor cannot change pack settings');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select throws_ok($$ select set_pack_settings((select id from pack_installs where pack_key = 'pgtap-settings'), '{"country":"fr"}', '[]') $$,
  'unknown pack setting or choice (country)', 'a choice the manifest does not list is refused');
select throws_ok($$ select set_pack_settings((select id from pack_installs where pack_key = 'pgtap-settings'), '{"colour":"no"}', '[]') $$,
  'unknown pack setting or choice (colour)', 'a setting the manifest does not have is refused');
select throws_ok($$ select set_pack_settings((select id from pack_installs where pack_key = 'pgtap-settings'), '{"country":"de"}',
    '[{"id":"00000000-0000-4000-8000-00000000ffff","default":"BSI"}]') $$,
  'pack settings: fields not of this install (00000000-0000-4000-8000-00000000ffff)', 'only the install''s own fields');

select is(set_pack_settings((select id from pack_installs where pack_key = 'pgtap-settings'), '{"country":"de"}',
    '[{"id":"e4000000-0000-4000-8000-000000000001","default":"CERT-Bund"}]'), 1,
  'the choice rewrites the field default');
select is((select config->>'default' from fields where id = 'e4000000-0000-4000-8000-000000000001'), 'CERT-Bund',
  'the field has the new default');
select is((select new_value->'labels'->>'Country' from activity_log where action = 'pack.settings_changed'
            and org_id = 'e0e0e0e0-0000-0000-0000-000000000000'), 'Germany',
  'the workspace log names the choice');
select is(set_pack_settings((select id from pack_installs where pack_key = 'pgtap-settings'), '{"country":"de"}',
    '[{"id":"e4000000-0000-4000-8000-000000000001","default":null}]'), 1,
  'no default for a value the choice does not have');

select * from finish();
rollback;
