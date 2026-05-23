# Document module

Load this when working on the document library, HMS handbooks, policies, version control, or read-and-understood acknowledgements.

## Purpose

A version-controlled repository for:

- HMS handbooks (mandatory under Internkontrollforskriften § 5)
- Policies and procedures (ISO 27001/45001 readiness)
- AMU annual reports and protocols (archived from the meeting module)
- Training materials referenced by the e-learning module

Documents are immutable once published. New content means a new version, not editing the old one.

## Schema

```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  category text,                                  -- 'hms_handbook', 'policy', 'amu_protocol', etc.
  description text,
  current_version_id uuid,                        -- FK added after document_versions table
  requires_acknowledgement boolean not null default false,
  acknowledgement_audience jsonb default '{}',    -- {"all": true} or {"roles": [...]}
  retention_years int,
  archived_at timestamptz,
  created_at timestamptz default now(),
  created_by uuid references profiles(id)
);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  version_number int not null,
  file_path text not null,                        -- Supabase Storage
  file_size_bytes bigint,
  mime_type text,
  changelog text,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'published', 'superseded', 'withdrawn')),
  published_at timestamptz,
  published_by uuid references profiles(id),
  uploaded_at timestamptz default now(),
  uploaded_by uuid references profiles(id),
  unique (document_id, version_number)
);

alter table documents add constraint documents_current_version_fk
  foreign key (current_version_id) references document_versions(id) deferrable initially deferred;

create table document_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  document_version_id uuid not null references document_versions(id),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  acknowledged_at timestamptz default now(),
  ip_address inet,                                -- legitimate here; this is the proof
  user_agent text,
  unique (document_version_id, user_id)
);
```

Note: the IP address is stored on acknowledgements because the legal value of "the employee read it" depends on having a robust record. This is the opposite of the whistleblowing module's rule — context decides.

## Workflows

When a document version is published with `requires_acknowledgement = true`:

- Workflow creates tasks for each user in the audience: "Please review and acknowledge: {document.title}"
- The task closes when the user submits an acknowledgement
- Compliance dashboard shows % acknowledged per document per audience

When a document hits its retention horizon:

- Workflow flags it for review, doesn't auto-delete
- Org admin reviews and either extends or archives

## Section components

- `DocumentLibrary` — browse by category, search
- `DocumentDetail` — current version preview, version history, acknowledgement status
- `DocumentEditor` — upload new version, edit metadata
- `AcknowledgementReader` — full-screen reader with a checkbox at the end + confirm
- `AcknowledgementDashboard` — admin view of who has and hasn't acknowledged what

## Templates this module ships

Templates here are document *templates* (sample HMS handbooks) the org admin can fork into a real document for their org. Ship one starting set in Norwegian:

- `hms_handbook_template_nb` — outline-form HMS-håndbok matching Internkontrollforskriften § 5
- `policy_varsling_routines_nb` — varslingsrutiner matching AML kap. 2A requirements
- `policy_anti_harassment_nb` — anti-trakassering policy

## Deliverables checklist

- [ ] Migrations with the three tables and storage bucket setup
- [ ] Storage RLS scoped by organization
- [ ] Server Actions: `createDocument`, `uploadVersion`, `publishVersion`, `acknowledge`
- [ ] Workflow trigger: published version with audience → tasks created
- [ ] Section components registered
- [ ] Built-in document templates seeded

## What not to do

- Don't allow editing published version content. New content = new version, period.
- Don't let acknowledgements be retroactively edited. They are append-only proof.
- Don't show document files via signed URLs that bypass RLS — go through a server route that authenticates and streams.
