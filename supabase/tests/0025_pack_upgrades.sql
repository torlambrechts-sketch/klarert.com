-- Pack upgrades: upgrade_pack (0035_pack_upgrades.sql): owners and admins, the install's own rows only, add-only
-- fields, the on/off state kept, archive never delete, all or nothing, the install moved to the new version with its
-- ref map extended and pack.upgraded logged. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(23);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'up-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'up-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000c1', 'Up Admin', 'UA'),
  ('00000000-0000-0000-0000-0000000000c2', 'Up Editor', 'UE');
insert into orgs (id, name, slug) values ('c0c0c0c0-0000-0000-0000-000000000000', 'Org U', 'pgtap-upgrades');
insert into memberships (org_id, user_id, role) values
  ('c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'admin'),
  ('c0c0c0c0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 'editor');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-up', '1.0.0', 'Upgrade pack', '{}', repeat('a', 64)),
  ('pgtap-up', '1.1.0', 'Upgrade pack', '{}', repeat('b', 64));

create temporary table plans (name text primary key, p jsonb);
grant select, update on plans to authenticated;
-- 1.0.0: one sheet with a status field, a link field to itself, two items, two automations and a dashboard
insert into plans values ('install', $j${
  "pack": { "key": "pgtap-up", "version": "1.0.0", "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  "folders": [{ "id": "c1000000-0000-4000-8000-000000000001", "ref": "main", "name": "Risks", "position": "a0" }],
  "sheets": [{ "id": "c2000000-0000-4000-8000-000000000001", "ref": "risk", "folder_id": "c1000000-0000-4000-8000-000000000001",
               "name": "Risk register", "item_label": "Risk", "id_prefix": "UPR-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "c3000000-0000-4000-8000-000000000001", "ref": "risk.open", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "Open", "color": "blue", "position": "a0" }],
  "fields": [
    { "id": "c4000000-0000-4000-8000-000000000001", "ref": "risk.status", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "status", "name": "Status", "type": "status", "position": "a0", "width": 140,
      "config": { "options": [{ "id": "opt_open", "label": "Open", "color": "blue" }, { "id": "opt_done", "label": "Done", "color": "green", "done": true }] } },
    { "id": "c4000000-0000-4000-8000-000000000002", "ref": "risk.score", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "score", "name": "Score", "type": "number", "position": "a1", "width": 100, "config": {} },
    { "id": "c4000000-0000-4000-8000-000000000003", "ref": "risk.related", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "related", "name": "Related", "type": "link", "position": "a2", "width": 160,
      "config": { "targetSheetId": "c2000000-0000-4000-8000-000000000001", "multiple": true, "inverseFieldId": null } }],
  "views": [],
  "items": [
    { "id": "c6000000-0000-4000-8000-000000000001", "ref": "risk.phishing", "sheet_id": "c2000000-0000-4000-8000-000000000001", "group_id": "c3000000-0000-4000-8000-000000000001",
      "name": "Example: phishing", "position": "a0", "values": { "c4000000-0000-4000-8000-000000000002": 12 } },
    { "id": "c6000000-0000-4000-8000-000000000002", "ref": "risk.flood", "sheet_id": "c2000000-0000-4000-8000-000000000001", "group_id": "c3000000-0000-4000-8000-000000000001",
      "name": "Example: flood", "position": "a1", "values": {} }],
  "links": [],
  "automations": [
    { "id": "c7000000-0000-4000-8000-000000000001", "ref": "notify", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "Created → post",
      "enabled": true, "trigger": { "type": "item_created" }, "conditions": [], "actions": [{ "type": "post_update", "message": "New." }] },
    { "id": "c7000000-0000-4000-8000-000000000002", "ref": "old", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "Old",
      "enabled": true, "trigger": { "type": "item_created" }, "conditions": [], "actions": [{ "type": "post_update", "message": "Old." }] }],
  "dashboards": [{ "id": "c8000000-0000-4000-8000-000000000001", "ref": "overview", "name": "Overview", "position": "a0",
      "config": { "widgets": [{ "id": "w1", "type": "count", "title": "Risks", "sheetId": "c2000000-0000-4000-8000-000000000001" }] } }]
}$j$);
-- 1.0.0 → 1.1.0: rewords, a new option, a new field, a new item linked to an old one, a new automation; the flood
-- example and the dashboard archived, the old automation turned off
insert into plans values ('upgrade', $j${
  "pack": { "key": "pgtap-up", "from_version": "1.0.0", "from_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "version": "1.1.0", "hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  "install": "INSTALL",
  "add": {
    "folders": [], "sheets": [], "groups": [], "views": [], "dashboards": [],
    "fields": [{ "id": "c4000000-0000-4000-8000-000000000009", "ref": "risk.owner", "sheet_id": "c2000000-0000-4000-8000-000000000001", "key": "owner", "name": "Owner", "type": "text", "position": "a3", "width": 140, "config": {} }],
    "items": [{ "id": "c6000000-0000-4000-8000-000000000009", "ref": "risk.ransom", "sheet_id": "c2000000-0000-4000-8000-000000000001", "group_id": "c3000000-0000-4000-8000-000000000001",
                "name": "Example: ransomware", "position": "a2", "values": { "c4000000-0000-4000-8000-000000000009": "IT" } }],
    "links": [{ "field_id": "c4000000-0000-4000-8000-000000000003", "from_item": "c6000000-0000-4000-8000-000000000009", "to_item": "c6000000-0000-4000-8000-000000000001" }],
    "automations": [{ "id": "c7000000-0000-4000-8000-000000000009", "ref": "fresh", "sheet_id": "c2000000-0000-4000-8000-000000000001", "name": "Fresh",
      "enabled": true, "trigger": { "type": "item_created" }, "conditions": [], "actions": [{ "type": "post_update", "message": "Fresh." }] }] },
  "update": {
    "folders": [], "groups": [], "views": [], "dashboards": [],
    "sheets": [{ "id": "c2000000-0000-4000-8000-000000000001", "description": "Risks to information." }],
    "fields": [{ "id": "c4000000-0000-4000-8000-000000000001",
                 "config": { "options": [{ "id": "opt_open", "label": "Open", "color": "blue" }, { "id": "opt_done", "label": "Done", "color": "green", "done": true },
                                         { "id": "opt_accepted", "label": "Accepted", "color": "orange" }] } },
               { "id": "c4000000-0000-4000-8000-000000000002", "name": "Risk score" }],
    "items": [{ "id": "c6000000-0000-4000-8000-000000000001", "name": "Example: phishing email", "values": { "c4000000-0000-4000-8000-000000000002": 15, "c4000000-0000-4000-8000-000000000009": "Security" } }],
    "automations": [{ "id": "c7000000-0000-4000-8000-000000000001", "name": "Created → post an update" }] },
  "archive": { "folders": [], "sheets": [], "items": ["c6000000-0000-4000-8000-000000000002"], "dashboards": ["c8000000-0000-4000-8000-000000000001"] },
  "disable": { "automations": ["c7000000-0000-4000-8000-000000000002"] },
  "summary": { "added": 3, "changed": 5, "archived": 3, "kept": 0, "conflicts": 0, "theirs": 0 }
}$j$);

-- ── grants
select ok(has_function_privilege('authenticated', 'upgrade_pack(uuid, jsonb)', 'execute'),
  'signed-in people can call upgrade_pack (it checks the role)');
select ok(not has_function_privilege('anon', 'upgrade_pack(uuid, jsonb)', 'execute'),
  'signed-out visitors cannot upgrade packs');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select lives_ok($$ select install_pack('c0c0c0c0-0000-0000-0000-000000000000', (select p from plans where name = 'install')) $$,
  'the admin installs 1.0.0');
-- the plan names the install
update plans set p = jsonb_set(p, '{install}', to_jsonb((select id::text from pack_installs where pack_key = 'pgtap-up')))
 where name = 'upgrade';
-- the client turned the kept automation off and wrote their own value on the phishing example
update automations set enabled = false where id = 'c7000000-0000-4000-8000-000000000001';
select lives_ok($$ select set_item_values('c6000000-0000-4000-8000-000000000001', jsonb_build_object('c4000000-0000-4000-8000-000000000001', 'opt_open')) $$,
  'the client sets a value of their own');

-- ── editors cannot upgrade
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select throws_ok($$ select upgrade_pack((select id from pack_installs where pack_key = 'pgtap-up'), (select p from plans where name = 'upgrade')) $$,
  'not allowed: only owners and admins update packs', 'an editor cannot update a pack');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
-- ── refused plans leave nothing behind
select throws_ok($$ select upgrade_pack((select id from pack_installs where pack_key = 'pgtap-up'),
                                         jsonb_set((select p from plans where name = 'upgrade'), '{pack,from_hash}', to_jsonb(repeat('c', 64)))) $$,
  'pack changed: preview the update again', 'a plan made for another installed version is refused');
select throws_ok($$ select upgrade_pack((select id from pack_installs where pack_key = 'pgtap-up'),
                                         jsonb_set((select p from plans where name = 'upgrade'), '{update,fields,0,config,options}', '[{"id":"opt_accepted","label":"Accepted"}]')) $$,
  'upgrade plan: options cannot be removed (Status)', 'an upgrade never removes an option');
select throws_ok($$ select upgrade_pack((select id from pack_installs where pack_key = 'pgtap-up'),
                                         jsonb_set((select p from plans where name = 'upgrade'), '{archive,sheets}', '["c2000000-0000-4000-8000-0000000000ff"]')) $$,
  'upgrade plan: not rows of this install (sheet c2000000-0000-4000-8000-0000000000ff)', 'only the install''s own rows are touched');
select throws_ok($$ select upgrade_pack((select id from pack_installs where pack_key = 'pgtap-up'),
                                         jsonb_set((select p from plans where name = 'upgrade'), '{add,items,0,values}', '{"c4000000-0000-4000-8000-0000000000ff": 1}')) $$,
  'upgrade plan: fields c4000000-0000-4000-8000-0000000000ff cannot hold a value', 'a bad row at the end stops the upgrade');
select is((select version from pack_installs where pack_key = 'pgtap-up'), '1.0.0', 'a failed upgrade leaves the install at its version');
select is((select name from fields where id = 'c4000000-0000-4000-8000-000000000002'), 'Score',
  'a failed upgrade rolls back the updates it made before failing');
select is((select count(*)::int from fields where id = 'c4000000-0000-4000-8000-000000000009'), 0,
  'a failed upgrade rolls back the rows it added');

-- ── the upgrade
select lives_ok($$ select upgrade_pack((select id from pack_installs where pack_key = 'pgtap-up'), (select p from plans where name = 'upgrade')) $$,
  'the admin updates the pack to 1.1.0');
select ok((select version = '1.1.0' and manifest_hash = repeat('b', 64) and ref_map ? 'field:risk.owner'
                  and ref_map ? 'item:risk.ransom' and ref_map ? 'automation:fresh' and ref_map ? 'sheet:risk'
             from pack_installs where pack_key = 'pgtap-up'),
  'the install moves to the new version and its ref map grows');
select ok((select name = 'Risk score' and type = 'number' and pack_hash ~ '^[0-9a-f]{64}$' from fields where id = 'c4000000-0000-4000-8000-000000000002')
          and (select description = 'Risks to information.' from sheets where id = 'c2000000-0000-4000-8000-000000000001')
          and (select jsonb_array_length(config->'options') = 3 from fields where id = 'c4000000-0000-4000-8000-000000000001'),
  'renames, descriptions and new options are applied');
select ok((select pack_install_id is not null and pack_ref = 'risk.owner' from fields where id = 'c4000000-0000-4000-8000-000000000009')
          and (select display_id = 'UPR-003' and pack_ref = 'risk.ransom' from items where id = 'c6000000-0000-4000-8000-000000000009'),
  'added rows carry the install''s provenance and are numbered on');
select ok((select name = 'Example: phishing email'
                  and "values"->>'c4000000-0000-4000-8000-000000000002' = '15'
                  and "values"->>'c4000000-0000-4000-8000-000000000001' = 'opt_open'
                  and "values"->>'c4000000-0000-4000-8000-000000000009' = 'Security'
             from items where id = 'c6000000-0000-4000-8000-000000000001'),
  'an item takes the pack''s changes (a value for a field added in the same update too) and keeps the client''s own values');
select ok((select not enabled and name = 'Created → post an update' from automations where id = 'c7000000-0000-4000-8000-000000000001')
          and (select not enabled from automations where id = 'c7000000-0000-4000-8000-000000000002')
          and (select enabled from automations where id = 'c7000000-0000-4000-8000-000000000009'),
  'the client''s off stays off, a removed automation is turned off, a new one is on');
select ok((select archived_at is not null from items where id = 'c6000000-0000-4000-8000-000000000002')
          and (select archived_at is not null from dashboards where id = 'c8000000-0000-4000-8000-000000000001'),
  'removed objects are archived, not deleted');
select is((select count(*)::int from item_links where field_id = 'c4000000-0000-4000-8000-000000000003'
             and from_item = 'c6000000-0000-4000-8000-000000000009'), 1, 'links of added items are written');
select is((select string_agg(action, ',' order by action) from activity_log
            where org_id = 'c0c0c0c0-0000-0000-0000-000000000000' and note = 'Pack update'),
  'item.archived,item.created,item.renamed,link.changed,value.changed,value.changed', 'every item change is logged on the item''s chain');
select ok((select new_value->>'from_version' = '1.0.0' and new_value->>'version' = '1.1.0'
                  and (new_value->'counts'->'added'->>'fields')::int = 1 and old_value->>'version' = '1.0.0'
             from activity_log where action = 'pack.upgraded' and chain_key = 'sheet:c0c0c0c0-0000-0000-0000-000000000000')
          and (verify_activity_chain('sheet:c0c0c0c0-0000-0000-0000-000000000000')->>'ok')::boolean
          and (verify_activity_chain('c6000000-0000-4000-8000-000000000001')->>'ok')::boolean,
  'pack.upgraded is on the workspace chain and the chains verify');
select throws_ok($$ select upgrade_pack((select id from pack_installs where pack_key = 'pgtap-up'), (select p from plans where name = 'upgrade')) $$,
  'pack changed: preview the update again', 'the same plan cannot run twice');

select * from finish();
rollback;
