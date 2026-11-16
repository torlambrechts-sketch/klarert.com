-- A user deleted in the Supabase dashboard (0072): the same clean-up as Delete my account, through a BEFORE DELETE
-- trigger on auth.users; the only owner is not refused, the workspace is left without an owner and that is logged;
-- Delete my account still works and the trigger then does nothing. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(25);

-- Sam is the only owner of Lone (with Eve as editor) and an editor in Duo; Dan co-owns Duo with Kim; Kim stays;
-- Tia deletes her own account; Pia's profile is already marked deleted (a half-done earlier clean-up).
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000072001', 'sup-sam@a.test', now()),
  ('00000000-0000-0000-0000-000000072002', 'sup-dan@a.test', now()),
  ('00000000-0000-0000-0000-000000072003', 'sup-kim@a.test', now()),
  ('00000000-0000-0000-0000-000000072004', 'sup-tia@a.test', now()),
  ('00000000-0000-0000-0000-000000072005', 'sup-pia@a.test', now()),
  ('00000000-0000-0000-0000-000000072006', 'sup-eve@a.test', now()),
  ('00000000-0000-0000-0000-000000072007', 'sup-nop@a.test', now());
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000072001', 'Sam Solo', 'SS'),
  ('00000000-0000-0000-0000-000000072002', 'Dan Duo', 'DD'),
  ('00000000-0000-0000-0000-000000072003', 'Kim Keeps', 'KK'),
  ('00000000-0000-0000-0000-000000072004', 'Tia Self', 'TS'),
  ('00000000-0000-0000-0000-000000072005', 'Pia Partial', 'PP'),
  ('00000000-0000-0000-0000-000000072006', 'Eve Editor', 'EE');
insert into orgs (id, name, slug, settings) values
  ('72000000-0000-0000-0000-00000000000a', 'Lone Works', 'pgtap-support-lone', '{}'),
  ('72000000-0000-0000-0000-00000000000b', 'Duo Works', 'pgtap-support-duo', '{"requireTwoStep": true}');
insert into memberships (org_id, user_id, role) values
  ('72000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000072001', 'owner'),
  ('72000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000072006', 'editor'),
  ('72000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000072004', 'viewer'),
  ('72000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000072005', 'viewer'),
  ('72000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000072002', 'owner');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000072002","aal":"aal2"}', true);
insert into memberships (org_id, user_id, role) values
  ('72000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000072003', 'owner'),
  ('72000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000072001', 'editor');
select set_config('request.jwt.claims', '', true);
update profiles set deleted_at = '2026-11-01T00:00:00Z' where id = '00000000-0000-0000-0000-000000072005';
insert into sheets (id, org_id, name, id_prefix, position) values
  ('72000001-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000a', 'Actions', 'AC-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('72000002-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-00000000000a',
   '72000001-0000-0000-0000-00000000000a', 'Open', 'a0');
insert into items (id, org_id, sheet_id, group_id, seq, display_id, name, position, created_by, updated_by) values
  ('72000003-0000-0000-0000-000000000001', '72000000-0000-0000-0000-00000000000a', '72000001-0000-0000-0000-00000000000a',
   '72000002-0000-0000-0000-00000000000a', 1, 'AC-001', 'Check the alarm', 'a0',
   '00000000-0000-0000-0000-000000072001', '00000000-0000-0000-0000-000000072001');
insert into item_updates (org_id, item_id, author_id, body) values
  ('72000000-0000-0000-0000-00000000000a', '72000003-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000072001', 'Booked the engineer');

create temp table log_before as select id, to_jsonb(a) as entry from activity_log a;

-- the functions are internal
select ok(not has_function_privilege('anon', 'auth_users_close_account()', 'execute')
          and not has_function_privilege('authenticated', 'auth_users_close_account()', 'execute')
          and not has_function_privilege('service_role', 'auth_users_close_account()', 'execute'),
  'the trigger function is not executable by any API role');
select ok(not has_function_privilege('anon', '_account_close(uuid, boolean)', 'execute')
          and not has_function_privilege('authenticated', '_account_close(uuid, boolean)', 'execute')
          and not has_function_privilege('service_role', '_account_close(uuid, boolean)', 'execute'),
  'neither is the shared clean-up');
select has_trigger('auth', 'users', 'auth_users_account_closed', 'auth.users has the clean-up trigger');

-- the flag is narrow: naming one person does not let another's only-owner membership go
select set_config('app.member_op', 'account_deleted_by_support', true);
select set_config('app.member_op_user', '00000000-0000-0000-0000-000000072006', true);
select throws_ok($$ delete from memberships where user_id = '00000000-0000-0000-0000-000000072001'
                    and org_id = '72000000-0000-0000-0000-00000000000a' $$,
  'P0001', 'only an owner can change who owns the workspace', 'the support flag covers only the person it names');
select set_config('app.member_op', '', true);
select set_config('app.member_op_user', '', true);

-- support deletes Sam in the dashboard (as the database owner, no person's session)
delete from auth.users where id = '00000000-0000-0000-0000-000000072001';
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-000000072001'), 0,
  'the only owner''s deletion succeeds');
select is((select count(*)::int from memberships where user_id = '00000000-0000-0000-0000-000000072001'), 0,
  'every membership is gone');
select is((select display_name || '|' || initials || '|' || (deleted_at is not null)
             from profiles where id = '00000000-0000-0000-0000-000000072001'),
  'Former member|?|true', 'the profile is anonymised and marked deleted');
select is((select count(*)::int from activity_log
            where action = 'member.removed' and old_value ->> 'user_id' = '00000000-0000-0000-0000-000000072001'
              and new_value ->> 'how' = 'account deleted by support' and actor_kind = 'system' and actor_id is null
              and note = 'Sam Solo'),
  2, 'each removal is logged as member.removed, how: account deleted by support');
select is((select new_value from activity_log
            where action = 'member.removed' and old_value ->> 'user_id' = '00000000-0000-0000-0000-000000072001'
              and org_id = '72000000-0000-0000-0000-00000000000a'),
  '{"how": "account deleted by support", "ownerless": true}'::jsonb,
  'the workspace he owned alone is logged as left without an owner');
select is((select new_value from activity_log
            where action = 'member.removed' and old_value ->> 'user_id' = '00000000-0000-0000-0000-000000072001'
              and org_id = '72000000-0000-0000-0000-00000000000b'),
  '{"how": "account deleted by support"}'::jsonb, 'an editor membership is not');
select is((select count(*)::int from memberships where org_id = '72000000-0000-0000-0000-00000000000a' and role = 'owner'),
  0, 'Lone Works has no owner');
select is((select count(*)::int from memberships where org_id = '72000000-0000-0000-0000-00000000000a'), 3,
  'its other members stay');
select is((select p.display_name from items i join profiles p on p.id = i.created_by
            where i.id = '72000003-0000-0000-0000-000000000001'), 'Former member',
  'the item''s created by still resolves to the profile');
select is((select p.display_name from item_updates u join profiles p on p.id = u.author_id
            where u.item_id = '72000003-0000-0000-0000-000000000001'), 'Former member',
  'and the update''s author');

-- a co-owner deleted by support: the workspace keeps an owner, so no ownerless note
delete from auth.users where id = '00000000-0000-0000-0000-000000072002';
select is((select new_value from activity_log
            where action = 'member.removed' and old_value ->> 'user_id' = '00000000-0000-0000-0000-000000072002'),
  '{"how": "account deleted by support"}'::jsonb, 'a co-owner''s removal leaves an owner and says so by no note');
select is((select string_agg(user_id::text, ',') from memberships
            where org_id = '72000000-0000-0000-0000-00000000000b' and role = 'owner'),
  '00000000-0000-0000-0000-000000072003', 'Kim still owns Duo Works');

-- a profile already marked deleted: the trigger does nothing
delete from auth.users where id = '00000000-0000-0000-0000-000000072005';
select is((select display_name || '|' || deleted_at::text from profiles where id = '00000000-0000-0000-0000-000000072005'),
  'Pia Partial|2026-11-01 00:00:00+00', 'a profile already marked deleted is not changed again');
select is((select count(*)::int from memberships where user_id = '00000000-0000-0000-0000-000000072005'), 1,
  'and its memberships are not touched');

-- a user with no profile is deleted as before
delete from auth.users where id = '00000000-0000-0000-0000-000000072007';
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-000000072007'), 0,
  'a user without a profile is deleted');

-- Tia deletes her own account: delete_my_account cleans up, then the trigger does nothing extra
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000007200' || u,
                    'role', 'authenticated', 'aal', 'aal1')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
set local role authenticated;
select pg_temp.as_user('4');
select is(delete_my_account(), '{"memberships_removed": 1}'::jsonb, 'Delete my account still works');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-000000072004'), 0,
  'her auth user is deleted');
select is((select string_agg(new_value ->> 'how', ',') from activity_log
            where action = 'member.removed' and old_value ->> 'user_id' = '00000000-0000-0000-0000-000000072004'),
  'account deleted', 'one removal, logged as her own deletion, none by support');
select is((select display_name || '|' || initials from profiles where id = '00000000-0000-0000-0000-000000072004'),
  'Former member|?', 'her profile is anonymised');

-- nothing written before changed, and nobody else was touched
select is((select count(*)::int from log_before b join activity_log a using (id) where to_jsonb(a) = b.entry),
  (select count(*)::int from log_before), 'every earlier log entry is unchanged');
select is((select display_name from profiles where id = '00000000-0000-0000-0000-000000072006'), 'Eve Editor',
  'other profiles are untouched');

select * from finish();
rollback;
