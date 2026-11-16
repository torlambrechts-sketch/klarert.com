-- The audit pack's hash recipe (security review 9.1 item 3): the database's hash functions give, for these inputs,
-- the hashes src/engine/audit/hash-recipe.test.ts recomputes from log.csv. If either function changes, this test and
-- that fixture must change together. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
set local timezone = 'UTC';
select plan(6);

create temp table fx(id int, prev text, at timestamptz, ak text, aid uuid, act text, fid uuid, ov jsonb, nv jsonb,
                     note text, org uuid, sh uuid, it uuid, ck text, seq bigint, v1 text, v2 text);
insert into fx values
 (1, 'genesis', '2026-11-15 10:11:12.123456+00', 'user', 'a1b2c3d4-0000-4000-8000-000000000001', 'value.changed',
  'f0000000-0000-4000-8000-000000000002', '{"b": 1.50, "a": [1, "x"], "10": null}', '"Ålesund – “quoted” | pipe"',
  E'Comment with | pipe, "quotes" and a line\nbreak', 'e0000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000005', 7,
  '6cf1addc86c9b74bf9a5b160c8b1fd354b15ea4a23af3c34abbb0a240380d7b1',
  '5bbb5148b5e59be6d1320a95b65e3e8a5e6bfa527caf6c8d1c447b70f752081f'),
 (2, 'ab12', '2026-11-15 23:59:59+01', 'automation', null, 'item.created', null, null,
  '{"name": "R-1", "values": {"x": -3, "y": 0.0001, "z": true}}', null, 'e0000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004', null, 'sheet:50000000-0000-4000-8000-000000000004', 1,
  'c62905be1eb89f6c15287519660a896580eb974d48441e8d6d2c94c2cb546917',
  'b970a821c7ab3e2e09bfd7e55bee2e015932184f2699d37f0446798081d09f03'),
 (3, 'cd34', '2026-01-02 03:04:05.1+00', 'user', 'a1b2c3d4-0000-4000-8000-000000000001', 'workflow.decided', null,
  'null', '{"$personal": "00ff"}', '{"$personal": "abcd"}', 'e0000000-0000-4000-8000-000000000003', null, null,
  'sheet:e0000000-0000-4000-8000-000000000003', 12,
  '385ea3a4d83e4f2108e46e7212f7775329264253be960f57e22465a2cc138412',
  '35772fc6bf9815d0870bb1fa101a5002bdf00bdecb34a06026b0a5f6c6dd5e44');

select is((select array_agg(activity_hash(prev, at, ak, aid, act, fid, ov, nv, note) order by id) from fx),
          (select array_agg(v1 order by id) from fx), 'v1 hashes match the fixture the unit test recomputes');
select is((select array_agg(activity_hash_v2(prev, at, ak, aid, act, fid, ov, nv, note, org, sh, it, ck, seq) order by id)
             from fx),
          (select array_agg(v2 order by id) from fx), 'v2 hashes match the fixture the unit test recomputes');
-- the texts log.csv carries are the database's own printing of the values
select is((select ov::text from fx where id = 1), '{"a": [1, "x"], "b": 1.50, "10": null}',
  'jsonb prints keys by length then bytes and keeps the number''s scale');
select is((select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from fx where id = 2),
  '2026-11-15T22:59:59.000000Z', 'the hashed time is UTC with six decimals');
-- the same recipe holds for entries the trigger writes: v2, place in the chain, org and chain in the hash
insert into orgs (id, name, slug) values ('99560000-0000-0000-0000-00000000000a', 'Hash recipe', 'pgtap-hash-recipe');
insert into activity_log(org_id, chain_key, actor_kind, action, new_value, note)
values ('99560000-0000-0000-0000-00000000000a', '', 'system', 'test.recipe', '{"b": 2, "a": 1.10}', 'n|1');
select is((select hash_v from activity_log where action = 'test.recipe'), 2::smallint, 'new entries are v2');
select is((select hash from activity_log where action = 'test.recipe'),
          (select encode(digest(concat_ws('|', 'v2', prev_hash, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                                          actor_kind, coalesce(actor_id::text, ''), action, coalesce(field_id::text, ''),
                                          coalesce(old_value::text, 'null'), coalesce(new_value::text, 'null'),
                                          coalesce(note, ''), org_id::text, coalesce(sheet_id::text, ''),
                                          coalesce(item_id::text, ''), chain_key, chain_seq::text), 'sha256'), 'hex')
             from activity_log where action = 'test.recipe'),
  'the recipe in activity/method.txt recomputes an entry the trigger wrote');

select * from finish();
rollback;
