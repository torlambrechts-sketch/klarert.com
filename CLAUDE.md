# CLAUDE.md

This file loads at the start of every Claude Code session. Keep it short. Module and topic detail lives in `.claude/modules/` and is loaded on demand.

## Project

**klarert.com** — multi-tenant compliance platform for Norwegian workplaces. Starts with Arbeidsmiljøloven (AML) and Internkontrollforskriften. Designed to extend to ISO 27001 / 45001 / 9001 and sectoral frameworks **without code changes** — only new templates and workflows.

We are rebuilding from a prior prototype at `github.com/torlambrechts-sketch/NewAMU` — already named `"klarert"` internally. It is mature (175+ migrations, ~25 edge functions, 9 framework registries, an evidence-anchoring workflow engine) but built on React 19 + Vite + React Router 7. The rebuild is a **deliberate stack change** to Next.js 15 App Router + RSC. Port patterns and data; never port code. See `.claude/modules/AMU_LEGACY.md` for the full transition guide.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind v4 + shadcn/ui, tokens in `lib/design/tokens.ts`
- Supabase (Postgres, Auth, Storage, Edge Functions, `pg_cron`)
- React Hook Form + Zod for every form, every Server Action input
- TanStack Table (via our `<DataGrid>` wrapper) for list views
- Deployed on Vercel
- nb-NO default locale, `en` fallback; user text via `t()`

Adding a dependency requires explicit user approval. Already present: shadcn primitives, Tailwind, Supabase client, Zod, date-fns, lucide-react, React Hook Form, TanStack Table.

## Architectural rules (non-negotiable)

1. **Data, not code.** Module config, templates, workflows, role permissions, form schemas live in Postgres. If you find yourself hardcoding a checklist item, a question, an approval step, or a role check in TypeScript — stop and put it in the database.
2. **Multi-tenancy by RLS.** Every tenant-scoped table has `organization_id uuid not null` and an RLS policy that scopes by `current_org_id()` (which reads `auth.uid()` and the active org claim). Never rely on application-layer filtering for isolation. Cross-tenant queries go through explicit service-role functions, audited.
3. **Component registry is the only way to add sections.** New page sections register in `lib/registry/components.ts` (`COMPONENT_REGISTRY`). The layout engine renders only what's in the registry, filtered by the user's permissions **and** by `organization_modules.enabled`. Do not import section components directly into pages.
4. **Workflows are data.** Cross-module side effects (a deviation creating a task, a survey closing notifying the AMU) go through `workflow_triggers` + `workflow_actions`, executed by a single workflow runner. Never `await supabase.from(...).insert()` from a section component to fire a cross-module effect.
5. **Audit everything.** Every state change on a compliance object writes to `audit_log` via a Postgres trigger. Never bypass. The audit log is append-only — there is no UPDATE policy.
6. **Server-side first.** Default to Server Components and Server Actions. Client components only for genuine interactivity. No service-role keys, no Supabase admin client, in the browser bundle — ever.
7. **Structural anonymity, not configured anonymity.** When a module accepts anonymous input, the schema must make identification impossible. Separate table, no FK to users, no IP/session/auth context stored. Every anonymity guarantee is proven by an automated test that tries to join and fails.
8. **Norwegian first.** All built-in templates ship in `nb-NO`, written for an Arbeidstilsynet inspector. The schema supports localization; the defaults assume Norwegian.
9. **Law references are load-bearing strings.** Use the exact format the gap planner and dashboards match on: `AML § 4-3`, `AML § 2A-7 (5)`, `AML kap. 2A`, `IK-f § 5 nr. 7`, `GDPR Art. 35`, `Likestillings- og diskrimineringsloven § 26`. Spaces and `§` matter. A `LawRef` Zod string format validates inputs; template content is reviewed against it.

## Lessons paid for already (do not relearn)

These come from the NewAMU prototype — see `.claude/modules/AMU_LEGACY.md` and `.claude/modules/COMPETITIVE.md` for context.

- **Migrations apply via CI / `supabase db push`.** Never instruct a user to run a migration in the SQL editor. If a migration is required for a feature to work, the feature is gated on schema presence at boot.
- **Every outbox needs a worker shipped in the same PR.** Writing intent without delivery is a footgun. Notifications flow through the workflow engine → an edge-function dispatcher that drains queues. No `_outbox` table without a paired drain function.
- **Auto-provision on `organizations.insert`.** No "open this section once to provision it" bootstrap step. Org creation triggers seed all per-org rows the org will need.
- **Feature flags live in `module_config` rows.** Not in conditional UI copy. The string "(når X er påslått)" must never reach the user.
- **Source of truth is git.** Anything not in this repo does not exist. AI-builder deploys that don't commit source are forbidden.
- **Never `check (col in (...))` for an extensibility surface.** The prototype's `org_module_payloads.module_key` constraint forced two follow-up migrations to extend. Use a lookup table with FK instead.
- **Anonymity is by separate table, not by trigger.** The prototype's `is_anonymous = true → nullify user_id` pattern is the "filled in by accident" mode the architecture forbids. Separate table, no FK, proven by test.
- **Workflow engine is the only cross-module path.** Even when a direct write seems easier, route it through `emit_workflow_event()`. The evidence chain is the deliverable. See `.claude/modules/workflow.md`.

## Folder structure

```
app/                           # Next.js routes
  (auth)/                      # public/auth routes
  (app)/[org]/...              # tenant-scoped routes (mandatory /[org]/ segment)
  (public)/varsling/...        # unauthenticated public forms
components/
  ui/                          # shadcn primitives (don't modify directly)
  shell/                       # PageShell, Section, nav, layout chrome
  primitives/                  # Stack, Cluster, Grid, Surface, MetaList
  states/                      # EmptyState, ErrorState, LoadingState
  data/                        # DataGrid, FormField, Toolbar
  sections/                    # registered section components (registry-only)
lib/
  design/                      # tokens.ts, theme.css
  supabase/                    # client + server + service factories
  registry/                    # COMPONENT_REGISTRY, workflow actions, triggers
  rbac/                        # permission helpers (mirror the SQL functions)
  workflows/                   # workflow engine client helpers
  retention/                   # purge helpers, retention policies
modules/
  <module>/                    # module-specific server actions, schemas, components
templates/                     # built-in template seeds (SQL/JSON), per module
supabase/
  migrations/                  # numbered .sql files, append-only
  functions/                   # edge functions (workflow runner, anon-varsling, dispatcher)
  tests/                       # pgTAP RLS + anonymity tests
.claude/
  modules/                     # per-module + per-topic instruction files (loaded on demand)
```

## Naming and code style

- Tables: `snake_case`, plural (`alert_actions`, not `AlertAction`).
- Every table has: `id uuid default gen_random_uuid() primary key`, `organization_id uuid` (or explicit cross-tenant comment), `created_at timestamptz default now()`, `created_by uuid references profiles(id)`. Append-only tables also have a deny-update RLS.
- Use Zod schemas for every Server Action input. Schemas live next to the action and are re-exported for client use.
- `select('id, name, ...')` — never `select('*')` in production code paths.
- Code identifiers and comments in English. Table/column comments and user-facing strings in nb-NO when audience is Norwegian.
- Domain vocabulary uses the canonical Norwegian terms — see `.claude/modules/TERMINOLOGY.md`. Do not invent English aliases for `avvik`, `varsling`, `vernerunde`, `verneombud`, etc.

## What "done" looks like

Before marking a feature complete, all of these must be true:

- [ ] Migration under `supabase/migrations/` applied locally and to a preview branch.
- [ ] RLS policies for SELECT / INSERT / UPDATE / DELETE on every relevant role, with a pgTAP test under `supabase/tests/` that switches users and asserts the matrix.
- [ ] Anonymity tests (if applicable) that try to join the anonymous table to users and assert no path exists.
- [ ] Server Actions have Zod input validation and return typed `{ ok: true, data } | { ok: false, error }` — never throw to the client.
- [ ] New section components registered in `COMPONENT_REGISTRY` with permission and module requirements declared.
- [ ] Cross-module effects routed through a workflow trigger, not direct DB writes.
- [ ] Audit trigger present on every state-changing table; verified by inserting a row and reading `audit_log`.
- [ ] System templates seeded in `templates/<module>/` and inserted by the migration. Norwegian text reviewed for tone.
- [ ] Worker / dispatcher / cron job shipped alongside any outbox or scheduled table.
- [ ] `npm run typecheck`, `npm run lint`, and `supabase test db` all green.

## Where to read next

Module detail (load only when working on that module):

- `admin.md` — orgs, users, roles, module activation, templates
- `survey.md` — surveys, anonymous responses, psychosocial assessments
- `checklist.md` — recurring checks, evidence upload, signoff
- `alert.md` — deviations and whistleblowing, anonymous tracking codes
- `task.md` — central action tracker, Kanban
- `document.md` — version-controlled documents, acknowledgements
- `elearning.md` — courses, quizzes, certificates, mandatory training
- `meeting.md` — AMU meetings, protocols, attendee signoff
- `register.md` — chemical register (Stoffkartotek), SDS expiry

Cross-cutting topic detail (load when working in that area):

- `DESIGN_SYSTEM.md` — Claude-inspired tokens, wrapper components, page-type layouts
- `SECURITY.md` — RLS testing, anonymity testing, secrets, GDPR / Datatilsynet
- `DATABASE.md` — migration conventions, audit trigger pattern, retention engine, performance
- `ENGINEERING.md` — Server Actions, error model, testing strategy, observability, accountability
- `workflow.md` — workflow engine: catalog + revisions, evidence chain, TSA anchoring, signoffs
- `COMPLIANCE.md` — Norwegian regulation → feature map (baseline)
- `COMPLIANCE_EXTENDED.md` — additional AML chapters, GDPR, ARP, BHT, sykefraværsoppfølging, Byggherreforskriften, Arbeidstilsynet inspection extensions
- `COMPETITIVE.md` — Vanta / VComply learnings, Norwegian wedge, future-module backlog
- `AMU_LEGACY.md` — what to carry forward from the NewAMU prototype (data, patterns, anti-patterns)
- `TERMINOLOGY.md` — nb-NO ⇄ EN domain cheat sheet

Do not load every file. Load CLAUDE.md, then the one or two files that match the current task.

## What not to do

- Don't add a new top-level route without checking whether it belongs as a section in the layout engine.
- Don't add a `role` enum check in TypeScript — extend the RBAC tables and use the SQL helper `has_permission()` / `has_role()`.
- Don't write a `useEffect` that fetches on mount when a Server Component would do.
- Don't add a dependency without asking.
- Don't ship a UI button whose backend isn't built. No half-truths.
- Don't write multi-paragraph comments. Code should explain itself; comments are for non-obvious why.
- Don't use emojis in product UI or commit messages.
