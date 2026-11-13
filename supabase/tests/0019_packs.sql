-- Packs: catalogue, install_pack (atomic, owners and admins, provenance and ref map), archive_pack, grants
-- (0024_packs.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'pack-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'pack-editor@a.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'pack-outsider@b.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000a1', 'Pack Admin', 'PA'),
  ('00000000-0000-0000-0000-0000000000a2', 'Pack Editor', 'PE'),
  ('00000000-0000-0000-0000-0000000000a3', 'Pack Outsider', 'PO');
insert into orgs (id, name, slug) values
  ('a0a0a0a0-0000-0000-0000-000000000000', 'Org P', 'pgtap-packs'),
  ('b0b0b0b0-0000-0000-0000-000000000000', 'Org Q', 'pgtap-packs-other');
insert into memberships (org_id, user_id, role) values
  ('a0a0a0a0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('a0a0a0a0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'editor'),
  ('b0b0b0b0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3', 'owner');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-pack', '1.0.0', 'Pgtap pack', '{}', repeat('a', 64));

-- a small plan: a folder, two sheets linked, a group each, three fields, a view, two items and a link, an
-- automation and a dashboard
create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
insert into plans values ('good', $j${
  "pack": { "key": "pgtap-pack", "version": "1.0.0", "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  "folders": [{ "id": "a1000000-0000-4000-8000-000000000001", "ref": "main", "name": "Pack folder", "position": "a0" }],
  "sheets": [
    { "id": "a2000000-0000-4000-8000-000000000001", "ref": "reg", "folder_id": "a1000000-0000-4000-8000-000000000001",
      "name": "Register", "item_label": "Entry", "id_prefix": "PKA-", "settings": {}, "position": "a0" },
    { "id": "a2000000-0000-4000-8000-000000000002", "ref": "act", "folder_id": "a1000000-0000-4000-8000-000000000001",
      "name": "Actions", "item_label": "Action", "id_prefix": "PKB-", "settings": {}, "position": "a1" }],
  "groups": [
    { "id": "a3000000-0000-4000-8000-000000000001", "ref": "reg.open", "sheet_id": "a2000000-0000-4000-8000-000000000001", "name": "Open", "color": "green", "position": "a0" },
    { "id": "a3000000-0000-4000-8000-000000000002", "ref": "act.todo", "sheet_id": "a2000000-0000-4000-8000-000000000002", "name": "To do", "color": "blue", "position": "a0" }],
  "fields": [
    { "id": "a4000000-0000-4000-8000-000000000001", "ref": "reg.notes", "sheet_id": "a2000000-0000-4000-8000-000000000001", "key": "notes", "name": "Notes", "type": "text", "position": "a0", "width": 200, "config": {} },
    { "id": "a4000000-0000-4000-8000-000000000002", "ref": "reg.actions", "sheet_id": "a2000000-0000-4000-8000-000000000001", "key": "actions", "name": "Actions", "type": "link", "position": "a1", "width": 180,
      "config": { "targetSheetId": "a2000000-0000-4000-8000-000000000002", "multiple": true, "inverseFieldId": null } },
    { "id": "a4000000-0000-4000-8000-000000000003", "ref": "act.done_on", "sheet_id": "a2000000-0000-4000-8000-000000000002", "key": "done_on", "name": "Done on", "type": "date", "position": "a0", "width": 140, "config": {} }],
  "views": [{ "id": "a5000000-0000-4000-8000-000000000001", "ref": "reg.view.1", "sheet_id": "a2000000-0000-4000-8000-000000000001", "name": "Table", "type": "list", "config": {}, "position": "a0" }],
  "items": [
    { "id": "a6000000-0000-4000-8000-000000000001", "ref": "reg.first", "sheet_id": "a2000000-0000-4000-8000-000000000001", "group_id": "a3000000-0000-4000-8000-000000000001",
      "name": "First entry", "position": "a0", "values": { "a4000000-0000-4000-8000-000000000001": "Hello" } },
    { "id": "a6000000-0000-4000-8000-000000000002", "ref": "act.fix", "sheet_id": "a2000000-0000-4000-8000-000000000002", "group_id": "a3000000-0000-4000-8000-000000000002",
      "name": "Fix it", "position": "a0", "values": {} }],
  "links": [{ "field_id": "a4000000-0000-4000-8000-000000000002", "from_item": "a6000000-0000-4000-8000-000000000001", "to_item": "a6000000-0000-4000-8000-000000000002" }],
  "automations": [{ "id": "a7000000-0000-4000-8000-000000000001", "ref": "notify", "sheet_id": "a2000000-0000-4000-8000-000000000001", "name": "Created → post",
      "enabled": true, "trigger": { "type": "item_created" }, "conditions": [], "actions": [{ "type": "post_update", "message": "New." }] }],
  "dashboards": [{ "id": "a8000000-0000-4000-8000-000000000001", "ref": "overview", "name": "Pack overview", "position": "a0",
      "config": { "widgets": [{ "id": "w1", "type": "count", "title": "Entries", "sheetId": "a2000000-0000-4000-8000-000000000001" }] } }]
}$j$);
-- the same plan with one bad row at the end: an item value for a field that does not exist
insert into plans select 'bad_value', jsonb_set(p, '{items,1,values}', '{"a4000000-0000-4000-8000-0000000000ff": 1}') from plans where name = 'good';
-- a link field pointing at another workspace's sheet
insert into sheets (id, org_id, name, id_prefix, position) values
  ('b2000000-0000-4000-8000-000000000001', 'b0b0b0b0-0000-0000-0000-000000000000', 'Elsewhere', 'EL-', 'a0');
insert into plans select 'bad_link', jsonb_set(p, '{fields,1,config,targetSheetId}', '"b2000000-0000-4000-8000-000000000001"') from plans where name = 'good';
insert into plans select 'bad_hash', jsonb_set(p, '{pack,hash}', to_jsonb(repeat('b', 64))) from plans where name = 'good';

-- ── grants
select ok(has_function_privilege('authenticated', 'install_pack(uuid, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'archive_pack(uuid)', 'execute')
          and has_function_privilege('authenticated', 'pack_member_emails(uuid)', 'execute'),
  'signed-in people can call install_pack, archive_pack and pack_member_emails (they check the role)');
select ok(not has_function_privilege('anon', 'install_pack(uuid, jsonb)', 'execute')
          and not has_function_privilege('anon', 'archive_pack(uuid)', 'execute'),
  'signed-out visitors cannot install or archive packs');
select ok(not has_function_privilege('authenticated', '_pack_hash(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'pack_provenance_guard()', 'execute'),
  'the internal pack helpers are not callable');

set local role authenticated;

-- ── the catalogue: readable, never written by people
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from packs where key = 'pgtap-pack'), 1, 'members read the catalogue');
select throws_ok($$ insert into packs (key, version, title, manifest, hash) values ('mine', '1.0.0', 'Mine', '{}', repeat('c', 64)) $$,
  '42501', null, 'nobody writes the catalogue through the API');

-- ── editors cannot install
select throws_ok($$ select install_pack('a0a0a0a0-0000-0000-0000-000000000000', (select p from plans where name = 'good')) $$,
  'not allowed: only owners and admins install packs', 'an editor cannot install a pack');
select throws_ok($$ select * from pack_member_emails('a0a0a0a0-0000-0000-0000-000000000000') $$,
  'not allowed: only owners and admins install packs', 'an editor cannot read member emails');

-- ── admins: all or nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ select install_pack('a0a0a0a0-0000-0000-0000-000000000000', (select p from plans where name = 'bad_value')) $$,
  'pack plan: fields a4000000-0000-4000-8000-0000000000ff cannot hold a value', 'a bad row stops the install');
select is((select count(*)::int from sheets where org_id = 'a0a0a0a0-0000-0000-0000-000000000000')
          + (select count(*)::int from folders where org_id = 'a0a0a0a0-0000-0000-0000-000000000000')
          + (select count(*)::int from pack_installs where org_id = 'a0a0a0a0-0000-0000-0000-000000000000')
          + (select count(*)::int from activity_log where org_id = 'a0a0a0a0-0000-0000-0000-000000000000'), 0,
  'nothing of a failed install is left: no folder, sheet, install or log entry');
select throws_ok($$ select install_pack('a0a0a0a0-0000-0000-0000-000000000000', (select p from plans where name = 'bad_link')) $$,
  'pack plan: a link field points outside the workspace', 'a link field cannot point into another workspace');
select throws_ok($$ select install_pack('a0a0a0a0-0000-0000-0000-000000000000', (select p from plans where name = 'bad_hash')) $$,
  'pack changed: preview it again', 'the plan must be for the catalogue''s manifest');
select throws_ok($$ select install_pack('b0b0b0b0-0000-0000-0000-000000000000', (select p from plans where name = 'good')) $$,
  'not allowed: only owners and admins install packs', 'an admin of one workspace cannot install into another');
select is((select count(*)::int from pack_member_emails('a0a0a0a0-0000-0000-0000-000000000000')), 2,
  'admins read their members'' emails to match example people');

select lives_ok($$ select install_pack('a0a0a0a0-0000-0000-0000-000000000000', (select p from plans where name = 'good')) $$,
  'an admin installs the pack');
select is((select count(*)::int from sheets where org_id = 'a0a0a0a0-0000-0000-0000-000000000000'
             and pack_install_id is not null and pack_hash ~ '^[0-9a-f]{64}$'), 2,
  'every sheet carries its provenance');
select is((select string_agg(pack_ref, ',' order by pack_ref) from fields where sheet_id in
            ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002')),
  'act.done_on,reg.actions,reg.notes', 'fields carry their refs');
select ok((select count(*) = 1 from folders where pack_ref = 'main' and pack_install_id is not null)
          and (select count(*) = 1 from groups where pack_ref = 'reg.open')
          and (select count(*) = 1 from views where pack_ref = 'reg.view.1')
          and (select count(*) = 1 from automations where pack_ref = 'notify' and source = 'pack:pgtap-pack')
          and (select count(*) = 1 from dashboards where pack_ref = 'overview'),
  'folders, groups, views, automations and dashboards carry their refs');
select is((select string_agg(display_id || ' ' || pack_ref, ',' order by display_id) from items
            where org_id = 'a0a0a0a0-0000-0000-0000-000000000000'), 'PKA-001 reg.first,PKB-001 act.fix',
  'example items are numbered and carry their refs');
select is((select ref_map->>'sheet:reg' from pack_installs where pack_key = 'pgtap-pack'),
  'a2000000-0000-4000-8000-000000000001', 'the install keeps the ref → id map');
select ok((select installed_by = '00000000-0000-0000-0000-0000000000a1' and status = 'installed'
             and manifest_hash = repeat('a', 64) from pack_installs where pack_key = 'pgtap-pack'),
  'the install records who installed which manifest');
select is((select count(*)::int from item_links where field_id = 'a4000000-0000-4000-8000-000000000002'), 1,
  'links are written');
select is((select string_agg(action, ',' order by action) from activity_log
            where action in ('pack.installed', 'item.created', 'link.changed')
              and org_id = 'a0a0a0a0-0000-0000-0000-000000000000'),
  'item.created,item.created,link.changed,pack.installed', 'items, links and the install are logged');
select is((select new_value->>'manifest_hash' from activity_log where action = 'pack.installed'
              and chain_key = 'sheet:a0a0a0a0-0000-0000-0000-000000000000'), repeat('a', 64),
  'pack.installed is on the workspace chain with the manifest hash');
select throws_ok($$ select install_pack('a0a0a0a0-0000-0000-0000-000000000000', (select p from plans where name = 'good')) $$,
  'pack already installed', 'a pack is installed once at a time');

-- ── provenance is the install's alone
select throws_ok($$ update sheets set pack_ref = 'other' where id = 'a2000000-0000-4000-8000-000000000001' $$,
  'pack provenance never changes', 'provenance never changes');
select throws_ok($$ insert into folders (org_id, name, position, pack_ref) values
                      ('a0a0a0a0-0000-0000-0000-000000000000', 'Fake', 'b0', 'main') $$,
  'pack provenance is written only by install_pack', 'nobody writes provenance by hand');

-- ── archive: editors cannot; admins archive what the install made, items and the log stay
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select throws_ok($$ select archive_pack((select id from pack_installs where pack_key = 'pgtap-pack')) $$,
  'not allowed: only owners and admins archive packs', 'an editor cannot archive a pack');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(archive_pack((select id from pack_installs where pack_key = 'pgtap-pack')),
  '{"sheets": 2, "folders": 1, "automations": 1, "dashboards": 1}'::jsonb, 'archive reports what it archived');
select ok((select bool_and(archived_at is not null) from sheets where pack_install_id is not null
             and org_id = 'a0a0a0a0-0000-0000-0000-000000000000')
          and (select not enabled from automations where pack_ref = 'notify')
          and (select archived_at is not null from dashboards where pack_ref = 'overview')
          and (select status = 'archived' from pack_installs where pack_key = 'pgtap-pack'),
  'sheets, folder and dashboard archived, automations off, the install archived');
select is((select count(*)::int from items where org_id = 'a0a0a0a0-0000-0000-0000-000000000000' and archived_at is null)
          + (select count(*)::int from item_links where field_id = 'a4000000-0000-4000-8000-000000000002'), 3,
  'archiving keeps the items and their links');
select ok((select count(*) = 1 from activity_log where action = 'pack.archived')
          and (select count(*) = 1 from activity_log where action = 'pack.installed')
          and (verify_activity_chain('sheet:a0a0a0a0-0000-0000-0000-000000000000')->>'ok')::boolean,
  'pack.archived is logged and the workspace chain still verifies');

select * from finish();
rollback;
