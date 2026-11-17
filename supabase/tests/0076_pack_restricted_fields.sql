-- Restricted columns in packs and the publisher's delete guard (0076_pack_restricted_fields.sql; docs/11 Your own
-- packs, owner decisions of 17 Nov 2026): publish carries roles only; install restricts the columns it makes (never
-- with people, never with example values); an update applies a role change, opens a column and moves its values, and
-- keeps the people the workspace listed; a workspace whose pack is installed elsewhere is not deleted.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'rf-consultant@a.test'),
  ('00000000-0000-0000-0000-0000000007b2', 'rf-b-editor@b.test'),
  ('00000000-0000-0000-0000-0000000007b3', 'rf-b-viewer@b.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000007a1', 'Rae Consultant', 'RC'),
  ('00000000-0000-0000-0000-0000000007b2', 'Rob Editor', 'RE'),
  ('00000000-0000-0000-0000-0000000007b3', 'Rita Viewer', 'RV');
insert into orgs (id, name, slug) values
  ('a7a7a7a7-0000-0000-0000-000000000000', 'Practice', 'pgtap-rf-a'),
  ('b7b7b7b7-0000-0000-0000-000000000000', 'Client', 'pgtap-rf-b');
insert into memberships (org_id, user_id, role) values
  ('a7a7a7a7-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000007a1', 'admin'),
  ('b7b7b7b7-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000007a1', 'admin'),
  ('b7b7b7b7-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000007b2', 'editor'),
  ('b7b7b7b7-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000007b3', 'viewer');

create temporary table j (name text primary key, v jsonb);
grant select, update on j to authenticated;
-- a version as the command builds it; p_roles is the Score column's restriction (null: open)
create function pg_temp._pk(p_version text, p_hash text, p_restricted jsonb) returns jsonb language sql as $$
  select jsonb_build_object('key', 'wa7a7a7a7-method', 'version', p_version, 'title', 'Our method', 'description', '',
           'hash', p_hash, 'counts', '{"sheets": 1}'::jsonb, 'left_out', '[]'::jsonb,
           'manifest', jsonb_build_object('key', 'wa7a7a7a7-method', 'version', p_version, 'title', 'Our method',
             'requires', '[]'::jsonb, 'frameworks', '[]'::jsonb, 'automations', '[]'::jsonb, 'dashboards', '[]'::jsonb,
             'sheets', jsonb_build_array(jsonb_build_object('ref', 's_0000000001', 'name', 'Scores', 'items', '[]'::jsonb,
               'fields', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('key', 'score', 'name', 'Score', 'type', 'text',
                                                                            'restrictedTo', p_restricted)))))))
$$;
grant execute on function pg_temp._pk(text, text, jsonb) to authenticated;
insert into j values ('install', $p${
  "pack": { "key": "wa7a7a7a7-method", "version": "1.0.0", "hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
  "folders": [],
  "sheets": [{ "id": "e7000000-0000-4000-8000-000000000001", "ref": "s_0000000001", "folder_id": null, "name": "Scores",
               "item_label": "Score", "id_prefix": "SCR-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "e7100000-0000-4000-8000-000000000001", "ref": "s_0000000001.g_1", "sheet_id": "e7000000-0000-4000-8000-000000000001", "name": "Open", "color": "blue", "position": "a0" }],
  "fields": [{ "id": "e7200000-0000-4000-8000-000000000001", "ref": "s_0000000001.score", "sheet_id": "e7000000-0000-4000-8000-000000000001",
               "key": "score", "name": "Score", "type": "text", "position": "a0", "width": 140, "config": {},
               "restricted_to": { "userIds": [], "roles": ["admin"] } },
             { "id": "e7200000-0000-4000-8000-000000000002", "ref": "s_0000000001.notes", "sheet_id": "e7000000-0000-4000-8000-000000000001",
               "key": "notes", "name": "Notes", "type": "text", "position": "a1", "width": 140, "config": {} }],
  "views": [], "items": [], "links": [], "automations": [], "dashboards": []
}$p$);
-- 1.0.0 → 1.1.0: editors see Score too; a new Pay column only owners see
insert into j values ('up1', $p${
  "pack": { "key": "wa7a7a7a7-method", "from_version": "1.0.0", "from_hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            "version": "1.1.0", "hash": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  "install": "INSTALL",
  "add": { "folders": [], "sheets": [], "groups": [], "views": [], "dashboards": [], "items": [], "links": [], "automations": [],
    "fields": [{ "id": "e7200000-0000-4000-8000-000000000003", "ref": "s_0000000001.pay", "sheet_id": "e7000000-0000-4000-8000-000000000001",
                 "key": "pay", "name": "Pay", "type": "text", "position": "a2", "width": 120, "config": {},
                 "restricted_to": { "userIds": [], "roles": [] } }] },
  "update": { "folders": [], "sheets": [], "groups": [], "views": [], "dashboards": [], "items": [], "automations": [],
    "fields": [{ "id": "e7200000-0000-4000-8000-000000000001", "restricted_to": { "userIds": [], "roles": ["admin", "editor"] } }] },
  "archive": { "folders": [], "sheets": [], "items": [], "dashboards": [] },
  "disable": { "automations": [] },
  "summary": { "added": 1, "changed": 1, "archived": 0, "kept": 0, "conflicts": 0, "theirs": 0 }
}$p$);
-- 1.1.0 → 1.2.0: Score is open again
insert into j values ('up2', $p${
  "pack": { "key": "wa7a7a7a7-method", "from_version": "1.1.0", "from_hash": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            "version": "1.2.0", "hash": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
  "install": "INSTALL",
  "add": { "folders": [], "sheets": [], "groups": [], "views": [], "dashboards": [], "items": [], "links": [], "automations": [], "fields": [] },
  "update": { "folders": [], "sheets": [], "groups": [], "views": [], "dashboards": [], "items": [], "automations": [],
    "fields": [{ "id": "e7200000-0000-4000-8000-000000000001", "restricted_to": null }] },
  "archive": { "folders": [], "sheets": [], "items": [], "dashboards": [] },
  "disable": { "automations": [] },
  "summary": { "added": 0, "changed": 1, "archived": 0, "kept": 0, "conflicts": 0, "theirs": 0 }
}$p$);

select ok(not has_function_privilege('authenticated', '_pack_restrict_field(uuid, jsonb, boolean)', 'execute')
          and not has_function_privilege('service_role', '_pack_restrict_field(uuid, jsonb, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'orgs_publisher_guard()', 'execute'),
  'the helpers are nobody''s');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
-- ── publish: roles, never people
select throws_ok($$ select publish_pack('a7a7a7a7-0000-0000-0000-000000000000',
                     pg_temp._pk('1.0.0', repeat('d', 64), '{"roles": ["admin"], "userIds": ["00000000-0000-0000-0000-0000000007b2"]}')) $$,
  'publish: people belong to a workspace and are never copied', 'a restricted column never carries people');
select throws_ok($$ select publish_pack('a7a7a7a7-0000-0000-0000-000000000000',
                     pg_temp._pk('1.0.0', repeat('d', 64), '{"roles": ["owner"]}')) $$,
  'publish: a restricted column names admin, editor, viewer or auditor', 'owners always see: a pack names the other roles');
select throws_ok($$ select publish_pack('a7a7a7a7-0000-0000-0000-000000000000',
                     pg_temp._pk('1.0.0', repeat('d', 64), '"admin"')) $$,
  'publish: a restricted column names admin, editor, viewer or auditor', 'a restriction is { roles }');
select lives_ok($$ select publish_pack('a7a7a7a7-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64), '{"roles": ["admin"]}')) $$,
  'a pack with a restricted column is published');

-- ── install: the column the plan makes is restricted, never with people or example values
select throws_ok($$ select install_pack('b7b7b7b7-0000-0000-0000-000000000000',
                     jsonb_set((select v from j where name = 'install'), '{fields,0,restricted_to,userIds}',
                               '["00000000-0000-0000-0000-0000000007b2"]')) $$,
  'pack plan: people belong to a workspace and are never copied', 'an install lists nobody on a restricted column');
select throws_ok($$ select install_pack('b7b7b7b7-0000-0000-0000-000000000000',
                     jsonb_set((select v from j where name = 'install'), '{fields,0,restricted_to,roles}', '["owner"]')) $$,
  'pack plan: a restricted column names admin, editor, viewer or auditor', 'an install names only the other roles');
select throws_ok($$ select install_pack('b7b7b7b7-0000-0000-0000-000000000000',
                     jsonb_set((select v from j where name = 'install'), '{items}',
                               '[{"id": "e7300000-0000-4000-8000-000000000009", "ref": "s_0000000001.i_1",
                                  "sheet_id": "e7000000-0000-4000-8000-000000000001", "group_id": "e7100000-0000-4000-8000-000000000001",
                                  "name": "Example", "position": "a0", "values": {"e7200000-0000-4000-8000-000000000001": "42"}}]')) $$,
  'pack plan: a restricted column carries no example values', 'a restricted column has no example values');
select lives_ok($$ select install_pack('b7b7b7b7-0000-0000-0000-000000000000', (select v from j where name = 'install')) $$,
  'the consultant installs the pack in the client''s workspace');
select is((select restricted_to from fields where id = 'e7200000-0000-4000-8000-000000000001'),
  '{"roles": ["admin"], "userIds": []}'::jsonb, 'the column is restricted to the pack''s roles, nobody listed');
select is((select restricted_to from fields where id = 'e7200000-0000-4000-8000-000000000002'), null,
  'an open column stays open');
select is((select note || ' ' || (new_value->'roles')::text from activity_log
            where org_id = 'b7b7b7b7-0000-0000-0000-000000000000' and action = 'field.restricted'
              and new_value->>'field_id' = 'e7200000-0000-4000-8000-000000000001'),
  'Score ["admin"]', 'field.restricted is logged on the sheet chain');

-- a value written later lives in the store
reset role;
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position, values) values
  ('e7300000-0000-4000-8000-000000000001', 'b7b7b7b7-0000-0000-0000-000000000000', 'e7000000-0000-4000-8000-000000000001',
   'e7100000-0000-4000-8000-000000000001', 1, 'SCR-001', 'Acme', 'a0', '{"e7200000-0000-4000-8000-000000000001": "secret"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007b2","role":"authenticated"}', true);
select ok(not field_visible('e7200000-0000-4000-8000-000000000001')
          and (select count(*) from restricted_values where field_id = 'e7200000-0000-4000-8000-000000000001') = 0
          and (select "values" from items where id = 'e7300000-0000-4000-8000-000000000001') = '{}'::jsonb,
  'an editor of the client neither sees the column nor its value');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
select is((select value #>> '{}' from restricted_values where field_id = 'e7200000-0000-4000-8000-000000000001'), 'secret',
  'an admin of the client sees it');

-- ── updates
update j set v = jsonb_set(v, '{install}', to_jsonb((select id::text from pack_installs
                                                      where pack_key = 'wa7a7a7a7-method' and org_id = 'b7b7b7b7-0000-0000-0000-000000000000')))
 where name in ('up1', 'up2');
select lives_ok($$ select publish_pack('a7a7a7a7-0000-0000-0000-000000000000', pg_temp._pk('1.1.0', repeat('e', 64), '{"roles": ["admin", "editor"]}')) $$,
  'the practice publishes 1.1.0');
select throws_ok($$ select upgrade_pack((select (v->>'install')::uuid from j where name = 'up1'),
                     jsonb_set((select v from j where name = 'up1'), '{update,fields,0,restricted_to,userIds}',
                               '["00000000-0000-0000-0000-0000000007b2"]')) $$,
  'pack plan: people belong to a workspace and are never copied', 'an update never lists a new person');
select lives_ok($$ select upgrade_pack((select (v->>'install')::uuid from j where name = 'up1'), (select v from j where name = 'up1')) $$,
  'the client admin takes 1.1.0');
select is((select restricted_to from fields where id = 'e7200000-0000-4000-8000-000000000001'),
  '{"roles": ["admin", "editor"], "userIds": []}'::jsonb, 'the role change is applied');
select is((select restricted_to from fields where id = 'e7200000-0000-4000-8000-000000000003'),
  '{"roles": [], "userIds": []}'::jsonb, 'a column the update adds is restricted too');
select is((select count(*)::int from activity_log where org_id = 'b7b7b7b7-0000-0000-0000-000000000000'
             and action = 'field.restriction_changed' and new_value->>'field_id' = 'e7200000-0000-4000-8000-000000000001'),
  1, 'field.restriction_changed is logged');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007b2","role":"authenticated"}', true);
select is((select value #>> '{}' from restricted_values where field_id = 'e7200000-0000-4000-8000-000000000001'), 'secret',
  'the editor now sees the value');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007b3","role":"authenticated"}', true);
select ok(not field_visible('e7200000-0000-4000-8000-000000000001'), 'a viewer still does not');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
select lives_ok($$ select publish_pack('a7a7a7a7-0000-0000-0000-000000000000', pg_temp._pk('1.2.0', repeat('f', 64), null)) $$,
  'the practice publishes 1.2.0 with the column open');
select lives_ok($$ select upgrade_pack((select (v->>'install')::uuid from j where name = 'up2'), (select v from j where name = 'up2')) $$,
  'the client admin takes 1.2.0');
reset role;
select ok((select restricted_to from fields where id = 'e7200000-0000-4000-8000-000000000001') is null
          and (select "values"->>'e7200000-0000-4000-8000-000000000001' from items where id = 'e7300000-0000-4000-8000-000000000001') = 'secret'
          and not exists (select 1 from restricted_values where field_id = 'e7200000-0000-4000-8000-000000000001')
          and exists (select 1 from activity_log where action = 'field.unrestricted'
                       and new_value is null and old_value->>'field_id' = 'e7200000-0000-4000-8000-000000000001'),
  'opening the column moves its values back into the rows and logs field.unrestricted');

-- ── the publisher is not deleted while its pack is installed elsewhere
select throws_ok($$ delete from orgs where id = 'a7a7a7a7-0000-0000-0000-000000000000' $$, '23503',
  'This workspace published packs that 1 other workspace has installed (Our method). It cannot be deleted while they are installed there.',
  'deleting the publisher says why it cannot be done');

select * from finish();
rollback;
