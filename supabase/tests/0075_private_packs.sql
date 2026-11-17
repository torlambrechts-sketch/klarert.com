-- A workspace's own packs (0075_private_packs.sql, docs/11 Your own packs): publish (owners and admins, the safety
-- rules, versions written once and higher), visibility between workspaces, the first install needing an owner or admin
-- of both workspaces (which shares the pack), updates by any admin of the target after that, withdraw (no new installs,
-- installed copies keep working), an own framework shared with the pack, every log entry, and shares nobody can change.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(48);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009a1', 'pp-consultant@a.test'),
  ('00000000-0000-0000-0000-0000000009a2', 'pp-a-editor@a.test'),
  ('00000000-0000-0000-0000-0000000009b1', 'pp-client-admin@b.test'),
  ('00000000-0000-0000-0000-0000000009b2', 'pp-b-editor@b.test'),
  ('00000000-0000-0000-0000-0000000009c1', 'pp-c-admin@c.test'),
  ('00000000-0000-0000-0000-0000000009c2', 'pp-ac-admin@c.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000009a1', 'Cora Consultant', 'CC'),
  ('00000000-0000-0000-0000-0000000009a2', 'Ed Editor', 'EE'),
  ('00000000-0000-0000-0000-0000000009b1', 'Bo Client', 'BC'),
  ('00000000-0000-0000-0000-0000000009b2', 'Bea Editor', 'BE'),
  ('00000000-0000-0000-0000-0000000009c1', 'Cy Admin', 'CA'),
  ('00000000-0000-0000-0000-0000000009c2', 'Ace Admin', 'AA');
insert into orgs (id, name, slug) values
  ('a9a9a9a9-0000-0000-0000-000000000000', 'Practice', 'pgtap-pp-a'),
  ('b9b9b9b9-0000-0000-0000-000000000000', 'Client B', 'pgtap-pp-b'),
  ('c9c9c9c9-0000-0000-0000-000000000000', 'Client C', 'pgtap-pp-c');
insert into memberships (org_id, user_id, role) values
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009a1', 'admin'),
  ('b9b9b9b9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009a1', 'admin'),
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009a2', 'editor'),
  ('b9b9b9b9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009a2', 'admin'),
  ('b9b9b9b9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009b1', 'admin'),
  ('b9b9b9b9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009b2', 'editor'),
  ('c9c9c9c9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009c1', 'admin'),
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009c2', 'admin'),
  ('c9c9c9c9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000009c2', 'admin');

-- the practice's own framework, which the pack lists (written as publish_framework writes it)
select set_config('app.framework_op', 'on', true);
insert into packs (key, version, title, manifest, hash, owner_org_id)
values ('framework-wa9a9a9a9-method', '1.1.0', 'Method', '{}', repeat('9', 64), 'a9a9a9a9-0000-0000-0000-000000000000');
insert into frameworks (key, version, title, short_title, publisher, kind, source, licence, url, pack_key, pack_version, hash, titles, org_id)
values ('wa9a9a9a9-method', '1', 'Method controls', 'MC', 'Practice', 'internal', 'Practice', 'Provided by Practice. Owned by Practice.',
        null, 'framework-wa9a9a9a9-method', '1.1.0', repeat('9', 64), 'customer', 'a9a9a9a9-0000-0000-0000-000000000000');
insert into requirements (framework_key, framework_version, ref, parent_ref, kind, position, title, org_id) values
  ('wa9a9a9a9-method', '1', 'G', null, 'theme', 0, 'Group', 'a9a9a9a9-0000-0000-0000-000000000000'),
  ('wa9a9a9a9-method', '1', '1', 'G', 'clause', 1, 'Review access', 'a9a9a9a9-0000-0000-0000-000000000000');
select set_config('app.framework_op', '', true);

create temporary table j (name text primary key, v jsonb);
grant select, update on j to authenticated;
-- a manifest as the command builds it (the safety rules met); p_extra changes it for the refusals
create function pg_temp._pk(p_version text, p_hash text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('key', 'wa9a9a9a9-method', 'version', p_version, 'title', 'Our method', 'description', 'How we work.',
           'hash', p_hash, 'counts', jsonb_build_object('sheets', 1, 'automations', 1),
           'left_out', '[{"kind": "webhook", "text": "Automation Escalate: the webhook address. Add the address after install."}]'::jsonb,
           'manifest', jsonb_build_object('key', 'wa9a9a9a9-method', 'version', p_version, 'title', 'Our method',
             'requires', '[]'::jsonb, 'frameworks', '[{"key": "wa9a9a9a9-method", "version": "1"}]'::jsonb,
             'sheets', '[{"ref": "s_0000000001", "name": "Findings", "items": [], "restricted": true, "personalData": true}]'::jsonb,
             'automations', '[{"ref": "a_0000000001", "sheet": "s_0000000001", "startInTestMode": true,
                                "actions": [{"type": "notify", "to": ["jobRole:Quality lead"]}]}]'::jsonb,
             'dashboards', '[]'::jsonb) || p_extra)
$$;
grant execute on function pg_temp._pk(text, text, jsonb) to authenticated;
-- the install plan of 1.0.0 (as the planner makes it)
insert into j values ('install', $p${
  "pack": { "key": "wa9a9a9a9-method", "version": "1.0.0", "hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
  "folders": [],
  "sheets": [{ "id": "d2000000-0000-4000-8000-000000000001", "ref": "s_0000000001", "folder_id": null, "name": "Findings",
               "item_label": "Finding", "id_prefix": "FND-", "settings": {}, "position": "a0" }],
  "groups": [{ "id": "d3000000-0000-4000-8000-000000000001", "ref": "s_0000000001.g_0000000001", "sheet_id": "d2000000-0000-4000-8000-000000000001", "name": "Open", "color": "blue", "position": "a0" }],
  "fields": [{ "id": "d4000000-0000-4000-8000-000000000001", "ref": "s_0000000001.status", "sheet_id": "d2000000-0000-4000-8000-000000000001", "key": "status", "name": "Status", "type": "text", "position": "a0", "width": 140, "config": {} }],
  "views": [], "items": [], "links": [], "automations": [], "dashboards": []
}$p$);
-- the update 1.0.0 → 1.1.0: one new field
insert into j values ('upgrade', $p${
  "pack": { "key": "wa9a9a9a9-method", "from_version": "1.0.0", "from_hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            "version": "1.1.0", "hash": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  "install": "INSTALL",
  "add": { "folders": [], "sheets": [], "groups": [], "views": [], "dashboards": [], "items": [], "links": [], "automations": [],
    "fields": [{ "id": "d4000000-0000-4000-8000-000000000002", "ref": "s_0000000001.due", "sheet_id": "d2000000-0000-4000-8000-000000000001", "key": "due", "name": "Due", "type": "date", "position": "a1", "width": 120, "config": {} }] },
  "update": { "folders": [], "sheets": [], "groups": [], "views": [], "dashboards": [], "fields": [], "items": [], "automations": [] },
  "archive": { "folders": [], "sheets": [], "items": [], "dashboards": [] },
  "disable": { "automations": [] },
  "summary": { "added": 1, "changed": 0, "archived": 0, "kept": 0, "conflicts": 0, "theirs": 0 }
}$p$);

-- ── grants
select ok(has_function_privilege('authenticated', 'publish_pack(uuid, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'withdraw_pack(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'publish_pack(uuid, jsonb)', 'execute')
          and not has_function_privilege('anon', 'withdraw_pack(uuid, text)', 'execute')
          and not has_function_privilege('authenticated', '_private_access(packs, uuid)', 'execute')
          and not has_function_privilege('authenticated', '_framework_access(frameworks, uuid)', 'execute')
          and not has_function_privilege('authenticated', '_semver(text)', 'execute'),
  'signed-in people call the RPCs (they check the role); visitors cannot; the helpers are nobody''s');

set local role authenticated;
-- ── publishing: owners and admins of the publisher, the safety rules, versions once and higher
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a2","role":"authenticated"}', true);
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64))) $$,
  'not allowed: only owners and admins publish packs', 'an editor cannot publish');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
select throws_ok($$ select publish_pack('b9b9b9b9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64))) $$,
  'publish: the key is not this workspace''s', 'a pack key carries its publisher''s prefix');
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64),
                     '{"sheets": [{"ref": "s_0000000001", "items": [{"ref": "x", "name": "Acme Ltd"}]}]}')) $$,
  'publish: example items come later', 'no example items are published');
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64),
                     '{"automations": [{"ref": "a", "sheet": "s_0000000001", "actions": [{"type": "notify"}]}]}')) $$,
  'publish: every automation starts in test mode', 'automations start in test mode');
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64),
                     '{"extends": [{"pack": "core", "sheet": "risk", "automations": [{"ref": "a", "startInTestMode": true, "actions": [{"type": "webhook"}]}]}]}')) $$,
  'publish: an automation sends outside the workspace', 'no outbound action is published');
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64),
                     '{"sheets": [{"ref": "s_0000000001", "items": [], "personalData": true, "restricted": false}]}')) $$,
  'publish: a sheet with personal data installs restricted', 'personal-data sheets stay restricted');
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64),
                     '{"automations": [{"ref": "a", "sheet": "s_0000000001", "startInTestMode": true,
                       "actions": [{"type": "notify", "to": ["user:00000000-0000-0000-0000-0000000009b1"]}]}]}')) $$,
  'publish: people belong to a workspace and are never copied', 'user ids are never published');
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64),
                     '{"requires": [{"pack": "wb9b9b9b9-other", "range": "^1.0.0"}]}')) $$,
  'publish: it requires packs that are not ours: wb9b9b9b9-other', 'a private pack builds only on our catalogue');
select lives_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64))) $$,
  'an admin publishes 1.0.0');
select is((select owner_org_id::text || ' ' || published_by::text || ' ' || (withdrawn_at is null)::text
             from packs where key = 'wa9a9a9a9-method' and version = '1.0.0'),
  'a9a9a9a9-0000-0000-0000-000000000000 00000000-0000-0000-0000-0000000009a1 true', 'the publisher and who published');
select is((select new_value->>'version' || ' ' || (new_value->>'hash' = repeat('d', 64))::text || ' '
                  || (new_value->'counts'->>'sheets') || ' ' || (new_value->'left_out'->0->>'kind')
             from activity_log where org_id = 'a9a9a9a9-0000-0000-0000-000000000000' and action = 'pack.published'),
  '1.0.0 true 1 webhook', 'pack.published names the version, hash, counts and what was left out');
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.0.0', repeat('d', 64))) $$,
  'publish: version 1.0.0 is not higher than 1.0.0', 'a version is written once');
select throws_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('0.9.0', repeat('d', 64))) $$,
  'publish: version 0.9.0 is not higher than 1.0.0', 'versions only go up');
select throws_ok($$ update packs set title = 'Changed' where key = 'wa9a9a9a9-method' $$,
  '42501', null, 'nobody updates a pack through the API');

-- ── another workspace: nothing without a share
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009b1","role":"authenticated"}', true);
select is((select count(*)::int from packs where key = 'wa9a9a9a9-method'), 0, 'a client admin cannot read the private pack');
select is((select count(*)::int from frameworks where key = 'wa9a9a9a9-method'), 0, 'nor the framework it lists');
select throws_ok($$ select install_pack('b9b9b9b9-0000-0000-0000-000000000000', (select v from j where name = 'install')) $$,
  'pack not found', 'a client admin cannot install it');
select throws_ok($$ select adopt_framework('b9b9b9b9-0000-0000-0000-000000000000', 'wa9a9a9a9-method', '1',
                     '{"pack": {"key": "framework-wa9a9a9a9-method", "version": "1.1.0"}}') $$,
  'framework not found', 'nor adopt the framework it lists');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a2","role":"authenticated"}', true);
select is((select count(*)::int from packs where key = 'wa9a9a9a9-method'), 1, 'a member of the publisher reads it');
select throws_ok($$ select install_pack('b9b9b9b9-0000-0000-0000-000000000000', (select v from j where name = 'install')) $$,
  'not allowed: the first install needs an owner or admin of both workspaces', 'an editor of the publisher cannot share it');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009b2","role":"authenticated"}', true);
select throws_ok($$ select install_pack('b9b9b9b9-0000-0000-0000-000000000000', (select v from j where name = 'install')) $$,
  'pack not found', 'an editor of the target cannot install it');

-- ── the first install: owner or admin of both workspaces; it shares the pack
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
select lives_ok($$ select install_pack('b9b9b9b9-0000-0000-0000-000000000000', (select v from j where name = 'install')) $$,
  'the consultant, admin in both, installs it in the client''s workspace');
select is((select granted_by::text from pack_shares where pack_key = 'wa9a9a9a9-method' and org_id = 'b9b9b9b9-0000-0000-0000-000000000000'),
  '00000000-0000-0000-0000-0000000009a1', 'the install wrote the share');
select is((select new_value->>'source' || ' ' || (new_value->>'publisher_org_id')
             from activity_log where org_id = 'b9b9b9b9-0000-0000-0000-000000000000' and action = 'pack.installed'
               and new_value->>'pack_key' = 'wa9a9a9a9-method'),
  'private a9a9a9a9-0000-0000-0000-000000000000', 'pack.installed on the target says private and names the publisher');
select is((select new_value->>'org_id' || ' ' || (new_value->>'version')
             from activity_log where org_id = 'a9a9a9a9-0000-0000-0000-000000000000' and action = 'pack.shared'),
  'b9b9b9b9-0000-0000-0000-000000000000 1.0.0', 'pack.shared on the publisher''s chain names the workspace');
update j set v = jsonb_set(v, '{install}', to_jsonb((select id::text from pack_installs
                                                      where pack_key = 'wa9a9a9a9-method' and org_id = 'b9b9b9b9-0000-0000-0000-000000000000')))
 where name = 'upgrade';
select lives_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.1.0', repeat('e', 64))) $$,
  'the practice publishes 1.1.0');

-- ── after the share: any admin of the target reads and updates; editors do not
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009b1","role":"authenticated"}', true);
select is((select count(*)::int from packs where key = 'wa9a9a9a9-method'), 2, 'the client admin reads every version');
select is((select count(*)::int from pack_shares where pack_key = 'wa9a9a9a9-method'), 1, 'and the share of their workspace');
select is((select count(*)::int from frameworks where key = 'wa9a9a9a9-method'), 1, 'the framework the pack lists is shared with it');
select is((select count(*)::int from requirements where framework_key = 'wa9a9a9a9-method'), 2, 'with its requirements');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009b2","role":"authenticated"}', true);
select throws_ok($$ select upgrade_pack((select (v->>'install')::uuid from j where name = 'upgrade'), (select v from j where name = 'upgrade')) $$,
  'not allowed: only owners and admins update packs', 'an editor of the target cannot update it');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009b1","role":"authenticated"}', true);
select lives_ok($$ select upgrade_pack((select (v->>'install')::uuid from j where name = 'upgrade'), (select v from j where name = 'upgrade')) $$,
  'the client admin, not in the publisher, takes the update');
select is((select new_value->>'source' || ' ' || (new_value->>'version')
             from activity_log where org_id = 'b9b9b9b9-0000-0000-0000-000000000000' and action = 'pack.upgraded'
               and new_value->>'pack_key' = 'wa9a9a9a9-method'),
  'private 1.1.0', 'pack.upgraded on the target says private');

-- ── a workspace without a share cannot update to it (an install row written behind the API's back)
reset role;
insert into pack_installs (org_id, pack_key, version, manifest_hash, ref_map)
values ('c9c9c9c9-0000-0000-0000-000000000000', 'wa9a9a9a9-method', '1.0.0', repeat('d', 64), '{}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
select is((select count(*)::int from packs where key = 'wa9a9a9a9-method'), 0, 'workspace C cannot read the pack');
select throws_ok($$ select upgrade_pack((select id from pack_installs where org_id = 'c9c9c9c9-0000-0000-0000-000000000000'),
                     jsonb_set((select v from j where name = 'upgrade'), '{install}',
                       to_jsonb((select id::text from pack_installs where org_id = 'c9c9c9c9-0000-0000-0000-000000000000')))) $$,
  'pack version not found', 'nor update to it without a share');

-- ── withdraw: no new installs; installed copies keep taking updates
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a2","role":"authenticated"}', true);
select throws_ok($$ select withdraw_pack('a9a9a9a9-0000-0000-0000-000000000000', 'wa9a9a9a9-method') $$,
  'not allowed: only owners and admins withdraw packs', 'an editor cannot withdraw');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
select lives_ok($$ select withdraw_pack('a9a9a9a9-0000-0000-0000-000000000000', 'wa9a9a9a9-method') $$, 'the practice withdraws it');
select is((select new_value->>'versions' || ' ' || (new_value->>'shared_with')
             from activity_log where org_id = 'a9a9a9a9-0000-0000-0000-000000000000' and action = 'pack.withdrawn'),
  '2 1', 'pack.withdrawn names the versions and how many workspaces have it');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c2","role":"authenticated"}', true);
select throws_ok($$ select install_pack('c9c9c9c9-0000-0000-0000-000000000000',
                     jsonb_set((select v from j where name = 'install'), '{pack}',
                       '{"key": "wa9a9a9a9-method", "version": "1.1.0", "hash": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}')) $$,
  'pack withdrawn: it takes no new installs', 'a withdrawn pack is not installed in a new workspace');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
select lives_ok($$ select publish_pack('a9a9a9a9-0000-0000-0000-000000000000', pg_temp._pk('1.2.0', repeat('f', 64))) $$,
  'a withdrawn pack still gets new versions');
select ok((select withdrawn_at is not null from packs where key = 'wa9a9a9a9-method' and version = '1.2.0'),
  'and they stay withdrawn');
update j set v = jsonb_set(jsonb_set(jsonb_set(jsonb_set(v, '{pack,from_version}', '"1.1.0"'), '{pack,from_hash}', to_jsonb(repeat('e', 64))),
                                     '{pack,version}', '"1.2.0"'), '{pack,hash}', to_jsonb(repeat('f', 64)))
                 #- '{add,fields}' where name = 'upgrade';
update j set v = jsonb_set(v, '{add,fields}', '[]') where name = 'upgrade';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009b1","role":"authenticated"}', true);
select lives_ok($$ select upgrade_pack((select (v->>'install')::uuid from j where name = 'upgrade'), (select v from j where name = 'upgrade')) $$,
  'an installed copy keeps taking updates after the withdrawal');

-- ── shares: nobody writes, changes or removes one directly
select throws_ok($$ insert into pack_shares (pack_key, org_id) values ('wa9a9a9a9-method', 'c9c9c9c9-0000-0000-0000-000000000000') $$,
  '42501', null, 'a person cannot write a share');
select throws_ok($$ delete from pack_shares where pack_key = 'wa9a9a9a9-method' $$,
  '42501', null, 'nor remove one');
reset role;
select throws_ok($$ insert into pack_shares (pack_key, org_id) values ('wa9a9a9a9-method', 'c9c9c9c9-0000-0000-0000-000000000000') $$,
  'a pack share is written only by install_pack and never changes', 'not even the database owner writes one directly');
select throws_ok($$ update pack_shares set org_id = 'c9c9c9c9-0000-0000-0000-000000000000' where pack_key = 'wa9a9a9a9-method' $$,
  'a pack share is written only by install_pack and never changes', 'or moves one');
select set_config('app.pack_publish', 'on', true);
select throws_ok($$ update packs set withdrawn_at = null where key = 'wa9a9a9a9-method' $$,
  'a pack version is written once: publish a new version', 'a withdrawal is not taken back by hand');

select * from finish();
rollback;
