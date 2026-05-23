# E-learning module

Load this when working on courses, lessons, quizzes, certificates, or HMS training tracking.

## Purpose

Track mandatory HMS training. Specifically required by Norwegian law:

- **HMS training for leaders** (AML § 3-5) — every employer with leadership responsibility must complete this. The platform should ship a system course that satisfies the minimum content requirements per § 3-5.
- **Verneombud training** — safety representatives must complete training (typically 40 hours for larger workplaces) per *Forskrift om organisering, ledelse og medvirkning* § 3-19.
- **Role-specific safety training** — driving forklifts, handling chemicals, working at height, etc.

The module also serves as a general LMS for non-mandatory training.

## Schema

```sql
create table courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,  -- null = system course
  template_id uuid references templates(id),
  title text not null,
  description text,
  category text,                                  -- 'hms_leadership', 'verneombud', 'chemical_handling', etc.
  estimated_minutes int,
  passing_score int default 80,                   -- percentage
  is_mandatory_for jsonb default '{}',            -- {"roles": ["verneombud"]} or {"all": true}
  certificate_template jsonb,                     -- {title, body_template, valid_for_months}
  is_published boolean not null default false,
  created_at timestamptz default now()
);

create table course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  order_index int not null,
  title text not null,
  content_type text not null check (content_type in ('text', 'video', 'pdf', 'interactive', 'quiz')),
  content jsonb not null,                          -- shape depends on content_type
  is_required boolean not null default true,
  unique (course_id, order_index)
);

create table course_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  course_id uuid not null references courses(id),
  user_id uuid not null references profiles(id),
  enrolled_at timestamptz default now(),
  enrolled_by uuid references profiles(id),       -- null for self-enrollment
  due_at timestamptz,
  status text not null default 'enrolled'
    check (status in ('enrolled', 'in_progress', 'completed', 'failed', 'expired')),
  started_at timestamptz,
  completed_at timestamptz,
  final_score int,
  unique (course_id, user_id, enrolled_at)
);

create table lesson_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references course_enrollments(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  lesson_id uuid not null references course_lessons(id),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed')),
  time_spent_seconds int default 0,
  last_position jsonb,                            -- e.g. video timestamp, scroll position
  completed_at timestamptz,
  unique (enrollment_id, lesson_id)
);

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references course_enrollments(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  lesson_id uuid not null references course_lessons(id),
  attempt_number int not null,
  answers jsonb not null,
  score int not null,
  passed boolean not null,
  attempted_at timestamptz default now(),
  unique (enrollment_id, lesson_id, attempt_number)
);

create table certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  enrollment_id uuid not null references course_enrollments(id),
  user_id uuid not null references profiles(id),
  course_id uuid not null references courses(id),
  certificate_number text not null unique,         -- format: ORG-COURSE-YYYY-NNNNN
  issued_at timestamptz default now(),
  valid_until timestamptz,
  pdf_path text not null,                          -- Supabase Storage
  revoked_at timestamptz,
  revoked_reason text
);
```

## Lesson content shapes

`content_type` and the `content` JSONB are paired:

- `text` — `{ markdown: "..." }`
- `video` — `{ provider: 'mux' | 'self', src: "...", duration_seconds: 480 }`
- `pdf` — `{ file_path: "..." }`
- `interactive` — `{ component: "RegistryComponentName", props: {...} }` — renders a component from a separate `INTERACTIVE_REGISTRY` (parallel to the page registry)
- `quiz` — `{ questions: [{ id, prompt, type: 'single' | 'multi', options: [...], correct: [...], explanation: "..." }] }`

The quiz schema is the only one with right/wrong answers, so it's the only one that produces `quiz_attempts` rows.

## Progress tracking

A lesson is `completed` when:

- `text` / `pdf` — user clicks "I have read this" and a minimum dwell time has passed (configurable, default 30s; prevents instant click-through)
- `video` — playback reaches ≥ 95% of `duration_seconds`, tracked server-side via periodic progress pings
- `interactive` — component fires `onComplete`
- `quiz` — most recent attempt's `passed = true`

Lessons must be completed in order if `is_required = true`. The runner UI enforces this; the SQL also enforces via a function that won't accept progress on lesson N+1 until lesson N is complete.

## Quizzes

- Random question order, optionally
- Configurable attempt limit (default 3)
- On failure beyond attempt limit, enrollment status becomes `failed` and a workflow triggers re-enrollment after a cooldown
- Correct answers and explanations are revealed only after the attempt is submitted, never before
- Question bank can include "compute": the answer key may be a function; for v1 stick to multiple choice

## Certificates

When a course is completed:

1. Generate a unique `certificate_number` (org prefix + course code + year + sequence)
2. Render PDF server-side using a templated layout (course title, user name, completion date, valid-until date, signature placeholder, certificate number, QR code linking to a public verification page)
3. Store in private Supabase Storage bucket `certificates/{org_id}/{certificate_id}.pdf`
4. Insert `certificates` row
5. Workflow trigger: email the user with certificate (link, not attachment, requires sign-in to download)

A public verification page at `/verify/{certificate_number}` shows: course title, holder name, issue date, valid-until date, status (valid/revoked). No PII beyond name. This is the certificate's anti-forgery defense.

## Mandatory training enforcement

`is_mandatory_for` on a course means the system enforces enrollment:

- A nightly job (`pg_cron`) checks every user against every course where `is_mandatory_for` matches them
- Missing or expired enrollments are auto-created
- A configurable due date is set (e.g. "30 days from role assignment")
- Users with overdue mandatory training get a banner blocking certain workflows until completed (define which — likely document acknowledgements but not core operations)

## RLS

- Courses: system courses readable by everyone; org courses by their org
- Enrollments: readable by the user, their manager, and HMS leads
- Lesson progress, quiz attempts: readable by the user and HMS leads (managers don't see quiz answers)
- Certificates: the user always sees their own; HMS leads see all in the org; public verification endpoint goes through a service-role function that returns only the non-PII summary

## Section components

- `CourseCatalog` — browse available courses
- `CourseDetail` — syllabus, lessons, enroll button
- `LessonRunner` — the actual content player (one per content_type)
- `QuizRunner` — the quiz UI
- `MyLearning` — user's enrolled courses with progress bars
- `CertificateWallet` — user's certificates
- `LearningAdmin` — assign courses, view org-wide completion stats
- `MandatoryTrainingReport` — compliance dashboard for HMS lead

## Templates / system courses this module ships

| Course | Locale | Hours | Purpose |
|---|---|---|---|
| `hms_for_leaders_nb` | nb-NO | ~3 | AML § 3-5 leadership HMS training |
| `verneombud_basic_nb` | nb-NO | 40 | Verneombudskurs (foundational) |
| `chemical_handling_basic_nb` | nb-NO | 1 | Basic chemical safety for non-specialists |
| `working_at_height_nb` | nb-NO | 2 | Fall protection basics |
| `psychosocial_workplace_nb` | nb-NO | 1 | Recognizing harassment and bullying |

Build the schema and lesson runner first. System course content is a separate content-authoring task — leave placeholder content in lessons until subject-matter experts contribute real content.

## Deliverables checklist

- [ ] Migration with all seven tables
- [ ] Storage buckets and policies for course media and certificates
- [ ] Server Actions: `enrollUser`, `recordLessonProgress`, `submitQuizAttempt`, `completeCourse`, `issueCertificate`, `revokeCertificate`
- [ ] PDF generation (use `@react-pdf/renderer` server-side or a templated approach)
- [ ] Public verification route
- [ ] `pg_cron` job for mandatory enrollment enforcement
- [ ] All section components registered
- [ ] System courses seeded with skeleton structure (placeholder content)

## What not to do

- Don't let users edit their own progress, scores, or completion timestamps.
- Don't store certificates as base64 in the database. Storage paths only.
- Don't show quiz correct answers to users before they submit.
- Don't allow client-side determination of "lesson complete" without server verification (especially video — anyone can fake a 95% progress event; check timestamps and require multiple pings).
- Don't generate certificates client-side. Server only.
