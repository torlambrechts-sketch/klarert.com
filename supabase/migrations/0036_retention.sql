-- 0036_retention.sql · Retention rules, the retention review queue and erasure without breaking the audit chain
-- (docs/02 §18, owner decision "rules + review queue").
--
-- 1. Personal data. A field is personal data when its config says so (fields.config.personalData = true: data, set
--    in the field's settings or by a pack). A sheet may also say that its item names can hold personal data
--    (sheets.settings.retention.personalNames = true).
-- 2. The log keeps no personal data in clear. Since the hash chain (0001) is append-only and covers every value, a
--    BEFORE INSERT trigger (activity_a_mask, before the chain) replaces a personal-data value in an entry with a marker
--    {"$personal": sha256(salt | kind | value)} and keeps the value and its salt in personal_activity. The chain hashes
--    the marker, so the chain never needs the value: erasing it later nulls the value AND the salt in
--    personal_activity (the only update that table allows, inside retention_execute) and the chain still verifies.
--    Without the salt the marker cannot be tested against guesses. Covered: value.changed / link.changed / file events
--    of a personal field, the field's entry in item.created values, file events of item files marked personal data,
--    and item names (item.created, item.renamed) on sheets whose names are personal. Personal data takes precedence
--    over a field restriction (0027), so erasable values never land in the append-only restricted_activity.
--    Entries written before a field was marked keep what they hold (append-only); erasure counts them in the
--    tombstone so the person approving knows.
-- 3. Retention rules are data in sheets.settings.retention.rules (see docs/02 §18 for the shape). The scheduler (and
--    "Check now" for owners and admins) computes due items in TypeScript and adds them to retention_queue through
--    retention_enqueue (one row per item, rule and due date: the dedupe key).
-- 4. A person decides: retention_execute erases (or anonymises, or archives) in one transaction and writes a
--    tombstone entry (who, which rule, which fields: never the values); retention_postpone needs a date and a reason;
--    set_retention_hold places or releases a legal hold, which blocks erasure. Owners and admins only.
-- The audit trigger, the chain and append-only stay as they are: nothing here updates or deletes activity_log.

-- ───────────────────────── personal data markers ─────────────────────────
create or replace function _field_personal(p_config jsonb) returns boolean language sql immutable as $$
  select coalesce(p_config -> 'personalData' = 'true'::jsonb, false)
$$;

create or replace function _sheet_names_personal(p_sheet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select settings -> 'retention' -> 'personalNames' = 'true'::jsonb from sheets where id = p_sheet),
                  false)
$$;

create or replace function _personal_mask(p_salt text, p_kind text, v jsonb) returns jsonb
language sql immutable set search_path = public, extensions as $$
  select case when v is null or v = 'null'::jsonb then v
              else jsonb_build_object('$personal', encode(digest(p_salt || '|' || p_kind || '|' || v::text, 'sha256'), 'hex'))
         end
$$;

-- The keys of a file entry that can hold personal data, and the entry with each of them masked.
create or replace function _personal_keys(v jsonb) returns jsonb language sql immutable as $$
  select case when v is null or jsonb_typeof(v) <> 'object' then null
              else nullif(jsonb_strip_nulls(jsonb_build_object('filename', v -> 'filename',
                                                               'description', v -> 'description',
                                                               'version_note', v -> 'version_note')), '{}'::jsonb) end
$$;
create or replace function _personal_mask_keys(p_salt text, p_kind text, v jsonb) returns jsonb
language sql immutable set search_path = public, extensions as $$
  select case when v is null or jsonb_typeof(v) <> 'object' then v
              else v || coalesce((select jsonb_object_agg(e.key, _personal_mask(p_salt, p_kind || ':' || e.key, e.value))
                                    from jsonb_each(_personal_keys(v)) e), '{}'::jsonb) end
$$;

-- A marker that stands for a value in the log: restricted (0027) or personal data (here).
create or replace function activity_value_masked(v jsonb) returns boolean language sql immutable as $$
  select v is null or (jsonb_typeof(v) = 'object' and (v ? '$restricted' or v ? '$personal'))
$$;

-- ───────────────────────── personal_activity ─────────────────────────
create table personal_activity (
  id          bigint generated always as identity primary key,
  activity_id bigint not null,
  org_id      uuid not null references orgs(id) on delete cascade,
  sheet_id    uuid,
  item_id     uuid,
  -- 'field': a field's value (field_id); 'name': the item's name; 'file': an item file's entry (file_id)
  slot        text not null check (slot in ('field', 'name', 'file')),
  field_id    uuid,
  file_id     uuid,
  salt        text,
  old_value   jsonb,
  new_value   jsonb,
  erased_at   timestamptz,
  -- the retention_queue row whose approval erased it
  erased_by   uuid,
  check ((slot = 'field') = (field_id is not null)),
  check (erased_at is null or (salt is null and old_value is null and new_value is null)),
  unique nulls not distinct (activity_id, slot, field_id)
);
create index personal_activity_item_idx on personal_activity(item_id) where erased_at is null;
create index personal_activity_activity_idx on personal_activity(activity_id);
alter table personal_activity enable row level security;
create policy personal_activity_read on personal_activity for select using (
  sheet_id in (select readable_sheet_ids())
  and (field_id is null or not (field_id = any ((select hidden_field_ids())::uuid[]))));
revoke insert, update, delete, truncate on personal_activity from anon, authenticated;

-- Nothing changes once written, except erasure (inside retention_execute: value and salt nulled, once) and the
-- workspace purge (delete).
create or replace function personal_activity_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.purge_org', true) = old.org_id::text then return old; end if;
    raise exception 'personal_activity: only erasure may change it';
  end if;
  if coalesce(current_setting('app.retention_op', true), '') = 'erase'
     and old.erased_at is null and new.erased_at is not null and new.erased_by is not null
     and new.salt is null and new.old_value is null and new.new_value is null
     and (new.id, new.activity_id, new.org_id, new.sheet_id, new.item_id, new.slot, new.field_id, new.file_id)
         is not distinct from
         (old.id, old.activity_id, old.org_id, old.sheet_id, old.item_id, old.slot, old.field_id, old.file_id) then
    return new;
  end if;
  raise exception 'personal_activity: only erasure may change it';
end $$;
create trigger personal_activity_guard before update or delete on personal_activity
  for each row execute function personal_activity_guard();

-- ───────────────────────── the log: mask personal data before the chain ─────────────────────────
-- Replaces 0027's activity_a_mask. Runs before activity_chain (alphabetical), so the chain hashes the markers.
create or replace function activity_a_mask() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare salt text; f record; vals jsonb; fl uuid; is_personal boolean; is_restricted boolean;
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

-- verify: the chain, every restricted value against its marker (0027), every personal value not yet erased against
-- its marker; erased values are counted ("redacted"), the chain does not need them.
create or replace function verify_activity_chain(p_chain_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; prev text := 'genesis'; n int := 0; o uuid; s uuid; bad bigint; redacted int;
begin
  select org_id, sheet_id into o, s from activity_log where chain_key = p_chain_key limit 1;
  if o is null then return jsonb_build_object('ok', true, 'entries', 0); end if;
  if not is_member(o) then raise exception 'not allowed'; end if;
  if s is not null and _sheet_level_for(auth.uid(), s) = 'none' then raise exception 'not allowed'; end if;
  for r in select * from activity_log where chain_key = p_chain_key order by id loop
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> activity_hash(r.prev_hash, r.at, r.actor_kind, r.actor_id, r.action,
                                                       r.field_id, r.old_value, r.new_value, r.note) then
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

-- ───────────────────────── files: erased ─────────────────────────
alter table files add column erased_at timestamptz;

-- The object of an erased file may be removed through the Storage API by an owner or admin (retention_execute
-- returns the paths; the command removes them with the person's own client).
create policy files_erase on storage.objects for delete using (
  bucket_id = 'files'
  and exists (select 1 from public.files f where f.storage_path = name and f.erased_at is not null
                and public.is_admin(f.org_id)));

-- ───────────────────────── the queue and legal holds ─────────────────────────
create table retention_queue (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  sheet_id        uuid not null references sheets(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  rule_id         text not null check (rule_id ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  rule_name       text not null check (char_length(rule_name) between 1 and 80),
  action          text not null check (action in ('erase', 'anonymise', 'archive')),
  due_on          date not null,
  status          text not null default 'due' check (status in ('due', 'postponed', 'done')),
  postponed_until date,
  reason          text check (char_length(reason) <= 1000),
  decided_by      uuid references profiles(id),
  decided_at      timestamptz,
  done_activity   bigint,
  created_at      timestamptz not null default now(),
  check (status <> 'postponed' or (postponed_until is not null and reason is not null)),
  -- the dedupe key: once per item, rule and due date
  unique (item_id, rule_id, due_on)
);
create index retention_queue_org_idx on retention_queue(org_id, status, due_on);

create table retention_holds (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  item_id     uuid not null references items(id) on delete cascade,
  reason      text not null check (char_length(btrim(reason)) between 1 and 1000),
  placed_by   uuid references profiles(id),
  placed_at   timestamptz not null default now(),
  released_by uuid references profiles(id),
  released_at timestamptz
);
create unique index retention_holds_live_idx on retention_holds(item_id) where released_at is null;

-- the scheduler checks each workspace once a day
create table retention_checks (
  org_id uuid not null references orgs(id) on delete cascade,
  day    date not null,
  primary key (org_id, day)
);

alter table retention_queue enable row level security;
alter table retention_holds enable row level security;
alter table retention_checks enable row level security;
create policy retention_queue_read on retention_queue for select
  using (is_admin(org_id) and sheet_id in (select readable_sheet_ids()));
create policy retention_holds_read on retention_holds for select
  using (is_admin(org_id) and exists (select 1 from items i where i.id = item_id));
-- the Retention page shows when the scheduler last checked
create policy retention_checks_read on retention_checks for select using (is_admin(org_id));
revoke insert, update, delete, truncate on retention_queue, retention_holds, retention_checks from anon, authenticated;

-- A sheet's retention rule by id, from its settings (null when it no longer exists).
create or replace function _retention_rule(p_sheet uuid, p_rule text) returns jsonb
language sql stable security definer set search_path = public as $$
  select r from sheets s, jsonb_array_elements(coalesce(s.settings -> 'retention' -> 'rules', '[]'::jsonb)) r
   where s.id = p_sheet and r ->> 'id' = p_rule limit 1
$$;

-- The scheduler claims a workspace's daily check (service role only).
create or replace function retention_claim_day(p_org uuid, p_day date) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  insert into retention_checks(org_id, day) values (p_org, p_day) on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Due items into the queue: p_rows = [{ sheet_id, item_id, rule_id, due_on }] computed by the engine
-- (src/engine/retention). The service role (scheduler) or an owner or admin of the workspace ("Check now"). Each row
-- is checked against the workspace, the sheet's current rules and the item; rows already queued are left alone.
-- Logs retention.due on the item's chain and tells the owners and admins once per call.
create or replace function retention_enqueue(p_org uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; rule jsonb; it items; q retention_queue; n int := 0; m record;
begin
  if p_org is null or not (coalesce(auth.role(), '') = 'service_role' or is_admin(p_org)) then
    raise exception 'not allowed';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'retention: bad rows';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into it from items where id = (r ->> 'item_id')::uuid and org_id = p_org
                                  and sheet_id = (r ->> 'sheet_id')::uuid;
    if it.id is null then raise exception 'retention: item not in the workspace'; end if;
    rule := _retention_rule(it.sheet_id, r ->> 'rule_id');
    if rule is null then raise exception 'retention: no rule %', r ->> 'rule_id'; end if;
    if (r ->> 'due_on')::date > current_date + 1 then raise exception 'retention: not due yet'; end if;
    -- an archive rule has nothing to do for an archived item
    if rule ->> 'action' = 'archive' and it.archived_at is not null then continue; end if;
    insert into retention_queue(org_id, sheet_id, item_id, rule_id, rule_name, action, due_on)
    values (p_org, it.sheet_id, it.id, rule ->> 'id', left(coalesce(rule ->> 'name', rule ->> 'id'), 80),
            rule ->> 'action', (r ->> 'due_on')::date)
    on conflict (item_id, rule_id, due_on) do nothing
    returning * into q;
    if q.id is null then continue; end if;
    n := n + 1;
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
    values (it.org_id, it.sheet_id, it.id, '', 'system', null, 'retention.due',
            jsonb_build_object('queue_id', q.id, 'rule_id', q.rule_id, 'rule', q.rule_name, 'action', q.action,
                               'due_on', q.due_on));
    q := null;
  end loop;
  if n > 0 then
    for m in select user_id from memberships
              where org_id = p_org and role in ('owner', 'admin') and (expires_at is null or expires_at > now()) loop
      insert into notifications(org_id, user_id, kind, body)
      values (p_org, m.user_id, 'system',
              n || case when n = 1 then ' record is' else ' records are' end
                || ' due for retention review. Open Workspace admin › Retention to approve, postpone or hold.');
    end loop;
  end if;
  return n;
end $$;

-- Postpone a due entry to a later date, with a reason (owners and admins).
create or replace function retention_postpone(p_queue uuid, p_until date, p_reason text) returns retention_queue
language plpgsql security definer set search_path = public as $$
declare q retention_queue;
begin
  select * into q from retention_queue where id = p_queue for update;
  if q.id is null or not is_admin(q.org_id) then raise exception 'not allowed'; end if;
  perform _need_sheet(q.sheet_id, 'editor');
  if q.status = 'done' then raise exception 'retention: already done'; end if;
  if p_until is null or p_until <= current_date then raise exception 'retention: postpone to a later date'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'retention: say why'; end if;
  update retention_queue set status = 'postponed', postponed_until = p_until, reason = left(btrim(p_reason), 1000),
                             decided_by = auth.uid(), decided_at = now()
   where id = q.id returning * into q;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (q.org_id, q.sheet_id, q.item_id, '', 'user', auth.uid(), 'retention.postponed',
          jsonb_build_object('queue_id', q.id, 'rule_id', q.rule_id, 'rule', q.rule_name, 'until', p_until), q.reason);
  return q;
end $$;

-- Place (p_on) or release a legal hold on an item (owners and admins). A hold blocks erasure, anonymisation and
-- retention archiving until it is released.
create or replace function set_retention_hold(p_item uuid, p_on boolean, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare it items; h retention_holds;
begin
  select * into it from items where id = p_item;
  if it.id is null or not is_admin(it.org_id) then raise exception 'not allowed'; end if;
  perform _need_sheet(it.sheet_id, 'editor');
  select * into h from retention_holds where item_id = it.id and released_at is null for update;
  if p_on then
    if h.id is not null then return true; end if;
    if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'retention: say why'; end if;
    insert into retention_holds(org_id, item_id, reason, placed_by) values (it.org_id, it.id, left(btrim(p_reason), 1000), auth.uid());
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, note)
    values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'retention.hold_placed', left(btrim(p_reason), 1000));
    return true;
  end if;
  if h.id is null then return false; end if;
  update retention_holds set released_by = auth.uid(), released_at = now() where id = h.id;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), 'retention.hold_released',
          nullif(left(btrim(coalesce(p_reason, '')), 1000), ''));
  return false;
end $$;

-- Approve a due entry: one transaction. erase: the rule's personal-data fields (all fields marked personal data
-- unless the rule names some) are cleared (values, restricted and protected values, links, files of those fields),
-- the item files marked personal data too when the rule says files, the comments when it says comments; anonymise:
-- the same, always with personal item files and comments, and the name replaced; archive: the item archived. Copies
-- made from the item (its notifications, automation run details, webhook payloads) are cleared as well. The values
-- in personal_activity for the erased fields, files and name are erased, so the log keeps only markers. The tombstone
-- (retention.erased / retention.anonymised / retention.archived) says who approved, the rule and what was erased,
-- never the values. Returns { paths: storage paths to remove, fields, files, comments, redacted, in_clear }.
create or replace function retention_execute(p_queue uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q retention_queue; it items; s sheets; rule jsonb; keys text[]; fids uuid[]; fnames jsonb;
        paths text[] := '{}'; file_ids uuid[] := '{}'; n_files int := 0; n_comments int := 0; n_redacted int := 0;
        n_clear int := 0; tomb bigint; act text; rename boolean; with_files boolean; with_comments boolean;
begin
  select * into q from retention_queue where id = p_queue for update;
  if q.id is null or not is_admin(q.org_id) then raise exception 'not allowed'; end if;
  perform _need_sheet(q.sheet_id, 'editor');
  if q.status = 'done' then raise exception 'retention: already done'; end if;
  select * into it from items where id = q.item_id for update;
  select * into s from sheets where id = q.sheet_id;
  if exists (select 1 from retention_holds where item_id = it.id and released_at is null) then
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
          or (slot = 'name' and rename));
  get diagnostics n_redacted = row_count;
  -- entries written before the fields were marked personal data still hold values in clear (append-only)
  select count(*) into n_clear from activity_log a
   where a.item_id = it.id and a.field_id = any (fids)
     and not (activity_value_masked(a.old_value) and activity_value_masked(a.new_value));
  perform set_config('app.retention_op', '', true);

  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(),
          case when rename then 'retention.anonymised' else 'retention.erased' end,
          jsonb_build_object('queue_id', q.id, 'rule_id', q.rule_id, 'rule', q.rule_name, 'due_on', q.due_on,
                             'fields', fnames, 'files', n_files, 'comments', n_comments, 'renamed', rename,
                             'log_values_erased', n_redacted, 'earlier_entries_in_clear', n_clear,
                             'archived', coalesce(rule -> 'archiveItem' = 'true'::jsonb, false)),
          nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
  returning id into tomb;
  if coalesce(rule -> 'archiveItem' = 'true'::jsonb, false) and it.archived_at is null then
    perform set_item_archived(it.id, true);
  end if;
  update retention_queue set status = 'done', decided_by = auth.uid(), decided_at = now(), done_activity = tomb
   where id = q.id;
  return jsonb_build_object('paths', to_jsonb(paths), 'fields', coalesce(array_length(fids, 1), 0),
                            'files', n_files, 'comments', n_comments, 'redacted', n_redacted, 'in_clear', n_clear,
                            'activity_id', tomb);
end $$;

-- ───────────────────────── grants ─────────────────────────
revoke all on function _field_personal(jsonb), _sheet_names_personal(uuid), _personal_mask(text, text, jsonb),
  _personal_keys(jsonb), _personal_mask_keys(text, text, jsonb),
  _retention_rule(uuid, text), personal_activity_guard(), activity_a_mask()
  from public, anon, authenticated;
revoke all on function retention_claim_day(uuid, date), retention_enqueue(uuid, jsonb),
  retention_postpone(uuid, date, text), set_retention_hold(uuid, boolean, text), retention_execute(uuid, text)
  from public, anon;
grant execute on function retention_claim_day(uuid, date) to service_role;
grant execute on function retention_enqueue(uuid, jsonb) to authenticated, service_role;
grant execute on function retention_postpone(uuid, date, text), set_retention_hold(uuid, boolean, text),
  retention_execute(uuid, text) to authenticated;
revoke all on function retention_claim_day(uuid, date) from authenticated;
