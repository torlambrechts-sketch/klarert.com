-- Workspace creation, invites and owner protection (0004_onboarding.sql). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'maria@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'james@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'nadia@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'noprofile@example.test');
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-0000000000a1', 'Maria Pereira', 'MP'),
  ('00000000-0000-0000-0000-0000000000a2', 'James Okafor', 'JO'),
  ('00000000-0000-0000-0000-0000000000a3', 'Nadia Khan', 'NK');

set local role authenticated;

-- ───────────── profile ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","email":"noprofile@example.test","role":"authenticated"}', true);
select throws_ok($$ select create_workspace('No Profile Ltd', 'no-profile') $$, 'profile required',
  'creating a workspace needs a profile');
select lives_ok($$ insert into profiles (id, display_name, initials) values ('00000000-0000-0000-0000-0000000000a4', 'New Person', 'NP') $$,
  'a person can create their own profile');
select throws_ok($$ insert into profiles (id, display_name, initials) values ('00000000-0000-0000-0000-0000000000a2', 'Fake', 'FK') $$,
  '42501', null, 'nobody can create a profile for someone else');

-- ───────────── create workspace ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"maria@example.test","role":"authenticated"}', true);
select is(workspace_slug_available('meridian'), true, 'slug is free before creation');
select is((create_workspace('Meridian Components Ltd', 'meridian')).slug, 'meridian', 'create_workspace returns the workspace');
select is(workspace_slug_available('meridian'), false, 'slug is taken afterwards');
select is((select role::text from memberships m join orgs o on o.id = m.org_id
            where o.slug = 'meridian' and m.user_id = auth.uid()), 'owner', 'the creator is the owner');
select throws_ok($$ select create_workspace('Bad zone', 'bad-zone', 'Mars/Olympus') $$, 'unknown time zone Mars/Olympus',
  'time zone must be a real one');

create temp table t_org as select id from orgs where slug = 'meridian';
grant select on t_org to authenticated;

-- ───────────── owner protection ─────────────
select throws_ok($$ delete from memberships where user_id = auth.uid() $$, 'a workspace needs at least one owner',
  'the last owner cannot leave');
select throws_ok($$ update memberships set role = 'admin' where user_id = auth.uid() $$, 'a workspace needs at least one owner',
  'the last owner cannot be demoted');

insert into memberships (org_id, user_id, role) select id, '00000000-0000-0000-0000-0000000000a3', 'admin' from t_org;

-- ───────────── invites ─────────────
insert into invites (org_id, email, role, invited_by)
select id, 'james@example.test', 'editor', auth.uid() from t_org;
create temp table t_invite as select token from invites where email = 'james@example.test';
grant select on t_invite to authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","email":"noprofile@example.test","role":"authenticated"}', true);
select throws_ok($$ select accept_invite((select token from t_invite)) $$, 'invite is for another email address',
  'an invite only works for its own email');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","email":"James@Example.test","role":"authenticated"}', true);
select is((select org_name from get_invite((select token from t_invite))), 'Meridian Components Ltd', 'the invitee can read their invite');
select is((accept_invite((select token from t_invite))).slug, 'meridian', 'accepting is case-insensitive on email');
select is((select role::text from memberships where user_id = auth.uid()), 'editor', 'the invitee gets the invited role');
select throws_ok($$ select accept_invite((select token from t_invite)) $$, 'invite already used', 'an invite works once');

-- ───────────── admins cannot touch owners ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","email":"nadia@example.test","role":"authenticated"}', true);
select throws_ok($$ update memberships set role = 'owner' where user_id = '00000000-0000-0000-0000-0000000000a2' $$,
  'only an owner can change who owns the workspace', 'an admin cannot make someone owner');

select * from finish();
rollback;
