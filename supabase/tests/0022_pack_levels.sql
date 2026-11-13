-- Pack levels (0032_pack_levels.sql, docs/11 Levels): install_pack keeps the level; a higher level joins the live
-- install of the same version, writes only new rows, extends the ref map and logs pack.extended. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'lvl-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'lvl-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000c1', 'Level Admin', 'LA'),
  ('00000000-0000-0000-0000-0000000000c2', 'Level Editor', 'LE');
insert into orgs (id, name, slug) values ('c0c0c0c0-0000-0000-0000-000000000000', 'Org L', 'pgtap-levels');
insert into memberships (org_id, user_id, role) values
  ('c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'admin'),
  ('c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 'editor');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-levels', '1.0.0', 'Levels pack',
   '{"levels": [{"key": "starter", "name": "Starter"}, {"key": "full", "name": "Full"}]}', repeat('d', 64));

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
-- Starter: a folder, the register with a group, a field and an item
insert into plans values ('starter', $j${
  "pack": { "key": "pgtap-levels", "version": "1.0.0", "hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "level": "starter" },
  "folders": [{ "id": "c1000000-0000-4000-8000-000000000001", "ref": "main", "name": "Levels folder", "position": "a0" }],
  "sheets": [{ "id": "c2000000-0000-4000-8000-000000000001", "ref": "reg", "folder_id": "c1000000-0000-4000-8000-000000000001",
      "name": "Register", "item_label": "Entry", "id_prefix": "LVA-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "c3000000-0000-4000-8000-000000000001", "ref": "reg.open", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "Open", "color": "green", "position": "a0" }],
  "fields": [{ "id": "c4000000-0000-4000-8000-000000000001", "ref": "reg.notes", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "notes", "name": "Notes", "type": "text", "position": "a0", "width": 200, "config": {} }],
  "views": [],
  "items": [{ "id": "c6000000-0000-4000-8000-000000000001", "ref": "reg.first", "sheet_id": "c2000000-0000-4000-8000-000000000001", "group_id": "c3000000-0000-4000-8000-000000000001", "name": "First", "position": "a0", "values": {} }],
  "links": [], "automations": [], "dashboards": []
}$j$);
-- Full on top: a second sheet whose link field points at the register and whose item links to Starter's item
insert into plans values ('full', $j${
  "pack": { "key": "pgtap-levels", "version": "1.0.0", "hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "level": "full" },
  "extend_install": "c9000000-0000-4000-8000-000000000001",
  "folders": [],
  "sheets": [{ "id": "c2000000-0000-4000-8000-000000000002", "ref": "act", "folder_id": "c1000000-0000-4000-8000-000000000001",
      "name": "Actions", "item_label": "Action", "id_prefix": "LVB-", "settings": {}, "position": "a1" }],
  "groups": [{ "id": "c3000000-0000-4000-8000-000000000002", "ref": "act.todo", "sheet_id": "c2000000-0000-4000-8000-000000000002", "name": "To do", "color": "blue", "position": "a0" }],
  "fields": [{ "id": "c4000000-0000-4000-8000-000000000002", "ref": "act.reg", "sheet_id": "c2000000-0000-4000-8000-000000000002", "key": "reg", "name": "Register", "type": "link", "position": "a0", "width": 180,
      "config": { "targetSheetId": "c2000000-0000-4000-8000-000000000001", "multiple": true, "inverseFieldId": null } }],
  "views": [],
  "items": [{ "id": "c6000000-0000-4000-8000-000000000002", "ref": "act.fix", "sheet_id": "c2000000-0000-4000-8000-000000000002", "group_id": "c3000000-0000-4000-8000-000000000002", "name": "Fix", "position": "a0", "values": {} }],
  "links": [{ "field_id": "c4000000-0000-4000-8000-000000000002", "from_item": "c6000000-0000-4000-8000-000000000002", "to_item": "c6000000-0000-4000-8000-000000000001" }],
  "automations": [], "dashboards": []
}$j$);
insert into plans select 'unknown_level', jsonb_set(p, '{pack,level}', '"gold"') from plans where name = 'starter';
insert into plans select 'same_level', jsonb_set(p, '{pack,level}', '"starter"') from plans where name = 'full';
-- a Full plan that would write the Starter sheet again
insert into plans select 'repeat_ref', jsonb_set(p, '{sheets,0,ref}', '"reg"') from plans where name = 'full';

select ok(exists (select 1 from information_schema.columns where table_name = 'pack_installs' and column_name = 'level'),
  'pack_installs has a level');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select throws_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'starter')) $$,
  'not allowed: only owners and admins install packs', 'an editor cannot install a level');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'unknown_level')) $$,
  'pack plan: unknown level gold', 'a level must be one of the manifest''s');
select lives_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'starter')) $$,
  'an admin installs Starter');
select is((select level from pack_installs where pack_key = 'pgtap-levels'), 'starter', 'the install keeps its level');

-- the Full plan names the live install by id
reset role;
update plans set p = jsonb_set(p, '{extend_install}', to_jsonb((select id::text from pack_installs where pack_key = 'pgtap-levels')))
 where name in ('full', 'same_level', 'repeat_ref');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);

select throws_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'same_level')) $$,
  'pack plan: this level is installed already', 'the same level is not installed twice');
select throws_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'repeat_ref')) $$,
  'pack plan: refs already installed (sheet:reg)', 'a level never writes what the install already made');
select lives_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'full')) $$,
  'an admin adds Full to the install');
select is((select count(*)::int from pack_installs where pack_key = 'pgtap-levels'), 1, 'still one install');
select ok((select level = 'full' and ref_map ? 'sheet:reg' and ref_map ? 'sheet:act' from pack_installs where pack_key = 'pgtap-levels'),
  'the level and the ref map grow');
select is((select count(*)::int from sheets where pack_install_id = (select id from pack_installs where pack_key = 'pgtap-levels')), 2,
  'the new sheet joins the install');
select is((select count(*)::int from item_links where field_id = 'c4000000-0000-4000-8000-000000000002'
             and to_item = 'c6000000-0000-4000-8000-000000000001'), 1, 'a new item links to an item of the lower level');
select is((select string_agg(action || ':' || coalesce(new_value->>'level', ''), ',' order by id) from activity_log
            where org_id = 'c0c0c0c0-0000-0000-0000-000000000000' and action like 'pack.%'),
  'pack.installed:starter,pack.extended:full', 'installing and adding a level are logged');

select * from finish();
rollback;
