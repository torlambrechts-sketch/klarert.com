-- Your account › Your name: a person renames their own profile through `profiles_self`; nobody renames someone else's,
-- and a deleted profile ("Former member", 0071) is not renamed, even by a token that outlives its auth user.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000073101', 'name-ada@a.test', now()),
  ('00000000-0000-0000-0000-000000073102', 'name-bo@a.test', now());
insert into profiles (id, display_name, initials) values
  ('00000000-0000-0000-0000-000000073101', 'Ada Lovelace', 'AL'),
  ('00000000-0000-0000-0000-000000073102', 'Bo Berg', 'BB'),
  ('00000000-0000-0000-0000-000000073103', 'Former member', '?');
-- Cy deleted her account: the auth user is gone, the profile is the tombstone
update profiles set deleted_at = now() where id = '00000000-0000-0000-0000-000000073103';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000073101","role":"authenticated"}', true);
select lives_ok($$ update profiles set display_name = 'Ada King', initials = 'AK'
                    where id = '00000000-0000-0000-0000-000000073101' $$, 'a person renames themselves');
update profiles set display_name = 'Not Bo', initials = 'NB' where id = '00000000-0000-0000-0000-000000073102';

-- a token of the deleted account, still within its hour
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000073103","role":"authenticated"}', true);
update profiles set display_name = 'Cy Back', initials = 'CB' where id = '00000000-0000-0000-0000-000000073103';
select is((select count(*)::int from profiles where id = '00000000-0000-0000-0000-000000073103'), 1,
  'the deleted profile is still visible to that token');

reset role;
select is((select display_name || '|' || initials from profiles where id = '00000000-0000-0000-0000-000000073101'),
  'Ada King|AK', 'the new name and initials are saved');
select is((select display_name || '|' || initials from profiles where id = '00000000-0000-0000-0000-000000073102'),
  'Bo Berg|BB', 'nobody renames someone else');
select is((select display_name || '|' || initials || '|' || (deleted_at is not null)
             from profiles where id = '00000000-0000-0000-0000-000000073103'),
  'Former member|?|true', 'a deleted profile cannot be renamed');

select * from finish();
rollback;
