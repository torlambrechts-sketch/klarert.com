-- Pack links into a library (0033_pack_library_links.sql, docs/11 Frameworks): an example item may link to a live item
-- of the workspace's library sheet through a requirement field; not through a plain link field, and not to an item of
-- an ordinary sheet outside the plan. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'liblink-admin@a.test');
insert into profiles (id, display_name, initials) values ('00000000-0000-0000-0000-0000000000d1', 'Lib Admin', 'LA');
insert into orgs (id, name, slug) values ('d0d0d0d0-0000-0000-0000-000000000000', 'Org D', 'pgtap-liblinks');
insert into memberships (org_id, user_id, role) values
  ('d0d0d0d0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000d1', 'admin');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-liblinks', '1.0.0', 'Library links pack', '{}', repeat('e', 64));

-- the adopted library (one requirement) and an ordinary sheet of the workspace
insert into sheets (id, org_id, name, id_prefix, position, is_library) values
  ('d2000000-0000-4000-8000-0000000000a1', 'd0d0d0d0-0000-0000-0000-000000000000', 'Library', 'LIB-', 'b0', true),
  ('d2000000-0000-4000-8000-0000000000a2', 'd0d0d0d0-0000-0000-0000-000000000000', 'Notes', 'NTE-', 'b1', false);
insert into groups (id, org_id, sheet_id, name, position) values
  ('d3000000-0000-4000-8000-0000000000a1', 'd0d0d0d0-0000-0000-0000-000000000000', 'd2000000-0000-4000-8000-0000000000a1', 'Annex A', 'a0'),
  ('d3000000-0000-4000-8000-0000000000a2', 'd0d0d0d0-0000-0000-0000-000000000000', 'd2000000-0000-4000-8000-0000000000a2', 'Open', 'a0');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('d6000000-0000-4000-8000-0000000000a1', 'd0d0d0d0-0000-0000-0000-000000000000', 'd2000000-0000-4000-8000-0000000000a1',
   'd3000000-0000-4000-8000-0000000000a1', 1, 'LIB-001', 'Awareness and training', 'a0'),
  ('d6000000-0000-4000-8000-0000000000a2', 'd0d0d0d0-0000-0000-0000-000000000000', 'd2000000-0000-4000-8000-0000000000a2',
   'd3000000-0000-4000-8000-0000000000a2', 1, 'NTE-001', 'A note', 'a0');

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
-- a risk register whose example risk links to the library's requirement through a requirement field
insert into plans values ('good', $j${
  "pack": { "key": "pgtap-liblinks", "version": "1.0.0", "hash": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  "folders": [],
  "sheets": [{ "id": "d2000000-0000-4000-8000-000000000001", "ref": "risk", "folder_id": null,
      "name": "Risks", "item_label": "Risk", "id_prefix": "RSK-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "d3000000-0000-4000-8000-000000000001", "ref": "risk.open", "sheet_id": "d2000000-0000-4000-8000-000000000001", "name": "Open", "color": "green", "position": "a0" }],
  "fields": [
    { "id": "d4000000-0000-4000-8000-000000000001", "ref": "risk.controls", "sheet_id": "d2000000-0000-4000-8000-000000000001", "key": "controls", "name": "Controls", "type": "requirement", "position": "a0", "width": 180,
      "config": { "targetSheetId": null, "multiple": true, "inverseFieldId": null } },
    { "id": "d4000000-0000-4000-8000-000000000002", "ref": "risk.other", "sheet_id": "d2000000-0000-4000-8000-000000000001", "key": "other", "name": "Other", "type": "link", "position": "a1", "width": 180,
      "config": { "targetSheetId": null, "multiple": true, "inverseFieldId": null } }],
  "views": [],
  "items": [{ "id": "d6000000-0000-4000-8000-000000000001", "ref": "risk.phish", "sheet_id": "d2000000-0000-4000-8000-000000000001", "group_id": "d3000000-0000-4000-8000-000000000001", "name": "Phishing", "position": "a0", "values": {} }],
  "links": [{ "field_id": "d4000000-0000-4000-8000-000000000001", "from_item": "d6000000-0000-4000-8000-000000000001", "to_item": "d6000000-0000-4000-8000-0000000000a1" }],
  "automations": [], "dashboards": []
}$j$);
-- through a plain link field, to the same library item
insert into plans select 'plain_link', jsonb_set(p, '{links,0,field_id}', '"d4000000-0000-4000-8000-000000000002"') from plans where name = 'good';
-- through the requirement field, to an item of an ordinary sheet
insert into plans select 'not_library', jsonb_set(p, '{links,0,to_item}', '"d6000000-0000-4000-8000-0000000000a2"') from plans where name = 'good';

select has_function('public', 'install_pack', array['uuid', 'jsonb'], 'install_pack exists');
select ok(has_function_privilege('authenticated', 'install_pack(uuid, jsonb)', 'execute'),
  'authenticated may call install_pack');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select throws_ok($$ select install_pack('d0d0d0d0-0000-0000-0000-000000000000', (select p from plans where name = 'plain_link')) $$,
  'pack plan: links must join the plan''s items', 'a plain link field cannot reach into a library');
select throws_ok($$ select install_pack('d0d0d0d0-0000-0000-0000-000000000000', (select p from plans where name = 'not_library')) $$,
  'pack plan: links must join the plan''s items', 'a requirement field reaches library items only');
select lives_ok($$ select install_pack('d0d0d0d0-0000-0000-0000-000000000000', (select p from plans where name = 'good')) $$,
  'an example risk links to the library''s requirement');
select is((select count(*)::int from item_links where field_id = 'd4000000-0000-4000-8000-000000000001'
             and from_item = 'd6000000-0000-4000-8000-000000000001' and to_item = 'd6000000-0000-4000-8000-0000000000a1'), 1,
  'the link is written');

select * from finish();
rollback;
