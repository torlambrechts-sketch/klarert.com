# Alert module — Deviations (Avvik) and Whistleblowing (Varsling)

Load this when working on incidents, deviations, or whistleblowing reports.

This is the most compliance-sensitive module. AML kapittel 2A is strict and well-litigated. Read this whole file before writing schema.

## Two distinct things behind one UI

The word "alert" covers two legally different concepts. They share a UI surface but **must not share a row in the same table** because their access rules are incompatible.

| Type | Legal basis | Who can read |
|---|---|---|
| Deviation (`avvik`) | Internkontrollforskriften — operational HMS incidents | HMS leads, line managers, reporter |
| Whistleblowing (`varsling`) | AML kap. 2A — kritikkverdige forhold | Only the `varsling_committee` role + the reporter via tracking code |

If you put both in one table with a `type` discriminator and use RLS to split them, you create a permanent risk of policy drift. Use two tables.

## Alert kinds — the 7-category taxonomy

Both deviations and whistleblowing share a typed `kind` reference into a small lookup table. The seed (from the NewAMU prototype, `src/data/amlAnonymousReporting.ts`) is canonical — do not re-translate:

| kind | nb-NO label | hint | routes to |
|---|---|---|---|
| `work_injury_illness` | Arbeidsskade / sykdom | Skader, ulykker eller arbeidsrelatert sykdom (AML kap. 5). | `incidents` (when that module ships); fall back to `deviations` |
| `near_miss` | Nestenulykke | Hendelser som kunne ført til skade. Viktig for forebygging. | `deviations` |
| `harassment_discrimination` | Trakassering / diskriminering | Krenkende handlinger eller forskjellsbehandling (AML § 4-3). | `deviations` if internal report; `whistleblowing_reports` if reporter chooses varsling track |
| `violence_threat` | Vold / trusler | Vold, trusler eller utilbørlig opptreden (AML § 4-3). | `deviations` + AMU agenda |
| `psychosocial` | Psykososialt arbeidsmiljø | Forhold som påvirker psykisk arbeidsmiljø (AML § 4-3). | `deviations` |
| `whistleblowing` | Varsling (kritikkverdige forhold) | AML kap. 2A — kritikkverdige forhold i virksomheten. | `whistleblowing_reports` always |
| `other` | Annet (AML-relevant) | — | `deviations` |

```sql
create table alert_kinds (
  id text primary key,
  label_nb text not null,
  hint_nb text,
  routes_to text not null check (routes_to in ('deviation', 'whistleblowing', 'either')),
  display_order int not null
);
```

The public submission form lets the reporter pick the kind. The `routes_to = 'either'` rows show the reporter both tracks with a one-line explanation of the difference.

## The anonymity rule

AML kap. 2A guarantees the right to report anonymously. "Anonymous" here means **structural anonymity**: the system must be incapable of revealing the reporter's identity, not merely configured to hide it.

Concretely:

- An anonymous report has **no `created_by`**, **no `reporter_email`**, **no IP**, **no session id** stored anywhere — not in the row, not in the audit log, not in Supabase Auth.
- The reporter receives a **tracking code** (a 64-bit random token shown once, hashed in the database). They use this code to check status and reply.
- A follow-up message from the reporter must also avoid storing identity. The endpoint that accepts replies takes the raw token, hashes it, looks up the report, and writes the message — without ever creating an auth session for the reporter.

If the reporter chooses to identify themselves, that's a separate, opt-in code path with its own row shape.

## Schema

```sql
-- Deviations: standard HMS incidents
create table deviations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id uuid references templates(id),
  title text not null,
  description text,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  category text,                                  -- defined per template
  location text,
  occurred_at timestamptz,
  reported_by uuid references profiles(id),       -- can be null if reporter chose anonymous-internal
  status text not null default 'open'
    check (status in ('open', 'investigating', 'action_pending', 'closed', 'rejected')),
  closed_at timestamptz,
  closed_by uuid references profiles(id),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table deviation_actions (
  id uuid primary key default gen_random_uuid(),
  deviation_id uuid not null references deviations(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  action_type text not null
    check (action_type in ('comment', 'status_change', 'assignment', 'attachment', 'task_created')),
  payload jsonb not null,
  performed_by uuid references profiles(id),
  performed_at timestamptz default now()
);

-- Whistleblowing: legally separate, isolated table
create table whistleblowing_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id uuid references templates(id),
  -- No reporter_id column. Ever.
  tracking_code_hash text not null unique,        -- sha256 of the token shown to reporter
  subject text not null,
  description text not null,
  category text,
  is_anonymous boolean not null default true,
  -- If reporter chose to identify themselves, store contact info encrypted at column level.
  -- This is opt-in only and must not be inferrable for anonymous reports.
  reporter_contact_encrypted bytea,
  status text not null default 'received'
    check (status in ('received', 'under_review', 'investigating', 'concluded', 'dismissed')),
  received_at timestamptz default now(),
  concluded_at timestamptz
);

-- Messages: bidirectional thread between reporter (via tracking code) and committee
create table whistleblowing_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references whistleblowing_reports(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  author_role text not null check (author_role in ('reporter', 'committee')),
  author_id uuid references profiles(id),         -- null when author_role = 'reporter'
  body text not null,
  posted_at timestamptz default now(),
  -- Hard constraint: if reporter, author_id must be null. If committee, must be non-null.
  constraint author_consistency check (
    (author_role = 'reporter' and author_id is null)
    or (author_role = 'committee' and author_id is not null)
  )
);
```

## RLS

Deviations follow the normal pattern: scoped by `organization_id`, readable by HMS leads, line managers in the department, and the reporter.

Whistleblowing is different. **Only** members of `varsling_committee` may read. There is no manager override, no admin override, no HMS lead override. This is a legal requirement, not a UX preference.

```sql
alter table whistleblowing_reports enable row level security;

create policy wb_select on whistleblowing_reports for select using (
  organization_id = current_org_id()
  and has_role('varsling_committee')
);

create policy wb_insert on whistleblowing_reports for insert with check (
  organization_id = current_org_id()
  -- anyone can insert; the public form does this via a service-role edge function with rate limiting
);

create policy wb_update on whistleblowing_reports for update using (
  organization_id = current_org_id()
  and has_role('varsling_committee')
);

-- No delete policy. Whistleblowing records are not deletable through the API.
-- Retention purges run via a scheduled function, audited.
```

## The anonymous submission flow

The public form is **not** behind auth. It posts to an Edge Function `submit-whistleblowing`. The Edge Function:

1. Validates input (Zod, server-side).
2. Generates a 16-byte random token, base32-encoded for the reporter (~26 chars, readable, e.g. `J4K2-M8FQ-7XPR-2VWN-NB94-Z3HM`).
3. Hashes the token with sha256, stores the hash only.
4. Inserts the report using the service role key — **but with no logging of headers**. The Edge Function must be configured to suppress request logs for this endpoint, or to scrub them. Document this in the deployment notes.
5. Returns the token to the reporter exactly once. The UI shows it with a "you cannot recover this; save it now" warning.

The reporter checks status by posting the token to `check-whistleblowing-status`, which hashes, looks up, and returns status + messages.

The reporter replies by posting `{ token, body }` to `post-whistleblowing-message`, which writes a row with `author_role = 'reporter'`, `author_id = null`.

## Tracking code length and entropy

128 bits of entropy minimum. Don't use uuids — they're predictable in some implementations. Use `crypto.randomBytes(16)` from Node's crypto, base32-encode, group in 4-char chunks separated by hyphens for readability.

Rate-limit the public endpoint aggressively (per IP, per session, and a global per-org rate). Don't store the IP in the database — store it in a transient KV (Vercel KV or similar) with a TTL of an hour, just for rate limiting.

## Cross-org dedup via HMAC fingerprint

From the NewAMU prototype's `alerts_fingerprint_hmac.sql`. Pattern: detect "this pattern appears across multiple orgs" without leaking row content.

1. A per-environment HMAC secret is stored in Supabase Vault, accessible only to a `SECURITY DEFINER` function.
2. Both `deviations` and `whistleblowing_reports` carry a `fingerprint_hmac bytea` column, computed from non-identifying canonical fields: `kind`, normalized `sha256(lower(title || description))`, locale, country, week-of-year. **Never** from `organization_id`, `reporter_*`, `created_by`, IP, or any identifier.
3. A platform-admin function `alerts_cross_org_dedup(p_fingerprint_hmac bytea)` returns `(occurrence_count, earliest_seen_at, distinct_kinds)` — counts, no rows.
4. Surfaces only on a platform-admin dashboard ("this pattern appears in N orgs"). Never to tenant admins, never to AMU. The point is for the platform to detect potential brigading or coordinated harassment against a worker who has been pushed between employers — a known risk pattern.

Add `fingerprint_hmac` to both tables. RLS does not expose it to tenant users. The dedup function carries its own audit row.

## Public endpoints — three-function shape

From the prototype. Three Supabase Edge Functions cover the public surface:

- `alerts-public-submit` — accept a submission, return a tracking code. Validates with Zod, rate-limits, writes the row, returns the token exactly once.
- `alerts-public-status` — given a tracking code, return status + messages. Constant-time token comparison.
- `alerts-purge-attachments` — scheduled cleanup (via `pg_cron` → edge function) of orphaned attachment paths after the row's retention window. Attachments live in Storage with independent lifecycle; this fn closes the loop.

Add the third function. Without it, Storage accumulates files past the retention horizon, undermining the GDPR claim.

## Workflows

A deviation closing with `severity = 'critical'` should trigger:

- A task assigned to the HMS lead to write a follow-up note
- A notification to the AMU committee
- An entry into the AMU meeting agenda backlog (the meeting module reads this)

Do not hardcode these. Define them as workflow triggers (`workflow_triggers` row with `event = 'deviation.closed'`, condition `severity = critical`, and ordered actions).

A whistleblowing report being created should trigger:

- A notification to the `varsling_committee` (no detail in the notification body — only "a new report has been received", clickable to the dashboard)
- An entry in `audit_log` with no PII

Whistleblowing reports must **not** generate notifications to line managers, HR, or executive leadership. The committee decides who else sees the case.

## The dashboard pattern

`varsling_committee` members get a separate route at `/[org]/varsling` that is **not** linked from the main nav unless the user has the role. The page lists open reports with subject and received date — nothing more in the list view. Detail is one click deeper, with an explicit "I am the committee and I am opening this case" log entry written to audit.

Deviations live under `/[org]/avvik` with a Kanban board (driven by `tasks` linked from `deviation_actions` where `action_type = 'task_created'`).

## Section components to register

- `DeviationList` (Kanban + list view)
- `DeviationDetail` (timeline of actions, attachments, linked tasks)
- `DeviationForm` (uses template config for category options)
- `WhistleblowingList` (varsling_committee only)
- `WhistleblowingDetail` (committee view, with messaging thread)
- `WhistleblowingPublicForm` (unauthenticated, used in a public route)
- `WhistleblowingStatusCheck` (unauthenticated, token-based)

## Templates this module ships

| Template | Locale | Purpose |
|---|---|---|
| `deviation_default` | nb-NO | Standard HMS-avvik with categories: Sikkerhet, Ergonomi, Psykososialt, Kjemikalier, Annet |
| `deviation_near_miss` | nb-NO | Nestenulykke — lighter form, mandatory follow-up only if severity ≥ medium |
| `whistleblowing_default` | nb-NO | Generic varsling form with AML-compliant disclaimers (rett til anonymitet, vern mot gjengjeldelse) |

## Deliverables checklist

- [ ] Migration with `deviations`, `deviation_actions`, `whistleblowing_reports`, `whistleblowing_messages`
- [ ] RLS on every table — verified by a test that switches users
- [ ] Edge Functions: `submit-whistleblowing`, `check-whistleblowing-status`, `post-whistleblowing-message`
- [ ] Logging configured to scrub the public endpoints (documented)
- [ ] Rate limiting with KV
- [ ] Section components registered
- [ ] Built-in templates seeded
- [ ] Workflow triggers seeded for the events above

## What not to do

- Don't add a `reporter_id` to `whistleblowing_reports`, not even as nullable. The schema must make identification impossible.
- Don't return the tracking code in a follow-up email. The user receives it once, in the browser, and that's it.
- Don't let `org_admin` read whistleblowing reports by default. Org admins manage the platform; they don't get committee access unless they're explicitly added to `varsling_committee`.
- Don't reuse the deviation Kanban for whistleblowing. The visual languages should be different so a screen-share of one doesn't accidentally expose the other.
