# Database

Load this when writing migrations, designing tables, or working with RLS, retention, audit, or performance.

Postgres on Supabase is the system of record. The frontend is replaceable; the schema is the product. Treat migrations as the most carefully reviewed code in the repo.

## 1. Migration conventions

- Files live under `supabase/migrations/`.
- Filename format: `NNN_short_kebab_name.sql` where `NNN` is a 4-digit zero-padded sequence. `0001_core_platform.sql`, `0002_templates.sql`, …
- **Append-only.** Once merged to main, a migration is immutable. Fix forward with a new migration; never edit a past file.
- Every migration ends with a comment block explaining *why*, not what.
- Migrations are applied by CI (`supabase db push`) on every deploy. Never instruct a user to run a migration in the SQL editor.
- Every migration includes its own RLS, indexes, audit trigger, and tests in the same file (or a paired test file under `supabase/tests/`). No "policy will come later" comments.

### Migration template

```sql
-- 0042_add_sick_leave_cases.sql
-- Adds sykefraværsoppfølging (sick-leave follow-up) per AML § 4-6 + Folketrygdloven § 8-7a.
-- See .claude/modules/sickleave.md.

begin;

create table sick_leave_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  started_at date not null,
  status text not null default 'active'
    check (status in ('active', 'closed', 'on_hold')),
  oppfolgingsplan_id uuid references documents(id),
  retention_class text not null default 'personnel_active',
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (user_id, started_at)
);

alter table sick_leave_cases enable row level security;

-- Indexes
create index sick_leave_org_user_idx on sick_leave_cases(organization_id, user_id);
create index sick_leave_active_idx on sick_leave_cases(organization_id, started_at)
  where status = 'active';

-- RLS
create policy sick_leave_select on sick_leave_cases for select using (
  organization_id = current_org_id()
  and (has_permission('sickleave.read') or user_id = auth.uid())
);
create policy sick_leave_insert on sick_leave_cases for insert with check (
  organization_id = current_org_id() and has_permission('sickleave.write')
);
create policy sick_leave_update on sick_leave_cases for update using (
  organization_id = current_org_id() and has_permission('sickleave.write')
);
-- No delete policy: rows are immutable until retention purges them.

-- Audit
select make_audit_trigger('sick_leave_cases');

commit;
```

### Per-migration checklist

- [ ] `begin; ... commit;` wraps the whole file.
- [ ] RLS enabled and all four operations (or explicit deny) covered.
- [ ] Indexes for every query the app will run — measured, not guessed.
- [ ] `make_audit_trigger(table_name)` if state-changing.
- [ ] `retention_class` column on any table with personal data.
- [ ] Paired pgTAP test file under `supabase/tests/` covers RLS matrix.
- [ ] Templates seeded if this is the first migration of a module.

## 2. The "data, not code" pattern in detail

Module behavior comes from **three layers of rows**:

1. **Templates** (`templates` table) — the shape of a thing the module produces. Survey question lists, checklist items, agenda outlines, course syllabi.
2. **Workflow triggers** (`workflow_triggers` + `workflow_actions`) — cross-module side effects. Every "when X happens, do Y" lives here.
3. **Page layout** (`pages` + `page_sections`) — which sections show up on which routes, in what order.

When a feature request would otherwise hardcode behavior in TypeScript, ask: *which of these three layers does this belong to?* If none — challenge the request.

## 3. Standard column set

Every tenant-scoped table has at minimum:

```sql
id              uuid primary key default gen_random_uuid()
organization_id uuid not null references organizations(id) on delete cascade
created_at      timestamptz not null default now()
created_by      uuid references profiles(id)
```

For append-only tables, add:
```sql
-- (no updated_at; rows are immutable)
```

For mutable tables, add:
```sql
updated_at      timestamptz not null default now()
updated_by      uuid references profiles(id)
```

For tables with personal data, add:
```sql
retention_class text not null   -- references data_categories.retention_class
purged_at       timestamptz     -- set by retention engine after hard delete (logical: row stays)
```

For soft-deletable tables:
```sql
deleted_at      timestamptz
-- RLS policies filter `deleted_at is null` for the default scope.
```

## 4. RLS pattern library

### Tenant-scoped read

```sql
create policy <table>_select on <table> for select using (
  organization_id = current_org_id()
);
```

### Permission-gated write

```sql
create policy <table>_insert on <table> for insert with check (
  organization_id = current_org_id()
  and has_permission('<perm>')
);
```

### Role-restricted (varsling)

```sql
create policy wb_select on whistleblowing_reports for select using (
  organization_id = current_org_id()
  and has_role('varsling_committee')
);
```

### Self-or-manager

```sql
create policy <table>_select on <table> for select using (
  organization_id = current_org_id()
  and (
    user_id = auth.uid()
    or has_permission('<perm>')
    or exists (
      select 1 from profiles p
      where p.id = <table>.user_id
        and p.manager_id = auth.uid()
    )
  )
);
```

### Audience-based (surveys, document acknowledgements)

```sql
create policy survey_select on surveys for select using (
  organization_id = current_org_id()
  and (
    (audience->>'all')::boolean
    or auth.uid()::text in (select jsonb_array_elements_text(audience->'users'))
    or exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and ur.organization_id = current_org_id()
        and ur.role_id::text in (select jsonb_array_elements_text(audience->'roles'))
    )
  )
);
```

### Append-only (audit_log)

```sql
create policy audit_select on audit_log for select using (
  organization_id = current_org_id()
  and has_permission('audit.read')
);
revoke update, delete on audit_log from authenticated, anon;
-- No update/delete policies. Purge runs as a SECURITY DEFINER function.
```

### Deny-all default

For any table where in doubt: enable RLS, add no policies, grant via explicit functions only. PostgREST cannot read it from the client.

## 5. The audit trigger generator

```sql
create or replace function make_audit_trigger(target_table text) returns void
language plpgsql as $$
begin
  execute format($f$
    create trigger %I_audit
    after insert or update or delete on %I
    for each row execute function audit_row_change();
  $f$, target_table, target_table);
end;
$$;

create or replace function audit_row_change() returns trigger
language plpgsql security definer as $$
declare
  v_action text;
  v_row_id uuid;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
    v_row_id := new.id;
    v_diff := jsonb_build_object('after', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_row_id := new.id;
    v_diff := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  else
    v_action := 'delete';
    v_row_id := old.id;
    v_diff := jsonb_build_object('before', to_jsonb(old));
  end if;

  -- Scrub PII categories before storing in audit_log. The scrub list is a table.
  v_diff := audit_scrub(tg_table_name, v_diff);

  insert into audit_log (organization_id, table_name, row_id, action, changed_by, changed_via, diff)
  values (
    coalesce(new.organization_id, old.organization_id),
    tg_table_name,
    v_row_id,
    v_action,
    auth.uid(),
    coalesce(current_setting('app.changed_via', true), 'user'),
    v_diff
  );

  return coalesce(new, old);
end;
$$;
```

The `audit_scrub` function reads `audit_scrub_rules(table_name, column_name, mode)` rows. `mode` is `omit | hash | redact`. Anonymity-sensitive tables (`anonymous_survey_responses`, `whistleblowing_messages` author bodies) omit the body.

## 6. The retention engine

```sql
-- Categories of personal data with their retention horizons.
create table data_categories (
  retention_class text primary key,
  description text not null,
  retention_days int not null,            -- days from created_at (or close event)
  legal_basis text not null,              -- 'gdpr_consent', 'aml_kap5', 'iso_27001_evidence', etc.
  notes text
);

insert into data_categories values
  ('whistleblowing_closed',  'Varsling — etter at sak er konkludert', 365 * 5,  'gdpr_purpose_limitation + datatilsynet_2021', null),
  ('survey_anonymous',       'Anonyme undersøkelser',                 365 * 3,  'gdpr_purpose_limitation', null),
  ('survey_identified',      'Identifiserte undersøkelser',           365 * 2,  'gdpr_purpose_limitation', null),
  ('checklist_completed',    'Sjekklistedata',                        365 * 5,  'internkontroll_dokumentasjon', null),
  ('audit_log_default',      'Audit log',                             365 * 7,  'tilsyn_dokumentasjon', null),
  ('exposure_record',        'Eksponering CMR/asbest/bly',            365 * 60, 'foruterbeid_kap3', null),
  ('personnel_active',       'Personalmappe — aktiv',                  null,    'arbeidsavtale', 'no horizon while employed'),
  ('personnel_post_exit',    'Personalmappe — etter avgang',          365 * 5,  'arbeidsavtale + skatteforvaltning', null);

-- Nightly purge.
create or replace function purge_expired() returns void
language plpgsql security definer as $$
declare
  r record;
begin
  for r in
    select c.retention_class, c.retention_days
    from data_categories c
    where c.retention_days is not null
  loop
    -- Schema-driven: every personal-data table has a retention_class column.
    -- Dynamic SQL iterates all such tables.
    ...
  end loop;
end;
$$;

select cron.schedule('purge_expired_daily', '15 3 * * *', $$ select purge_expired() $$);
```

Purges write `action = 'purge'` rows to `audit_log`. Hard-delete only after 90 days in soft-delete.

## 7. Indexes — measure, don't guess

- Every foreign key gets an index (Postgres doesn't auto-index FKs).
- Every column in a RLS predicate gets an index (`organization_id` always).
- Composite indexes match query order: `(organization_id, status, due_at)` for "tasks for this org in this status sorted by due date".
- Partial indexes for status filters: `... where status in ('open','in_progress')`.
- GIN index on `jsonb` columns we filter on; `tsvector` for full-text search (see register module).
- Add an index only after `explain analyze` shows a seq scan on a real query. Don't speculatively index.

## 8. Performance defaults

- `select id, name, ...` — never `select *`.
- Paginate at the SQL layer with `limit ... offset ...` or keyset pagination for stable order. Never load all rows then paginate in JS.
- For aggregations (compliance dashboards), use materialized views refreshed on a `pg_cron` schedule. Don't compute on every page load.
- For list views > 1000 rows, virtualize the table (`DataGrid` virtual mode) **and** keyset-paginate from the server.
- Long-running queries get a `statement_timeout` set per call site. Default 5 s for interactive, 30 s for cron.

## 9. Workflow engine tables

```sql
create table workflow_triggers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade, -- null = system-wide
  event text not null,                       -- e.g. 'deviation.closed'
  condition jsonb not null default '{}',     -- e.g. {"severity": "critical"}
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table workflow_actions (
  id uuid primary key default gen_random_uuid(),
  trigger_id uuid not null references workflow_triggers(id) on delete cascade,
  order_index int not null,
  action_type text not null,                 -- 'create_task', 'create_notification', 'transition_status', ...
  config jsonb not null,                     -- shape depends on action_type
  unique (trigger_id, order_index)
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trigger_id uuid not null references workflow_triggers(id),
  event_payload jsonb not null,              -- the original event
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create table workflow_action_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs(id) on delete cascade,
  action_id uuid not null references workflow_actions(id),
  status text not null check (status in ('pending', 'completed', 'failed')),
  output jsonb,
  error text,
  completed_at timestamptz
);
```

Events are emitted by SQL triggers on source tables: `after insert on deviations` → `select emit_event('deviation.created', ...)`. `emit_event` writes a `workflow_runs` row. An Edge Function `workflow-runner` polls / listens via Postgres NOTIFY, evaluates conditions, executes actions.

## 10. Naming

- **Tables**: snake_case, plural — `deviations`, `whistleblowing_reports`. Never the module name as a prefix unless the table is module-specific to disambiguate (`learning_courses`, `learning_certificates`).
- **Columns**: snake_case, scalar, single-purpose. `started_at` not `start`. Booleans prefixed with `is_` or `has_`.
- **Indexes**: `<table>_<columns>_idx`.
- **Constraints**: `<table>_<purpose>_chk` for check constraints; `<table>_<columns>_unique` for unique.
- **Functions**: snake_case, verb-first. `purge_expired`, `make_audit_trigger`, `has_permission`.
- **Views**: end in `_view` if computed, otherwise read like a noun.

## 11. JSONB usage

JSONB is great for **template config** (the shape changes per template), **payloads** (event payloads, workflow action configs), and **answers** (survey responses).

JSONB is **not** the right place for fields you query, filter, or constrain. If you find yourself doing `where config->>'frequency' = 'weekly'` more than twice — that's a column, not a JSONB key.

Index JSONB only when you actually query it, with GIN.

## 12. Cron jobs

- Schedule via Supabase `pg_cron`.
- Every job is idempotent. Running twice in a row produces the same result.
- Every job writes its start and end to `cron_runs` so we can see history.
- Every job has a paired test that runs the function and asserts effects.
- Jobs run UTC; convert in the function if a Norwegian local time matters.

## 13. What not to do

- Don't write a migration without RLS.
- Don't write RLS without a pgTAP test.
- Don't write `update audit_log set ...` ever. Even with service role.
- Don't store the same fact in two places (denormalization). If you must, document why and add a check that they agree.
- Don't add a column to `templates.config` and treat it as schema. If many templates need it, it belongs in a real column on a real table.
- Don't loop in application code over rows for aggregation. Push the aggregation to SQL.
- Don't use `text` when you can use a check-constrained enum text or a FK.
- Don't write a `BEFORE` trigger when an `AFTER` would do. `BEFORE` triggers can mask data races.
- Don't use `serial` / `bigserial` for ids. `uuid` everywhere — saves a class of guess-the-next-id bugs and works across replicas.
- Don't grant the `anon` role anything beyond what's strictly needed for the public varsling/survey endpoints. The `anon` GRANT surface is the public attack surface.
