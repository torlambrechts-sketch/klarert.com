-- Forms v1 (0022_forms_v1.sql): source and version on every submission, the form's state enforced on the public
-- path, per-link rate limit, form_version and view.form_changed, link regeneration, no IP stored, grants.
-- Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(41);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000017a1', 'owner@forms.test'),
  ('00000000-0000-0000-0000-0000000017a2', 'editor@forms.test'),
  ('00000000-0000-0000-0000-0000000017a3', 'viewer@forms.test');
insert into profiles (id, display_name, initials) select id, email, 'XX' from auth.users where email like '%@forms.test';
insert into orgs (id, name, slug) values ('f0f0f0f0-0000-0000-0000-000000000000', 'Forms Org', 'forms-org');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000017a1","role":"authenticated"}', true);
insert into memberships (org_id, user_id, role) values
  ('f0f0f0f0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000017a1', 'owner');
insert into memberships (org_id, user_id, role) values
  ('f0f0f0f0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000017a2', 'editor'),
  ('f0f0f0f0-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000017a3', 'viewer');
select set_config('request.jwt.claims', '', true);
insert into sheets (id, org_id, name, id_prefix, position) values
  ('f0f0f0f0-1111-0000-0000-000000000000', 'f0f0f0f0-0000-0000-0000-000000000000', 'Incidents', 'INC-', 'a0');
insert into groups (id, org_id, sheet_id, name, position) values
  ('f0f0f0f0-2222-0000-0000-000000000001', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000', 'New', 'a0'),
  ('f0f0f0f0-2222-0000-0000-000000000002', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000', 'Triage', 'a1');
insert into fields (id, org_id, sheet_id, key, name, type, position, config) values
  ('f0f0f0f0-3333-0000-0000-000000000001', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'where_seen', 'Where', 'text', 'a0', '{}'),
  ('f0f0f0f0-3333-0000-0000-000000000002', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'channel', 'Channel', 'text', 'a1', '{}'),
  ('f0f0f0f0-3333-0000-0000-000000000003', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'owner', 'Owner', 'people', 'a2', '{}');

-- a public form (reviewed notice, open, a hidden prefilled value, notifies the owner) and an internal-only form
insert into views (id, org_id, sheet_id, name, type, config, position) values
  ('f0f0f0f0-4444-0000-0000-000000000001', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'Report an incident', 'form', '{"form":{"fields":[{"key":"where_seen"},{"key":"owner"}],"status":"open","access":"public",
     "groupId":"f0f0f0f0-2222-0000-0000-000000000002",
     "prefill":[{"key":"channel","value":"QR poster"}],"notify":["00000000-0000-0000-0000-0000000017a1"],
     "notice":{"purpose":"Safety reports","legalBasis":"consent","recipients":"HSE team","retention":"5 years",
               "rights":"Ask privacy@forms.test","version":1,"reviewedVersion":1}}}', 'a0'),
  ('f0f0f0f0-4444-0000-0000-000000000002', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'Investigator intake', 'form', '{"form":{"fields":[{"key":"where_seen"}],"status":"open","access":"internal"}}', 'a1');
insert into form_links (id, org_id, sheet_id, view_id, token) values
  ('f0f0f0f0-5555-0000-0000-000000000001', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'f0f0f0f0-4444-0000-0000-000000000001', repeat('1a', 32)),
  ('f0f0f0f0-5555-0000-0000-000000000002', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'f0f0f0f0-4444-0000-0000-000000000002', repeat('2b', 32));

-- ───────────── public submit: source, version, notice, consent ─────────────
set local role service_role;
select is((submit_public_form(repeat('1a', 32), repeat('1', 64), 'No consent', '{}', 'a0', ''))->>'reason',
  'consent_required', 'a consent-based form refuses a submission without consent');
select is((submit_public_form(repeat('1a', 32), repeat('1', 64), 'Spill at bay 3',
  '{"f0f0f0f0-3333-0000-0000-000000000001":"Bay 3"}', 'a0', '', true))->>'ok', 'true', 'a visitor submits the public form');
select is((submit_public_form(repeat('1a', 32), repeat('1', 64), 'Set channel',
  '{"f0f0f0f0-3333-0000-0000-000000000002":"forged"}', 'a1', '', true))->>'reason', 'invalid',
  'a hidden prefilled field cannot be sent by the visitor');
select is((submit_public_form(repeat('1a', 32), repeat('1', 64), 'Pick a person',
  '{"f0f0f0f0-3333-0000-0000-000000000003":["00000000-0000-0000-0000-0000000017a1"]}', 'a1', '', true))->>'reason',
  'invalid', 'directory fields are never accepted on a public form');
select is((submit_public_form(repeat('2b', 32), repeat('1', 64), 'Outside', '{}', 'a0', ''))->>'reason',
  'internal_only', 'an internal-only form refuses the public path');
reset role;

select results_eq(
  $$ select source_form_id::text, form_version, source_channel, group_id::text, "values"->>'f0f0f0f0-3333-0000-0000-000000000002'
       from items where name = 'Spill at bay 3' $$,
  $$ values ('f0f0f0f0-4444-0000-0000-000000000001', 1, 'public', 'f0f0f0f0-2222-0000-0000-000000000002', 'QR poster') $$,
  'the item records the form, its version and the channel, in the form group, with the prefilled value');
select results_eq(
  $$ select actor_kind, actor_id::text, new_value->'source'->>'form_id', (new_value->'source'->>'form_version')::int,
            new_value->'source'->>'channel', (new_value->'source'->>'notice_version')::int,
            (new_value->'source'->>'consent_at') is not null
       from activity_log a join items i on i.id = a.item_id
      where i.name = 'Spill at bay 3' and a.action = 'item.created' $$,
  $$ values ('form', 'f0f0f0f0-4444-0000-0000-000000000001', 'f0f0f0f0-4444-0000-0000-000000000001', 1, 'public', 1, true) $$,
  'item.created names the form (actor form + view id), version, channel, notice version and consent time');
select is((select count(*)::int from notifications n join items i on i.id = n.item_id
            where i.name = 'Spill at bay 3' and n.user_id = '00000000-0000-0000-0000-0000000017a1'), 1,
  'the people the form notifies get a notification');

-- ───────────── internal submit ─────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000017a2","role":"authenticated"}', true);
select is((submit_internal_form('f0f0f0f0-4444-0000-0000-000000000002', 'Found by the investigator',
  '{"f0f0f0f0-3333-0000-0000-000000000001":"Lab"}', 'b0'))->>'ok', 'true', 'an editor submits an internal form');
select results_eq(
  $$ select a.actor_kind, a.actor_id::text, a.new_value->'source'->>'channel', i.source_channel, i.form_version
       from activity_log a join items i on i.id = a.item_id
      where i.name = 'Found by the investigator' and a.action = 'item.created' $$,
  $$ values ('user', '00000000-0000-0000-0000-0000000017a2', 'internal', 'internal', 1) $$,
  'an internal submission is logged as the signed-in person, with the form as its source');
select is((submit_internal_form('f0f0f0f0-4444-0000-0000-000000000002', 'Extra',
  '{"f0f0f0f0-3333-0000-0000-000000000002":"not on the form"}', 'b1'))->>'reason', 'invalid',
  'fields that are not on an internal form are refused');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000017a3","role":"authenticated"}', true);
select throws_ok($$ select submit_internal_form('f0f0f0f0-4444-0000-0000-000000000002', 'Viewer', '{}', 'b2') $$,
  'P0001', 'not allowed', 'viewers cannot submit forms');

-- ───────────── only owners and admins edit forms and links ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000017a2","role":"authenticated"}', true);
update views set name = 'Renamed by an editor' where id = 'f0f0f0f0-4444-0000-0000-000000000002';
select is((select name from views where id = 'f0f0f0f0-4444-0000-0000-000000000002'), 'Investigator intake',
  'editors cannot change a form');
select throws_ok($$ select form_link_regenerate('f0f0f0f0-4444-0000-0000-000000000001') $$, 'P0001', 'not allowed',
  'editors cannot regenerate a link');
select throws_like($$ insert into views (org_id, sheet_id, name, type, config, position) values
  ('f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000', 'Editor form', 'form',
   '{"form":{"fields":[]}}', 'a5') $$, '%row-level security%', 'editors cannot create a form');

-- ───────────── version, log and the open guard ─────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000017a1","role":"authenticated"}', true);
update views set config = jsonb_set(config, '{form,title}', '"Tell us what happened"')
 where id = 'f0f0f0f0-4444-0000-0000-000000000001';
select is((select form_version from views where id = 'f0f0f0f0-4444-0000-0000-000000000001'), 2,
  'saving a form bumps form_version');
select results_eq(
  $$ select actor_kind, actor_id::text, chain_key, (old_value->>'version')::int, (new_value->>'version')::int, note
       from activity_log where action = 'view.form_changed' and new_value->>'view_id' = 'f0f0f0f0-4444-0000-0000-000000000001' $$,
  $$ values ('user', '00000000-0000-0000-0000-0000000017a1', 'sheet:f0f0f0f0-1111-0000-0000-000000000000', 1, 2,
             'Changed: title') $$,
  'view.form_changed is logged on the sheet chain with who and a before/after summary');
update views set position = 'a9' where id = 'f0f0f0f0-4444-0000-0000-000000000001';
select is((select form_version from views where id = 'f0f0f0f0-4444-0000-0000-000000000001'), 2,
  'moving the view is not a form change');
select ok((select (verify_activity_chain('sheet:f0f0f0f0-1111-0000-0000-000000000000'))->>'ok')::boolean,
  'the sheet chain still verifies');

-- changing the notice's words makes it a new version that needs a review: an open public form cannot keep it
select throws_like($$ update views set config = jsonb_set(config, '{form,notice,purpose}', '"Something else"')
                     where id = 'f0f0f0f0-4444-0000-0000-000000000001' $$,
  '%reviewed by an owner or admin%', 'an open public form cannot take an unreviewed notice');
select throws_like($$ insert into views (org_id, sheet_id, name, type, config, position) values
  ('f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000', 'No notice', 'form',
   '{"form":{"fields":[],"status":"open","access":"public"}}', 'a6') $$,
  '%privacy notice%', 'a public form without a notice cannot be opened');
select lives_ok($$ insert into views (id, org_id, sheet_id, name, type, config, position) values
  ('f0f0f0f0-4444-0000-0000-000000000003', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'Draft', 'form', '{"form":{"fields":[{"key":"where_seen"}],"status":"draft","access":"public",
     "notice":{"purpose":"P","legalBasis":"contract","recipients":"R","retention":"1 year","rights":"Ask us"}}}', 'a7') $$,
  'a draft public form can be saved without a reviewed notice');
update views set config = jsonb_set(config, '{form,notice,reviewedVersion}', '1')
 where id = 'f0f0f0f0-4444-0000-0000-000000000003';
select results_eq(
  $$ select config->'form'->'notice'->>'reviewedBy', (config->'form'->'notice'->>'reviewedAt') is not null
       from views where id = 'f0f0f0f0-4444-0000-0000-000000000003' $$,
  $$ values ('00000000-0000-0000-0000-0000000017a1', true) $$,
  'the review is stamped by the database with who and when');
select lives_ok($$ update views set config = jsonb_set(config, '{form,status}', '"open"')
                   where id = 'f0f0f0f0-4444-0000-0000-000000000003' $$, 'once reviewed, it can open');
reset role;

-- ───────────── closed, not yet open, full ─────────────
set local role service_role;
update views set config = jsonb_set(config, '{form,closesAt}', to_jsonb((now() - interval '1 minute')::text))
 where id = 'f0f0f0f0-4444-0000-0000-000000000003';
insert into form_links (id, org_id, sheet_id, view_id, token) values
  ('f0f0f0f0-5555-0000-0000-000000000003', 'f0f0f0f0-0000-0000-0000-000000000000', 'f0f0f0f0-1111-0000-0000-000000000000',
   'f0f0f0f0-4444-0000-0000-000000000003', repeat('3c', 32));
select is((submit_public_form(repeat('3c', 32), repeat('2', 64), 'Late', '{}', 'c0', ''))->>'reason', 'closed',
  'a form past its closing time refuses submissions');
update views set config = (config #- '{form,closesAt}') || '{}'::jsonb
 where id = 'f0f0f0f0-4444-0000-0000-000000000003';
update views set config = jsonb_set(config, '{form,opensAt}', to_jsonb((now() + interval '1 day')::text))
 where id = 'f0f0f0f0-4444-0000-0000-000000000003';
select is((submit_public_form(repeat('3c', 32), repeat('2', 64), 'Early', '{}', 'c0', ''))->>'reason', 'scheduled',
  'a form that has not opened yet refuses submissions');
select is(get_public_form(repeat('3c', 32))->>'state', 'scheduled', 'and its page says so, without the questions');
update views set config = jsonb_set(config #- '{form,opensAt}', '{form,maxResponses}', '1')
 where id = 'f0f0f0f0-4444-0000-0000-000000000003';
select is((submit_public_form(repeat('3c', 32), repeat('2', 64), 'First', '{}', 'c0', ''))->>'ok', 'true',
  'the first response is accepted');
select is((submit_public_form(repeat('3c', 32), repeat('2', 64), 'Second', '{}', 'c1', ''))->>'reason', 'full',
  'a full form refuses more');
update views set config = jsonb_set(config #- '{form,maxResponses}', '{form,status}', '"closed"')
 where id = 'f0f0f0f0-4444-0000-0000-000000000003';
select is((submit_public_form(repeat('3c', 32), repeat('2', 64), 'Closed', '{}', 'c2', ''))->>'reason', 'closed',
  'a closed form refuses submissions');

-- ───────────── per-link rate limit (each from a different visitor) ─────────────
update views set config = jsonb_set(config, '{form,status}', '"open"') where id = 'f0f0f0f0-4444-0000-0000-000000000003';
-- the link took 5 attempts above; 96 more make 101
select is((select count(*)::int from generate_series(1, 96) n
            where (submit_public_form(repeat('3c', 32), encode(sha256(convert_to('visitor ' || n, 'UTF8')), 'hex'),
                   'Visitor ' || n, '{}', 'd' || lpad(n::text, 3, '0'), ''))->>'reason' = 'rate_limited'), 1,
  'the 101st attempt on one link within the hour is refused, whoever sends it');

-- ───────────── regenerate: the old token dies at once ─────────────
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000017a1","role":"authenticated"}', true);
select isnt((form_link_regenerate('f0f0f0f0-4444-0000-0000-000000000001')).token, repeat('1a', 32),
  'regenerate gives a new token');
select is(get_public_form(repeat('1a', 32)), null, 'the old link no longer opens the form');
select is((select count(*)::int from activity_log where action = 'form.link_regenerated'
            and new_value->>'view_id' = 'f0f0f0f0-4444-0000-0000-000000000001'), 1, 'regenerating is logged once');
select is(form_link_disable('f0f0f0f0-4444-0000-0000-000000000001'), 1, 'disable turns the live link off');
select is((select count(*)::int from form_links where view_id = 'f0f0f0f0-4444-0000-0000-000000000001' and enabled), 0,
  'no live link is left');
reset role;
set local role service_role;
select is((submit_public_form(repeat('1a', 32), repeat('4', 64), 'Old link', '{}', 'e0', '', true))->>'reason',
  'not_found', 'and the old token refuses submissions');
reset role;

-- ───────────── privacy ─────────────
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name in ('items', 'activity_log')
              and (column_name ~* '(^|_)ip($|_)' or column_name ~* 'user_?agent')), 0,
  'items and the activity log have no IP or user agent columns');
select is((select count(*)::int from activity_log
            where org_id = 'f0f0f0f0-0000-0000-0000-000000000000'
              and (coalesce(new_value::text, '') ~ repeat('1', 64) or coalesce(new_value::text, '') ~ 'ip_hash'
                   or coalesce(old_value::text, '') ~ repeat('1', 64) or coalesce(new_value::text, '') ~ repeat('1a', 32))),
  0, 'the activity log holds no visitor key and no link token');

-- ───────────── grants ─────────────
select ok(not has_function_privilege('anon', 'submit_internal_form(uuid, text, jsonb, text)', 'execute')
       and has_function_privilege('authenticated', 'submit_internal_form(uuid, text, jsonb, text)', 'execute'),
  'internal submits need a session');
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like '\_%'
              and (has_function_privilege('anon', p.oid, 'execute')
                   or has_function_privilege('authenticated', p.oid, 'execute'))),
  '{}'::text[], 'no internal _ helper is executable by the API roles');

select * from finish();
rollback;
