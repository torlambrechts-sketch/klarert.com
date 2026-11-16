-- Retention erasure clears approval comments and nothing else of the approval's record (0068). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000099591', 'wfc-owner@a.test'),
  ('00000000-0000-0000-0000-000000099592', 'wfc-editor@a.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000099591', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000099592', 'Eve Editor', 'EE');
insert into orgs (id, name, slug) values ('99590000-0000-0000-0000-00000000000a', 'Approvals', 'pgtap-wf-comments');
insert into memberships (org_id, user_id, role) values
  ('99590000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099591', 'owner'),
  ('99590000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000099592', 'editor');
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('99590001-0000-0000-0000-000000000001', '99590000-0000-0000-0000-00000000000a', 'Procedures', 'PRO-', 'a0',
   '{"retention":{"rules":[{"id":"erase","name":"Erase comments","from":{"kind":"created"},
     "period":{"n":1,"unit":"days"},"action":"erase","comments":true}]}}');
insert into groups (id, org_id, sheet_id, name, position) values
  ('99590002-0000-0000-0000-000000000001', '99590000-0000-0000-0000-00000000000a', '99590001-0000-0000-0000-000000000001',
   'All', 'a0');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('99590003-0000-0000-0000-000000000001', '99590000-0000-0000-0000-00000000000a', '99590001-0000-0000-0000-000000000001',
   '99590002-0000-0000-0000-000000000001', 1, 'PRO-001', 'Lockout procedure', 'a0');
insert into workflow_instances (id, org_id, sheet_id, item_id, workflow_id, definition, status, step_index, approvers,
                                submitted_by, submit_comment, ended_at, ended_by, end_reason) values
  ('99590004-0000-0000-0000-000000000001', '99590000-0000-0000-0000-00000000000a', '99590001-0000-0000-0000-000000000001',
   '99590003-0000-0000-0000-000000000001', 'wf', '{"name":"Sign-off"}', 'approved', null, '[]',
   '00000000-0000-0000-0000-000000099592', 'Sam asked for this before his leave', now(),
   '00000000-0000-0000-0000-000000099591', 'approved');
insert into workflow_decisions (id, org_id, instance_id, item_id, step_index, step_id, step_name, round, user_id, decision,
                                comment, decided_at) values
  ('99590005-0000-0000-0000-000000000001', '99590000-0000-0000-0000-00000000000a', '99590004-0000-0000-0000-000000000001',
   '99590003-0000-0000-0000-000000000001', 0, 's1', 'Review', 1, '00000000-0000-0000-0000-000000099591', 'rejected',
   'Sam signed the wrong form', '2026-11-01 10:00+00'),
  ('99590005-0000-0000-0000-000000000002', '99590000-0000-0000-0000-00000000000a', '99590004-0000-0000-0000-000000000001',
   '99590003-0000-0000-0000-000000000001', 0, 's1', 'Review', 2, '00000000-0000-0000-0000-000000099591', 'approved',
   null, '2026-11-02 10:00+00');
create temp table t_before as select id, to_jsonb(d) - 'comment' as row from workflow_decisions d
 where item_id = '99590003-0000-0000-0000-000000000001';
create temp table t_inst_before as select to_jsonb(i) - 'submit_comment' as row from workflow_instances i
 where id = '99590004-0000-0000-0000-000000000001';

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009959' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- nobody changes a decision outside erasure
set local role authenticated;
select pg_temp.as_user('1');
select throws_ok($$ update workflow_decisions set comment = null where id = '99590005-0000-0000-0000-000000000001' $$,
  '42501', null, 'a person cannot update a decision, not even its comment');
reset role;
select throws_ok($$ update workflow_decisions set comment = null where id = '99590005-0000-0000-0000-000000000001' $$,
  'workflow_decisions is append-only', 'nor can a definer function outside retention erasure');
select throws_ok($$ update workflow_instances set submit_comment = null where id = '99590004-0000-0000-0000-000000000001' $$,
  'workflow_instances: the submit comment changes only by retention erasure', 'the submit comment neither');
-- inside erasure, only the comment may go
select set_config('app.retention_op', 'erase', true);
select throws_ok($$ update workflow_decisions set comment = null, decision = 'approved'
                     where id = '99590005-0000-0000-0000-000000000001' $$,
  'workflow_decisions is append-only', 'even during erasure the decision itself cannot change');
select throws_ok($$ update workflow_decisions set comment = 'rewritten' where id = '99590005-0000-0000-0000-000000000001' $$,
  'workflow_decisions is append-only', 'and a comment cannot be rewritten, only cleared');
select set_config('app.retention_op', '', true);

-- retention erasure with comments
insert into retention_queue (id, org_id, sheet_id, item_id, rule_id, rule_name, action, due_on) values
  ('99590008-0000-0000-0000-000000000001', '99590000-0000-0000-0000-00000000000a', '99590001-0000-0000-0000-000000000001',
   '99590003-0000-0000-0000-000000000001', 'erase', 'Erase comments', 'erase', current_date);
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$ select retention_execute('99590008-0000-0000-0000-000000000001') $$, 'the owner erases');
reset role;
select is((select count(*)::int from workflow_decisions where item_id = '99590003-0000-0000-0000-000000000001'
            and comment is not null), 0, 'retention clears the decisions'' comments');
select is((select submit_comment from workflow_instances where id = '99590004-0000-0000-0000-000000000001'), null,
  'and the submit comment');
select ok((select bool_and(b.row = to_jsonb(d) - 'comment') and count(*) = 2
             from t_before b join workflow_decisions d on d.id = b.id)
          and (select row from t_inst_before) = (select to_jsonb(i) - 'submit_comment' from workflow_instances i
                                                   where id = '99590004-0000-0000-0000-000000000001'),
  'every decision and the instance are otherwise the same: outcome, step, round, who, when');
select is((select new_value ->> 'approval_comments_erased' from activity_log
            where item_id = '99590003-0000-0000-0000-000000000001' and action = 'retention.erased'), '2',
  'the tombstone counts the approval comments erased');

select * from finish();
rollback;
