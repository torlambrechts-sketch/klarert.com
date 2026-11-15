-- Invites by email (0070, board review A4): creating, resending and revoking an invite is logged on the workspace
-- chain without the address; resending is for owners and admins, at most once every 10 minutes and 5 times per
-- invite, and only while the link works. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(15);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000097001', 'inv-owner@a.test', now()),
  ('00000000-0000-0000-0000-000000097002', 'inv-admin@a.test', now()),
  ('00000000-0000-0000-0000-000000097003', 'inv-editor@a.test', now());
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000097001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000097002', 'Adam Admin', 'AA'),
  ('00000000-0000-0000-0000-000000097003', 'Eve Editor', 'EE');
insert into orgs (id, name, slug) values ('97000000-0000-0000-0000-00000000000a', 'Invites A', 'pgtap-invites-a');
insert into memberships (org_id, user_id, role) values
  ('97000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000097001', 'owner'),
  ('97000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000097002', 'admin'),
  ('97000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000097003', 'editor');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000009700' || u,
                    'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;
select pg_temp.as_user('1');

insert into invites (id, org_id, email, role, invited_by) values
  ('97000009-0000-0000-0000-000000000001', '97000000-0000-0000-0000-00000000000a', 'new@a.test', 'editor', auth.uid()),
  ('97000009-0000-0000-0000-000000000002', '97000000-0000-0000-0000-00000000000a', 'late@a.test', 'viewer', auth.uid()),
  ('97000009-0000-0000-0000-000000000003', '97000000-0000-0000-0000-00000000000a', 'gone@a.test', 'viewer', auth.uid());

select ok((select chain_key = 'sheet:97000000-0000-0000-0000-00000000000a' and actor_id = auth.uid()
                  and new_value ->> 'role' = 'editor' and new_value ? 'link_expires_at'
             from activity_log where action = 'invite.created'
              and new_value ->> 'invite_id' = '97000009-0000-0000-0000-000000000001'),
  'creating an invite is logged on the workspace chain');
select is((select count(*)::int from activity_log where org_id = '97000000-0000-0000-0000-00000000000a'
            and action like 'invite.%' and (coalesce(new_value, '{}') || coalesce(old_value, '{}'))::text like '%@a.test%'),
  0, 'invite entries never hold the address');

select is((select email || '|' || role || '|' || resend_count || '|' || org_name || '|' || invited_by_name
             from resend_invite('97000009-0000-0000-0000-000000000001')),
  'new@a.test|editor|1|Invites A|Olga Owner', 'an owner resends an open invite and gets what the email needs');
select ok((select new_value ->> 'resend' = '1' and chain_key = 'sheet:97000000-0000-0000-0000-00000000000a'
             from activity_log where action = 'invite.resent'
              and new_value ->> 'invite_id' = '97000009-0000-0000-0000-000000000001'),
  'the resend is logged on the workspace chain');

select pg_temp.as_user('2');
select throws_ok($$ select resend_invite('97000009-0000-0000-0000-000000000001') $$, 'invite resend: too soon',
  'a second resend within 10 minutes is refused');

select pg_temp.as_user('3');
select throws_ok($$ select resend_invite('97000009-0000-0000-0000-000000000001') $$, 'invite not found',
  'an editor cannot resend an invite');

-- four more resends, each more than 10 minutes after the last; the sixth is refused
reset role;
create function pg_temp.later() returns void language sql security definer as $$
  update invites set resent_at = now() - interval '11 minutes' where id = '97000009-0000-0000-0000-000000000001';
$$;
grant execute on function pg_temp.later() to authenticated;
set local role authenticated;
select pg_temp.as_user('2');
select pg_temp.later(); select resend_invite('97000009-0000-0000-0000-000000000001');
select pg_temp.later(); select resend_invite('97000009-0000-0000-0000-000000000001');
select pg_temp.later(); select resend_invite('97000009-0000-0000-0000-000000000001');
select pg_temp.later();
select is((select resend_count from resend_invite('97000009-0000-0000-0000-000000000001')), 5,
  'an admin resends it after 10 minutes, up to 5 times');
select pg_temp.later();
select throws_ok($$ select resend_invite('97000009-0000-0000-0000-000000000001') $$, 'invite resend: limit reached',
  'a sixth resend is refused');
select is((select count(*)::int from activity_log where action = 'invite.resent'
            and new_value ->> 'invite_id' = '97000009-0000-0000-0000-000000000001'), 5, 'each resend is logged once');

-- an ended link and a used invite cannot be resent
reset role;
update invites set link_expires_at = now() - interval '1 minute' where id = '97000009-0000-0000-0000-000000000002';
update invites set accepted_at = now() where id = '97000009-0000-0000-0000-000000000003';
set local role authenticated;
select pg_temp.as_user('1');
select throws_ok($$ select resend_invite('97000009-0000-0000-0000-000000000002') $$, 'invite resend: link expired',
  'an invite whose link has ended is not resent');
select throws_ok($$ select resend_invite('97000009-0000-0000-0000-000000000003') $$, 'invite already used',
  'a used invite is not resent');

-- revoking an open invite is logged; removing a used one is not
delete from invites where id in ('97000009-0000-0000-0000-000000000002', '97000009-0000-0000-0000-000000000003');
select is((select count(*)::int from activity_log where action = 'invite.revoked'
            and old_value ->> 'invite_id' in ('97000009-0000-0000-0000-000000000002',
                                              '97000009-0000-0000-0000-000000000003')), 1,
  'revoking an open invite is logged, cleaning up a used one is not');
select ok((select actor_id = auth.uid() and old_value ->> 'role' = 'viewer' from activity_log
            where action = 'invite.revoked' and old_value ->> 'invite_id' = '97000009-0000-0000-0000-000000000002'),
  'with who revoked it and the role');
reset role;

select ok(not has_function_privilege('anon', 'resend_invite(uuid)', 'execute'), 'signed-out callers cannot resend');
select ok(not has_function_privilege('authenticated', 'invites_audit()', 'execute'),
  'the audit trigger function is not callable');

select * from finish();
rollback;
