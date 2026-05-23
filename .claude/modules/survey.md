# Survey module

Load this when working on surveys, psychosocial assessments, or *vernerunder* / *arbeidsmiljøkartlegging*.

## Purpose

Dynamic survey engine for:

- Employee satisfaction surveys
- Psychosocial risk assessments (mandatory under AML §§ 3-1, 4-3)
- Safety walkthroughs (vernerunder) — though these may also flow through the checklist module
- Generic feedback collection

## Anonymity model

Like alerts, anonymity is structural. A survey template declares an `anonymity_mode`:

- `identified` — `respondent_id` is set, RLS scopes detail by manager
- `anonymous` — no `respondent_id`, ever
- `pseudonymous` — a per-survey salt hashes the user's id, so aggregate "did this user respond yet" is possible but individual answers can't be re-identified

Psychosocial assessments default to `anonymous`. The UI explains the mode to the respondent before they start.

## Schema

```sql
create table surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_id uuid not null references templates(id),
  title text not null,
  description text,
  anonymity_mode text not null check (anonymity_mode in ('identified', 'anonymous', 'pseudonymous')),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed', 'archived')),
  opens_at timestamptz,
  closes_at timestamptz,
  audience jsonb not null default '{}'::jsonb,   -- {"all": true} or {"departments": [uuid]}
  created_at timestamptz default now(),
  created_by uuid references profiles(id)
);

-- Identified and pseudonymous responses
create table survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  respondent_id uuid references profiles(id),       -- null for pseudonymous (use hash instead)
  respondent_hash text,                              -- for pseudonymous mode
  answers jsonb not null,
  submitted_at timestamptz default now(),
  constraint identity_consistency check (
    (respondent_id is not null and respondent_hash is null)
    or (respondent_id is null and respondent_hash is not null)
  )
);

-- Fully anonymous responses go in a separate table with no link to users
create table anonymous_survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  answers jsonb not null,
  submitted_at timestamptz default now()
);

-- Receipt of participation (for pseudonymous and anonymous modes) — proves medvirkning
-- without revealing answers
create table survey_participation_receipts (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  participated_at timestamptz default now(),
  unique (survey_id, user_id)
);
```

The participation receipts table is **important**. Norwegian audits often ask "can you prove employees were invited and participated in the psychosocial assessment?" — `survey_participation_receipts` gives you that proof without breaking anonymity.

## Question schema

Questions live in `templates.config` for a survey template. Use a discriminated union — keep it simple, this is what the UI renders:

```ts
type Question =
  | { id: string; type: 'short_text'; label: string; required?: boolean }
  | { id: string; type: 'long_text'; label: string; required?: boolean }
  | { id: string; type: 'single_select'; label: string; options: string[]; required?: boolean }
  | { id: string; type: 'multi_select'; label: string; options: string[]; required?: boolean }
  | { id: string; type: 'likert_5'; label: string; required?: boolean }
  | { id: string; type: 'yes_no'; label: string; required?: boolean }
  | { id: string; type: 'section_header'; label: string; description?: string };
```

Don't add types until a real survey needs them. Likert + yes/no + selects + text covers ~95% of HMS surveys.

## RLS

- `surveys`: readable by users in the org whose role permits, or whose membership in `audience` includes them
- `survey_responses` (identified): readable by HMS lead and the respondent themselves; never by line managers without explicit permission
- `survey_responses` (pseudonymous): readable by HMS lead in aggregate, but the UI must enforce a minimum cohort size (e.g. ≥ 5) before showing breakdowns
- `anonymous_survey_responses`: readable by HMS lead in aggregate only

The "minimum cohort size" rule is enforced in the **query layer**, not just the UI. Build a SQL function `survey_aggregate(survey_id, group_by)` that refuses to return groups with fewer than N respondents.

## Workflows

When a survey closes, trigger:

- A summary task for the HMS lead to review results
- If pseudonymous/anonymous: a notification to the AMU agenda backlog (psychosocial topics are AMU territory)
- If aggregate risk score crosses a configured threshold: a deviation entry (links to alert module)

## Section components

- `SurveyList` (admin view, draft/open/closed tabs)
- `SurveyBuilder` (drag-and-drop question editor, edits template config)
- `SurveyRespondView` (the actual respondent UI — minimal chrome, clear anonymity statement)
- `SurveyResultsDashboard` (charts, with cohort-size guard)
- `SurveyParticipationReport` (who participated, for audit purposes — does not show answers)

## Templates this module ships

| Template | Locale | Purpose |
|---|---|---|
| `survey_psychosocial_default` | nb-NO | Standard psychosocial assessment with QPSNordic-inspired questions, anonymous mode locked |
| `survey_vernerunde` | nb-NO | Safety walkthrough with categories: fysisk arbeidsmiljø, ergonomi, kjemisk, biologisk |
| `survey_onboarding_30d` | nb-NO | 30-day check-in for new hires, identified mode |
| `survey_exit` | nb-NO | Exit interview, identified by default but respondent can opt to anonymize |

## Deliverables checklist

- [ ] Migration with the four tables, all RLS policies, `survey_aggregate` function
- [ ] Server Actions: `createSurvey`, `publishSurvey`, `closeSurvey`, `submitResponse`, `listSurveys`
- [ ] Edge function or RPC for anonymous submission (similar pattern to whistleblowing, but lighter — no tracking code needed)
- [ ] Cohort-size guard in `survey_aggregate` (function-level, not application-level)
- [ ] Section components registered
- [ ] Templates seeded with real Norwegian question text

## What not to do

- Don't add a "show me who answered what" toggle for anonymous surveys, even for admins.
- Don't show aggregate results before the survey closes, and not until cohort size threshold is met.
- Don't store the IP, device, or browser of respondents.
