-- The hash chain is ordered by chain_seq, assigned under the chain's lock; v2 hashes cover where an entry belongs;
-- the append-only tables cannot be truncated (0058, M5, L5). Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000094001', 'chain-owner@a.test');
insert into profiles (id, display_name, initials) values ('00000000-0000-0000-0000-000000094001', 'Olga Owner', 'OO');
insert into orgs (id, name, slug) values ('94000000-0000-0000-0000-00000000000a', 'Chain A', 'pgtap-chain-a');
insert into memberships (org_id, user_id, role) values
  ('94000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000094001', 'owner');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000094001","role":"authenticated"}', true);

-- the race: one writer takes its id first, then waits for the chain's lock while others write
create temp table early as select nextval(pg_get_serial_sequence('activity_log', 'id')) as id;
-- an item chain written by this version
insert into activity_log (org_id, item_id, chain_key, actor_kind, action, note)
select '94000000-0000-0000-0000-00000000000a', '94000005-0000-0000-0000-000000000001', '', 'system', 'test.entry', 'n' || g
  from generate_series(1, 3) g;
select is((select array_agg(chain_seq order by id) from activity_log
            where chain_key = '94000005-0000-0000-0000-000000000001'), array[1, 2, 3]::bigint[],
  'each entry takes the next sequence number of its chain');
select ok((select bool_and(hash_v = 2) from activity_log where chain_key = '94000005-0000-0000-0000-000000000001'),
  'new entries use the v2 hash');

-- the race: an entry whose id is lower than the entry it follows (its id was taken before it waited for the lock)
insert into activity_log (id, org_id, item_id, chain_key, actor_kind, action, note) overriding system value
values ((select id from early),
        '94000000-0000-0000-0000-00000000000a', '94000005-0000-0000-0000-000000000001', '', 'system', 'test.entry', 'late');
select is((select chain_seq from activity_log where chain_key = '94000005-0000-0000-0000-000000000001' and note = 'late'),
  4::bigint, 'an entry that got its id early still comes last in its chain');
select is((verify_activity_chain('94000005-0000-0000-0000-000000000001')) ->> 'ok', 'true',
  'and the chain verifies: honest concurrency is never reported as tampering');
select is((select count(distinct chain_seq)::int from activity_log
            where chain_key = '94000005-0000-0000-0000-000000000001'), 4, 'sequence numbers are unique in a chain');

-- a chain written before 0058 (no chain_seq, v1 hashes) keeps verifying, and new entries follow it
set local session_replication_role = replica;
insert into activity_log (org_id, item_id, chain_key, actor_kind, action, at, prev_hash, hash)
select '94000000-0000-0000-0000-00000000000a', '94000005-0000-0000-0000-000000000002',
       '94000005-0000-0000-0000-000000000002', 'system', 'legacy', '2026-01-01T00:00:00Z', 'genesis',
       activity_hash('genesis', '2026-01-01T00:00:00Z', 'system', null, 'legacy', null, null, null, null);
set local session_replication_role = origin;
insert into activity_log (org_id, item_id, chain_key, actor_kind, action)
values ('94000000-0000-0000-0000-00000000000a', '94000005-0000-0000-0000-000000000002', '', 'system', 'after');
select is((select prev_hash = (select hash from activity_log where action = 'legacy'
                                  and chain_key = '94000005-0000-0000-0000-000000000002')
             from activity_log where action = 'after'), true, 'the first new entry links to the last earlier entry');
select is((verify_activity_chain('94000005-0000-0000-0000-000000000002')) ->> 'entries', '2',
  'and a chain with earlier and new entries verifies as a whole');
select is((verify_activity_chain('94000005-0000-0000-0000-000000000002')) ->> 'ok', 'true', 'ok');

-- L5: a v2 entry copied to another item's chain is caught (its hash covers chain, item and workspace)
set local session_replication_role = replica;
insert into activity_log (org_id, item_id, chain_key, actor_kind, action, at, prev_hash, hash, chain_seq, hash_v, note)
select org_id, '94000005-0000-0000-0000-000000000003', '94000005-0000-0000-0000-000000000003', actor_kind, action, at,
       prev_hash, hash, chain_seq, hash_v, note
  from activity_log where chain_key = '94000005-0000-0000-0000-000000000001' and chain_seq = 1;
set local session_replication_role = origin;
select is((verify_activity_chain('94000005-0000-0000-0000-000000000003')) ->> 'ok', 'false',
  'an entry moved to another chain no longer verifies');

-- L5: no TRUNCATE
select throws_ok($$ truncate activity_log $$, 'P0001', 'activity_log is append-only', 'the log cannot be truncated');
select ok(not has_table_privilege('authenticated', 'activity_log', 'truncate')
          and not has_table_privilege('anon', 'items', 'truncate'), 'API roles hold no TRUNCATE privilege');

select * from finish();
rollback;
