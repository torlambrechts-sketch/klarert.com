# Workflow engine

Load this when working on cross-module side effects, evidence chains, signoffs, scheduled jobs, or anything that turns an event into one or more actions.

The workflow engine is the **only** way modules talk to each other. A deviation creating a task, a survey closing notifying the AMU, a checklist item failing opening an alert, a meeting decision becoming a tracked action — every one of these is a workflow rule, not a direct write.

This file extends DATABASE.md §9 with the full model: catalog + revisions, evidence chain, TSA anchoring, queue worker, signoffs. The prototype (NewAMU) has the most mature implementation of this in the codebase; see `.claude/modules/AMU_LEGACY.md` §2.2 for the source.

## 1. Why an engine, not direct writes

Three reasons:

1. **Auditability.** A workflow run is an artifact: input event, conditions evaluated, actions taken, outcomes, evidence hashes. An audit team can re-walk the run. A direct `await supabase.from('tasks').insert(...)` from a button handler has no equivalent record beyond `audit_log`, which is row-level not flow-level.
2. **Configurability.** Compliance teams change "what should happen when" without code deploys. A workflow rule is a template + condition + action sequence, edited in-app, version-controlled.
3. **Replay and dry-run.** A workflow run can be replayed against a new version of a rule; a candidate rule can be dry-run against historical events. Neither is possible with direct writes.

## 2. The model

```
workflow_rule_catalog            -- the editable definitions (per org or system)
  ↓
workflow_rule_revisions          -- immutable snapshots; one published at a time
  ↓
workflow_runs                    -- one row per event matched
  ↓
workflow_action_results          -- one row per action executed in a run
  ↓
workflow_action_queue            -- pending dispatch for async actions
  ↓
workflow_run_evidence            -- hash-linked evidence chain per run
  ↓
workflow_tsa_anchors             -- RFC-3161 timestamp receipts (periodic)
```

Two side concerns:

```
workflow_approvals               -- N-of-M signoffs that gate a run
workflow_signing_audit_log       -- BankID / e-sign receipts referenced by runs
```

### 2.1 Tables

```sql
create table workflow_rule_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade, -- null = system rule
  module_type text not null,                       -- 'alert', 'survey', 'meeting', ...
  event text not null,                             -- 'ON_DEVIATION_CLOSED' (see naming below)
  name text not null,
  description text,
  is_enabled boolean not null default true,
  current_revision_id uuid,                        -- FK added after revisions table
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table workflow_rule_revisions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references workflow_rule_catalog(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade, -- mirrors catalog
  version_number int not null,
  condition jsonb not null default '{}',           -- e.g. {"severity": ["high","critical"]}
  actions jsonb not null,                          -- ordered array of action specs
  is_published boolean not null default false,
  published_at timestamptz,
  published_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (rule_id, version_number)
);

alter table workflow_rule_catalog
  add constraint catalog_current_revision_fk
  foreign key (current_revision_id) references workflow_rule_revisions(id) deferrable initially deferred;

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  rule_id uuid not null references workflow_rule_catalog(id),
  revision_id uuid not null references workflow_rule_revisions(id),
  event text not null,
  event_payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  parent_run_id uuid references workflow_runs(id),   -- for fan-out / nested runs
  recursion_depth int not null default 0
    check (recursion_depth <= 8),                    -- guard against rule loops
  created_at timestamptz not null default now()
);

create table workflow_action_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  order_index int not null,
  action_type text not null,
  input jsonb not null,
  output jsonb,
  status text not null check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  unique (run_id, order_index)
);

create table workflow_action_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  action_result_id uuid not null references workflow_action_results(id) on delete cascade,
  scheduled_for timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'dead_letter')),
  last_error text,
  locked_at timestamptz,
  locked_by text                                    -- worker id
);

create index workflow_action_queue_ready_idx
  on workflow_action_queue(scheduled_for)
  where status = 'queued';
```

### 2.2 Evidence chain

```sql
-- Partitioned by month for retention and performance.
create table workflow_run_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  order_index int not null,
  event_type text not null,                         -- 'rule_matched', 'condition_eval', 'action_completed', ...
  payload jsonb not null,                           -- structured event detail
  prev_hash bytea,                                  -- previous evidence row's hash (chain)
  row_hash bytea not null,                          -- sha256(prev_hash || canonical_json(payload))
  created_at timestamptz not null default now(),
  unique (run_id, order_index)
) partition by range (created_at);

-- Partitions created monthly by a pg_cron job ensure_evidence_partitions().

create table workflow_tsa_anchors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),  -- null = global anchor across orgs
  anchored_at timestamptz not null default now(),
  evidence_root_hash bytea not null,                  -- merkle root or running hash
  tsa_url text not null,                              -- 'https://freetsa.org/tsr' or commercial NO TSA
  tsa_receipt bytea not null,                         -- RFC-3161 timestamp token
  covers_from timestamptz not null,
  covers_to timestamptz not null
);
```

### 2.3 Approvals

```sql
create table workflow_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  required_role text not null,                      -- e.g. 'amu_chair', 'hms_lead'
  required_count int not null default 1,            -- N-of-M
  approved_count int not null default 0,
  decided_at timestamptz,
  decision text check (decision in ('approved', 'rejected', null))
);

create table workflow_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references workflow_approvals(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  decided_by uuid not null references profiles(id),
  decision text not null check (decision in ('approved', 'rejected')),
  comment text,
  signing_audit_id uuid references workflow_signing_audit_log(id),  -- BankID receipt if used
  decided_at timestamptz not null default now(),
  unique (approval_id, decided_by)
);
```

## 3. Event naming

`ON_<ENTITY>_<VERB_PAST_TENSE>`. Tense matters: events fire **after** the state change is durable, never before.

Canonical events:

- `ON_DEVIATION_CREATED`, `ON_DEVIATION_CLOSED`
- `ON_WHISTLEBLOWING_RECEIVED`, `ON_WHISTLEBLOWING_CONCLUDED`
- `ON_SURVEY_PUBLISHED`, `ON_SURVEY_CLOSED`, `ON_SURVEY_RESPONSE_SUBMITTED`
- `ON_CHECKLIST_COMPLETED`, `ON_CHECKLIST_ITEM_NOT_OK`, `ON_CHECKLIST_OVERDUE`
- `ON_DOCUMENT_PUBLISHED`, `ON_DOCUMENT_ACKNOWLEDGED`
- `ON_COURSE_COMPLETED`, `ON_CERTIFICATE_ISSUED`, `ON_TRAINING_OVERDUE`
- `ON_AMU_MEETING_COMPLETED`, `ON_AMU_PROTOCOL_SIGNED`
- `ON_TASK_OVERDUE`, `ON_TASK_CLOSED`
- `ON_SDS_EXPIRED`
- `ON_SICK_LEAVE_WEEK_4`, `ON_SICK_LEAVE_WEEK_7`, `ON_SICK_LEAVE_WEEK_26`

Add events parsimoniously. Each new event is a new contract.

## 4. Emission

Source modules emit events via a Postgres trigger that writes a `workflow_runs` row. They never write to `tasks`, `documents`, or any other module's table.

```sql
create or replace function emit_workflow_event(
  p_event text,
  p_payload jsonb
) returns void
language plpgsql security definer as $$
declare
  r_org uuid := (p_payload->>'organization_id')::uuid;
  r_rule record;
begin
  for r_rule in
    select rc.id as rule_id, rc.current_revision_id, rr.condition
    from workflow_rule_catalog rc
    join workflow_rule_revisions rr on rr.id = rc.current_revision_id
    where rc.event = p_event
      and rc.is_enabled
      and (rc.organization_id = r_org or rc.organization_id is null)
      and condition_matches(rr.condition, p_payload)
  loop
    insert into workflow_runs (organization_id, rule_id, revision_id, event, event_payload)
    values (r_org, r_rule.rule_id, r_rule.current_revision_id, p_event, p_payload);
    perform pg_notify('workflow_run_ready', '');
  end loop;
end;
$$;
```

`condition_matches(condition jsonb, payload jsonb)` evaluates a JSON-logic-like dialect. Keep it small:

- `{ "field": "value" }` — equality
- `{ "field": ["a","b"] }` — membership
- `{ "field": { "gt": 5 } }` — comparison
- `{ "any_of": [...] }`, `{ "all_of": [...] }` — composition

Don't ship arbitrary expression eval. If a rule's logic doesn't fit, build a real action, don't make conditions a sublanguage.

## 5. The runner

Implemented as a Supabase Edge Function `workflow-runner`:

1. Listens on `pg_notify('workflow_run_ready')` and also polls every 5 s as a fallback.
2. Picks `pending` runs, claims with `for update skip locked`, sets `status = 'running'`.
3. For each action in the revision's `actions` array:
   - Creates a `workflow_action_results` row with `status = 'pending'`.
   - If the action is sync (e.g. `transition_status`, `create_task`), executes immediately.
   - If async (e.g. `send_email`, `generate_pdf`, `call_external`), enqueues in `workflow_action_queue`.
4. Writes evidence rows for each step: rule match, condition eval, action started, action completed.
5. On approval-gated actions, sets run status to `awaiting_approval` and pauses.
6. On completion, computes the run's evidence root hash and writes a final evidence row.

A separate edge function `workflow-queue-worker`, scheduled via `pg_cron`, drains `workflow_action_queue`. Idempotent: every async action is re-runnable.

## 6. Action types (canonical set)

Start with these. Add new types only when needed and with the same care as a new event.

- `transition_status(table, id, from, to)` — update a source row's status, audited.
- `create_task(template_id, assignee, due_offset_days, source_module, source_id)` — write to `tasks`.
- `create_notification(audience, template_id, payload)` — write to `notifications`; dispatcher emails.
- `create_alert(template_id, payload)` — open a deviation (typically from a failed checklist item).
- `add_to_backlog(meeting_type, source_module, source_id, suggested_topic)` — write to `amu_agenda_backlog`.
- `acknowledge_required(document_version_id, audience)` — fan out tasks for document acknowledgement.
- `request_approval(role, count, timeout_days)` — open a `workflow_approvals` row; pauses the run.
- `send_email(template_id, audience)` — via the dispatcher.
- `send_to_gov_outbox(endpoint, payload)` — writes to `gov_notifications_outbox`; the gov-outbox-worker drains.
- `generate_pdf(template_id, payload, store_as)` — server-side PDF; lands in Storage; references in the source row.
- `sign_with_bankid(document_id, signers)` — wraps the BankID flow; receipts land in `workflow_signing_audit_log`.
- `purge_personal_data(row_ref, fields)` — used by retention; writes audit, performs scrub.

## 7. TSA anchoring

Evidence rows form a hash chain per run. Periodically — typically nightly — a job:

1. Selects the latest evidence row per org.
2. Computes a global merkle root across orgs (so a tampered org's chain is detectable from outside).
3. Sends the root to a Trusted Time-Stamping Authority (RFC-3161). For Norwegian projects, prefer a Norwegian TSA where commercially available; freetsa.org acceptable for non-critical environments.
4. Stores the TSA receipt token in `workflow_tsa_anchors`.

A breach in the chain is detectable: re-hashing must reproduce the anchored root. An external auditor verifies independently using only the TSA receipts and the public root.

## 8. The runtime contract

Server Actions and Edge Functions emit events. They do not call the runner directly; they call `emit_workflow_event(event, payload)` and trust the runner. This is enforced by RLS:

- The application user has NO write privilege on `workflow_runs`, `workflow_action_results`, `workflow_run_evidence`, `workflow_action_queue`, or `workflow_tsa_anchors`. These tables grant only to the `service_role` user used by the edge functions.
- `workflow_rule_catalog` and `workflow_rule_revisions` writes are gated by the `workflows.manage` permission.

## 9. Versioning and dry-run

Editing a rule creates a new revision. Publishing flips `current_revision_id`. Past runs reference their immutable revision_id, so historical audits show "what the rule was at the time".

A dry-run mode replays an event against a candidate revision, writing to a shadow `workflow_dry_run_results` table. The runner exposes this as a Server Action `dryRunRule(ruleId, eventPayload)`. Nothing is committed, no side effects, no notifications fire.

## 10. Retention and pruning

- `workflow_runs` and `workflow_action_results` retain for `audit_log_default` (7 years).
- `workflow_action_queue` rows in `completed` state are purged after 30 days; `dead_letter` rows retained 1 year for forensics.
- `workflow_run_evidence` partitions are detached after 7 years and archived to cold Storage. The TSA anchors remain — they prove the archived chain's integrity even after detach.

## 11. Monitoring

Surfaced on a platform-admin dashboard:

- Queue depth (`status = 'queued'` count by org)
- Failure rate per action_type (last 24 h)
- Recursion depth distribution (alert on any run > 4)
- TSA anchor age (alert if > 25 h since last anchor)
- Dead-letter queue size (alert > 0 for any org)

Per-org dashboards surface: pending runs, awaiting approval, recently failed.

## 12. What this lets us do well

- **Compliance pack as data.** "When a survey closes and a category averages < 3, open a deviation and add to AMU backlog." Set in a rule, not in a function.
- **Multi-org policy updates without redeploy.** System rules ship with framework templates (e.g. ISO 27001). Activating the framework flips a flag; the rules fire.
- **Provable processes.** "Did we follow the sykefravær protocol?" — replay the events against the rule history. The evidence chain proves the trail.
- **External signoff integration.** BankID, Buypass, or a future Norwegian e-sign provider: a single `sign_with_bankid` action; the receipt is part of the evidence chain.

## 13. What not to do

- Don't bypass the engine to "make this simpler". Direct writes lose the evidence chain. The whole point is the chain.
- Don't introduce a Turing-complete condition language. Compose actions instead.
- Don't write evidence rows from application code. Only the runner writes them.
- Don't store sensitive payload data unencrypted in `workflow_runs.event_payload` if the rule is across an anonymity boundary (varsling). The payload is `audit_scrub`-ed before storage.
- Don't run the queue worker without locks. `for update skip locked` is mandatory; two workers without it will double-execute.
- Don't allow rule edits without revisions. Editing in place destroys auditability.
- Don't anchor too rarely. A 25-hour gap is a tampering window. Nightly anchoring is the floor.
