-- 0001_core.sql · Compliance OS Sheets MVP · baseline schema
-- Conventions: every table has org_id + RLS. Items and the activity log are written only through the
-- SECURITY DEFINER functions at the bottom (commands call them). activity_log is append-only and hash-chained.

create extension if not exists pgcrypto;

-- ───────────────────────── enums and helpers ─────────────────────────
create type member_role as enum ('owner','admin','editor','viewer');

create or replace function field_types() returns text[] language sql immutable as $$
  select array[
    -- basic input (18)
    'text','longtext','comment','number','value','percent','yesno','check','date','datetime','duration',
    'timeline','recurrence','rating','email','phone','url','location',
    -- choice and people (10)
    'status','dropdown','multiselect','people','role','team','entity','country','classification','severity',
    -- compliance (19)
    'requirement','controllink','evidence','attachment','signature','ack','justification','applicability',
    'finding','checklist','question','riskmatrix','maturity','measurement','clock','protected','pdmarker',
    'retention','version',
    -- linked, computed and system (10)
    'link','lookup','rollup','formula','progress','autoid','meta','workflowstep','button','ai'
  ]::text[]
$$;

-- types whose value is NOT stored in items.values
create or replace function non_value_types() returns text[] language sql immutable as $$
  select array['link','requirement','controllink','lookup','rollup','formula','progress','autoid','meta',
               'clock','button','evidence','attachment','protected']::text[]
$$;

-- ───────────────────────── tenancy ─────────────────────────
create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  time_zone   text not null default 'Europe/London',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  initials      text not null check (char_length(initials) between 1 and 3),
  color         text not null default 'blue',
  created_at    timestamptz not null default now()
);

create table memberships (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       member_role not null default 'editor',
  job_title  text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  email       text not null,
  role        member_role not null default 'editor',
  token       text not null unique default encode(gen_random_bytes(24),'hex'),
  invited_by  uuid references profiles(id),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create table teams (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references orgs(id) on delete cascade,
  name    text not null,
  unique (org_id, name)
);
create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  org_id  uuid not null references orgs(id) on delete cascade,
  primary key (team_id, user_id)
);
create table job_roles (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references orgs(id) on delete cascade,
  name    text not null,
  unique (org_id, name)
);
create table entities (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  name     text not null,
  country  char(2) not null
);
create table sites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  entity_id  uuid not null references entities(id) on delete cascade,
  name       text not null
);

create or replace function is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = o and m.user_id = auth.uid())
$$;

create or replace function has_role(o uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = o and m.user_id = auth.uid() and m.role = any(roles))
$$;

create or replace function is_editor(o uuid) returns boolean language sql stable as $$
  select has_role(o, array['owner','admin','editor']::member_role[])
$$;
create or replace function is_admin(o uuid) returns boolean language sql stable as $$
  select has_role(o, array['owner','admin']::member_role[])
$$;

-- ───────────────────────── sheets, fields, groups ─────────────────────────
create table folders (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  position    text not null,
  created_at  timestamptz not null default now()
);

create table sheets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  folder_id    uuid references folders(id) on delete set null,
  name         text not null check (char_length(name) between 1 and 120),
  description  text,
  item_label   text not null default 'Item',
  id_prefix    text not null default 'IT-' check (id_prefix ~ '^[A-Z0-9]{1,6}-$'),
  next_seq     integer not null default 1,
  is_library   boolean not null default false,
  settings     jsonb not null default '{}'::jsonb,   -- { defaultViewId, kanbanFieldId, form: {...} }
  position     text not null,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  unique (org_id, id_prefix)
);

create table fields (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  sheet_id     uuid not null references sheets(id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name         text not null check (char_length(name) between 1 and 80),
  type         text not null check (type = any(field_types())),
  position     text not null,
  width        integer check (width between 60 and 600),
  required     boolean not null default false,
  locked       boolean not null default false,
  description  text,
  config       jsonb not null default '{}'::jsonb,   -- type config incl. options; see docs/03
  validation   jsonb not null default '{}'::jsonb,   -- { min, max, pattern, unique, maxLength }
  rules        jsonb not null default '[]'::jsonb,   -- status rules; see docs/03 §6
  visibility   jsonb,                                -- { fieldId, op, value } or null
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  unique (sheet_id, key)
);
create index fields_sheet_idx on fields(sheet_id, position) where archived_at is null;

create table groups (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  sheet_id    uuid not null references sheets(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  color       text not null default 'blue',
  position    text not null,
  created_at  timestamptz not null default now()
);
create index groups_sheet_idx on groups(sheet_id, position);

-- ───────────────────────── items and values ─────────────────────────
create table items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  sheet_id    uuid not null references sheets(id) on delete cascade,
  group_id    uuid not null references groups(id) on delete restrict,
  seq         integer not null,
  display_id  text not null,
  name        text not null check (char_length(name) between 1 and 500),
  "values"    jsonb not null default '{}'::jsonb,   -- { "<field_id>": <value per docs/03> }
  position    text not null,
  locked      boolean not null default false,
  lock_reason text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (sheet_id, seq),
  unique (sheet_id, display_id)
);
create index items_group_idx  on items(sheet_id, group_id, position) where archived_at is null;
create index items_values_gin on items using gin ("values" jsonb_path_ops);
create index items_name_idx   on items(sheet_id, lower(name));

create table item_links (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  field_id    uuid not null references fields(id) on delete cascade,
  from_item   uuid not null references items(id) on delete cascade,
  to_item     uuid not null references items(id) on delete cascade,
  position    text not null default 'a0',
  created_at  timestamptz not null default now(),
  unique (field_id, from_item, to_item),
  check (from_item <> to_item)
);
create index item_links_to_idx on item_links(to_item);

create table protected_values (
  org_id    uuid not null references orgs(id) on delete cascade,
  item_id   uuid not null references items(id) on delete cascade,
  field_id  uuid not null references fields(id) on delete cascade,
  value     text not null,
  primary key (item_id, field_id)
);

create table files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  item_id        uuid not null references items(id) on delete cascade,
  field_id       uuid not null references fields(id) on delete cascade,
  storage_path   text not null unique,
  filename       text not null,
  mime_type      text not null,
  size_bytes     bigint not null check (size_bytes > 0),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source         text not null default 'upload',          -- upload | form | connector:<name>
  collected_at   date not null default current_date,
  valid_until    date,                                    -- evidence only
  replaced_by    uuid references files(id),
  uploaded_by    uuid references profiles(id),
  created_at     timestamptz not null default now()
);
create index files_item_idx on files(item_id, field_id) where replaced_by is null;

create table item_updates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  item_id     uuid not null references items(id) on delete cascade,
  author_id   uuid references profiles(id),
  kind        text not null default 'update' check (kind in ('update','automation','system')),
  body        text not null check (char_length(body) between 1 and 10000),
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index item_updates_item_idx on item_updates(item_id, created_at desc);

-- ───────────────────────── activity log (append-only, hash chained) ─────────────────────────
create table activity_log (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references orgs(id) on delete cascade,
  sheet_id       uuid,                                -- no FK on purpose: the log outlives archived/purged rows
  item_id        uuid,
  chain_key      text not null,                       -- item id, or 'sheet:<id>' for schema entries
  actor_kind     text not null check (actor_kind in ('user','automation','system','form')),
  actor_id       uuid,                                -- profile id for user; automation id for automation
  action         text not null,                       -- item.created, value.changed, item.moved, link.changed …
  field_id       uuid,
  old_value      jsonb,
  new_value      jsonb,
  note           text,
  at             timestamptz not null default clock_timestamp(),
  prev_hash      text not null default '',
  hash           text not null default ''
);
create index activity_chain_idx on activity_log(chain_key, id);
create index activity_item_idx  on activity_log(item_id, id desc);

create or replace function activity_hash(prev text, at timestamptz, actor_kind text, actor_id uuid, action text,
                                         field_id uuid, old_value jsonb, new_value jsonb, note text)
returns text language sql immutable as $$
  select encode(digest(
    prev || '|' || to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || actor_kind || '|' ||
    coalesce(actor_id::text,'') || '|' || action || '|' || coalesce(field_id::text,'') || '|' ||
    coalesce(old_value::text,'null') || '|' || coalesce(new_value::text,'null') || '|' || coalesce(note,''),
    'sha256'), 'hex')
$$;

create or replace function activity_chain() returns trigger language plpgsql as $$
declare last_hash text;
begin
  new.chain_key := coalesce(new.item_id::text, 'sheet:' || coalesce(new.sheet_id::text, new.org_id::text));
  perform pg_advisory_xact_lock(hashtextextended(new.chain_key, 0));
  select a.hash into last_hash from activity_log a where a.chain_key = new.chain_key order by a.id desc limit 1;
  new.prev_hash := coalesce(last_hash, 'genesis');
  new.at := clock_timestamp();
  new.hash := activity_hash(new.prev_hash, new.at, new.actor_kind, new.actor_id, new.action,
                            new.field_id, new.old_value, new.new_value, new.note);
  return new;
end $$;
create trigger activity_chain_bi before insert on activity_log for each row execute function activity_chain();

create or replace function activity_append_only() returns trigger language plpgsql as $$
begin
  -- only the workspace purge job (GDPR deletion of a whole workspace) may delete, never update
  if tg_op = 'DELETE' and current_setting('app.purge_org', true) = old.org_id::text then return old; end if;
  raise exception 'activity_log is append-only';
end $$;
create trigger activity_no_change before update or delete on activity_log
  for each row execute function activity_append_only();

create or replace function verify_activity_chain(p_chain_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; prev text := 'genesis'; n int := 0; o uuid;
begin
  select org_id into o from activity_log where chain_key = p_chain_key limit 1;
  if o is null then return jsonb_build_object('ok', true, 'entries', 0); end if;
  if not is_member(o) then raise exception 'not allowed'; end if;
  for r in select * from activity_log where chain_key = p_chain_key order by id loop
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> activity_hash(r.prev_hash, r.at, r.actor_kind, r.actor_id, r.action,
                                                       r.field_id, r.old_value, r.new_value, r.note) then
      return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', r.id);
    end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'entries', n, 'last_hash', prev);
end $$;

-- schema changes (sheets, fields, groups, automations) are logged on the sheet chain
create or replace function audit_schema() returns trigger language plpgsql security definer set search_path = public as $$
declare o uuid; s uuid; rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- bookkeeping columns (sequence, counters, timestamps) are not schema changes
  if tg_op = 'UPDATE' and (to_jsonb(old) - array['next_seq','updated_at','run_count','last_run_at'])
                        = (to_jsonb(new) - array['next_seq','updated_at','run_count','last_run_at']) then
    return null;
  end if;
  o := (rec->>'org_id')::uuid;
  s := case when tg_table_name = 'sheets' then (rec->>'id')::uuid else (rec->>'sheet_id')::uuid end;
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
  values (o, s, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          tg_table_name || '.' || lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

-- ───────────────────────── views ─────────────────────────
create table views (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  sheet_id    uuid not null references sheets(id) on delete cascade,
  name        text not null,
  type        text not null check (type in ('list','grid','kanban','calendar','form')),
  config      jsonb not null default '{}'::jsonb,   -- { filters, sort, hidden, labelFieldId, dateFieldId, pageSize }
  owner_id    uuid references profiles(id),         -- null = shared view
  position    text not null,
  created_at  timestamptz not null default now()
);

create table form_links (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  sheet_id    uuid not null references sheets(id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(32),'hex'),
  group_id    uuid references groups(id) on delete set null,
  enabled     boolean not null default true,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);

-- ───────────────────────── automations ─────────────────────────
create table automations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  sheet_id    uuid not null references sheets(id) on delete cascade,
  name        text not null,
  enabled     boolean not null default true,
  trigger     jsonb not null,                       -- docs/04 §3
  conditions  jsonb not null default '[]'::jsonb,   -- docs/04 §4
  actions     jsonb not null,                       -- docs/04 §5 (array, run in order)
  source      text not null default 'custom',       -- custom | template:<id> | pack:<id>
  version     integer not null default 1,
  locked      boolean not null default false,
  run_count   integer not null default 0,
  last_run_at timestamptz,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index automations_sheet_idx on automations(sheet_id) where enabled;

create table automation_pauses (
  automation_id uuid not null references automations(id) on delete cascade,
  item_id       uuid not null references items(id) on delete cascade,
  org_id        uuid not null references orgs(id) on delete cascade,
  paused_by     uuid references profiles(id),
  created_at    timestamptz not null default now(),
  primary key (automation_id, item_id)
);

create table automation_runs (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references orgs(id) on delete cascade,
  automation_id  uuid references automations(id) on delete set null,
  sheet_id       uuid references sheets(id) on delete set null,
  item_id        uuid references items(id) on delete set null,
  event          jsonb not null,
  status         text not null check (status in ('done','partial','skipped','failed','stopped')),
  detail         text not null default '',
  steps          jsonb not null default '[]'::jsonb,  -- [{ action, outcome, message }]
  depth          integer not null default 0,
  chain_id       uuid not null,                       -- all runs caused by one user change share it
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index automation_runs_org_idx on automation_runs(org_id, id desc);

create table scheduler_fired (
  automation_id uuid not null references automations(id) on delete cascade,
  item_id       uuid not null references items(id) on delete cascade,
  occurrence    text not null,                       -- e.g. the date value that fired
  fired_at      timestamptz not null default now(),
  primary key (automation_id, item_id, occurrence)
);

create table outbound_webhooks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  automation_id    uuid references automations(id) on delete set null,
  item_id          uuid references items(id) on delete set null,
  url              text not null check (url ~ '^https://'),
  payload          jsonb not null,
  status           text not null default 'queued' check (status in ('queued','sent','retrying','dead_letter')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now()
);
create index outbound_webhooks_due_idx on outbound_webhooks(next_attempt_at) where status in ('queued','retrying');

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  item_id     uuid references items(id) on delete cascade,
  kind        text not null check (kind in ('notify','request','mention','system')),
  body        text not null,
  done_at     timestamptz,                          -- for requests: when the person updated the item
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, read_at, created_at desc);

-- schema audit triggers (after the automations table exists)
create trigger sheets_audit      after insert or update or delete on sheets      for each row execute function audit_schema();
create trigger fields_audit      after insert or update or delete on fields      for each row execute function audit_schema();
create trigger groups_audit      after insert or update or delete on groups      for each row execute function audit_schema();
create trigger automations_audit after insert or update or delete on automations for each row execute function audit_schema();

-- ───────────────────────── write functions (the only way to write items) ─────────────────────────
-- p_automation: set when an automation performs the write; the caller must be a member and the automation enabled.
create or replace function can_write(o uuid, p_automation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_editor(o)
      or (p_automation is not null and is_member(o)
          and exists (select 1 from automations a where a.id = p_automation and a.org_id = o and a.enabled))
      or coalesce(auth.role(), '') = 'service_role'
$$;

create or replace function actor_kind_for(p_automation uuid) returns text language sql stable as $$
  select case when p_automation is not null then 'automation'
              when auth.uid() is null then 'system' else 'user' end
$$;

create or replace function _create_item(p_sheet uuid, p_group uuid, p_name text, p_position text,
                                        p_values jsonb, p_actor_kind text, p_actor_id uuid)
returns items language plpgsql security definer set search_path = public as $$
declare s sheets; v_seq int; it items; k text;
begin
  select * into s from sheets where id = p_sheet and archived_at is null;
  if s.id is null then raise exception 'sheet not found'; end if;
  if not exists (select 1 from groups g where g.id = p_group and g.sheet_id = p_sheet) then raise exception 'group not in sheet'; end if;
  for k in select jsonb_object_keys(coalesce(p_values,'{}'::jsonb)) loop
    if not exists (select 1 from fields f where f.id::text = k and f.sheet_id = p_sheet and f.archived_at is null
                   and not (f.type = any(non_value_types()))) then
      raise exception 'field % cannot hold a value', k;
    end if;
  end loop;
  update sheets set next_seq = next_seq + 1, updated_at = now() where id = p_sheet returning next_seq - 1 into v_seq;
  insert into items(org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by)
  values (s.org_id, p_sheet, p_group, v_seq, s.id_prefix || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0'),
          p_name, coalesce(p_values,'{}'::jsonb), p_position, auth.uid(), auth.uid())
  returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (it.org_id, it.sheet_id, it.id, '', p_actor_kind, p_actor_id, 'item.created',
          jsonb_build_object('name', it.name, 'group_id', it.group_id, 'values', it."values"));
  return it;
end $$;
revoke all on function _create_item from public;

create or replace function create_item(p_sheet uuid, p_group uuid, p_name text, p_position text,
                                       p_values jsonb default '{}'::jsonb, p_automation uuid default null)
returns items language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select org_id into o from sheets where id = p_sheet;
  if o is null or not can_write(o, p_automation) then raise exception 'not allowed'; end if;
  return _create_item(p_sheet, p_group, p_name, p_position, p_values, actor_kind_for(p_automation),
                      coalesce(p_automation, auth.uid()));
end $$;

create or replace function set_item_values(p_item uuid, p_patch jsonb, p_name text default null,
                                           p_automation uuid default null, p_note text default null)
returns items language plpgsql security definer set search_path = public as $$
declare it items; f fields; k text; old_v jsonb; new_v jsonb;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if it.locked and p_automation is null and not is_admin(it.org_id) then
    raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
  end if;
  if p_name is not null and p_name <> it.name then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
    values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
            'item.renamed', to_jsonb(it.name), to_jsonb(p_name), p_note);
    it.name := p_name;
  end if;
  for k in select jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) loop
    select * into f from fields where id::text = k and sheet_id = it.sheet_id and archived_at is null;
    if f.id is null then raise exception 'field % not in sheet', k; end if;
    if f.type = any(non_value_types()) then raise exception 'field % (%) is not set through values', f.name, f.type; end if;
    if f.type = 'workflowstep' and p_automation is null and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'workflow step is set by automations only';
    end if;
    old_v := it."values" -> k;
    new_v := p_patch -> k;
    if new_v is null or new_v = 'null'::jsonb then
      it."values" := it."values" - k; new_v := null;
    else
      it."values" := jsonb_set(it."values", array[k], new_v, true);
    end if;
    if old_v is distinct from new_v then
      insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value, note)
      values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
              'value.changed', f.id, old_v, new_v, p_note);
    end if;
  end loop;
  update items set name = it.name, "values" = it."values", updated_at = now(), updated_by = auth.uid()
   where id = it.id returning * into it;
  return it;
end $$;

create or replace function move_item(p_item uuid, p_group uuid, p_position text, p_automation uuid default null)
returns items language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if not exists (select 1 from groups g where g.id = p_group and g.sheet_id = it.sheet_id) then raise exception 'group not in sheet'; end if;
  if it.group_id <> p_group then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
    values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
            'item.moved', to_jsonb(it.group_id), to_jsonb(p_group));
  end if;
  update items set group_id = p_group, position = p_position, updated_at = now(), updated_by = auth.uid()
   where id = p_item returning * into it;
  return it;
end $$;

create or replace function set_item_archived(p_item uuid, p_archived boolean) returns items
language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item for update;
  if it.id is null or not can_write(it.org_id, null) then raise exception 'not allowed'; end if;
  update items set archived_at = case when p_archived then now() end, updated_at = now(), updated_by = auth.uid()
   where id = p_item returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action)
  values (it.org_id, it.sheet_id, it.id, '', 'user', auth.uid(), case when p_archived then 'item.archived' else 'item.restored' end);
  return it;
end $$;

create or replace function set_item_lock(p_item uuid, p_locked boolean, p_reason text default null,
                                         p_automation uuid default null) returns items
language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = p_item for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not (is_admin(it.org_id) or (p_automation is not null and can_write(it.org_id, p_automation))) then
    raise exception 'not allowed';
  end if;
  update items set locked = p_locked, lock_reason = case when p_locked then p_reason end, updated_at = now()
   where id = p_item returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, note)
  values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
          case when p_locked then 'item.locked' else 'item.unlocked' end, p_reason);
  return it;
end $$;

-- p_mode: add | remove | replace. Two-way: the inverse field (config.inverseFieldId) is maintained by the command layer
-- by calling this function again for the inverse direction inside the same command.
create or replace function set_item_links(p_field uuid, p_from uuid, p_to uuid[], p_mode text,
                                          p_automation uuid default null) returns setof item_links
language plpgsql security definer set search_path = public as $$
declare f fields; it items; before uuid[]; after uuid[];
begin
  select * into f from fields where id = p_field and type in ('link','requirement','controllink');
  select * into it from items where id = p_from and archived_at is null;
  if f.id is null or it.id is null or f.sheet_id <> it.sheet_id then raise exception 'bad link field or item'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if it.locked and p_automation is null and not is_admin(it.org_id) then raise exception 'item locked'; end if;
  if exists (select 1 from unnest(p_to) t(id) left join items x on x.id = t.id
             where x.id is null or x.org_id <> it.org_id
                or x.sheet_id::text <> coalesce(f.config->>'targetSheetId', x.sheet_id::text)) then
    raise exception 'link target not allowed';
  end if;
  select coalesce(array_agg(to_item order by position), '{}') into before from item_links where field_id = p_field and from_item = p_from;
  if p_mode = 'replace' then
    delete from item_links where field_id = p_field and from_item = p_from and not (to_item = any(p_to));
  end if;
  if p_mode in ('add','replace') then
    insert into item_links(org_id, field_id, from_item, to_item)
    select it.org_id, p_field, p_from, t.id from unnest(p_to) t(id) on conflict do nothing;
  elsif p_mode = 'remove' then
    delete from item_links where field_id = p_field and from_item = p_from and to_item = any(p_to);
  else raise exception 'bad mode %', p_mode; end if;
  select coalesce(array_agg(to_item order by position), '{}') into after from item_links where field_id = p_field and from_item = p_from;
  if before is distinct from after then
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id, old_value, new_value)
    values (it.org_id, it.sheet_id, it.id, '', actor_kind_for(p_automation), coalesce(p_automation, auth.uid()),
            'link.changed', p_field, to_jsonb(before), to_jsonb(after));
  end if;
  return query select * from item_links where field_id = p_field and from_item = p_from order by position;
end $$;

-- public forms (anon). Automations for the `form` trigger are run by the server route that calls this.
create or replace function submit_form(p_token text, p_name text, p_values jsonb, p_position text) returns items
language plpgsql security definer set search_path = public as $$
declare fl form_links; g uuid; it items;
begin
  select * into fl from form_links where token = p_token and enabled;
  if fl.id is null then raise exception 'form not found'; end if;
  g := coalesce(fl.group_id, (select id from groups where sheet_id = fl.sheet_id order by position limit 1));
  it := _create_item(fl.sheet_id, g, p_name, p_position, p_values, 'form', null);
  return it;
end $$;

-- ───────────────────────── row level security ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['orgs','memberships','invites','teams','team_members','job_roles','entities','sites',
    'folders','sheets','fields','groups','items','item_links','protected_values','files','item_updates',
    'activity_log','views','form_links','automations','automation_pauses','automation_runs','scheduler_fired',
    'outbound_webhooks','notifications','profiles'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- read: members see their workspace
create policy orgs_read on orgs for select using (is_member(id));
create policy orgs_admin on orgs for update using (is_admin(id));
create policy profiles_read on profiles for select using (
  id = auth.uid() or exists (select 1 from memberships a join memberships b on a.org_id = b.org_id
                             where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy profiles_self on profiles for update using (id = auth.uid());

do $$ declare t text; begin
  foreach t in array array['memberships','teams','team_members','job_roles','entities','sites','folders','sheets',
    'fields','groups','items','item_links','files','item_updates','activity_log','form_links','automations',
    'automation_pauses','automation_runs'] loop
    execute format('create policy %I on %I for select using (is_member(org_id))', t || '_read', t);
  end loop;
end $$;

-- workspace administration: admins
do $$ declare t text; begin
  foreach t in array array['memberships','invites','teams','team_members','job_roles','entities','sites'] loop
    execute format('create policy %I on %I for all using (is_admin(org_id)) with check (is_admin(org_id))', t || '_admin', t);
  end loop;
end $$;
create policy invites_read on invites for select using (is_admin(org_id));

-- structure: editors; locked rows only admins
create policy folders_write on folders for all using (is_editor(org_id)) with check (is_editor(org_id));
create policy sheets_write  on sheets  for all using (is_editor(org_id)) with check (is_editor(org_id));
create policy groups_write  on groups  for all using (is_editor(org_id)) with check (is_editor(org_id));
create policy fields_insert on fields for insert with check (is_editor(org_id));
create policy fields_update on fields for update using (is_admin(org_id) or (is_editor(org_id) and not locked))
                                          with check (is_admin(org_id) or (is_editor(org_id) and not locked));
create policy fields_delete on fields for delete using (is_admin(org_id) or (is_editor(org_id) and not locked));
create policy automations_insert on automations for insert with check (is_editor(org_id));
create policy automations_update on automations for update using (is_admin(org_id) or (is_editor(org_id) and not locked))
                                                     with check (is_admin(org_id) or (is_editor(org_id) and not locked));
create policy automations_delete on automations for delete using (is_admin(org_id) or (is_editor(org_id) and not locked));
create policy automation_pauses_write on automation_pauses for all using (is_editor(org_id)) with check (is_editor(org_id));
create policy form_links_write on form_links for all using (is_editor(org_id)) with check (is_editor(org_id));

-- views: shared views by editors, personal views by their owner
create policy views_read  on views for select using (is_member(org_id) and (owner_id is null or owner_id = auth.uid()));
create policy views_write on views for all
  using ((owner_id = auth.uid() and is_member(org_id)) or (owner_id is null and is_editor(org_id)))
  with check ((owner_id = auth.uid() and is_member(org_id)) or (owner_id is null and is_editor(org_id)));

-- updates: members who can edit post as themselves
create policy item_updates_insert on item_updates for insert
  with check (is_editor(org_id) and author_id = auth.uid() and kind = 'update');

-- files: rows are created by the upload command after the hash check
create policy files_insert on files for insert with check (is_editor(org_id) and uploaded_by = auth.uid());

-- protected values: admins, or people listed in the field's config.allowedUserIds
create policy protected_read on protected_values for select using (
  is_admin(org_id) or exists (select 1 from fields f where f.id = field_id
     and f.config -> 'allowedUserIds' ? auth.uid()::text));
create policy protected_write on protected_values for all using (
  is_admin(org_id) or (is_editor(org_id) and exists (select 1 from fields f where f.id = field_id
     and f.config -> 'allowedUserIds' ? auth.uid()::text)))
  with check (is_admin(org_id) or (is_editor(org_id) and exists (select 1 from fields f where f.id = field_id
     and f.config -> 'allowedUserIds' ? auth.uid()::text)));

-- notifications: only your own
create policy notifications_read on notifications for select using (user_id = auth.uid());
create policy notifications_mark on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- scheduler_fired and outbound_webhooks: service role only (no policies)

-- function grants
revoke all on function create_item, set_item_values, move_item, set_item_archived, set_item_lock,
                       set_item_links, verify_activity_chain from public;
grant execute on function create_item, set_item_values, move_item, set_item_archived, set_item_lock,
                          set_item_links, verify_activity_chain to authenticated;
grant execute on function submit_form to anon, authenticated;
