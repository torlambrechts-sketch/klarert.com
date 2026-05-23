# NewAMU / klarert prototype — what to carry forward

Load this when designing or implementing a module that exists in the prior codebase. This file maps what the rebuild should inherit (data, patterns, names, copy) versus what it must consciously change (stack, RLS approach, anti-patterns).

## The framing

The repo at `github.com/torlambrechts-sketch/NewAMU` is the **current, actively-developed** prototype. Its `package.json` already calls it `"klarert"`. It is not abandoned — it has 175+ migrations, ~25 edge functions, ~100 page files, a mature workflow engine, and Norwegian regulatory content covering 9 frameworks.

The rebuild at `klarert.com` is a **deliberate stack change**, not a fresh attempt because nothing existed. We are moving from:

| Layer | NewAMU (prototype) | klarert.com (rebuild) |
|---|---|---|
| Framework | React 19 + Vite 8 + React Router 7 | Next.js 15 App Router + RSC |
| Data fetching | Client + Supabase JS client | Server Components + Server Actions |
| Forms | Mixed (Zod present) | React Hook Form + Zod, mandatory |
| UI | Custom `ui/` primitives, Tailwind 4 | shadcn/ui + Tailwind 4 + tokens |
| i18n | i18next | next-intl (`t()` wrapper) |
| Auth/RBAC | Custom permission keys + RLS | Same RBAC tables; URL `/[org]/` mandatory |
| Audit | `hse_audit_log` + workflow chain + TSA | Same chain, restated in DATABASE.md / workflow.md |

**Rule: port patterns and data; never port code.** The frameworks differ enough that copy-paste rarely works and usually drags in client-only assumptions. Read the prototype, understand the intent, re-implement against the rebuild's architecture.

## 1. What to port verbatim (data and content)

### 1.1 Alert / varsling — 7-kind taxonomy

Source: `src/data/amlAnonymousReporting.ts` in the prototype.

```ts
export const ALERT_KINDS = [
  { id: 'work_injury_illness',     label: 'Arbeidsskade / sykdom',
    hint: 'Skader, ulykker eller arbeidsrelatert sykdom (AML kap. 5).' },
  { id: 'near_miss',                label: 'Nestenulykke',
    hint: 'Hendelser som kunne ført til skade. Viktig for forebygging.' },
  { id: 'harassment_discrimination', label: 'Trakassering / diskriminering',
    hint: 'Krenkende handlinger eller forskjellsbehandling (AML § 4-3).' },
  { id: 'violence_threat',          label: 'Vold / trusler',
    hint: 'Vold, trusler eller utilbørlig opptreden (AML § 4-3).' },
  { id: 'psychosocial',             label: 'Psykososialt arbeidsmiljø',
    hint: 'Forhold som påvirker psykisk arbeidsmiljø (AML § 4-3).' },
  { id: 'whistleblowing',           label: 'Varsling (kritikkverdige forhold)',
    hint: 'AML kap. 2A — kritikkverdige forhold i virksomheten.' },
  { id: 'other',                    label: 'Annet (AML-relevant)',
    hint: null },
] as const;
```

Seed these as `alert_kinds` rows in the rebuild's `alert` module. Foreign-key from `deviations.kind_id` and `whistleblowing_reports.kind_id`. The `whistleblowing` kind must route through the varsling subsystem; other kinds route through deviations.

### 1.2 AML compliance modules (dashboard seed)

Source: `src/data/amlComplianceSeed.ts`. 13 modules with status thresholds. Names to use verbatim: AMU, Verneombud, ROS-analyser, Vernerunder, Avvik & forbedring, Sykefravær & IA, HMS-opplæring, Bedriftshelsetjeneste, Arbeidstid, Sikker jobbanalyse, Arbeidsmiljøkartlegging, Beredskap & brann. Use as default cards on the org dashboard.

### 1.3 AML "masterclass" course outline — 23 lessons

Source: `learning_aml_masterclass_2026_nb.sql` in the prototype. Covers AML § 1-1 through § 19-1 across 23 modules. **Use as the seed content for the rebuild's `hms_for_leaders_nb` system course** (see `.claude/modules/elearning.md`). Subject-matter content already exists; only the wrapper changes.

### 1.4 AMU system meeting templates (19)

Source: prototype's ROADMAP and `archive/20260414120000_council_tables.sql`. Use as the seed for `templates.module_type = 'meeting'`. The 7 default compliance items in `council_ensure_org_defaults()` go into `meeting_template_compliance_items` rows on org creation.

### 1.5 Cadence vocabulary

Plain text values, no check constraint: `'arlig'`, `'halvarlig'`, `'kvartalsvis'`, `'ad_hoc'`. Use this exact spelling — it is referenced by string match in scheduling logic.

### 1.6 Law-ref string format — **load-bearing**

The prototype's gap planner and dashboard widgets match on these strings literally. Match the format exactly:

- `'AML § 4-3'`
- `'AML § 2A-7 (5)'`
- `'AML kap. 2A'`
- `'IK-f § 5 nr. 7'`
- `'GDPR Art. 35'`
- `'Likestillings- og diskrimineringsloven § 26'`
- `'Byggherreforskriften § 8'`

Spaces matter. `§` not `s`, not `paragraph`. Add this to your template content review checklist. The rebuild should define a Zod string format `LawRef` that validates against the pattern and reuse it everywhere law references appear.

### 1.7 Regelverk registry — 9 frameworks

Source: `src/lib/regelverkRequirements.ts`. The prototype defines a typed registry of nine Norwegian frameworks (AML, Internkontrollforskriften, Likestillings- og diskrimineringsloven, GDPR, FOLM, Brannvern, Åpenhetsloven, BHT-f, Utf.arb) with the full text of key paragraphs. Port this as `templates/regelverk/<framework>.json` seed files. Treat as the source of truth for which framework references are valid in template content.

### 1.8 Workflow event naming

`ON_<ENTITY>_<VERB_PAST_TENSE>` — `ON_SURVEY_PUBLISHED`, `ON_SURVEY_CLOSED`, `ON_SURVEY_RESPONSE_SUBMITTED`, `ON_DEVIATION_CLOSED`, `ON_WHISTLEBLOWING_RECEIVED`, `ON_DOCUMENT_PUBLISHED`, `ON_CHECKLIST_ITEM_NOT_OK`, `ON_AMU_MEETING_COMPLETED`. The workflow runner indexes events by this string.

### 1.9 Accent palette per scope

Source: prototype's dashboard scope registry. Reserve these for module-level visual identity (used sparingly — see DESIGN_SYSTEM.md):

- Compliance/AML: `#1a3d32` (brand green)
- ISO: `#1e40af`
- Survey/megaphone: `#7c3aed`
- Tasks/kanban: `#c2410c`
- Learning: `#0e7490`
- Documents: `#0f766e`
- HMS overview: `#4338ca`
- Meetings: `#0891b2`

These augment, not replace, the copper accent from the design system. Use for badges, scope avatars, and chart series — not for primary action surfaces.

## 2. Patterns to adopt (re-implement, not copy)

### 2.1 HMAC fingerprinting for cross-org dedup

`alerts_fingerprint_hmac.sql` in the prototype shows how to deduplicate alerts across organizations **without leaking PII**. The pattern:

1. Per-environment HMAC secret in Supabase Vault.
2. `alerts.fingerprint_hmac` column computed from non-identifying canonical fields (kind, normalized text hash, locale).
3. `alerts_cross_org_dedup(fingerprint_hmac)` query returns count + earliest timestamp across orgs — no row data.
4. A platform-admin dashboard surfaces "this pattern appears across N orgs" without exposing tenant contents.

Port the pattern. See `.claude/modules/alert.md` for the rebuild's adapted schema.

### 2.2 Workflow engine — the crown jewel

The prototype's workflow engine spans 40+ migrations: `workflow_rules`, `workflow_runs`, `workflow_run_evidence`, `workflow_approvals`, `workflow_action_queue`, `workflow_rule_catalog`, `workflow_rule_revisions`, `workflow_signing_audit_log`, `workflow_evidence_chain_partition`, plus the `workflow-tsa-anchor` edge function for RFC-3161 timestamping.

This is far more mature than the simplified description in CLAUDE.md and DATABASE.md. Promote it to its own module file — see `.claude/modules/workflow.md`. Key features to inherit:

- **Evidence chain**: each workflow run writes hash-linked evidence rows that form a tamper-evident chain. Partitioned by month.
- **TSA anchoring**: an RFC-3161 trusted-timestamp authority (e.g. freetsa.org or a commercial Norwegian TSA) anchors the chain hash periodically. The TSA receipt is stored in `workflow_tsa_anchors`.
- **Catalog + revisions**: workflow rules live in `workflow_rule_catalog` (the editable definitions) and every save creates a `workflow_rule_revisions` row. Revisions are immutable. The runner always reads the latest published revision.
- **Queue worker pattern**: `workflow_action_queue` + `workflow_queue_worker_cron` + the `workflow-queue-worker` edge function. Three-piece atomic outbox: write, dispatch, drain — all shipped together.
- **Multi-role signoff**: `workflow_approvals` tracks N-of-M signoffs across named roles. Used for AMU protocol publishing, document publishing, policy attestation.

The rebuild should not re-derive this from scratch. Read the prototype's migrations and adopt the table shapes.

### 2.3 Agenda backlog drain (AMU meeting module)

Source: `trg_amu_agenda_backlog_drain()` in the prototype. The pattern:

```
amu_agenda_backlog (
  id, organization_id, meeting_type, source_module, source_id,
  priority, suggested_topic, suggested_decision,
  drained_at timestamptz,           -- null until pulled into a meeting
  drained_into uuid                 -- references meeting_agenda_items(id)
)
```

When a meeting moves to `in_progress` or its agenda is assembled, the chair pulls backlog items into `meeting_agenda_items`. The trigger updates `drained_at` and `drained_into` on the source row. The backlog stays append-only.

This is the right model for the rebuild's `meeting` module — replace any "delete from backlog" logic with this drain pattern.

### 2.4 Multi-framework regelverk registry pattern

The prototype models each regulatory framework as a typed object with paragraphs, captions, audience, and source URL. Use this shape:

```ts
type RegelverkParagraph = {
  ref: LawRef;                       // 'AML § 4-3'
  caption: string;                   // 'Psykososialt arbeidsmiljø'
  body: string;                      // The actual text from lovdata
  source_url: string;                // lovdata URL
  audience: ('amu' | 'hms_lead' | 'verneombud' | 'employee')[];
};
```

Stored as `templates/regelverk/aml.json` etc.; loaded into a `regelverk_paragraphs` table by a seed migration. Workflow conditions, audit packages, and template content reference rows by `ref`.

### 2.5 Public anonymous endpoints — three-fn shape

The prototype splits the public varsling surface into three edge functions:

- `alerts-public-submit` — accept a submission, return a tracking code
- `alerts-public-status` — given a tracking code, return status + messages
- `alerts-purge-attachments` — scheduled cleanup of attachment paths after retention

The rebuild's `.claude/modules/alert.md` already names the first two. Add the third — attachments to anonymous submissions need their own purge worker, separate from the row retention, because Supabase Storage and Postgres lifecycle independently.

### 2.6 Locale-aware system content

The prototype has `learning_system_course_locales` keyed by `(course_id, locale)` with a `law_refs jsonb` column. System content is multilingual; per-locale rows decouple translation from publication. Adopt this for **all** system templates: a parent `templates` row + child `template_locales` rows.

### 2.7 Slug + access-key pattern for external participants

The prototype lets external invitees view meeting protocols via `/meetings/external/:token` without an account, where `token` is a long random string indexed in `meeting_external_invitees(token_hash)`. Same pattern as the varsling tracking code, but for read-only protocol viewing. Use this in the rebuild's `meeting` module for external observers (BHT, union reps, auditors).

## 3. Patterns to consciously change

### 3.1 Anonymity by trigger → anonymity by separate table

The prototype's `surveys.is_anonymous = true` triggers a `BEFORE INSERT/UPDATE` that nullifies `user_id`. This is the "nullable filled in by accident" pattern the rebuild's CLAUDE.md explicitly warns against.

**Change**: use `anonymous_survey_responses` (no FK to users) and `survey_responses` (FK present) as two separate tables. The schema, not the trigger, enforces anonymity. See `.claude/modules/survey.md` and SECURITY.md §3.

### 3.2 Check-constraint enumerations → lookup tables

The prototype's `org_module_payloads.module_key` had a `check (col in (...))` constraint that locked four values. It later required two follow-up migrations (`20260416120000_extend_org_module_payload_keys.sql`, `20260510120000_org_module_workplace_reporting.sql`) to extend. Every `check (col in (...))` for an extensibility surface becomes a bottleneck.

**Change**: use a lookup table with FK. `compliance_pack` (PostgreSQL enum) should be a `compliance_frameworks` table. See DATABASE.md §17 (added).

### 3.3 localStorage state → server state

The prototype's Tasks and Council were initially localStorage-backed. The rebuild's CLAUDE.md mandates server-first.

**Change**: never use localStorage for compliance state. UI preferences (sidebar collapsed, theme) only.

### 3.4 Repo-root component files → strict folder discipline

The prototype has `DocumentTemplatesSettings.tsx` stranded at the repo root and a typo-folder `path/to/`. Reflects the velocity of an AI-builder workflow.

**Change**: section components live under `components/sections/`. Module-specific components under `modules/<module>/components/`. The folder structure is enforced by an ESLint rule (`no-restricted-paths`).

### 3.5 Single-column FK to composite-PK → triggered constraint

The prototype has `regulations` with PK `(organization_id, id)`. A single-column FK fails with Postgres error 42830.

**Change**: the rebuild's tables don't use composite primary keys. The natural key is `id uuid`. If a cross-table tenant-match invariant is needed, enforce via a `check_organization_match()` trigger, not via composite FK.

### 3.6 Six-call-site widget kinds → single registry

The prototype's CLAUDE.md flags that adding a chart kind requires touching six call sites because the discriminated union is duplicated across files.

**Change**: define widget kinds in one registry file with a discriminated union type. Every consumer imports the union; exhaustive switches type-check automatically. No duplication.

### 3.7 `SECURITY DEFINER` public RPCs → edge functions only

The prototype's `public_submit_whistleblowing`, `public_submit_anonymous_aml_report`, `public_anonymous_aml_page_settings` are SQL functions with `SECURITY DEFINER`. They bypass RLS by design but are easy to misconfigure.

**Change**: public unauthenticated submissions go through Supabase Edge Functions (`supabase/functions/<name>/`) using the service-role client, with input validated by Zod, rate-limited via KV, and request-logged with header scrubbing. No `SECURITY DEFINER` public RPCs in the rebuild.

### 3.8 Repo-root *.md files → `.claude/modules/`

The prototype has DESIGN_SYSTEM.md, ROADMAP.md, MODULE_SPEC.md etc. at the repo root. The prototype's own CLAUDE.md calls these "output, not process".

**Change**: all instruction content lives under `.claude/modules/`. Repo-root files are limited to `README.md` (one paragraph) and `CLAUDE.md` (Claude's entry point).

## 4. Modules that exist in the prototype but not yet in the rebuild instructions

These need new instruction files when the rebuild reaches them. Until then, treat the prototype's migrations as the de-facto spec.

| Prototype area | Maturity in prototype | Rebuild status |
|---|---|---|
| Workflow engine + TSA anchoring | 40+ migrations, 3 edge functions | New `.claude/modules/workflow.md` — see below |
| Government integrations (Altinn, Arbeidstilsynet, Datatilsynet, NAV) | `gov_*` tables + 7 edge functions | Belongs in `monitor` (see COMPETITIVE.md) — design pending |
| Partner console (multi-tenant for consultants) | `partner_*` tables | New module file `partner.md` when needed |
| Reporting engine | `reporting_engine`, `report_runs`, `dashboard_layouts` | New `reporting.md` when needed |
| Wiki PII/GDPR templates + retention framework | Migrations exist | Fold into `.claude/modules/document.md` + SECURITY.md |
| BankID signing | `bankid-init` edge function | Folds into `workflow.md` signing flow |

## 5. Migration strategy

This is the architectural question the user owns; the engineering team's recommendation:

- **Schema-first port.** Migrate the prototype's Postgres schema (slightly cleaned per §3) into `klarert.com/supabase/migrations/0001_core_platform.sql` through `00NN_*.sql`. RLS, audit trigger, retention class on every personal-data table. This is a one-week effort with two reviewers.
- **System content port.** Seed templates, regelverk paragraphs, system courses, AMU agenda templates, alert kinds — all as SQL inserts in dedicated `0NNN_seed_*.sql` migrations. The Norwegian text already exists; we are not re-translating.
- **UI from scratch.** Rebuild each route as a Next.js App Router page composed from registry sections. No copy-paste of React components.
- **Workflow engine port.** This is the highest-value subsystem and the hardest to get right. Mirror the tables; rewrite the runner as a Supabase Edge Function in TypeScript (the prototype's runner is JavaScript and entangled with the Vite client).
- **Sunset plan.** Once the rebuild covers the prototype's shipped surface, freeze the prototype as a read-only reference repo. Don't dual-maintain.

## 6. Source paths from the prototype worth re-reading

When you need to understand a feature deeply, read these files in the prototype (browse via GitHub web UI, do not copy code into the rebuild):

- `src/data/amlAnonymousReporting.ts` — alert taxonomy
- `src/data/amlComplianceSeed.ts` — 13 AML modules
- `src/lib/regelverkRequirements.ts` — regelverk registry
- `src/lib/dashboards/dashboardRegistry.ts` — dashboard scope pattern
- `src/lib/dashboards/freshId.ts` — id generation helper
- `src/lib/permissionKeys.ts` — RBAC permission map
- `src/types/reportBuilder.ts` — widget kinds (the six-call-site problem)
- `supabase/migrations/archive/20260101000000_enterprise_survey_module_core.sql` — survey schema
- `supabase/migrations/archive/20260414120000_council_tables.sql` — AMU core
- `supabase/migrations/archive/20260420120000_workflow_engine.sql` — workflow engine genesis
- `supabase/migrations/archive/20260501120000_whistleblowing_vault.sql` — varsling schema
- `supabase/migrations/archive/20260707200000_avvik_module_setup.sql` — deviation schema
- `supabase/migrations/<active>/alerts_fingerprint_hmac.sql` — HMAC dedup pattern
- `supabase/functions/workflow-tsa-anchor/index.ts` — TSA pattern
- `supabase/functions/alerts-public-submit/index.ts` — public submission canonical shape
- The prototype's own `CLAUDE.md` — explicit warnings about widget-kind sprawl, composite-FK pitfall, law-ref string format

## 7. What this file is not

This is not a port plan. It is a **reference** for `.claude/modules/*` so that when a Claude session works on (say) `alert.md`, it knows there is already a 7-kind taxonomy to import rather than inventing categories. When working on the `meeting` module, it knows the agenda-backlog-drain pattern is the right model. When working on workflows, it knows the TSA-anchored evidence chain is the target architecture, not a "nice to have".

Keep this file updated when the rebuild adopts or rejects a prototype pattern. The legacy pointer is only useful while it is accurate.
