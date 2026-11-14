-- Approval workflows in extends and tab sets in upgrades (0044_extension_workflows.sql, docs/11 Extends, Upgrades): an
-- add-on adds approval workflows (ids in its namespace) to a sheet of a pack it requires, merged by id; only workflows
-- its manifest ships there, only onto required packs' sheets; its upgrade changes only its own entries there; the
-- required pack's upgrade writes its own sheet's tab set (views of that sheet only); archiving the add-on takes its
-- workflows back and leaves the sheet's own. Internal helpers are not granted. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'ew-admin@a.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'ew-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000e1', 'Ew Admin', 'EA'),
  ('00000000-0000-0000-0000-0000000000e2', 'Ew Editor', 'EE');
insert into orgs (id, name, slug) values ('e0e0e0e0-0000-0000-0000-000000000000', 'Org E', 'pgtap-ext-wf');
insert into memberships (org_id, user_id, role) values
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'admin'),
  ('e0e0e0e0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e2', 'editor');
insert into packs (key, version, title, manifest, hash) values
  ('pgtap-core2', '1.0.0', 'Core', '{"system": true}', repeat('1', 64)),
  ('pgtap-core2', '1.1.0', 'Core', '{"system": true}', repeat('2', 64)),
  ('pgtap-addon2', '1.0.0', 'Add-on',
   '{"requires": [{"pack": "pgtap-core2", "range": "^1.0.0"}], "extends": [{"pack": "pgtap-core2", "sheet": "risk", "workflows": [{"id": "pgtapaddon2_sign_off"}]}]}',
   repeat('3', 64)),
  ('pgtap-addon2', '1.1.0', 'Add-on',
   '{"requires": [{"pack": "pgtap-core2", "range": "^1.0.0"}], "extends": [{"pack": "pgtap-core2", "sheet": "risk", "workflows": [{"id": "pgtapaddon2_sign_off"}]}]}',
   repeat('4', 64)),
  ('pgtap-rogue2', '1.0.0', 'Rogue', '{"requires": [], "extends": [{"pack": "pgtap-core2", "sheet": "risk", "workflows": [{"id": "pgtaprogue2_x"}]}]}', repeat('5', 64));

create temporary table plans (name text primary key, p jsonb);
grant select on plans to authenticated;
insert into plans values ('core', $j${
  "pack": { "key": "pgtap-core2", "version": "1.0.0", "hash": "1111111111111111111111111111111111111111111111111111111111111111" },
  "folders": [],
  "sheets": [
    { "id": "e2000000-0000-4000-8000-000000000001", "ref": "risk", "name": "Risk register", "item_label": "Risk", "id_prefix": "ER-", "position": "a0",
      "settings": { "system": true, "workflows": [{ "id": "risk-acceptance", "name": "Risk acceptance", "enabled": true,
        "steps": [{ "id": "owner", "name": "Owner", "approvers": { "kind": "jobRole", "roleName": "Top management" }, "mode": "any", "onReject": { "to": "draft" } }] }] } },
    { "id": "e2000000-0000-4000-8000-000000000002", "ref": "other", "name": "Other", "item_label": "Thing", "id_prefix": "EO-", "position": "a1", "settings": {} }
  ],
  "groups": [{ "id": "e3000000-0000-4000-8000-000000000001", "ref": "risk.open", "sheet_id": "e2000000-0000-4000-8000-000000000001", "name": "Open", "color": "blue", "position": "a0" }],
  "fields": [{ "id": "e4000000-0000-4000-8000-000000000001", "ref": "risk.score", "sheet_id": "e2000000-0000-4000-8000-000000000001", "key": "score", "name": "Score", "type": "number", "position": "a0", "width": 96, "config": {}, "system": true }],
  "views": [
    { "id": "e5000000-0000-4000-8000-000000000001", "ref": "risk.view.1", "sheet_id": "e2000000-0000-4000-8000-000000000001", "name": "By status", "type": "kanban", "position": "a0", "config": {} },
    { "id": "e5000000-0000-4000-8000-000000000002", "ref": "other.view.1", "sheet_id": "e2000000-0000-4000-8000-000000000002", "name": "Elsewhere", "type": "kanban", "position": "a0", "config": {} }
  ],
  "items": [], "links": [], "automations": [], "dashboards": []
}$j$), ('addon', $j${
  "pack": { "key": "pgtap-addon2", "version": "1.0.0", "hash": "3333333333333333333333333333333333333333333333333333333333333333" },
  "folders": [], "sheets": [], "groups": [], "fields": [], "views": [], "items": [], "links": [], "automations": [], "dashboards": [],
  "workflows": [{ "ref": "pgtap-core2:risk.workflow.pgtapaddon2_sign_off", "sheet_id": "e2000000-0000-4000-8000-000000000001",
    "workflow": { "id": "pgtapaddon2_sign_off", "name": "Sign-off", "enabled": true,
      "steps": [{ "id": "manager", "name": "Manager", "approvers": { "kind": "jobRole", "roleName": "Manager" }, "mode": "any", "onReject": { "to": "draft" } }] } }]
}$j$), ('rogue', $j${
  "pack": { "key": "pgtap-rogue2", "version": "1.0.0", "hash": "5555555555555555555555555555555555555555555555555555555555555555" },
  "folders": [], "sheets": [], "groups": [], "fields": [], "views": [], "items": [], "links": [], "automations": [], "dashboards": [],
  "workflows": [{ "ref": "pgtap-core2:risk.workflow.pgtaprogue2_x", "sheet_id": "e2000000-0000-4000-8000-000000000001",
    "workflow": { "id": "pgtaprogue2_x", "name": "Rogue", "enabled": true,
      "steps": [{ "id": "s", "name": "S", "approvers": { "kind": "jobRole", "roleName": "X" }, "mode": "any", "onReject": { "to": "draft" } }] } }]
}$j$), ('empty-up', $j${
  "install": "",
  "add": { "folders": [], "sheets": [], "fields": [], "groups": [], "views": [], "items": [], "links": [], "automations": [], "dashboards": [], "options": [] },
  "update": { "folders": [], "sheets": [], "fields": [], "groups": [], "views": [], "items": [], "automations": [], "dashboards": [] },
  "archive": { "folders": [], "sheets": [], "items": [], "dashboards": [] },
  "disable": { "automations": [] },
  "summary": { "added": 0, "changed": 1, "archived": 0, "kept": 0, "conflicts": 0, "theirs": 0 }
}$j$);

-- an upgrade plan for an install: the pack versions, the install id and the update lists given
create function pg_temp.up(p_key text, p_from text, p_from_hash text, p_to text, p_hash text, p_update jsonb) returns jsonb
language sql as $$
  select (select p from plans where name = 'empty-up')
    || jsonb_build_object(
         'pack', jsonb_build_object('key', p_key, 'from_version', p_from, 'from_hash', p_from_hash, 'version', p_to, 'hash', p_hash),
         'install', (select id::text from pack_installs where pack_key = p_key and status = 'installed'
                        and org_id = 'e0e0e0e0-0000-0000-0000-000000000000'))
    || jsonb_build_object('update', (select p->'update' from plans where name = 'empty-up') || p_update)
$$;
create function pg_temp.flow_ids(p_sheet uuid) returns text[] language sql as $$
  select coalesce(array_agg(w->>'id' order by o), '{}')
    from sheets s, jsonb_array_elements(s.settings->'workflows') with ordinality as a(w, o) where s.id = p_sheet
$$;
grant execute on function pg_temp.up(text, text, text, text, text, jsonb), pg_temp.flow_ids(uuid) to authenticated;

-- internal helpers are never granted; the RPCs are
select ok(not has_function_privilege('authenticated', '_install_pack_rows(uuid, jsonb)', 'execute'),
  'the install''s row writer is not callable');
select ok(not has_function_privilege('authenticated', '_archive_pack_rows(uuid)', 'execute'),
  'the archive''s row writer is not callable');
select ok(not has_function_privilege('authenticated', '_pack_owns_workflow(text, text)', 'execute'),
  'the namespace helper is not callable');
select ok(has_function_privilege('authenticated', 'install_pack(uuid, jsonb)', 'execute')
      and has_function_privilege('authenticated', 'apply_pack_upgrade(uuid, jsonb)', 'execute')
      and has_function_privilege('authenticated', 'archive_pack(uuid)', 'execute'),
  'install_pack, apply_pack_upgrade and archive_pack are granted to authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select lives_ok($$ select install_pack('e0e0e0e0-0000-0000-0000-000000000000', (select p from plans where name = 'core')) $$,
  'an admin installs the core pack with its sheet''s own workflow');

-- install: only workflows the manifest ships, in the pack's namespace, onto a required pack's sheet
select throws_ok($$ select install_pack('e0e0e0e0-0000-0000-0000-000000000000',
    jsonb_set((select p from plans where name = 'addon'), '{workflows,0,workflow,id}', '"sign_off"')) $$,
  'pack plan: an approval workflow on another pack''s sheet needs an id in the pack''s namespace',
  'a workflow id outside the namespace is refused');
select throws_ok($$ select install_pack('e0e0e0e0-0000-0000-0000-000000000000',
    jsonb_set((select p from plans where name = 'addon'), '{workflows,0,workflow,id}', '"pgtapaddon2_other"')) $$,
  'pack plan: the pack does not ship the approval workflow pgtapaddon2_other on this sheet',
  'a workflow the manifest does not ship there is refused');
select throws_ok($$ select install_pack('e0e0e0e0-0000-0000-0000-000000000000', (select p from plans where name = 'rogue')) $$,
  'pack plan: approval workflows go on a sheet of a pack this one requires',
  'a pack cannot add workflows to a pack it does not require');
select lives_ok($$ select install_pack('e0e0e0e0-0000-0000-0000-000000000000', (select p from plans where name = 'addon')) $$,
  'the add-on installs its workflow onto the core sheet');
select is(pg_temp.flow_ids('e2000000-0000-4000-8000-000000000001'), array['risk-acceptance', 'pgtapaddon2_sign_off'],
  'the workflow is appended after the sheet''s own');

-- upgrade of the add-on: its own entries may change on the core sheet, nothing else
select throws_ok($$ select apply_pack_upgrade(
    (select id from pack_installs where pack_key = 'pgtap-addon2' and status = 'installed'),
    pg_temp.up('pgtap-addon2', '1.0.0', repeat('3', 64), '1.1.0', repeat('4', 64), jsonb_build_object('workflows', jsonb_build_array(
      jsonb_build_object('sheet_id', 'e2000000-0000-4000-8000-000000000001', 'workflows',
        (select settings->'workflows' from sheets where id = 'e2000000-0000-4000-8000-000000000001')
        #- '{0}'))))) $$,
  'upgrade plan: on another pack''s sheet only the pack''s own approval workflows change',
  'an add-on''s upgrade cannot drop the sheet''s own workflow');
select lives_ok($$ select apply_pack_upgrade(
    (select id from pack_installs where pack_key = 'pgtap-addon2' and status = 'installed'),
    pg_temp.up('pgtap-addon2', '1.0.0', repeat('3', 64), '1.1.0', repeat('4', 64), jsonb_build_object('workflows', jsonb_build_array(
      jsonb_build_object('sheet_id', 'e2000000-0000-4000-8000-000000000001', 'workflows',
        jsonb_set((select settings->'workflows' from sheets where id = 'e2000000-0000-4000-8000-000000000001'),
                  '{1,name}', '"Environmental sign-off"')))))) $$,
  'an add-on''s upgrade changes its own workflow on the core sheet');
select is((select w->>'name' from sheets s, jsonb_array_elements(s.settings->'workflows') w
            where s.id = 'e2000000-0000-4000-8000-000000000001' and w->>'id' = 'pgtapaddon2_sign_off'),
  'Environmental sign-off', 'its workflow is updated, in place');

-- upgrade of the core: the tab set of its own sheet, views of that sheet only
select throws_ok($$ select apply_pack_upgrade(
    (select id from pack_installs where pack_key = 'pgtap-core2' and status = 'installed'),
    pg_temp.up('pgtap-core2', '1.0.0', repeat('1', 64), '1.1.0', repeat('2', 64), jsonb_build_object('tabs', jsonb_build_array(
      jsonb_build_object('sheet_id', 'e2000000-0000-4000-8000-000000000001',
        'tabs', '[{"id": "table"}, {"id": "e5000000-0000-4000-8000-000000000002"}]'::jsonb, 'tabsDefault', null, 'defaultViewId', null))))) $$,
  'upgrade plan: a tab names a view of another sheet', 'a tab set cannot name another sheet''s view');
select lives_ok($$ select apply_pack_upgrade(
    (select id from pack_installs where pack_key = 'pgtap-core2' and status = 'installed'),
    pg_temp.up('pgtap-core2', '1.0.0', repeat('1', 64), '1.1.0', repeat('2', 64), jsonb_build_object('tabs', jsonb_build_array(
      jsonb_build_object('sheet_id', 'e2000000-0000-4000-8000-000000000001',
        'tabs', '[{"id": "table"}, {"id": "e5000000-0000-4000-8000-000000000001"}, {"id": "insights", "hidden": true}]'::jsonb,
        'tabsDefault', null, 'defaultViewId', 'e5000000-0000-4000-8000-000000000001'))))) $$,
  'the core''s upgrade writes its sheet''s tab set');
select is((select jsonb_build_array(settings->'tabs', settings->'tabsDefault', settings->'defaultViewId')
             from sheets where id = 'e2000000-0000-4000-8000-000000000001'),
  jsonb_build_array('[{"id": "table"}, {"id": "e5000000-0000-4000-8000-000000000001"}, {"id": "insights", "hidden": true}]'::jsonb,
                    '[{"id": "table"}, {"id": "e5000000-0000-4000-8000-000000000001"}, {"id": "insights", "hidden": true}]'::jsonb,
                    '"e5000000-0000-4000-8000-000000000001"'::jsonb),
  'tabs, the shipped default and the view that opens first are stored');
select is(pg_temp.flow_ids('e2000000-0000-4000-8000-000000000001'), array['risk-acceptance', 'pgtapaddon2_sign_off'],
  'the add-on''s workflow is still there after the core''s upgrade');

-- an editor cannot install or upgrade
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select throws_ok($$ select archive_pack((select id from pack_installs where pack_key = 'pgtap-addon2' and status = 'installed')) $$,
  'not allowed: only owners and admins archive packs', 'an editor cannot archive the add-on');

-- archive: the add-on's workflows leave the core sheet, the sheet's own stays
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select lives_ok($$ select archive_pack((select id from pack_installs where pack_key = 'pgtap-addon2' and status = 'installed')) $$,
  'the add-on is archived');
select is(pg_temp.flow_ids('e2000000-0000-4000-8000-000000000001'), array['risk-acceptance'],
  'its workflow is taken off the core sheet; the sheet''s own stays');

select * from finish();
rollback;
