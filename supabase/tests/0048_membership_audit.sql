-- Every join is logged, invites expire and need a confirmed address, pauses only through the logged function
-- (0057, M4, SA-8). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000093001', 'mem-owner@a.test', now()),
  ('00000000-0000-0000-0000-000000093002', 'mem-new@a.test', now()),
  ('00000000-0000-0000-0000-000000093003', 'mem-unconfirmed@a.test', null),
  ('00000000-0000-0000-0000-000000093004', 'mem-late@a.test', now()),
  ('00000000-0000-0000-0000-000000093005', 'mem-editor@a.test', now());
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000093001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000093002', 'Nina New', 'NN'),
  ('00000000-0000-0000-0000-000000093003', 'Una Unconfirmed', 'UU'),
  ('00000000-0000-0000-0000-000000093004', 'Larry Late', 'LL'),
  ('00000000-0000-0000-0000-000000093005', 'Eve Editor', 'EE');
insert into orgs (id, name, slug) values ('93000000-0000-0000-0000-00000000000a', 'Members A', 'pgtap-members-a');
insert into memberships (org_id, user_id, role) values
  ('93000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000093001', 'owner'),
  ('93000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000093005', 'editor');
insert into invites (id, org_id, email, role, invited_by, token, link_expires_at) values
  ('93000009-0000-0000-0000-000000000001', '93000000-0000-0000-0000-00000000000a', 'mem-new@a.test', 'editor',
   '00000000-0000-0000-0000-000000093001', 'tok-new', now() + interval '14 days'),
  ('93000009-0000-0000-0000-000000000002', '93000000-0000-0000-0000-00000000000a', 'mem-unconfirmed@a.test', 'editor',
   '00000000-0000-0000-0000-000000093001', 'tok-unconfirmed', now() + interval '14 days'),
  ('93000009-0000-0000-0000-000000000003', '93000000-0000-0000-0000-00000000000a', 'mem-late@a.test', 'editor',
   '00000000-0000-0000-0000-000000093001', 'tok-late', now() - interval '1 day');
insert into sheets (id, org_id, name, id_prefix, position) values
  ('93000001-0000-0000-0000-000000000001', '93000000-0000-0000-0000-00000000000a', 'Risks', 'RSK-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('93000003-0000-0000-0000-000000000001', '93000000-0000-0000-0000-00000000000a', '93000001-0000-0000-0000-000000000001', 'All', 'a0');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position) values
  ('93000005-0000-0000-0000-000000000001', '93000000-0000-0000-0000-00000000000a', '93000001-0000-0000-0000-000000000001',
   '93000003-0000-0000-0000-000000000001', 1, 'RSK-001', 'Fire', 'a0');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by) values
  ('93000007-0000-0000-0000-000000000001', '93000000-0000-0000-0000-00000000000a', '93000001-0000-0000-0000-000000000001',
   'Escalate', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-000000093001');

select is((select count(*)::int from activity_log where org_id = '93000000-0000-0000-0000-00000000000a'
            and action = 'member.added'), 2, 'every new membership is logged, whatever the role');

create function pg_temp.as_user(u text, email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009300' || u,
                    'email', email, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text, text) to authenticated;
set local role authenticated;

select pg_temp.as_user('1', 'mem-owner@a.test');
select throws_ok($$ insert into memberships (org_id, user_id, role) values
  ('93000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000093004', 'admin') $$,
  '42501', 'access: People join a workspace by accepting an invite.',
  'an owner or admin cannot add a member (or a second account) directly');

select pg_temp.as_user('2', 'mem-new@a.test');
select lives_ok($$ select accept_invite('tok-new') $$, 'a confirmed invitee accepts');
select ok((select new_value ->> 'via' = 'invite' and new_value ->> 'invite_id' = '93000009-0000-0000-0000-000000000001'
                  and new_value ->> 'invited_by' = '00000000-0000-0000-0000-000000093001' and actor_id = auth.uid()
             from activity_log where org_id = '93000000-0000-0000-0000-00000000000a' and action = 'member.added'
              and new_value ->> 'user_id' = '00000000-0000-0000-0000-000000093002'),
  'joining through an invite is logged with the invite and who sent it');

select pg_temp.as_user('3', 'mem-unconfirmed@a.test');
select throws_ok($$ select accept_invite('tok-unconfirmed') $$, '42501',
  'access: Confirm your email address, then open the invite link again.',
  'an invite cannot be accepted with an unconfirmed address');

select pg_temp.as_user('4', 'mem-late@a.test');
select throws_ok($$ select accept_invite('tok-late') $$, 'invite expired', 'an expired invite link is refused');

-- automation pauses only through set_automation_pause
select pg_temp.as_user('5', 'mem-editor@a.test');
select throws_ok($$ insert into automation_pauses (automation_id, item_id, org_id, paused_by) values
  ('93000007-0000-0000-0000-000000000001', '93000005-0000-0000-0000-000000000001', '93000000-0000-0000-0000-00000000000a',
   auth.uid()) $$, '42501', null, 'an editor cannot pause an automation for an item directly (unlogged)');
select lives_ok($$ select set_automation_pause('93000007-0000-0000-0000-000000000001',
                                               '93000005-0000-0000-0000-000000000001', true) $$,
  'set_automation_pause still pauses it');
select is((select count(*)::int from activity_log where item_id = '93000005-0000-0000-0000-000000000001'
            and action = 'automation.paused'), 1, 'and logs automation.paused');
select throws_ok($$ delete from automation_pauses $$, '42501', null, 'nor resume it directly');
reset role;

insert into invites (id, org_id, email, role, invited_by) values
  ('93000009-0000-0000-0000-000000000004', '93000000-0000-0000-0000-00000000000a', 'mem-later@a.test', 'viewer',
   '00000000-0000-0000-0000-000000093001');
select ok((select link_expires_at between now() + interval '13 days' and now() + interval '15 days' from invites
            where id = '93000009-0000-0000-0000-000000000004'), 'a new invite link lasts 14 days');

select * from finish();
rollback;
