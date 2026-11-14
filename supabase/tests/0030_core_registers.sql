-- Core registers and extends (0040_core_registers.sql, docs/11 Extends): domain folders and system columns; an add-on
-- adds columns, groups, views, items, links and options to the sheets of a pack it requires, in its own provenance;
-- only into packs it requires; a pack another install builds on is not archived; archiving the add-on archives its
-- columns, removes its views, empty groups and standard option, and keeps every item. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(32);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'core-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'core-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000c1', 'Core Admin', 'CA'),
  ('00000000-0000-0000-0000-0000000000c2', 'Core Editor', 'CE');
insert into orgs (id, name, slug) values ('c0c0c0c0-0000-0000-0000-000000000000', 'Org C', 'pgtap-core');
insert into memberships (org_id, user_id, role) values
  ('c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'admin'),
  ('c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 'editor');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-core', '1.0.0', 'Core', '{"system": true}', repeat('c', 64)),
  ('pgtap-addon', '1.0.0', 'Add-on', '{"requires": [{"pack": "pgtap-core", "range": "^1.0.0"}], "standard": {"id": "pgx", "label": "PGX"}}', repeat('d', 64)),
  ('pgtap-addon', '1.1.0', 'Add-on', '{"requires": [{"pack": "pgtap-core", "range": "^1.0.0"}], "standard": {"id": "pgx", "label": "PGX"}}', repeat('e', 64)),
  ('pgtap-rogue', '1.0.0', 'Rogue', '{"requires": []}', repeat('f', 64));

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
insert into plans values ('core', $j${
  "pack": { "key": "pgtap-core", "version": "1.0.0", "hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
  "folders": [{ "id": "c1000000-0000-4000-8000-000000000001", "ref": "risk", "name": "Risk and controls", "position": "a0", "domain": "risk" }],
  "sheets": [{ "id": "c2000000-0000-4000-8000-000000000001", "ref": "risk", "folder_id": "c1000000-0000-4000-8000-000000000001",
      "name": "Risk register", "item_label": "Risk", "id_prefix": "CR-", "settings": { "system": true }, "position": "a0" }],
  "groups": [{ "id": "c3000000-0000-4000-8000-000000000001", "ref": "risk.open", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "Open", "color": "blue", "position": "a0" }],
  "fields": [
    { "id": "c4000000-0000-4000-8000-000000000001", "ref": "risk.standards", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "standards", "name": "Standards", "type": "multiselect", "position": "a0", "width": 180, "config": { "options": [{ "id": "all", "label": "All standards", "color": "grey" }] }, "system": true },
    { "id": "c4000000-0000-4000-8000-000000000002", "ref": "risk.score", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "score", "name": "Score", "type": "number", "position": "a1", "width": 96, "config": {}, "system": true },
    { "id": "c4000000-0000-4000-8000-000000000003", "ref": "risk.related", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "related", "name": "Related", "type": "link", "position": "a2", "width": 180, "config": { "targetSheetId": "c2000000-0000-4000-8000-000000000001", "multiple": true, "inverseFieldId": null }, "system": true }
  ],
  "views": [], "items": [], "links": [], "automations": [], "dashboards": []
}$j$), ('addon', $j${
  "pack": { "key": "pgtap-addon", "version": "1.0.0", "hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
  "folders": [],
  "sheets": [],
  "groups": [
    { "id": "c3000000-0000-4000-8000-000000000011", "ref": "pgtap-core:risk.pgx_env", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "Environment", "color": "green", "position": "a1" },
    { "id": "c3000000-0000-4000-8000-000000000012", "ref": "pgtap-core:risk.pgx_spare", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "Spare", "color": "grey", "position": "a2" }
  ],
  "fields": [{ "id": "c4000000-0000-4000-8000-000000000011", "ref": "pgtap-core:risk.pgx_permit", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "pgx_permit", "name": "Permit", "type": "text", "position": "a3", "width": 180, "config": {}, "system": true }],
  "views": [{ "id": "c5000000-0000-4000-8000-000000000011", "ref": "pgtap-core:risk.view.standard", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "PGX view", "type": "list", "position": "a0",
      "config": { "filters": [{ "fieldKey": "standards", "op": "has_any_of", "value": ["pgx"] }], "sort": [], "hidden": [] } }],
  "items": [
    { "id": "c6000000-0000-4000-8000-000000000011", "ref": "pgtap-core:risk.pgx_spill", "sheet_id": "c2000000-0000-4000-8000-000000000001", "group_id": "c3000000-0000-4000-8000-000000000011", "name": "Example: spill", "position": "a0",
      "values": { "c4000000-0000-4000-8000-000000000002": 12, "c4000000-0000-4000-8000-000000000011": "P-1", "c4000000-0000-4000-8000-000000000001": ["pgx"] } },
    { "id": "c6000000-0000-4000-8000-000000000012", "ref": "pgtap-core:risk.pgx_leak", "sheet_id": "c2000000-0000-4000-8000-000000000001", "group_id": "c3000000-0000-4000-8000-000000000001", "name": "Example: leak", "position": "a1", "values": {} }
  ],
  "links": [{ "field_id": "c4000000-0000-4000-8000-000000000003", "from_item": "c6000000-0000-4000-8000-000000000011", "to_item": "c6000000-0000-4000-8000-000000000012" }],
  "automations": [], "dashboards": [],
  "options": [{ "ref": "pgtap-core:risk.standards.pgx", "field_id": "c4000000-0000-4000-8000-000000000001", "option": { "id": "pgx", "label": "PGX", "color": "green" } },
              { "ref": "pgtap-core:risk.standards.all", "field_id": "c4000000-0000-4000-8000-000000000001", "option": { "id": "all", "label": "Renamed", "color": "red" } }]
}$j$), ('up', $j${
  "pack": { "key": "pgtap-addon", "from_version": "1.0.0", "from_hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            "version": "1.1.0", "hash": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  "install": "",
  "add": { "folders": [], "sheets": [], "groups": [], "views": [], "items": [], "links": [], "automations": [], "dashboards": [],
    "fields": [{ "id": "c4000000-0000-4000-8000-000000000031", "ref": "pgtap-core:risk.pgx_volume", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "pgx_volume", "name": "Volume", "type": "number", "position": "a4", "width": 96, "config": {}, "system": true }],
    "options": [{ "ref": "pgtap-core:risk.standards.pgx_air", "field_id": "c4000000-0000-4000-8000-000000000001", "option": { "id": "pgx_air", "label": "Air", "color": "teal" } }] },
  "update": { "folders": [], "sheets": [], "fields": [], "groups": [], "views": [], "items": [], "automations": [], "dashboards": [] },
  "archive": { "folders": [], "sheets": [], "items": [], "dashboards": [] },
  "disable": { "automations": [] },
  "summary": { "added": 2, "changed": 0, "archived": 0, "kept": 0, "conflicts": 0, "theirs": 0 }
}$j$), ('rogue', $j${
  "pack": { "key": "pgtap-rogue", "version": "1.0.0", "hash": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
  "folders": [], "sheets": [], "groups": [],
  "fields": [{ "id": "c4000000-0000-4000-8000-000000000021", "ref": "pgtap-core:risk.rogue", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "rogue", "name": "Rogue", "type": "text", "position": "a9", "width": 180, "config": {} }],
  "views": [], "items": [], "links": [], "automations": [], "dashboards": []
}$j$);

select has_column('folders', 'domain', 'folders have a domain');
select has_column('fields', 'system', 'fields can be system columns');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select lives_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'core')) $$,
  'an admin installs the core pack');
select is((select domain from folders where id = 'c1000000-0000-4000-8000-000000000001'), 'risk', 'the domain folder keeps its domain');
select is((select count(*)::int from fields where sheet_id = 'c2000000-0000-4000-8000-000000000001' and system), 3,
  'its fields are system columns');

-- system columns: renamed and hidden, never retyped, re-keyed or deleted (except by a pack)
select lives_ok($$ update fields set name = 'Risk score' where id = 'c4000000-0000-4000-8000-000000000002' $$,
  'a system column can be renamed');
select throws_ok($$ update fields set type = 'text' where id = 'c4000000-0000-4000-8000-000000000002' $$,
  'a system column keeps its type', 'a system column cannot be retyped');
select throws_ok($$ update fields set key = 'points' where id = 'c4000000-0000-4000-8000-000000000002' $$,
  'a system column keeps its key', 'a system column cannot be re-keyed');
select throws_ok($$ update fields set archived_at = now() where id = 'c4000000-0000-4000-8000-000000000002' $$,
  'a system column cannot be deleted: hide it in a view', 'a system column cannot be archived');
select throws_ok($$ insert into fields (org_id, sheet_id, key, name, type, position, system)
    values ('c0c0c0c0-0000-0000-0000-000000000000', 'c2000000-0000-4000-8000-000000000001', 'mine', 'Mine', 'text', 'b0', true) $$,
  'a system column is made only by a pack', 'people cannot make a system column');

-- extends: only into packs in requires
select throws_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'rogue')) $$,
  'pack plan: rows must belong to the plan''s sheets', 'a pack cannot add to a pack it does not require');

select lives_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'addon')) $$,
  'the add-on installs onto the core sheet');
select is((select pack_install_id from fields where id = 'c4000000-0000-4000-8000-000000000011'),
  (select id from pack_installs where pack_key = 'pgtap-addon' and org_id = 'c0c0c0c0-0000-0000-0000-000000000000'),
  'its column on the core sheet is its own');
select is((select config->'options' from fields where id = 'c4000000-0000-4000-8000-000000000001'),
  '[{"id": "all", "label": "All standards", "color": "grey"}, {"id": "pgx", "label": "PGX", "color": "green"}]'::jsonb,
  'options are merged by id: a new one added, one already there left as it is');
select is((select ref_map->>'option:pgtap-core:risk.standards.pgx' from pack_installs where pack_key = 'pgtap-addon'),
  'c4000000-0000-4000-8000-000000000001', 'the option is in the add-on''s ref map');
select is((select count(*)::int from items where sheet_id = 'c2000000-0000-4000-8000-000000000001'), 2,
  'its example items are on the core sheet, in a core group and its own');
select is((select count(*)::int from item_links where field_id = 'c4000000-0000-4000-8000-000000000003'), 1,
  'items it adds link through the core sheet''s own link field');
select is((select display_id from items where id = 'c6000000-0000-4000-8000-000000000011'), 'CR-001',
  'they are numbered by the core sheet');

-- upgrade: the add-on's new column and option reach the core sheet, in its own provenance and ref map
select lives_ok($$ select upgrade_pack((select id from pack_installs where pack_key = 'pgtap-addon' and status = 'installed'),
    jsonb_set((select p from plans where name = 'up'), '{install}',
              to_jsonb((select id::text from pack_installs where pack_key = 'pgtap-addon' and status = 'installed')))) $$,
  'the add-on upgrades onto the core sheet');
select is((select pack_install_id from fields where id = 'c4000000-0000-4000-8000-000000000031'),
  (select id from pack_installs where pack_key = 'pgtap-addon' and status = 'installed'), 'the new column is the add-on''s');
select ok((select config->'options' @> '[{"id": "pgx_air"}]' from fields where id = 'c4000000-0000-4000-8000-000000000001'),
  'the new option is merged into the core field');
select is((select ref_map->>'option:pgtap-core:risk.standards.pgx_air' from pack_installs where pack_key = 'pgtap-addon' and status = 'installed'),
  'c4000000-0000-4000-8000-000000000001', 'the new option joins the add-on''s ref map');
select is((select version from pack_installs where pack_key = 'pgtap-addon' and status = 'installed'), '1.1.0', 'the install moved on');

-- archive: the core cannot go while the add-on builds on it
select throws_ok($$ select archive_pack((select id from pack_installs where pack_key = 'pgtap-core' and status = 'installed')) $$,
  'not allowed: archive Add-on first, it builds on this pack', 'a pack another install builds on is not archived');
select lives_ok($$ select archive_pack((select id from pack_installs where pack_key = 'pgtap-addon' and status = 'installed')) $$,
  'the add-on is archived');
select isnt((select archived_at from fields where id = 'c4000000-0000-4000-8000-000000000011'), null,
  'its column on the core sheet is archived');
select is((select count(*)::int from views where id = 'c5000000-0000-4000-8000-000000000011'), 0, 'its view is removed');
select is((select array_agg(name order by name) from groups where sheet_id = 'c2000000-0000-4000-8000-000000000001'),
  array['Environment', 'Open'], 'its empty group is removed, the one with items kept');
select is((select config->'options' from fields where id = 'c4000000-0000-4000-8000-000000000001'),
  '[{"id": "all", "label": "All standards", "color": "grey"}, {"id": "pgx_air", "label": "Air", "color": "teal"}]'::jsonb,
  'its standard leaves the Standards field; another option it added stays');
select is((select count(*)::int from items where sheet_id = 'c2000000-0000-4000-8000-000000000001' and archived_at is null), 2,
  'every item on the core sheet is kept');
select is((select count(*)::int from sheets where id = 'c2000000-0000-4000-8000-000000000001' and archived_at is null), 1,
  'the core sheet stays');

reset role;
select ok(not has_function_privilege('authenticated', 'public._pack_add_options(uuid, jsonb, jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public._pack_extend_target(uuid, jsonb, uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.install_pack(uuid, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.archive_pack(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.install_pack(uuid, jsonb)', 'execute'),
  'the RPCs are granted to authenticated, the helpers to nobody');

select * from finish();
rollback;
