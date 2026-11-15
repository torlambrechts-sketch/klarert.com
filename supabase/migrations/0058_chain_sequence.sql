-- 0058_chain_sequence.sql · The hash chain is ordered by a per-chain sequence assigned under the chain's lock; new
-- entries also hash where they belong; the append-only tables cannot be truncated (security review M5, L5).
--
-- Before: `activity_chain` (BEFORE INSERT) took the chain's advisory lock, but the identity `id` is assigned before
-- BEFORE triggers run, and `verify_activity_chain` walked a chain `order by id`. Two honest writers on one chain could
-- commit in the opposite order to their ids (T1 id 8, T2 id 9 waits for the lock, T1 id 10 commits, T2 links to 10),
-- and the chain then read as tampered for ever, since the log cannot be repaired.
--
-- Now:
-- 1. `activity_log.chain_seq`: assigned inside `activity_chain`, after the lock is taken: the chain's highest
--    `chain_seq` + 1 (1 for the first entry written by this version). Unique per chain. `prev_hash` is the hash of the
--    entry with the highest `chain_seq`, or, for a chain that has none yet, of its last entry by id, as before.
-- 2. `verify_activity_chain` walks entries written before this migration (no `chain_seq`) by id, as they were
--    written and verified until now, then the new entries by `chain_seq`. Existing chains verify as before.
-- 3. L5: `hash_v` = 2 for new entries, whose hash also covers `org_id`, `sheet_id`, `item_id`, `chain_key` and
--    `chain_seq` (`activity_hash_v2`), so an entry cannot be moved to another chain, item or workspace unnoticed.
--    Older entries keep `hash_v` = 1 and their original hash.
-- 4. L5: no API role may TRUNCATE any table, and a statement trigger refuses TRUNCATE on the append-only tables
--    (activity_log, restricted_activity, personal_activity, workflow_decisions) for everyone; row triggers do not fire
--    on TRUNCATE.

alter table activity_log add column if not exists chain_seq bigint;
alter table activity_log add column if not exists hash_v smallint not null default 1;
create unique index if not exists activity_chain_seq_idx on activity_log (chain_key, chain_seq) where chain_seq is not null;

create or replace function activity_hash_v2(prev text, at timestamptz, actor_kind text, actor_id uuid, action text,
                                            field_id uuid, old_value jsonb, new_value jsonb, note text, org_id uuid,
                                            sheet_id uuid, item_id uuid, chain_key text, chain_seq bigint)
returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(
    'v2|' || prev || '|' || to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || actor_kind || '|' ||
    coalesce(actor_id::text,'') || '|' || action || '|' || coalesce(field_id::text,'') || '|' ||
    coalesce(old_value::text,'null') || '|' || coalesce(new_value::text,'null') || '|' || coalesce(note,'') || '|' ||
    org_id::text || '|' || coalesce(sheet_id::text,'') || '|' || coalesce(item_id::text,'') || '|' || chain_key || '|' ||
    chain_seq::text,
    'sha256'), 'hex')
$$;
revoke execute on function activity_hash_v2(text, timestamptz, text, uuid, text, uuid, jsonb, jsonb, text, uuid, uuid,
                                            uuid, text, bigint) from public, anon, authenticated;

create or replace function activity_chain() returns trigger
language plpgsql as $$
declare last_hash text; last_seq bigint;
begin
  new.chain_key := coalesce(new.item_id::text, 'sheet:' || coalesce(new.sheet_id::text, new.org_id::text));
  perform pg_advisory_xact_lock(hashtextextended(new.chain_key, 0));
  -- read after the lock (a new snapshot for this statement): the order is decided here, not by the id
  select a.hash, a.chain_seq into last_hash, last_seq from activity_log a
   where a.chain_key = new.chain_key and a.chain_seq is not null
   order by a.chain_seq desc limit 1;
  if last_seq is null then
    select a.hash into last_hash from activity_log a where a.chain_key = new.chain_key order by a.id desc limit 1;
  end if;
  new.chain_seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := coalesce(last_hash, 'genesis');
  new.at := clock_timestamp();
  new.hash_v := 2;
  new.hash := activity_hash_v2(new.prev_hash, new.at, new.actor_kind, new.actor_id, new.action, new.field_id,
                               new.old_value, new.new_value, new.note, new.org_id, new.sheet_id, new.item_id,
                               new.chain_key, new.chain_seq);
  return new;
end $$;

create or replace function verify_activity_chain(p_chain_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; prev text := 'genesis'; n int := 0; o uuid; s uuid; bad bigint; redacted int; expected text;
begin
  select org_id, sheet_id into o, s from activity_log where chain_key = p_chain_key limit 1;
  if o is null then return jsonb_build_object('ok', true, 'entries', 0); end if;
  if not is_member(o) then raise exception 'not allowed'; end if;
  if s is not null and _sheet_level_for(auth.uid(), s) = 'none' then raise exception 'not allowed'; end if;
  -- entries written before 0058 (no chain_seq) by id, then the others by their sequence
  for r in select * from activity_log where chain_key = p_chain_key
            order by (chain_seq is not null), chain_seq, id loop
    n := n + 1;
    expected := case when r.hash_v = 2
                     then activity_hash_v2(r.prev_hash, r.at, r.actor_kind, r.actor_id, r.action, r.field_id,
                                           r.old_value, r.new_value, r.note, r.org_id, r.sheet_id, r.item_id,
                                           r.chain_key, r.chain_seq)
                     else activity_hash(r.prev_hash, r.at, r.actor_kind, r.actor_id, r.action, r.field_id,
                                        r.old_value, r.new_value, r.note) end;
    if r.prev_hash <> prev or r.hash <> expected or (r.hash_v = 2 and r.chain_key <> p_chain_key) then
      return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', r.id);
    end if;
    prev := r.hash;
  end loop;
  select min(a.id) into bad from restricted_activity ra join activity_log a on a.id = ra.activity_id
   where a.chain_key = p_chain_key
     and ((a.field_id is not null
           and (_mask_value(ra.salt, 'old', ra.old_value) is distinct from a.old_value
                or _mask_value(ra.salt, 'new', ra.new_value) is distinct from a.new_value))
          or (a.field_id is null
              and _mask_value(ra.salt, 'new', ra.new_value) is distinct from a.new_value->'values'->(ra.field_id::text)));
  if bad is not null then return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', bad); end if;
  select min(a.id) into bad from personal_activity pa join activity_log a on a.id = pa.activity_id
   where a.chain_key = p_chain_key and pa.erased_at is null
     and (case
            when pa.slot = 'field' and a.field_id is null then
              _personal_mask(pa.salt, 'new', pa.new_value) is distinct from a.new_value->'values'->(pa.field_id::text)
            when pa.slot = 'name' and a.action = 'item.created' then
              _personal_mask(pa.salt, 'new', pa.new_value) is distinct from a.new_value->'name'
            when pa.slot = 'file' then
              exists (select 1 from jsonb_each(coalesce(pa.old_value, '{}'::jsonb)) e
                       where _personal_mask(pa.salt, 'old:' || e.key, e.value) is distinct from a.old_value -> e.key)
              or exists (select 1 from jsonb_each(coalesce(pa.new_value, '{}'::jsonb)) e
                          where _personal_mask(pa.salt, 'new:' || e.key, e.value) is distinct from a.new_value -> e.key)
            else _personal_mask(pa.salt, 'old', pa.old_value) is distinct from a.old_value
                 or _personal_mask(pa.salt, 'new', pa.new_value) is distinct from a.new_value
          end);
  if bad is not null then return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', bad); end if;
  select count(*) into redacted from personal_activity pa join activity_log a on a.id = pa.activity_id
   where a.chain_key = p_chain_key and pa.erased_at is not null;
  return jsonb_build_object('ok', true, 'entries', n, 'last_hash', prev, 'redacted', redacted);
end $$;

-- L5: no TRUNCATE through the API roles, and never on the append-only tables
do $$ declare t record; begin
  for t in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('revoke truncate on table %I from anon, authenticated', t.relname);
  end loop;
end $$;
revoke truncate on activity_log, restricted_activity, personal_activity, workflow_decisions from service_role;

create or replace function _no_truncate() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
revoke execute on function _no_truncate() from public, anon, authenticated;
create trigger activity_log_no_truncate before truncate on activity_log
  for each statement execute function _no_truncate();
create trigger restricted_activity_no_truncate before truncate on restricted_activity
  for each statement execute function _no_truncate();
create trigger personal_activity_no_truncate before truncate on personal_activity
  for each statement execute function _no_truncate();
create trigger workflow_decisions_no_truncate before truncate on workflow_decisions
  for each statement execute function _no_truncate();
