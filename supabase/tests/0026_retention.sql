-- Retention (0036_retention.sql, docs/02 §18): personal-data values leave the log for personal_activity, the queue
-- (dedupe, owners and admins only), postpone with a reason, legal hold blocks erasure, erasure clears values, files,
-- comments and the log's copies in one transaction and writes a tombstone without the values, and the hash chain
-- still verifies afterwards. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'ret-owner@a.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'ret-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000f1', 'Ret Owner', 'RO'),
  ('00000000-0000-0000-0000-0000000000f2', 'Ret Editor', 'RE');
insert into orgs (id, name, slug) values ('d0d0d0d0-0000-0000-0000-000000000000', 'Org R', 'pgtap-retention');
insert into memberships (org_id, user_id, role) values
  ('d0d0d0d0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('d0d0d0d0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000f2', 'editor');
-- a requests sheet: requester and email are personal data, outcome is not; names are personal too
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('d0000001-0000-0000-0000-000000000001', 'd0d0d0d0-0000-0000-0000-000000000000', 'Requests', 'DSR-', 'a0',
   '{"retention":{"personalNames":true,"rules":[
      {"id":"dsr3y","name":"Requests 3 years after closing","from":{"kind":"field","fieldKey":"closed_on"},
       "period":{"n":3,"unit":"years"},"action":"erase","comments":true,"files":true},
      {"id":"anon","name":"Anonymise","from":{"kind":"created"},"period":{"n":1,"unit":"days"},"action":"anonymise"}]}}');
insert into groups (id, org_id, sheet_id, name, position) values
  ('d0000003-0000-0000-0000-000000000001', 'd0d0d0d0-0000-0000-0000-000000000000', 'd0000001-0000-0000-0000-000000000001', 'Closed', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('d0000004-0000-0000-0000-000000000001', 'd0d0d0d0-0000-0000-0000-000000000000', 'd0000001-0000-0000-0000-000000000001',
   'requester', 'Requester', 'text', 'a0', '{"personalData":true}'),
  ('d0000004-0000-0000-0000-000000000002', 'd0d0d0d0-0000-0000-0000-000000000000', 'd0000001-0000-0000-0000-000000000001',
   'email', 'Email', 'email', 'a1', '{"personalData":true}'),
  ('d0000004-0000-0000-0000-000000000003', 'd0d0d0d0-0000-0000-0000-000000000000', 'd0000001-0000-0000-0000-000000000001',
   'outcome', 'Outcome', 'text', 'a2', '{}'),
  ('d0000004-0000-0000-0000-000000000004', 'd0d0d0d0-0000-0000-0000-000000000000', 'd0000001-0000-0000-0000-000000000001',
   'closed_on', 'Closed on', 'date', 'a3', '{}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- grants
select ok(has_function_privilege('authenticated', 'retention_execute(uuid, text)', 'execute'), 'authenticated may approve');
select ok(has_function_privilege('authenticated', 'retention_enqueue(uuid, jsonb)', 'execute'), 'authenticated may check now');
select ok(not has_function_privilege('authenticated', 'retention_claim_day(uuid, date)', 'execute'),
  'the daily claim is for the scheduler only');
select ok(not has_function_privilege('anon', 'retention_execute(uuid, text)', 'execute'), 'anon may not approve');
select ok(not has_function_privilege('authenticated', '_retention_rule(uuid, text)', 'execute')
          and not has_function_privilege('authenticated', '_personal_mask(text, text, jsonb)', 'execute'),
  'internal helpers are not granted');

-- an item created and edited by the editor, through the RPCs
set local role authenticated;
select pg_temp.as_user('f2');
create temp table t_item as
  select (create_item('d0000001-0000-0000-0000-000000000001', 'd0000003-0000-0000-0000-000000000001',
                      'Access request from Jane Doe', 'a0',
                      '{"d0000004-0000-0000-0000-000000000001":"Jane Doe","d0000004-0000-0000-0000-000000000003":"Sent"}')).id as id;
grant select on t_item to authenticated;
select lives_ok($$ select set_item_values((select id from t_item),
  '{"d0000004-0000-0000-0000-000000000002":"jane@example.com","d0000004-0000-0000-0000-000000000004":"2020-01-31"}') $$,
  'the editor records an email and the closing date');
select lives_ok($$ select set_item_values((select id from t_item), '{}', 'Access request (JD)') $$, 'and renames it');
insert into item_updates (org_id, item_id, author_id, body)
  select 'd0d0d0d0-0000-0000-0000-000000000000', id, '00000000-0000-0000-0000-0000000000f2', 'Called Jane on 0700 900' from t_item;
reset role;
insert into files (id, org_id, item_id, field_id, storage_path, filename, mime_type, size_bytes, sha256, uploaded_by, personal_data)
  select 'd0000006-0000-0000-0000-000000000001', 'd0d0d0d0-0000-0000-0000-000000000000', id, null,
         'org/d0/item/x/d0000006/passport.pdf', 'passport-jane.pdf', 'application/pdf', 10, repeat('a', 64),
         '00000000-0000-0000-0000-0000000000f2', true from t_item;
select log_file_event((select id from t_item), null, 'd0000006-0000-0000-0000-000000000001', 'file.added');

-- the log holds markers, never the personal values
select ok(not exists (select 1 from activity_log where item_id = (select id from t_item)
                       and (coalesce(old_value::text, '') ~ 'Jane|jane@|passport' or coalesce(new_value::text, '') ~ 'Jane|jane@|passport')),
  'no personal value or personal name in clear in the log');
select is((select new_value->'values'->>'d0000004-0000-0000-0000-000000000003' from activity_log
            where item_id = (select id from t_item) and action = 'item.created'), 'Sent',
  'values that are not personal data stay in clear');
select ok((select new_value->'name' ? '$personal' from activity_log
            where item_id = (select id from t_item) and action = 'item.created'), 'the name is a marker on this sheet');
select is((select count(*)::int from personal_activity where item_id = (select id from t_item)), 5,
  'personal_activity holds the creation''s requester and name, the email, the rename and the file event');
select is((verify_activity_chain((select id::text from t_item))->>'ok'), 'true', 'the chain verifies');
select throws_ok($$ update personal_activity set new_value = '"x"' where item_id = (select id from t_item) $$,
  'personal_activity: only erasure may change it', 'personal_activity cannot be edited');

-- the queue: owners and admins only, deduped
set local role authenticated;
select pg_temp.as_user('f2');
select throws_ok($$ select retention_enqueue('d0d0d0d0-0000-0000-0000-000000000000',
  jsonb_build_array(jsonb_build_object('sheet_id', 'd0000001-0000-0000-0000-000000000001', 'item_id', (select id from t_item),
                                       'rule_id', 'dsr3y', 'due_on', '2023-01-31'))) $$,
  'not allowed', 'an editor cannot fill the queue');
select pg_temp.as_user('f1');
select is(retention_enqueue('d0d0d0d0-0000-0000-0000-000000000000',
  jsonb_build_array(jsonb_build_object('sheet_id', 'd0000001-0000-0000-0000-000000000001', 'item_id', (select id from t_item),
                                       'rule_id', 'dsr3y', 'due_on', '2023-01-31'))), 1, 'the owner queues a due item');
select is(retention_enqueue('d0d0d0d0-0000-0000-0000-000000000000',
  jsonb_build_array(jsonb_build_object('sheet_id', 'd0000001-0000-0000-0000-000000000001', 'item_id', (select id from t_item),
                                       'rule_id', 'dsr3y', 'due_on', '2023-01-31'))), 0, 'once per item, rule and due date');
select throws_ok($$ select retention_enqueue('d0d0d0d0-0000-0000-0000-000000000000',
  jsonb_build_array(jsonb_build_object('sheet_id', 'd0000001-0000-0000-0000-000000000001', 'item_id', (select id from t_item),
                                       'rule_id', 'nope', 'due_on', '2023-01-31'))) $$,
  'retention: no rule nope', 'only the sheet''s own rules');
select is((select count(*)::int from notifications where org_id = 'd0d0d0d0-0000-0000-0000-000000000000' and kind = 'system'),
  1, 'the owner is told once');
create temp table t_q as select id from retention_queue where item_id = (select id from t_item);
grant select on t_q to authenticated;

-- postpone needs a reason and a later date; a hold blocks erasure
select throws_ok($$ select retention_postpone((select id from t_q), current_date + 30, ' ') $$,
  'retention: say why', 'postponing needs a reason');
select lives_ok($$ select retention_postpone((select id from t_q), current_date + 30, 'Complaint still open with the authority') $$,
  'postponed with a reason');
select lives_ok($$ select set_retention_hold((select id from t_item), true, 'Litigation hold from counsel') $$, 'a legal hold');
select throws_ok($$ select retention_execute((select id from t_q)) $$, 'retention: on legal hold', 'the hold blocks erasure');
select pg_temp.as_user('f2');
select throws_ok($$ select retention_execute((select id from t_q)) $$, 'not allowed', 'an editor cannot approve');
select pg_temp.as_user('f1');
select is(set_retention_hold((select id from t_item), false, 'Settled'), false, 'the hold is released');

-- approve: one transaction
create temp table t_res as select retention_execute((select id from t_q), 'Three years after closing') as r;
reset role;
select is((select "values" from items where id = (select id from t_item)),
  '{"d0000004-0000-0000-0000-000000000003": "Sent", "d0000004-0000-0000-0000-000000000004": "2020-01-31"}'::jsonb,
  'the personal values are gone, the others stay');
select is((select count(*)::int from item_updates where item_id = (select id from t_item)), 0, 'comments removed');
select ok((select erased_at is not null and filename = 'erased' and sha256 = repeat('0', 64) from files
            where id = 'd0000006-0000-0000-0000-000000000001'), 'the personal item file is erased');
select is((select r->'paths'->>0 from t_res), 'org/d0/item/x/d0000006/passport.pdf', 'its object is returned for removal');
select is((select count(*)::int from personal_activity where item_id = (select id from t_item) and erased_at is null), 2,
  'the logged values of the erased fields and file are erased; the name (not anonymised) stays');
select ok(not exists (select 1 from personal_activity where item_id = (select id from t_item) and erased_at is not null
                       and (salt is not null or old_value is not null or new_value is not null)),
  'value and salt both gone');
select is((select action || '|' || (new_value->>'files') || '|' || (new_value->>'comments') || '|' ||
                  (new_value->'fields'->0->>'key') || '|' || coalesce(note, '')
             from activity_log where item_id = (select id from t_item) order by id desc limit 1),
  'retention.erased|1|1|requester|Three years after closing', 'the tombstone says what was erased');
select ok((select new_value::text !~ 'Jane|jane@' from activity_log where item_id = (select id from t_item) order by id desc limit 1),
  'and never the values');
set local role authenticated;
select pg_temp.as_user('f1');
select is((verify_activity_chain((select id::text from t_item))->>'redacted'), '3', 'the chain verifies after erasure');
select is((select status from retention_queue where id = (select id from t_q)), 'done', 'the queue entry is done');

select * from finish();
rollback;
