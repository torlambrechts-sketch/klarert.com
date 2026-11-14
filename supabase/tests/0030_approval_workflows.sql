-- Approval workflows (0040, docs/02 §19, docs/04 §13): definitions guarded, submit / decide / withdraw, the
-- self-approval block, approvers without access reported, RLS, the hash chain and grants. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(51);

-- people: owner (o), editor who submits (e), second editor (e2), viewer (v), outsider (x), auditor (a)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a9001', 'owner@wf.test'),
  ('00000000-0000-0000-0000-0000000a9002', 'editor@wf.test'),
  ('00000000-0000-0000-0000-0000000a9003', 'editor2@wf.test'),
  ('00000000-0000-0000-0000-0000000a9004', 'viewer@wf.test'),
  ('00000000-0000-0000-0000-0000000a9005', 'outsider@wf.test'),
  ('00000000-0000-0000-0000-0000000a9006', 'auditor@wf.test');
insert into profiles (id, display_name, initials) select id, initcap(split_part(email, '@', 1)), 'XX'
  from auth.users where email like '%@wf.test';
insert into orgs (id, name, slug) values
  ('a9a9a9a9-0000-0000-0000-000000000000', 'Approvals Org', 'approvals-org'),
  ('a9a9a9a9-0000-0000-0000-00000000000b', 'Other Org', 'approvals-other');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9001","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role, job_title) values
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a9001', 'owner', 'Quality lead');
insert into memberships (org_id, user_id, role, job_title, expires_at) values
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a9002', 'editor', null, null),
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a9003', 'editor', null, null),
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a9004', 'viewer', 'Quality lead', null),
  ('a9a9a9a9-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a9006', 'auditor', null, now() + interval '30 days');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9005","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values
  ('a9a9a9a9-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000a9005', 'owner');
select set_config('request.jwt.claims', '', true);

-- a documents-like sheet (not a register) with a workflow: Review by the Owner field, then Approval by every
-- "Quality lead" (owner and viewer), a rejection there goes back to Review; lock on approval
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('a9a9a9a9-1111-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000000', 'Procedures', 'PRC-', 'a0', '{}'),
  ('a9a9a9a9-1111-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000000', 'Contracts', 'CON-', 'a1', '{}');
insert into groups (id, org_id, sheet_id, name, position) values
  ('a9a9a9a9-2222-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000001', 'Open', 'a0'),
  ('a9a9a9a9-2222-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000002', 'Open', 'a0');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('a9a9a9a9-3333-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000001',
   'owner', 'Owner', 'people', 'a0', '{"multiple":false}'),
  ('a9a9a9a9-3333-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000001',
   'summary', 'Summary', 'text', 'a1', '{}'),
  ('a9a9a9a9-3333-0000-0000-000000000003', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000001',
   'status', 'Status', 'status', 'a2',
   '{"options":[{"id":"o_draft","label":"Draft","color":"grey"},{"id":"o_review","label":"In review","color":"orange"},{"id":"o_ok","label":"Approved","color":"green","done":true}]}'),
  ('a9a9a9a9-3333-0000-0000-000000000004', 'a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000001',
   'step', 'Workflow step', 'workflowstep', 'a3',
   '{"options":[{"id":"w_draft","label":"Draft","color":"grey"},{"id":"w_review","label":"Review","color":"blue"},{"id":"w_approval","label":"Approval","color":"purple"},{"id":"w_done","label":"Done","color":"green","done":true}]}');

create temp table wf as select jsonb_build_object(
  'id', 'proc', 'name', 'Procedure approval', 'enabled', true, 'requiredFields', jsonb_build_array('summary'),
  'allowSelfApproval', false, 'lockOnApproval', true,
  'stepField', jsonb_build_object('fieldKey', 'step', 'draft', 'w_draft', 'approved', 'w_done', 'rejected', null),
  'statusField', jsonb_build_object('fieldKey', 'status', 'onSubmit', 'o_review', 'onApproved', 'o_ok', 'onRejected', 'o_draft'),
  'steps', jsonb_build_array(
    jsonb_build_object('id', 'review', 'name', 'Review', 'approvers', jsonb_build_object('kind', 'field', 'fieldKey', 'owner'),
                       'mode', 'any', 'sla', jsonb_build_object('amount', 1, 'unit', 'hours'),
                       'onReject', jsonb_build_object('to', 'draft'), 'optionId', 'w_review'),
    jsonb_build_object('id', 'approval', 'name', 'Approval',
                       'approvers', jsonb_build_object('kind', 'jobRole', 'roleName', 'Quality lead'),
                       'mode', 'all', 'onReject', jsonb_build_object('to', 'step', 'stepId', 'review'),
                       'optionId', 'w_approval'))) as def;
grant select on wf to authenticated;

set local role authenticated;
-- ───────────── definitions: owners and admins only ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9002","role":"authenticated"}', true);
select throws_like($$ update sheets set settings = jsonb_build_object('workflows', jsonb_build_array((select def from wf)))
                       where id = 'a9a9a9a9-1111-0000-0000-000000000001' $$,
  '%only owners and admins change approval workflows%', 'an editor cannot change approval workflows');
insert into sheets (id, org_id, name, id_prefix, position, settings) values
  ('a9a9a9a9-1111-0000-0000-000000000009', 'a9a9a9a9-0000-0000-0000-000000000000', 'Copy', 'CPY-', 'a9',
   jsonb_build_object('workflows', jsonb_build_array((select def from wf))));
select is((select settings ? 'workflows' from sheets where id = 'a9a9a9a9-1111-0000-0000-000000000009'), false,
  'a copy made by an editor starts without approval workflows');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9001","role":"authenticated"}', true);
select lives_ok($$ update sheets set settings = jsonb_build_object('workflows', jsonb_build_array((select def from wf)))
                    where id = 'a9a9a9a9-1111-0000-0000-000000000001' $$, 'an owner sets the approval workflows');
select is((select count(*)::int from activity_log where chain_key = 'sheet:a9a9a9a9-1111-0000-0000-000000000001'
                                                    and action = 'sheets.update'), 1,
  'the definition change is in the sheet''s audit chain');

-- ───────────── submit ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9002","role":"authenticated"}', true);
create temp table it1 as select * from create_item('a9a9a9a9-1111-0000-0000-000000000001', 'a9a9a9a9-2222-0000-0000-000000000001', 'Change control', 'a0');
select throws_like($$ select workflow_submit((select id from it1), 'proc') $$,
  '%Fill in Summary before submitting.%', 'required fields must be filled before submitting');
select set_item_values((select id from it1), jsonb_build_object(
  'a9a9a9a9-3333-0000-0000-000000000002', 'How changes are approved',
  'a9a9a9a9-3333-0000-0000-000000000001', jsonb_build_array('00000000-0000-0000-0000-0000000a9002')));
select throws_like($$ select workflow_submit((select id from it1), 'proc') $$,
  '%Step 1, Review: you are the only approver and cannot approve your own submission.%',
  'the submitter is never their own approver: a step left with nobody is reported');
select set_item_values((select id from it1), jsonb_build_object(
  'a9a9a9a9-3333-0000-0000-000000000001', jsonb_build_array('00000000-0000-0000-0000-0000000a9003')));
select throws_like($$ select workflow_submit((select id from it1), 'nope') $$,
  'approval: this approval workflow no longer exists.', 'an unknown workflow is refused');
select throws_like($$ select workflow_submit((select id from it1), 'proc', null,
                                             'a9a9a9a9-4444-0000-0000-000000000001') $$,
  'not allowed', 'a person cannot submit as an automation');
select lives_ok($$ select workflow_submit((select id from it1), 'proc', 'Ready for review') $$, 'the editor submits');
create temp table i1 as select * from workflow_instances where item_id = (select id from it1);
grant select on i1 to authenticated;
select results_eq($$ select status, step_index, round, submitted_by from i1 $$,
  $$ values ('in_progress'::text, 0, 1, '00000000-0000-0000-0000-0000000a9002'::uuid) $$, 'the instance waits at step 1');
select is((select approvers from i1),
  '[["00000000-0000-0000-0000-0000000a9003"], ["00000000-0000-0000-0000-0000000a9001", "00000000-0000-0000-0000-0000000a9004"]]'::jsonb,
  'the approvers of every step are fixed at submit');
select ok((select step_due_at between now() + interval '59 minutes' and now() + interval '61 minutes' from i1),
  'the step is due after its SLA');
select results_eq($$ select "values"->>'a9a9a9a9-3333-0000-0000-000000000004', "values"->>'a9a9a9a9-3333-0000-0000-000000000003'
                      from items where id = (select id from it1) $$,
  $$ values ('w_review'::text, 'o_review'::text) $$, 'the step field and the status follow the submission');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9003","role":"authenticated"}', true);
select is((select count(*)::int from notifications where item_id = (select id from it1)), 1,
  'the approver of step 1 is told');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9002","role":"authenticated"}', true);
select throws_like($$ select workflow_submit((select id from it1), 'proc') $$,
  'approval: this item is already waiting for approval.', 'one approval at a time per item');
update items set "values" = "values" || '{"a9a9a9a9-3333-0000-0000-000000000004":"w_done"}' where id = (select id from it1);
select is((select "values"->>'a9a9a9a9-3333-0000-0000-000000000004' from items where id = (select id from it1)), 'w_review',
  'people cannot write the step directly (no write policy on items)');
select throws_like($$ select set_item_values((select id from it1), '{"a9a9a9a9-3333-0000-0000-000000000004":"w_done"}') $$,
  'workflow step is set by automations only', 'nor through set_item_values');
select throws_like($$ insert into workflow_instances (org_id, sheet_id, item_id, workflow_id, definition, approvers)
                       values ('a9a9a9a9-0000-0000-0000-000000000000', 'a9a9a9a9-1111-0000-0000-000000000001',
                               (select id from it1), 'x', '{}', '[]') $$,
  '%permission denied%', 'nobody inserts instances directly');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9004","role":"authenticated"}', true);
select throws_like($$ select workflow_submit((select id from it1), 'proc') $$, 'not allowed', 'a viewer cannot submit');

-- ───────────── decide ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9002","role":"authenticated"}', true);
select throws_like($$ select workflow_decide((select id from i1), 'approved') $$,
  'approval: you submitted this item and cannot approve your own submission.', 'no self-approval');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9005","role":"authenticated"}', true);
select throws_like($$ select workflow_decide((select id from i1), 'approved') $$,
  'approval: this approval no longer exists.', 'another workspace cannot decide');
select is((select count(*)::int from workflow_instances), 0, 'another workspace reads no instances');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9004","role":"authenticated"}', true);
select throws_like($$ select workflow_decide((select id from i1), 'approved') $$,
  'approval: you are not an approver of this step.', 'only the step''s approvers decide');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9003","role":"authenticated"}', true);
select throws_like($$ select workflow_decide((select id from i1), 'rejected', '  ') $$,
  'approval: say why you reject it.', 'a rejection needs a comment');
select is((select workflow_decide((select id from i1), 'approved', 'Reads well')->>'outcome'), 'next',
  'step 1 approved: on to step 2');
select throws_like($$ select workflow_decide((select id from i1), 'approved') $$,
  'approval: you are not an approver of this step.', 'a step-1 approver cannot decide step 2');
-- step 2: all must approve; the viewer approves with view access only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9004","role":"authenticated"}', true);
select is((select workflow_decide((select id from i1), 'approved')->>'outcome'), 'waiting',
  'all must approve: one of two is not enough');
select is((select count(*)::int from workflow_instances where id = (select id from i1)), 1,
  'an approver reads the instance');
select throws_like($$ select workflow_decide((select id from i1), 'approved') $$,
  'approval: you have already decided on this step.', 'one decision per person per step');
-- the owner rejects: back to Review, a new round
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9001","role":"authenticated"}', true);
select is((select workflow_decide((select id from i1), 'rejected', 'Add the rollback plan')->>'outcome'), 'returned',
  'a rejection at step 2 goes back to step 1');
select results_eq($$ select step_index, round from workflow_instances where id = (select id from i1) $$,
  $$ values (0, 2) $$, 'back at step 1 in round 2');
select is((select "values"->>'a9a9a9a9-3333-0000-0000-000000000004' from items where id = (select id from it1)), 'w_review',
  'the step field shows Review again');
-- round 2: all the way through
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9003","role":"authenticated"}', true);
select is((select workflow_decide((select id from i1), 'approved', 'Rollback added')->>'outcome'), 'next', 'round 2, step 1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9004","role":"authenticated"}', true);
select is((select workflow_decide((select id from i1), 'approved')->>'outcome'), 'waiting',
  'an approval from round 1 does not count in round 2');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9001","role":"authenticated"}', true);
select is((select workflow_decide((select id from i1), 'approved', 'Approved for use')->>'outcome'), 'approved',
  'the last approval ends it');
select results_eq($$ select locked, lock_reason, "values"->>'a9a9a9a9-3333-0000-0000-000000000004',
                            "values"->>'a9a9a9a9-3333-0000-0000-000000000003'
                       from items where id = (select id from it1) $$,
  $$ values (true, 'Approved: Procedure approval'::text, 'w_done'::text, 'o_ok'::text) $$,
  'approved: locked, the step field done, the status set');
select results_eq($$ select status, end_reason, ended_by from workflow_instances where id = (select id from i1) $$,
  $$ values ('approved'::text, 'approved'::text, '00000000-0000-0000-0000-0000000a9001'::uuid) $$, 'the instance ended');
select results_eq($$ select action, actor_id, note, new_value->>'step', new_value->>'decision'
                       from activity_log where item_id = (select id from it1) and action like 'workflow.%' order by id $$,
  $$ values ('workflow.submitted'::text, '00000000-0000-0000-0000-0000000a9002'::uuid, 'Ready for review'::text, null::text, null::text),
            ('workflow.decided', '00000000-0000-0000-0000-0000000a9003', 'Reads well', 'Review', 'approved'),
            ('workflow.decided', '00000000-0000-0000-0000-0000000a9004', null, 'Approval', 'approved'),
            ('workflow.decided', '00000000-0000-0000-0000-0000000a9001', 'Add the rollback plan', 'Approval', 'rejected'),
            ('workflow.decided', '00000000-0000-0000-0000-0000000a9003', 'Rollback added', 'Review', 'approved'),
            ('workflow.decided', '00000000-0000-0000-0000-0000000a9004', null, 'Approval', 'approved'),
            ('workflow.decided', '00000000-0000-0000-0000-0000000a9001', 'Approved for use', 'Approval', 'approved'),
            ('workflow.approved', '00000000-0000-0000-0000-0000000a9001', null, null, null) $$,
  'every decision is in the item''s log: who, step, decision, comment');
select is((select count(*)::int from activity_log where item_id = (select id from it1) and action = 'item.locked'), 1,
  'the lock is logged');
select is((verify_activity_chain((select id::text from it1)))->>'ok', 'true', 'the item''s hash chain verifies');
select throws_like($$ select workflow_decide((select id from i1), 'approved') $$,
  'approval: this approval has already ended.', 'an ended approval takes no more decisions');
reset role;
select throws_like($$ update workflow_decisions set comment = 'changed' where instance_id = (select id from i1) $$,
  'workflow_decisions is append-only', 'decisions are append-only');
set local role authenticated;

-- ───────────── access is reported at submit; auditors never approve ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9001","role":"authenticated"}', true);
update sheets set settings = jsonb_build_object('workflows', jsonb_build_array(jsonb_build_object(
  'id', 'contract', 'name', 'Contract sign-off', 'enabled', true,
  'steps', jsonb_build_array(jsonb_build_object('id', 'legal', 'name', 'Legal',
    'approvers', jsonb_build_object('kind', 'people', 'userIds', jsonb_build_array(
       '00000000-0000-0000-0000-0000000a9003', '00000000-0000-0000-0000-0000000a9006')),
    'mode', 'any', 'onReject', jsonb_build_object('to', 'close'))))))
 where id = 'a9a9a9a9-1111-0000-0000-000000000002';
select set_sheet_access('a9a9a9a9-1111-0000-0000-000000000002', 'restricted');
select set_access_grant('sheet', 'a9a9a9a9-1111-0000-0000-000000000002', '00000000-0000-0000-0000-0000000a9002', 'editor');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9002","role":"authenticated"}', true);
create temp table it2 as select * from create_item('a9a9a9a9-1111-0000-0000-000000000002', 'a9a9a9a9-2222-0000-0000-000000000002', 'Supplier MSA', 'a0');
select throws_like($$ select workflow_submit((select id from it2), 'contract') $$,
  '%Step 1, Legal: Auditor, Editor2 cannot open this sheet. Give them access or change the approvers.%',
  'an approver without access is reported at submit, not skipped');
select throws_like($$ select workflow_submit((select id from it2), 'contract') $$,
  '%Auditor can only view as an auditor.%', 'an auditor approver is reported');

-- ───────────── withdraw, reject to close ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9001","role":"authenticated"}', true);
select set_access_grant('sheet', 'a9a9a9a9-1111-0000-0000-000000000002', '00000000-0000-0000-0000-0000000a9003', 'viewer');
update sheets set settings = jsonb_set(settings, '{workflows,0,steps,0,approvers,userIds}',
  '["00000000-0000-0000-0000-0000000a9003"]') where id = 'a9a9a9a9-1111-0000-0000-000000000002';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9002","role":"authenticated"}', true);
select lives_ok($$ select workflow_submit((select id from it2), 'contract') $$, 'submitted once the approver has access');
create temp table i2 as select id from workflow_instances where item_id = (select id from it2) and status = 'in_progress';
grant select on i2 to authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9003","role":"authenticated"}', true);
select throws_like($$ select workflow_withdraw((select id from i2)) $$,
  'approval: only the person who submitted it, an owner or an admin can withdraw it.', 'an approver cannot withdraw');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9002","role":"authenticated"}', true);
select is((select workflow_withdraw((select id from i2), 'Wrong version')->>'status'), 'withdrawn', 'the submitter withdraws');
select lives_ok($$ select workflow_submit((select id from it2), 'contract') $$, 'and submits again');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000a9003","role":"authenticated"}', true);
select is((select workflow_decide((select id from workflow_instances where item_id = (select id from it2)
                                                                       and status = 'in_progress'),
                                  'rejected', 'Liability cap missing')->>'outcome'), 'rejected',
  'a rejection that closes ends it rejected');

-- ───────────── grants ─────────────
reset role;
select ok(has_function_privilege('authenticated', 'workflow_decide(uuid,text,text)', 'execute')
          and has_function_privilege('authenticated', 'workflow_submit(uuid,text,text,uuid,uuid)', 'execute')
          and has_function_privilege('authenticated', 'workflow_withdraw(uuid,text)', 'execute'),
  'the three RPCs are granted to authenticated');
select ok(not has_function_privilege('authenticated', '_wf_resolve(items,jsonb)', 'execute')
          and not has_function_privilege('authenticated', '_wf_apply(uuid,jsonb,text,text,boolean,text,uuid,uuid,text)', 'execute')
          and not has_function_privilege('anon', 'workflow_decide(uuid,text,text)', 'execute'),
  'the helpers are granted to nobody, the RPCs not to anon');

select * from finish();
rollback;
