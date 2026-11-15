-- Notes of value changes and approval comments are kept out of the log in clear (0065, security review 9.1 item 3).
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000099581', 'note-owner@a.test'),
  ('00000000-0000-0000-0000-000000099582', 'note-viewer@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000099581', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000099582', 'Vic Viewer', 'VV');
insert into orgs (id, name, slug) values ('99580000-0000-0000-0000-00000000000a', 'Notes', 'pgtap-notes');
insert into memberships (org_id, user_id, role) values
  ('99580000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099581', 'owner'),
  ('99580000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099582', 'viewer');
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('99580001-0000-0000-0000-000000000001', '99580000-0000-0000-0000-00000000000a', 'Actions', 'ACT-', 'a0',
   '{"retention":{"rules":[{"id":"erase","name":"Erase comments","from":{"kind":"created"},
     "period":{"n":1,"unit":"days"},"action":"erase","comments":true}]}}');
insert into groups (id, org_id, sheet_id, name, position) values
  ('99580002-0000-0000-0000-000000000001', '99580000-0000-0000-0000-00000000000a', '99580001-0000-0000-0000-000000000001',
   'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('99580003-0000-0000-0000-000000000001', '99580000-0000-0000-0000-00000000000a', '99580001-0000-0000-0000-000000000001',
   'status', 'Status', 'status', 'a0',
   '{"options":[{"id":"o_open","label":"Open","color":"grey"},{"id":"o_stuck","label":"Stuck","color":"red"}]}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009958' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- an entry written before this migration: its note stays in clear for good
create temp table t_item as select gen_random_uuid() as id;
grant select on t_item to authenticated;
create function pg_temp.entry(p_action text) returns activity_log language sql as $$
  select * from activity_log where action = p_action and item_id = (select id from t_item) order by id desc limit 1
$$;
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position)
select id, '99580000-0000-0000-0000-00000000000a', '99580001-0000-0000-0000-000000000001',
       '99580002-0000-0000-0000-000000000001', 1, 'ACT-001', 'Replace guard', 'a0' from t_item;
alter table activity_log disable trigger activity_b_note_bi;
insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value, note)
select '99580000-0000-0000-0000-00000000000a', '99580001-0000-0000-0000-000000000001', id, '', 'user',
       '00000000-0000-0000-0000-000000099581', 'value.changed', '99580003-0000-0000-0000-000000000001', null, '"o_open"',
       'Old note about Sam' from t_item;
alter table activity_log enable trigger activity_b_note_bi;

-- a person's comment on a value change
set local role authenticated;
select pg_temp.as_user('1');
select set_item_values((select id from t_item), '{"99580003-0000-0000-0000-000000000001": "o_stuck"}', null, null,
                       'Waiting for Sam, who is off sick');
reset role;
select ok((select note ~ '^\{"\$personal": "[0-9a-f]{64}"\}$' from pg_temp.entry('value.changed')),
  'a person''s comment on a value change is a marker in the log');
select is((select pa.new_value #>> '{}' from personal_activity pa
            where pa.activity_id = (pg_temp.entry('value.changed')).id and pa.slot = 'note'),
  'Waiting for Sam, who is off sick', 'the comment itself is kept aside in personal_activity');
select is((select pa.field_id from personal_activity pa
            where pa.activity_id = (pg_temp.entry('value.changed')).id and pa.slot = 'note'),
  '99580003-0000-0000-0000-000000000001'::uuid, 'under the entry''s field, so it is read only where the field is seen');
select is((select new_value from pg_temp.entry('value.changed')), '"o_stuck"'::jsonb,
  'the value itself is not personal and stays as it was');

-- approval comments: always masked
insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
select '99580000-0000-0000-0000-00000000000a', '99580001-0000-0000-0000-000000000001', id, '', 'user',
       '00000000-0000-0000-0000-000000099581', 'workflow.decided', '{"decision":"rejected"}', 'Sam signed the wrong form'
  from t_item;
select ok(_note_masked((pg_temp.entry('workflow.decided')).note), 'an approval comment is a marker in the log');

-- notes the system writes stay in clear
insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, new_value, note)
select '99580000-0000-0000-0000-00000000000a', '99580001-0000-0000-0000-000000000001', id, '', 'automation', null,
       'value.changed', '99580003-0000-0000-0000-000000000001', '"o_open"', 'Set by automation "Reopen"' from t_item;
select is((pg_temp.entry('value.changed')).note, 'Set by automation "Reopen"', 'an automation''s note stays in clear');
select set_config('app.pack_op', 'upgrade', true);
insert into activity_log (org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
select '99580000-0000-0000-0000-00000000000a', '99580001-0000-0000-0000-000000000001', id, '', 'user',
       '00000000-0000-0000-0000-000000099581', 'item.renamed', '"Replace guard"', '"Replace guard"', 'Pack update' from t_item;
select set_config('app.pack_op', '', true);
select is((pg_temp.entry('item.renamed')).note, 'Pack update', 'and so does a pack operation''s');
insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value, note)
values ('99580000-0000-0000-0000-00000000000a', '', 'user', '00000000-0000-0000-0000-000000099581', 'member.added',
        '{"role":"viewer"}', 'Vic Viewer');
select is((select note from activity_log where action = 'member.added' and org_id = '99580000-0000-0000-0000-00000000000a'
            order by id desc limit 1),
  'Vic Viewer', 'member names in member.* notes stay in clear (access-provisioning evidence, owner decision)');
select is(_note_is_personal('item.archived', 'user'), false, 'archive notes are not in scope');

-- who reads the comment: the item's readers (the viewer reads the sheet and sees the field)
set local role authenticated;
select pg_temp.as_user('2');
select is((select count(*)::int from personal_activity pa join activity_log a on a.id = pa.activity_id
            where a.item_id = (select id from t_item) and pa.slot = 'note'), 2,
  'people who can read the item read its comments');
select pg_temp.as_user('1');
select is(verify_activity_chain((select id::text from t_item)) ->> 'ok', 'true', 'the item''s chain verifies');
reset role;

-- erasure with comments: the notes go, the markers stay, the old note in clear is counted
insert into retention_queue (id, org_id, sheet_id, item_id, rule_id, rule_name, action, due_on)
select '99580008-0000-0000-0000-000000000001', '99580000-0000-0000-0000-00000000000a',
       '99580001-0000-0000-0000-000000000001', id, 'erase', 'Erase comments', 'erase', current_date from t_item;
set local role authenticated;
select pg_temp.as_user('1');
create temp table t_res as select retention_execute('99580008-0000-0000-0000-000000000001') as r;
select is((select count(*)::int from personal_activity pa join activity_log a on a.id = pa.activity_id
            where a.item_id = (select id from t_item) and pa.slot = 'note' and pa.erased_at is null), 0,
  'erasure with comments erases every kept-aside note');
select is((select (r ->> 'redacted')::int from t_res), 2, 'both notes are counted as erased');
select is((select new_value ->> 'log_values_erased' from activity_log
            where item_id = (select id from t_item) and action = 'retention.erased'), '2',
  'the tombstone counts them');
select is((select new_value ->> 'earlier_entries_in_clear' from activity_log
            where item_id = (select id from t_item) and action = 'retention.erased'), '1',
  'and the earlier note still in clear (not the automation''s or the pack''s)');
select is(verify_activity_chain((select id::text from t_item)) ->> 'ok', 'true', 'the chain still verifies');
select is((verify_activity_chain((select id::text from t_item)) ->> 'redacted')::int, 2,
  'and reports the erased notes');
reset role;

select * from finish();
rollback;
