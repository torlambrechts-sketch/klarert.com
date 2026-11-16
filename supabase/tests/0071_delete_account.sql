-- Delete my account (0071): the only owner is refused (each workspace named), a person with an authenticator app
-- needs a two-step session, memberships go (logged), the profile stays nameless as a tombstone, the auth user goes,
-- and nothing they made or logged changes. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

-- Olga is the only owner of Solo; Mia is an editor in Solo and co-owns Pair (which requires two-step sign-in) with
-- Ben; Fay has an authenticator app; Ben stays.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000071001', 'del-olga@a.test', now()),
  ('00000000-0000-0000-0000-000000071002', 'del-mia@a.test', now()),
  ('00000000-0000-0000-0000-000000071003', 'del-fay@a.test', now()),
  ('00000000-0000-0000-0000-000000071004', 'del-ben@a.test', now());
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000071001', 'Olga Owner', 'OO'),
  ('00000000-0000-0000-0000-000000071002', 'Mia Member', 'MM'),
  ('00000000-0000-0000-0000-000000071003', 'Fay Factor', 'FF'),
  ('00000000-0000-0000-0000-000000071004', 'Ben Stays', 'BS');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-000000071003', 'Phone', 'totp', 'verified', now(), now());
insert into orgs (id, name, slug, settings) values
  ('71000000-0000-0000-0000-00000000000a', 'Solo Works', 'pgtap-delete-solo', '{}'),
  ('71000000-0000-0000-0000-00000000000b', 'Pair Works', 'pgtap-delete-pair', '{"requireTwoStep": true}');
insert into memberships (org_id, user_id, role) values
  ('71000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000071001', 'owner'),
  ('71000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000071002', 'editor'),
  ('71000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000071003', 'viewer'),
  ('71000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000071004', 'editor'),
  ('71000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000071002', 'owner');
-- a second owner is added by an owner
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000071002","aal":"aal2"}', true);
insert into memberships (org_id, user_id, role) values
  ('71000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000071004', 'owner');
select set_config('request.jwt.claims', '', true);
insert into sheets (id, org_id, name, id_prefix, position) values
  ('71000001-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-00000000000a', 'Actions', 'AC-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('71000002-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-00000000000a',
   '71000001-0000-0000-0000-00000000000a', 'Open', 'a0');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position, created_by, updated_by) values
  ('71000003-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a', '71000001-0000-0000-0000-00000000000a',
   '71000002-0000-0000-0000-00000000000a', 1, 'AC-001', 'Fix the lock', 'a0',
   '00000000-0000-0000-0000-000000071002', '00000000-0000-0000-0000-000000071002');
insert into item_updates (org_id, item_id, author_id, body) values
  ('71000000-0000-0000-0000-00000000000a', '71000003-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000071002', 'Ordered the part');
insert into automations (id, org_id, sheet_id, name, trigger, actions, created_by, acts_as) values
  ('71000004-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a', '71000001-0000-0000-0000-00000000000a',
   'Notify', '{"type":"item_created"}', '[]', '00000000-0000-0000-0000-000000071002',
   '00000000-0000-0000-0000-000000071002');

-- the log as it stands before anyone leaves
create temp table log_before as select id, to_jsonb(a) as entry from activity_log a;
create temp table automation_before as select to_jsonb(a) - 'updated_at' as row from automations a
 where id = '71000004-0000-0000-0000-000000000001';

select ok(not has_function_privilege('anon', 'delete_my_account()', 'execute'), 'anon cannot run it');
select ok(has_function_privilege('authenticated', 'delete_my_account()', 'execute'), 'a signed-in person can');

create function pg_temp.as_user(u text, aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000007100' || u,
                    'role', 'authenticated', 'aal', aal)::text, true);
$$;
grant execute on function pg_temp.as_user(text, text) to authenticated;
-- the refusal's detail: the workspaces as a JSON array
create function pg_temp.refusal() returns text language plpgsql as $$
declare d text;
begin
  perform delete_my_account();
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;
grant execute on function pg_temp.refusal() to authenticated;
set local role authenticated;

-- the only owner
select pg_temp.as_user('1', 'aal1');
select throws_ok($$ select delete_my_account() $$, 'P0001',
  'account: You are the only owner of Solo Works. Make someone else owner of each, or delete it, first.',
  'the only owner of a workspace is refused, and the workspace named');
select is(pg_temp.refusal(), '["Solo Works"]', 'the detail lists the workspaces as JSON');

-- a person with an authenticator app
select pg_temp.as_user('3', 'aal1');
select throws_ok($$ select delete_my_account() $$, '42501',
  'access: Enter the code from your authenticator app first, then try again.',
  'a person with an authenticator app needs a two-step session');

-- Mia deletes her account (co-owner of a workspace that requires two-step sign-in, without an app herself)
select pg_temp.as_user('2', 'aal1');
select is(delete_my_account(), '{"memberships_removed": 2}'::jsonb, 'Mia deletes her account');
select is(delete_my_account(), '{"memberships_removed": 0}'::jsonb, 'a retry with the same token finds nothing to do');
update profiles set display_name = 'Back again' where id = '00000000-0000-0000-0000-000000071002';

select pg_temp.as_user('3', 'aal2');
select is(delete_my_account(), '{"memberships_removed": 1}'::jsonb, 'with a two-step session Fay can');

reset role;
select is((select count(*)::int from memberships where user_id = '00000000-0000-0000-0000-000000071002'), 0,
  'her memberships are gone');
select is((select count(*)::int from activity_log
            where action = 'member.removed' and old_value ->> 'user_id' = '00000000-0000-0000-0000-000000071002'
              and new_value ->> 'how' = 'account deleted' and actor_id = '00000000-0000-0000-0000-000000071002'
              and note = 'Mia Member'),
  2, 'each removal is logged as member.removed, how: account deleted');
select is((select chain_key from activity_log
            where action = 'member.removed' and old_value ->> 'user_id' = '00000000-0000-0000-0000-000000071002'
              and org_id = '71000000-0000-0000-0000-00000000000b'),
  'sheet:71000000-0000-0000-0000-00000000000b', 'on the workspace chain');
select is((select display_name || '|' || initials || '|' || (deleted_at is not null)
             from profiles where id = '00000000-0000-0000-0000-000000071002'),
  'Former member|?|true', 'the profile is anonymised and marked deleted');
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-000000071002'), 0,
  'the auth user is deleted');
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-000000071003'), 0,
  'and Fay''s');
select is((select count(*)::int from auth.mfa_factors where user_id = '00000000-0000-0000-0000-000000071003'), 0,
  'her factors go with it');
select is((select p.display_name from items i join profiles p on p.id = i.created_by
            where i.id = '71000003-0000-0000-0000-000000000001'), 'Former member',
  'the item''s created by still resolves to the profile');
select is((select p.display_name from item_updates u join profiles p on p.id = u.author_id
            where u.item_id = '71000003-0000-0000-0000-000000000001'), 'Former member',
  'and the update''s author');
select is((select to_jsonb(a) - 'updated_at' from automations a where id = '71000004-0000-0000-0000-000000000001'),
  (select row from automation_before), 'her automation is not rewritten (acts_as still names her profile)');
select is((select count(*)::int from log_before b join activity_log a using (id) where to_jsonb(a) = b.entry),
  (select count(*)::int from log_before), 'every earlier log entry is unchanged');
select is((select count(*)::int from activity_log a where action = 'member.removed'
            and old_value ->> 'user_id' in ('00000000-0000-0000-0000-000000071001', '00000000-0000-0000-0000-000000071004')),
  0, 'nobody else was removed');
select is((select string_agg(display_name, ',' order by display_name) from profiles
            where id in ('00000000-0000-0000-0000-000000071001', '00000000-0000-0000-0000-000000071004')),
  'Ben Stays,Olga Owner', 'other profiles are untouched');
select is((select count(*)::int from memberships where user_id in ('00000000-0000-0000-0000-000000071001',
                                                                 '00000000-0000-0000-0000-000000071004')),
  3, 'other memberships are untouched');
select is((select count(*)::int from auth.users where id in ('00000000-0000-0000-0000-000000071001',
                                                           '00000000-0000-0000-0000-000000071004')),
  2, 'other auth users are untouched');

-- a token that outlives the auth user cannot bring the profile back into a workspace
select throws_ok($$ insert into memberships (org_id, user_id, role)
                    values ('71000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000071002', 'viewer') $$,
  '42501', 'access: This account has been deleted.', 'a deleted profile joins nothing');

select * from finish();
rollback;
