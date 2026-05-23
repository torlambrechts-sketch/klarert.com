CLAUDE.md
This file is loaded at the start of every Claude Code session. Keep it short. Module-specific detail lives in `.claude/modules/<module>.md` and is loaded on demand.
Project
Multi-tenant compliance platform. Starts with the Norwegian Working Environment Act (Arbeidsmiljøloven, "AML") and the Internal Control Regulation (Internkontrollforskriften). Designed to extend to ISO 27001, ISO 45001 and other frameworks without code changes — only new templates and workflows.
Stack
Next.js 15 (App Router) + React + TypeScript
Tailwind CSS + shadcn/ui
Supabase (Postgres, Auth, Storage, Edge Functions)
Deployed on Vercel
Architectural rules (non-negotiable)
Data, not code. Module config, templates, workflows, role permissions and form schemas live in Postgres. The frontend reads them at runtime. If you find yourself hardcoding a checklist item, a question, an approval step or a role check in TypeScript, stop and put it in the database instead.
Multi-tenancy by RLS. Every tenant-scoped table has `organization_id uuid not null` and an RLS policy that uses `auth.uid()` to scope reads/writes. Never rely on application-layer filtering for tenant isolation.
Component registry is the only way to add sections. New page sections register themselves in `lib/registry/components.ts` (`COMPONENT_REGISTRY`). The layout engine renders only what's in the registry. Do not import section components directly into pages.
Workflows are data. Cross-module side effects (a deviation creating a task, a survey closing notifying the AMU) go through the workflow engine tables, not through ad-hoc `await supabase.from(...)` calls in components.
Audit everything. Every state change on a compliance object (alert, task, document version, AMU protocol, training completion) writes a row to `audit_log` via a Postgres trigger. Never bypass.
Server-side first. Use Server Actions and Server Components. Client components only when you need interactivity. No service-role keys in the client, ever.
Folder structure
```
app/                         # Next.js routes
  (auth)/                    # public/auth routes
  (app)/[org]/...            # tenant-scoped routes
components/
  ui/                        # shadcn primitives (do not modify directly)
  shell/                     # PageShell, nav, layout chrome
  sections/                  # registered section components
lib/
  supabase/                  # client + server + service factories
  registry/                  # COMPONENT_REGISTRY, workflow actions, triggers
  rbac/                      # permission helpers (mirror the SQL functions)
  workflows/                 # workflow engine client helpers
modules/
  <module>/                  # module-specific server actions, components, schemas
templates/                   # built-in template seeds (SQL/JSON), per module
supabase/
  migrations/                # numbered .sql files, append-only
  functions/                 # edge functions (workflow runner, anon-varsling)
.claude/
  modules/                   # per-module instruction files (loaded on demand)
```
Naming and code style
Tables: `snake_case`, plural (`alert_actions`, not `AlertAction`).
Always include `id uuid default gen_random_uuid() primary key`, `organization_id`, `created_at timestamptz default now()`, `created_by uuid references profiles(id)`.
Use Zod schemas for every Server Action input. Schemas live next to the action and are re-exported for client use.
Prefer `select('id, name, ...')` over `select('*')`. Never ship `select *` to production.
All UI text passes through `t()` (i18n). Default locale `nb-NO`, fallback `en`.
What "done" looks like for any feature
Before you mark a task complete, all of these must be true:
[ ] Migration file added under `supabase/migrations/` and applied locally.
[ ] RLS policies written and tested for all four operations (select/insert/update/delete) for each relevant role.
[ ] Server Actions have Zod input validation and return typed errors, never throw to the client.
[ ] Any new section component is registered in `COMPONENT_REGISTRY` with permission requirements declared.
[ ] Any cross-module effect goes through a workflow trigger, not direct DB writes.
[ ] Audit log fires for every state change (verified by inserting a row and checking `audit_log`).
[ ] System templates seeded under `templates/<module>/` and inserted by the migration.
[ ] `npm run typecheck` and `npm run lint` pass.
When you need module detail
Read the matching file in `.claude/modules/`. Do not load all of them — they are large and most are not relevant to the task at hand:
`admin.md` — orgs, users, roles, module activation, template management
`survey.md` — surveys, anonymous responses, psychosocial assessments
`checklist.md` — recurring checks, evidence upload, signoff
`alert.md` — deviations and whistleblowing (AML kap. 2A), anonymous tracking codes
`task.md` — central action tracker, Kanban, cross-module origins
`document.md` — version-controlled documents, acknowledgements
`elearning.md` — courses, quizzes, certificates, mandatory HMS training
`meeting.md` — AMU meetings (AML kap. 7), protocols, attendee signoff
`register.md` — chemical register (Stoffkartotek), SDS expiry
Compliance principles (apply across modules)
Anonymity is structural, not optional. When a module supports anonymous input, the schema must make it impossible to join the response to a user — no nullable `user_id` that gets filled in "by accident". Use a separate `anonymous_responses` table with no FK to users.
Medvirkning (employee participation) must be provable. Every risk assessment, checklist completion and document acknowledgement records a signed timestamp the user cannot edit after the fact.
Retention. Personal data linked to closed alerts and surveys must be purgeable on a schedule defined per template. Build delete cascades accordingly.
Norwegian first. All built-in templates ship in `nb-NO`. The schema supports per-template localization but built-ins are written for a Norwegian auditor (Arbeidstilsynet) reading the output.
What not to do
Don't create a new top-level route without checking whether it should be a section in the layout engine instead.
Don't add a `role` enum check in TypeScript — extend the RBAC tables and use the SQL helper.
Don't write a `useEffect` that fetches data on mount when a Server Component would do.
Don't add a new dependency without asking. shadcn, Tailwind, Supabase client, Zod, date-fns, lucide-react are already present.
