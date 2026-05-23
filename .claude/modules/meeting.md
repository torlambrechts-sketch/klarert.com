# Meeting module — AMU (Arbeidsmiljøutvalg)

Load this when working on AMU meetings, meeting protocols, agendas, or annual HMS reports.

## Purpose

Statutory AMU meetings per AML kap. 7. The committee is required for organizations with ≥ 50 employees (and on request for those with 20–50). It must:

- Meet at least 4 times per year
- Keep written protocols
- Address structural HMS issues, not individual operational deviations
- Produce an annual HMS report

The module enforces these requirements through workflow, not just UI nudges.

## Schema

```sql
create table amu_committees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null default 'AMU',               -- larger orgs may have multiple
  established_at date,
  notes text,
  is_active boolean not null default true,
  unique (organization_id, name)
);

create table amu_committee_members (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references amu_committees(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  role text not null
    check (role in ('employer_rep', 'employee_rep', 'safety_rep', 'occupational_health', 'observer')),
  term_start date,
  term_end date,
  is_chair boolean not null default false
);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  committee_id uuid not null references amu_committees(id),
  title text not null,
  scheduled_at timestamptz not null,
  duration_minutes int default 60,
  location text,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  protocol_document_id uuid references documents(id),   -- when finalized, becomes a document
  created_at timestamptz default now()
);

create table meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  role text,
  rsvp_status text default 'invited'
    check (rsvp_status in ('invited', 'accepted', 'declined', 'tentative')),
  attended boolean,
  signoff_at timestamptz,                          -- when they signed off on the protocol
  unique (meeting_id, user_id)
);

create table meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  order_index int not null,
  topic text not null,
  description text,
  presenter_id uuid references profiles(id),
  source_module text,                              -- e.g. 'deviations' if pulled from backlog
  source_id uuid,
  discussion_notes text,
  decision text,                                   -- what was decided
  vote jsonb,                                      -- {for: 3, against: 1, abstain: 0}
  unique (meeting_id, order_index)
);
```

## The AMU agenda backlog

Other modules feed candidates for the AMU agenda:

- Deviation trends (aggregate, not individual incidents — see below)
- Psychosocial survey results
- Whistleblowing **categories** (never specific cases)
- Overdue mandatory training reports
- Repeat checklist failures

These show up in a "backlog" view when the chair plans the next meeting. The chair selects which to include; selection auto-fills `meeting_agenda_items` with `source_module` and `source_id`.

The key compliance principle (per AML guidance): **AMU looks at trends, not individual operational deviations**. So the agenda backlog from the deviation module is an aggregated view (e.g. "7 ergonomic deviations in Department X this quarter"), not a list of individual deviation rows.

### Backlog drain pattern

The backlog table is append-only. Pulling an item into a meeting **does not delete it** — it marks `drained_at` and `drained_into`. The history of "what was in the backlog when meeting M was planned" is preserved.

```sql
create table amu_agenda_backlog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  meeting_type text not null,                   -- 'amu_quarterly', 'amu_annual', 'amu_extraordinary'
  source_module text not null,                  -- 'deviations', 'surveys', 'training', ...
  source_id uuid,                               -- aggregate references may be null
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  suggested_topic text not null,
  suggested_decision text,
  evidence jsonb default '{}',                  -- aggregated counts, trend lines
  drained_at timestamptz,
  drained_into uuid references meeting_agenda_items(id),
  created_at timestamptz not null default now()
);

create index amu_agenda_backlog_pending_idx
  on amu_agenda_backlog(organization_id, meeting_type, priority, created_at)
  where drained_at is null;
```

A trigger on `meeting_agenda_items` insert updates the matching backlog rows. Workflow events emit when a backlog row is added (e.g. `ON_AMU_BACKLOG_ADDED`) so the chair sees a desk-side notification.

This is the model from the NewAMU prototype (`trg_amu_agenda_backlog_drain()`). It replaces any "delete from backlog" code in older sketches.

## Protocol workflow

1. Meeting moves to `in_progress` at scheduled time
2. Chair (or note-taker) edits agenda items live: discussion notes, decisions, votes
3. When meeting moves to `completed`:
   - Each `decision` with action becomes a task (via workflow trigger)
   - Protocol PDF is generated and stored as a document version
   - Attendees receive a signoff request — each attendee must explicitly sign off
   - Once all attendees have signed, the document version is published
4. Until all signoffs received, status is `awaiting_signoff` (computed, not stored)

## The 4-meetings-a-year enforcement

A `pg_cron` job runs monthly:

- For each active AMU committee
- Counts completed meetings in the current calendar year
- If by month X the count is below the prorated target (1 by end of Q1, 2 by Q2, 3 by Q3, 4 by Q4), creates a compliance alert visible to org admins
- This is also reflected on the org's compliance dashboard

## Annual HMS report

A specific document type (`category = 'amu_annual_report'`) that:

- Pulls aggregated stats from the year: deviations by category, completed training, meeting count, key decisions
- Is itself an AMU agenda item (typically the first meeting of the year)
- Once signed off, becomes a published document with `requires_acknowledgement = true` for the leadership audience

## RLS

- AMU committees and meetings: readable by committee members and org admins
- Meeting agenda items: same scope
- Members can edit their own RSVP and signoff
- Only the chair can finalize a meeting (and finalize triggers the workflow)

## Section components

- `AmuDashboard` — meeting count YTD, upcoming meeting, open action items from prior meetings
- `MeetingList` — past and upcoming meetings
- `MeetingPlanner` — schedule a meeting, build agenda from backlog
- `MeetingRunner` — live agenda view used during the meeting itself
- `ProtocolViewer` — read-only finalized protocol with signoff status
- `BacklogView` — pending items from other modules awaiting AMU attention

## Templates this module ships

| Template | Locale | Purpose |
|---|---|---|
| `amu_quarterly_default` | nb-NO | Standard quarterly agenda with mandatory sections (HMS review, prior actions, deviations summary, training compliance, new business) |
| `amu_annual_default` | nb-NO | Annual report meeting agenda |
| `amu_extraordinary` | nb-NO | Triggered by serious incident — fast-track agenda |

## Deliverables checklist

- [ ] Migration with all four tables
- [ ] Workflow triggers: meeting completed → tasks + protocol generation + signoff requests
- [ ] `pg_cron` job for meeting cadence compliance
- [ ] PDF generation for protocols
- [ ] Section components registered
- [ ] Backlog SQL views that aggregate from deviations, surveys, training, checklists
- [ ] Templates seeded

## What not to do

- Don't surface individual whistleblowing cases on the AMU backlog. Whistleblowing belongs to the committee with that role.
- Don't surface individual deviations on the AMU backlog. Aggregate first.
- Don't auto-finalize a protocol without explicit attendee signoff.
- Don't let non-AMU members read meeting agenda items, even with `org_admin` — that's a separate role.
