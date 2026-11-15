-- 0059_erasure_coverage.sql · Erasure reaches comment bodies, sub-item names and restricted values in the log
-- (security review M6).
--
-- Before: `activity_a_mask` kept personal data out of the append-only log only for personal fields, item names on
-- sheets with `personalNames` and item files marked personal. Left in clear for ever: comment bodies of
-- `update.edited` / `update.deleted`, sub-item names in the parent's `subitem.*` entries, and values of a field that was
-- restricted before it was marked personal (kept in the append-only `restricted_activity`). The erasure tombstone
-- counted only field entries as "earlier entries in clear".
--
-- Now:
-- 1. Comment bodies in `update.edited` / `update.deleted` are always masked (slot `comment`): a comment is free text
--    about people. Readers who may read the item still see the body (personal_activity, as for other values).
-- 2. Sub-item names in the parent's `subitem.added / removed / archived / restored` entries are masked when the
--    sub-item's own sheet has `personalNames` (slot `subitem`, key by key, kept under the sub-item's id).
-- 3. `restricted_activity` rows can be erased like `personal_activity` rows (value and salt nulled, `erased_at`), only
--    by `retention_execute`; `verify_activity_chain` skips erased values (their markers stay in the chain).
-- 4. `retention_execute` erases: comment slots with `comments` (and anonymise), the sub-item's name in its parent's
--    entries with anonymise, and restricted log values of the erased personal fields. The tombstone adds
--    `restricted_log_values_erased`, and `earlier_entries_in_clear` now counts every copy still in clear: field
--    entries, comment bodies (with comments), and names (with anonymise) written before masking applied.
-- Not covered (open question in the review notes): display names in `member.*` notes, free-text notes of value changes
-- and approval comments.

alter table personal_activity drop constraint if exists personal_activity_slot_check;
alter table personal_activity add constraint personal_activity_slot_check
  check (slot in ('field', 'name', 'file', 'comment', 'subitem'));

alter table restricted_activity alter column salt drop not null;
alter table restricted_activity add column if not exists erased_at timestamptz;
alter table restricted_activity add column if not exists erased_by uuid;
alter table restricted_activity add constraint restricted_activity_erased_check
  check (erased_at is null or (salt is null and old_value is null and new_value is null));

create or replace function restricted_activity_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.purge_org', true) = old.org_id::text then return old; end if;
  -- erasure (retention_execute): the value and the salt go, the row and the marker in the chain stay
  if tg_op = 'UPDATE' and coalesce(current_setting('app.retention_op', true), '') = 'erase'
     and old.erased_at is null and new.erased_at is not null and new.erased_by is not null
     and new.salt is null and new.old_value is null and new.new_value is null
     and (new.activity_id, new.org_id, new.sheet_id, new.field_id)
         is not distinct from (old.activity_id, old.org_id, old.sheet_id, old.field_id) then
    return new;
  end if;
  raise exception 'restricted_activity is append-only';
end $$;

create or replace function activity_a_mask() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare salt text; f record; vals jsonb; fl uuid; is_personal boolean; is_restricted boolean; sub uuid; sub_sheet uuid;
        o_name jsonb; n_name jsonb;
begin
  -- a field's entry (value.changed, link.changed, file events of a field)
  if new.field_id is not null then
    select _field_personal(config) as p, restricted_to is not null as r into is_personal, is_restricted
      from fields where id = new.field_id;
    if coalesce(is_personal, false) then
      salt := encode(gen_random_bytes(16), 'hex');
      insert into personal_activity(activity_id, org_id, sheet_id, item_id, slot, field_id, salt, old_value, new_value)
      values (new.id, new.org_id, new.sheet_id, new.item_id, 'field', new.field_id, salt, new.old_value, new.new_value);
      new.old_value := _personal_mask(salt, 'old', new.old_value);
      new.new_value := _personal_mask(salt, 'new', new.new_value);
    elsif coalesce(is_restricted, false) then
      salt := encode(gen_random_bytes(16), 'hex');
      insert into restricted_activity(activity_id, org_id, sheet_id, field_id, salt, old_value, new_value)
      values (new.id, new.org_id, new.sheet_id, new.field_id, salt, new.old_value, new.new_value);
      new.old_value := _mask_value(salt, 'old', new.old_value);
      new.new_value := _mask_value(salt, 'new', new.new_value);
    end if;
    return new;
  end if;

  -- a comment's body (edited or deleted): always personal, a comment is free text about people
  if new.action in ('update.edited', 'update.deleted') and new.item_id is not null
     and (new.old_value is not null or new.new_value is not null) then
    salt := encode(gen_random_bytes(16), 'hex');
    insert into personal_activity(activity_id, org_id, sheet_id, item_id, slot, salt, old_value, new_value)
    values (new.id, new.org_id, new.sheet_id, new.item_id, 'comment', salt, new.old_value, new.new_value);
    new.old_value := _personal_mask(salt, 'old', new.old_value);
    new.new_value := _personal_mask(salt, 'new', new.new_value);
    return new;
  end if;

  -- a sub-item's name in its parent's entries, when the sub-item sheet's names are personal data
  if new.action in ('subitem.added', 'subitem.removed', 'subitem.archived', 'subitem.restored')
     and new.item_id is not null then
    sub := coalesce(new.new_value ->> 'id', new.old_value ->> 'id')::uuid;
    select sheet_id into sub_sheet from items where id = sub;
    if sub_sheet is not null and _sheet_names_personal(sub_sheet) then
      o_name := case when jsonb_typeof(new.old_value) = 'object' and new.old_value ? 'name'
                     then jsonb_build_object('name', new.old_value -> 'name') end;
      n_name := case when jsonb_typeof(new.new_value) = 'object' and new.new_value ? 'name'
                     then jsonb_build_object('name', new.new_value -> 'name') end;
      if o_name is not null or n_name is not null then
        salt := encode(gen_random_bytes(16), 'hex');
        insert into personal_activity(activity_id, org_id, sheet_id, item_id, slot, salt, old_value, new_value)
        values (new.id, new.org_id, new.sheet_id, sub, 'subitem', salt, o_name, n_name);
        if o_name is not null then
          new.old_value := jsonb_set(new.old_value, '{name}', _personal_mask(salt, 'old:name', new.old_value -> 'name'));
        end if;
        if n_name is not null then
          new.new_value := jsonb_set(new.new_value, '{name}', _personal_mask(salt, 'new:name', new.new_value -> 'name'));
        end if;
      end if;
    end if;
    return new;
  end if;

  -- an item file marked personal data (Files tab): its name, description and version note, key by key (the rest of
  -- the entry, such as the category or the version number, stays in clear)
  if new.action like 'file.%' and new.item_id is not null then
    fl := coalesce(new.new_value ->> 'file_id', new.old_value ->> 'file_id')::uuid;
    if fl is not null and exists (select 1 from files where id = fl and personal_data) then
      salt := encode(gen_random_bytes(16), 'hex');
      insert into personal_activity(activity_id, org_id, sheet_id, item_id, slot, file_id, salt, old_value, new_value)
      values (new.id, new.org_id, new.sheet_id, new.item_id, 'file', fl, salt,
              _personal_keys(new.old_value), _personal_keys(new.new_value));
      new.old_value := _personal_mask_keys(salt, 'old', new.old_value);
      new.new_value := _personal_mask_keys(salt, 'new', new.new_value);
    end if;
    return new;
  end if;

  -- the item's name, on a sheet whose names are personal data
  if new.item_id is not null and new.sheet_id is not null and new.action = 'item.renamed'
     and _sheet_names_personal(new.sheet_id) then
    salt := encode(gen_random_bytes(16), 'hex');
    insert into personal_activity(activity_id, org_id, sheet_id, item_id, slot, salt, old_value, new_value)
    values (new.id, new.org_id, new.sheet_id, new.item_id, 'name', salt, new.old_value, new.new_value);
    new.old_value := _personal_mask(salt, 'old', new.old_value);
    new.new_value := _personal_mask(salt, 'new', new.new_value);
    return new;
  end if;

  if new.sheet_id is null or new.new_value is null or jsonb_typeof(new.new_value) <> 'object' then
    return new;
  end if;
  if new.action = 'item.created' and new.item_id is not null and new.new_value ? 'name'
     and _sheet_names_personal(new.sheet_id) then
    salt := encode(gen_random_bytes(16), 'hex');
    insert into personal_activity(activity_id, org_id, sheet_id, item_id, slot, salt, new_value)
    values (new.id, new.org_id, new.sheet_id, new.item_id, 'name', salt, new.new_value -> 'name');
    new.new_value := jsonb_set(new.new_value, '{name}', _personal_mask(salt, 'new', new.new_value -> 'name'));
  end if;
  if jsonb_typeof(new.new_value -> 'values') is distinct from 'object' then
    return new;
  end if;
  -- the values of a creation
  vals := new.new_value -> 'values';
  for f in select id, _field_personal(config) as p from fields
            where sheet_id = new.sheet_id and (restricted_to is not null or _field_personal(config)) loop
    if vals ? f.id::text and not activity_value_masked(vals -> f.id::text) then
      salt := encode(gen_random_bytes(16), 'hex');
      if f.p then
        insert into personal_activity(activity_id, org_id, sheet_id, item_id, slot, field_id, salt, new_value)
        values (new.id, new.org_id, new.sheet_id, new.item_id, 'field', f.id, salt, vals -> f.id::text);
        vals := jsonb_set(vals, array[f.id::text], _personal_mask(salt, 'new', vals -> f.id::text));
      else
        insert into restricted_activity(activity_id, org_id, sheet_id, field_id, salt, old_value, new_value)
        values (new.id, new.org_id, new.sheet_id, f.id, salt, null, vals -> f.id::text);
        vals := jsonb_set(vals, array[f.id::text], _mask_value(salt, 'new', vals -> f.id::text));
      end if;
    end if;
  end loop;
  new.new_value := jsonb_set(new.new_value, '{values}', vals);
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

create or replace function retention_execute(p_queue uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q retention_queue; it items; s sheets; rule jsonb; keys text[]; fids uuid[]; fnames jsonb;
        paths text[] := '{}'; file_ids uuid[] := '{}'; n_files int := 0; n_comments int := 0; n_redacted int := 0;
        n_restricted int := 0; n_clear int := 0; tomb bigint; act text; rename boolean; with_files boolean;
        with_comments boolean;
begin
  select * into q from retention_queue where id = p_queue for update;
  if q.id is null or not is_admin(q.org_id) then raise exception 'not allowed'; end if;
  perform _need_sheet(q.sheet_id, 'editor');
  if q.status = 'done' then raise exception 'retention: already done'; end if;
  select * into it from items where id = q.item_id for update;
  select * into s from sheets where id = q.sheet_id;
  -- a hold from the queue, or the item's own Retention field set to Legal hold
  if exists (select 1 from retention_holds where item_id = it.id and released_at is null)
     or exists (select 1 from fields f where f.sheet_id = it.sheet_id and f.type = 'retention'
                   and it."values" -> f.id::text -> 'hold' = 'true'::jsonb) then
    raise exception 'retention: on legal hold';
  end if;
  rule := _retention_rule(q.sheet_id, q.rule_id);
  if rule is null then raise exception 'retention: the rule no longer exists'; end if;
  act := rule ->> 'action';

  if act = 'archive' then
    perform set_item_archived(it.id, true);
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
    values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'retention.archived',
            jsonb_build_object('queue_id', q.id, 'rule_id', q.rule_id, 'rule', q.rule_name, 'due_on', q.due_on),
            nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
    returning id into tomb;
    update retention_queue set status = 'done', decided_by = auth.uid(), decided_at = now(), done_activity = tomb
     where id = q.id;
    return jsonb_build_object('paths', '[]'::jsonb, 'fields', 0, 'files', 0, 'comments', 0, 'redacted', 0,
                              'in_clear', 0, 'activity_id', tomb);
  end if;

  rename := act = 'anonymise';
  with_files := rename or coalesce(rule -> 'files' = 'true'::jsonb, false);
  with_comments := rename or coalesce(rule -> 'comments' = 'true'::jsonb, false);
  select coalesce(array_agg(f.id), '{}'), coalesce(array_agg(f.id::text), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'name', f.name) order by f.position), '[]'::jsonb)
    into fids, keys, fnames
    from fields f
   where f.sheet_id = it.sheet_id and _field_personal(f.config)
     and (jsonb_typeof(rule -> 'fieldKeys') is distinct from 'array' or jsonb_array_length(rule -> 'fieldKeys') = 0
          or rule -> 'fieldKeys' ? f.key);

  perform set_config('app.retention_op', 'erase', true);
  -- values
  update items set "values" = "values" - keys,
                   name = case when rename then 'Anonymised ' || lower(s.item_label) else name end,
                   updated_at = now(), updated_by = auth.uid()
   where id = it.id;
  delete from restricted_values where item_id = it.id and field_id = any (fids);
  delete from protected_values where item_id = it.id and field_id = any (fids);
  delete from item_links where field_id = any (fids) and (from_item = it.id or to_item = it.id);
  -- files of those fields, and item files marked personal data
  with e as (
    update files set filename = 'erased', description = null, version_note = null, sha256 = repeat('0', 64),
                     erased_at = now(), archived_at = coalesce(archived_at, now()),
                     archived_by = coalesce(archived_by, auth.uid())
     where item_id = it.id and erased_at is null
       and (field_id = any (fids) or (with_files and field_id is null and personal_data))
    returning id, storage_path
  )
  select coalesce(array_agg(storage_path), '{}'), coalesce(array_agg(id), '{}'), count(*) into paths, file_ids, n_files from e;
  if with_comments then
    delete from item_updates where item_id = it.id;
    get diagnostics n_comments = row_count;
  end if;
  -- copies made from the item
  delete from notifications where item_id = it.id;
  update automation_runs
     set event = jsonb_build_object('type', event ->> 'type', 'erased', true),
         detail = case when detail = '' then '' else 'Erased by retention' end,
         steps = coalesce((select jsonb_agg(jsonb_build_object('action', st ->> 'action', 'outcome', st ->> 'outcome',
                                                               'message', 'Erased by retention'))
                             from jsonb_array_elements(steps) st), '[]'::jsonb)
   where item_id = it.id;
  update outbound_webhooks set payload = jsonb_build_object('erased', true) where item_id = it.id;
  -- the log's values: erase value and salt; the markers stay and the chain still verifies
  update personal_activity set salt = null, old_value = null, new_value = null, erased_at = now(), erased_by = q.id
   where item_id = it.id and erased_at is null
     and ((slot = 'field' and field_id = any (fids)) or (slot = 'file' and file_id = any (file_ids))
          or (slot = 'name' and rename) or (slot = 'subitem' and rename) or (slot = 'comment' and with_comments));
  get diagnostics n_redacted = row_count;
  -- values kept aside while a field was restricted, before it was marked personal data
  update restricted_activity ra set salt = null, old_value = null, new_value = null, erased_at = now(), erased_by = q.id
    from activity_log a
   where a.id = ra.activity_id and a.item_id = it.id and ra.field_id = any (fids) and ra.erased_at is null;
  get diagnostics n_restricted = row_count;
  -- entries written before masking applied still hold the data in clear (append-only): count every one
  select count(*) into n_clear from activity_log a
   where a.item_id = it.id
     and ((a.field_id = any (fids) and not (activity_value_masked(a.old_value) and activity_value_masked(a.new_value)))
          or (with_comments and a.action in ('update.edited', 'update.deleted')
              and not (activity_value_masked(a.old_value) and activity_value_masked(a.new_value)))
          or (rename and a.action = 'item.renamed'
              and not (activity_value_masked(a.old_value) and activity_value_masked(a.new_value)))
          or (rename and a.action = 'item.created' and jsonb_typeof(a.new_value) = 'object'
              and a.new_value ? 'name' and not activity_value_masked(a.new_value -> 'name')));
  if rename and it.parent_id is not null then
    n_clear := n_clear + (select count(*) from activity_log a
                           where a.item_id = it.parent_id
                             and a.action in ('subitem.added', 'subitem.removed', 'subitem.archived', 'subitem.restored')
                             and coalesce(a.new_value ->> 'id', a.old_value ->> 'id') = it.id::text
                             and not activity_value_masked(coalesce(a.new_value, a.old_value) -> 'name'));
  end if;
  perform set_config('app.retention_op', '', true);

  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(),
          case when rename then 'retention.anonymised' else 'retention.erased' end,
          jsonb_build_object('queue_id', q.id, 'rule_id', q.rule_id, 'rule', q.rule_name, 'due_on', q.due_on,
                             'fields', fnames, 'files', n_files, 'comments', n_comments, 'renamed', rename,
                             'log_values_erased', n_redacted, 'restricted_log_values_erased', n_restricted,
                             'earlier_entries_in_clear', n_clear,
                             'archived', coalesce(rule -> 'archiveItem' = 'true'::jsonb, false)),
          nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
  returning id into tomb;
  if coalesce(rule -> 'archiveItem' = 'true'::jsonb, false) and it.archived_at is null then
    perform set_item_archived(it.id, true);
  end if;
  update retention_queue set status = 'done', decided_by = auth.uid(), decided_at = now(), done_activity = tomb
   where id = q.id;
  return jsonb_build_object('paths', to_jsonb(paths), 'fields', coalesce(array_length(fids, 1), 0),
                            'files', n_files, 'comments', n_comments, 'redacted', n_redacted + n_restricted,
                            'in_clear', n_clear, 'activity_id', tomb);
end $$;
