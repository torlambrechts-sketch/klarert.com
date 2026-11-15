-- 0065_note_masking.sql · Free-text notes of value changes and approval comments leave the log in clear
-- (security review 9.1 item 3, owner decision 15 Nov 2026).
--
-- Before: 0059 kept comment bodies out of the append-only log, but the `note` of an entry stayed in clear for ever:
-- the comment a status rule or a documents register asks for on a value change, and every approval comment
-- (submitted, decided, rejected, withdrawn). Retention erasure could not reach them.
--
-- Now:
-- 1. `activity_b_note` (BEFORE INSERT, after activity_a_mask and before activity_chain, by trigger name) masks the
--    free-text note of an item's entry: every approval comment (`workflow.submitted`, `workflow.decided`,
--    `workflow.approved`, `workflow.rejected`, `workflow.withdrawn`; only people write them), and the note a person
--    writes on a value change (`value.changed`, `link.changed`, `item.renamed`, `protected.changed`,
--    `protected.cleared`, actor `user`). The note becomes the text of a marker `{"$personal": sha256(salt | note |
--    note)}`; the note and its salt go to `personal_activity`, slot `note`, as 0059 does for comment bodies. The chain
--    hashes the marker. The slot carries the entry's field (if any), so only people who may see the field read it.
--    Notes the system writes stay in clear: an automation's ("Set by automation …"), a pack operation's
--    (`app.pack_op`: "Pack install", "Pack update") and a framework edition move's ("Copied from …", which now runs
--    its writes with `app.system_note`). The note of a field type conversion ("Field type changed to …") goes
--    through set_item_values as a person's comment does and is masked with them.
-- 2. `verify_activity_chain` checks each note not yet erased against its marker.
-- 3. `retention_execute` erases the note slots with the comment slots (a rule with `comments`, and anonymise), and
--    `earlier_entries_in_clear` in the tombstone also counts entries whose note is still in clear (written before this
--    migration: the log is append-only, so they stay as they are).
-- Not masked (owner decision 15 Nov 2026): display names in `member.*` notes, kept as access-provisioning evidence.
-- Other notes (archive, lock, retention reasons, file notes) are unchanged.
-- Not in the log, so not changed here: `workflow_decisions.comment` and `workflow_instances.submit_comment` keep the
-- approval comment for the approval's own record (docs/09 §9.1).

-- the note slot, with the entry's field when there is one
alter table personal_activity drop constraint if exists personal_activity_slot_check;
alter table personal_activity add constraint personal_activity_slot_check
  check (slot in ('field', 'name', 'file', 'comment', 'subitem', 'note'));
alter table personal_activity drop constraint if exists personal_activity_check;
alter table personal_activity add constraint personal_activity_check
  check (case slot when 'field' then field_id is not null when 'note' then true else field_id is null end);

-- Whether an entry's note is free text about people: approval comments always, value changes when a person wrote
-- them. (For the tombstone's count of earlier entries, which predate the system-note flags, the same test.)
create or replace function _note_is_personal(p_action text, p_actor_kind text) returns boolean
language sql immutable as $$
  select p_action in ('workflow.submitted', 'workflow.decided', 'workflow.approved', 'workflow.rejected',
                      'workflow.withdrawn')
      or (p_actor_kind = 'user'
          and p_action in ('value.changed', 'link.changed', 'item.renamed', 'protected.changed', 'protected.cleared'))
$$;

-- The notes system operations wrote on a person's behalf before this migration (pack operations, the framework
-- edition move): not personal data, so the tombstone does not count them as left in clear.
create or replace function _note_system(p_note text) returns boolean language sql immutable as $$
  select p_note in ('Pack install', 'Pack update') or p_note like 'Copied from % (move to %)'
$$;

-- A note the log keeps as a marker (this migration), as its text.
create or replace function _note_masked(p_note text) returns boolean language sql immutable as $$
  select p_note ~ '^\{"\$personal": "[0-9a-f]{64}"\}$'
$$;

create or replace function activity_b_note() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare salt text;
begin
  if new.note is null or btrim(new.note) = '' or new.item_id is null
     or not _note_is_personal(new.action, new.actor_kind) or _note_masked(new.note)
     -- notes the system writes: pack operations and the framework edition move
     or (new.action not like 'workflow.%'
         and (coalesce(current_setting('app.pack_op', true), '') <> ''
              or coalesce(current_setting('app.system_note', true), '') = 'on')) then
    return new;
  end if;
  salt := encode(gen_random_bytes(16), 'hex');
  insert into personal_activity(activity_id, org_id, sheet_id, item_id, slot, field_id, salt, new_value)
  values (new.id, new.org_id, new.sheet_id, new.item_id, 'note', new.field_id, salt, to_jsonb(new.note));
  new.note := _personal_mask(salt, 'note', to_jsonb(new.note))::text;
  return new;
end $$;
drop trigger if exists activity_b_note_bi on activity_log;
create trigger activity_b_note_bi before insert on activity_log
  for each row execute function activity_b_note();
revoke all on function activity_b_note(), _note_is_personal(text, text), _note_masked(text), _note_system(text)
  from public, anon, authenticated;

-- the framework edition move's note ("Copied from <edition> (move to <edition>)") is the system's, not a person's
do $$
declare d text := pg_get_functiondef('move_framework_edition(uuid, uuid, uuid, jsonb, jsonb)'::regprocedure);
        old text := $s$perform set_item_values(ti.id, e->'patch', null, null, note);$s$;
begin
  if position(old in d) = 0 then raise exception 'move_framework_edition changed: update 0065'; end if;
  execute replace(d, old, $s$perform set_config('app.system_note', 'on', true);
    perform set_item_values(ti.id, e->'patch', null, null, note);
    perform set_config('app.system_note', '', true);$s$);
end $$;

-- verification: a note not yet erased must match its marker
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
   where a.chain_key = p_chain_key and ra.erased_at is null
     and ((a.field_id is not null
           and (_mask_value(ra.salt, 'old', ra.old_value) is distinct from a.old_value
                or _mask_value(ra.salt, 'new', ra.new_value) is distinct from a.new_value))
          or (a.field_id is null
              and _mask_value(ra.salt, 'new', ra.new_value) is distinct from a.new_value->'values'->(ra.field_id::text)));
  if bad is not null then return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', bad); end if;
  select min(a.id) into bad from personal_activity pa join activity_log a on a.id = pa.activity_id
   where a.chain_key = p_chain_key and pa.erased_at is null
     and (case
            when pa.slot = 'note' then
              _personal_mask(pa.salt, 'note', pa.new_value)::text is distinct from a.note
            when pa.slot = 'field' and a.field_id is null then
              _personal_mask(pa.salt, 'new', pa.new_value) is distinct from a.new_value->'values'->(pa.field_id::text)
            when pa.slot = 'name' and a.action = 'item.created' then
              _personal_mask(pa.salt, 'new', pa.new_value) is distinct from a.new_value->'name'
            when pa.slot in ('file', 'subitem') then
              exists (select 1 from jsonb_each(coalesce(pa.old_value, '{}'::jsonb)) e
                       where _personal_mask(pa.salt, 'old:' || e.key, e.value) is distinct from a.old_value -> e.key)
              or exists (select 1 from jsonb_each(coalesce(pa.new_value, '{}'::jsonb)) e
                          where _personal_mask(pa.salt, 'new:' || e.key, e.value) is distinct from a.new_value -> e.key)
            else _personal_mask(pa.salt, 'old', pa.old_value) is distinct from a.old_value
                 or _personal_mask(pa.salt, 'new', pa.new_value) is distinct from a.new_value
          end);
  if bad is not null then return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', bad); end if;
  select (select count(*) from personal_activity pa join activity_log a on a.id = pa.activity_id
           where a.chain_key = p_chain_key and pa.erased_at is not null)
       + (select count(*) from restricted_activity ra join activity_log a on a.id = ra.activity_id
           where a.chain_key = p_chain_key and ra.erased_at is not null)
    into redacted;
  return jsonb_build_object('ok', true, 'entries', n, 'last_hash', prev, 'redacted', redacted);
end $$;

-- erasure: notes go with comments; the tombstone counts notes still in clear. retention_execute is long and changes
-- in two places: patched from its current definition, stopping if either line is not there (as 0062 does).
do $$
declare d text := pg_get_functiondef('retention_execute(uuid, text)'::regprocedure);
        erase_old text := $s$or (slot = 'comment' and with_comments));$s$;
        clear_old text := $s$          or (with_comments and a.action in ('update.edited', 'update.deleted')$s$;
begin
  if position(erase_old in d) = 0 or position(clear_old in d) = 0 then
    raise exception 'retention_execute changed: update 0065';
  end if;
  d := replace(d, erase_old, $s$or (slot in ('comment', 'note') and with_comments));$s$);
  d := replace(d, clear_old,
    $s$          or (with_comments and _note_is_personal(a.action, a.actor_kind) and btrim(coalesce(a.note, '')) <> ''
              and not _note_masked(a.note) and not _note_system(a.note))
$s$ || clear_old);
  execute d;
end $$;
