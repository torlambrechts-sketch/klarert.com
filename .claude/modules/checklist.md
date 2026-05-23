# Checklist module

Load this when working on recurring compliance checks, safety walkthroughs requiring evidence, onboarding checklists, or any repeating "did we do this" task.

## Purpose

A checklist is a template plus a schedule. The template defines the items; the schedule decides when instances are created. Each instance lives until completed and proves the work happened.

This module exists alongside the survey module because the use cases differ:

- Survey: collect opinions/data from many people, possibly anonymous
- Checklist: prove that a defined set of items was completed by named people at a specific time, with evidence

## Schema

```sql
create table checklist_templates_items (
  -- Lives inside templates.config for the checklist module type.
  -- Documented here for reference only.
);

-- Example templates.config for a checklist:
-- {
--   "items": [
--     { "id": "fire_exit_clear", "label": "Brannutgang ikke blokkert", "evidence": "photo_required" },
--     { "id": "first_aid_stocked", "label": "Førstehjelpsskap er fullstendig", "evidence": "optional" }
--   ],
--   "schedule": { "frequency": "weekly", "day_of_week": "monday" },
--   "assignment": { "role": "verneombud" },
--   "signoff_required": true
-- }

create table checklists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id uuid not null references templates(id),
  title text not null,
  assigned_to uuid references profiles(id),
  department_id uuid references departments(id),
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'overdue', 'cancelled')),
  completed_at timestamptz,
  completed_by uuid references profiles(id),
  signoff_at timestamptz,
  signoff_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table checklist_item_results (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  item_id text not null,                      -- matches template config item id
  status text not null check (status in ('ok', 'not_ok', 'na')),
  notes text,
  evidence_path text,                          -- Supabase Storage path
  checked_by uuid not null references profiles(id),
  checked_at timestamptz default now()
);

create index checklists_due_idx on checklists(organization_id, due_at) where status in ('pending', 'in_progress');
```

## Scheduling

Don't write a cron job in Vercel. Use Supabase `pg_cron` to run a daily function `materialize_checklists()` that:

1. Reads active checklist templates with a schedule
2. For each, computes the next due date(s) within the next 30 days
3. Inserts `checklists` rows that don't already exist for that template + due date

This is idempotent — running twice doesn't duplicate. Use a unique constraint on `(template_id, due_at, assigned_to)` to enforce that.

## Evidence

When a template item declares `evidence: "photo_required"`, the UI:

1. Refuses to mark the item complete without an upload
2. Uploads to a private Supabase Storage bucket `evidence/{org_id}/{checklist_id}/{item_id}/{filename}`
3. Stores the resulting path in `evidence_item_results.evidence_path`

Access to the bucket is gated by a Storage policy that mirrors RLS on `checklist_item_results`.

## RLS

- Checklists are readable by the assignee, their manager, the department, and HMS leads
- Item results have the same scope as their parent checklist
- Evidence inherits the parent's permissions via Storage RLS

## Workflows

When a checklist item is marked `not_ok`:

- Auto-create a `deviation` row (via workflow trigger, not direct call) with the item label as the title and a link back to the checklist
- Assign a task to the HMS lead

When a checklist becomes overdue:

- Notify the assignee
- After 7 days overdue, notify their manager
- After 14 days, surface on AMU agenda backlog

All of this is workflow trigger configuration, not code.

## Section components

- `ChecklistInbox` — the assignee's view of upcoming/overdue checklists
- `ChecklistRunner` — the page where the user actually checks items, with evidence upload
- `ChecklistDetail` — read-only summary view
- `ChecklistAdmin` — manage templates, schedules, audit a department's compliance rate
- `ChecklistComplianceDashboard` — completion rates, overdue counts, by department

## Templates this module ships

| Template | Locale | Purpose |
|---|---|---|
| `checklist_vernerunde_weekly` | nb-NO | Weekly walkthrough, verneombud assigned |
| `checklist_onboarding_employee` | nb-NO | First-week onboarding items per AML §§ 3-2 (training) |
| `checklist_daily_safety` | nb-NO | Daily pre-shift checks (industrial settings) |
| `checklist_monthly_first_aid` | nb-NO | Monthly first-aid kit and fire equipment check |

## Deliverables checklist

- [ ] Migration with checklists, checklist_item_results, unique constraint
- [ ] `materialize_checklists()` pg_cron function, scheduled daily
- [ ] Storage bucket policy for evidence
- [ ] Server Actions: `startChecklist`, `recordItemResult`, `completeChecklist`, `signoffChecklist`
- [ ] Section components registered
- [ ] Workflow triggers for `not_ok` items and overdue checklists
- [ ] Templates seeded

## What not to do

- Don't let users edit past item results. Once `checked_at` is set, the row is immutable. Corrections create a new row with a `supersedes_id` if needed.
- Don't let a user complete a checklist before all required items are recorded.
- Don't store evidence outside Supabase Storage (no S3 sidecar, no Vercel Blob).
