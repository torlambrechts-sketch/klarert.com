# Competitive landscape — Vanta, VComply, and the Norwegian wedge

Load this when scoping new modules, evaluating feature requests, or pitching the platform.

This file also covers what we carry forward from the prior prototype (AMUlett / NewAMU) and what to never repeat.

## 1. The two reference platforms

### Vanta — security-compliance category leader

- ~15,000 customers, US-startup orientation, extending into European frameworks since 2024.
- **Framework coverage (35+)**: SOC 2, ISO 27001/27701/42001/9001, HIPAA, HITRUST, PCI-DSS, GDPR, CCPA, FedRAMP, CMMC, NIST CSF / 800-53 / 800-171, NIS 2, DORA, EU AI Act, TISAX, Microsoft SSPA, Cyber Essentials, CIS Controls. Cross-mapping engine reuses one control across many frameworks.
- **Continuous monitoring**: 400+ native integrations (AWS, GCP, Azure, Okta, GitHub/GitLab, Jira, Rippling, Workday, Salesforce, 1Password, Slack, DocuSign). 1,200+ tests running hourly. Claims 70–80% evidence automation on a standard cloud + IdP + HRIS stack.
- **Policy management**: pre-built templates, central storage, version control, automated acknowledgement workflows. AI Agent drafts policies from control gaps; compares written policy to actual practice.
- **Vendor risk (TPRM)**: vendor inventory, shadow-IT discovery, automated scoring, AI questionnaire automation (95% acceptance, ~75% time saved).
- **Trust Center**: public branded compliance microsite with real-time evidence, one-click NDA, visitor analytics. Hosts pages for Snowflake, GitHub, WeWork.
- **Risk management**: register with owner/inherent/residual scoring, treatment plan, 100+ scenario library, heatmap, auditor snapshots.
- **Audit-readiness**: auditor portal with read-only access, auto-generated SOC 2 System Description and ISO 27001 SoA.
- **HRIS-driven lifecycle**: provisioning, training assignment, policy acknowledgements, access reviews, offboarding deprovisioning.
- **AI Agent 2.0 (Jan 2026)**: autonomous drafting, questionnaire answering, control mapping, evidence verification, remediation snippets.
- **Pricing**: Essentials ~$10–15k (1 framework, <50 emp), Plus, Professional (~$25–50k, 2 frameworks, 50–200 emp), Enterprise (~$50–80k+).

### VComply — no-code GRC suite for mid-market regulated industries

- 500+ customers, 96% 4-5★ on G2. Functionally narrower than Vanta on integrations and AI; broader on operational compliance.
- **Product suite**: ComplianceOps, PolicyOps (Paula C. AI assistant), RiskOps, CaseOps. GRCOps bundles all four.
- **Framework coverage**: SOX, PCI-DSS, GDPR, ISO 9001/27001, NIST, HIPAA, OSHA (closest analogue to AML), plus configurable custom frameworks.
- **Workflow builder**: no-code, rule-based with smart alerts, escalations, deadline reminders, recurring tasks.
- **Reporting & dashboards**: real-time compliance dashboards, kanban risk views, one-click regulator reports, role-configurable.
- **Mobile / inspection app**: iOS + Android for field audits and incident capture. Offline support unclear.
- **Document & version control**: central repo, attestation tracking, full-text search.
- **Incident & CAPA**: report → triage → track → resolve, audit trail.
- **Multi-entity**: parent → subsidiary → site hierarchy with consolidated dashboards.
- **EHS angle**: positions for OSHA, safety audits, multi-site SOPs — but no dedicated EHS schema (no chemical register, no work-injury classification, no sykefraværsoppfølging). **This is the gap we own.**

## 2. Table-stakes vs differentiators

### Must-have to be credible

| Capability | Our coverage |
|---|---|
| Multi-framework controls library with cross-mapping | ✅ via templates + workflow (planned) |
| Policy templates + versioning + employee attestation | ✅ `document` module |
| Risk register with scoring and heatmap | ❌ new module `risk` needed |
| Evidence library + auditor read-only access | ⚠ partial — `document` + `checklist` hold evidence; auditor role is a cross-cutting RBAC feature |
| Recurring checklists + tasks with reminders + escalations | ✅ `checklist` + `task` |
| Real-time dashboards per role | ⚠ partial — per-module exists, no cross-cutting `reporting` layer |
| Incident / case management with audit trail | ✅ `alert` covers deviations + whistleblowing |
| Audit log on every state change | ✅ mandatory architectural rule |
| RBAC + multi-entity scoping | ✅ `admin` + RLS; **multi-entity hierarchy** is an extension |
| Document version control + acknowledgements | ✅ `document` |
| Basic AI policy drafting | ❌ horizontal capability, not built |

### Differentiators used in sales

- **Vanta**: 400+ integrations, AI questionnaire automation, Trust Center as a revenue tool, agentic remediation. Hard to match in 6–12 months; not the right wedge for us.
- **VComply**: no-code workflow builder, mobile inspections, multi-entity consolidation, sector templates.

## 3. The Norwegian-AML wedge

Gaps neither US-centric platform addresses well — this is our defensible position.

1. **nb-NO templates curated for Arbeidstilsynet.** Every built-in checklist, alert form, AMU protocol, document template written for a Norwegian inspector — not translated US text. Lives across all modules; `templates/` seeds ship in nb-NO.
2. **Structural anonymity for varsling (AML kap. 2A).** Separate `anonymous_responses` / `whistleblowing_reports` tables, no FK to users, tracking-code-based follow-up. Provable via schema test. `alert` module covers it; document the architecture publicly.
3. **Arbeidstilsynet audit packages.** One-click export of the exact bundle an inspector requests. New cross-cutting export/reporting layer.
4. **BHT (bedriftshelsetjeneste) integration.** Invitable external role with scoped access. RBAC extension + scoped views.
5. **Sykefraværsoppfølging.** Statutory 4-/7-/26-week milestones, dialogmøter, IA-avtalen branch programs. New module `sickleave`. Neither Vanta nor VComply has anything like this.
6. **Verneombud + AMU governance (AML kap. 6–7).** Protocol templates, attendee signoff, election cycle. `meeting` module covers AMU.
7. **Stoffkartotek per FOR-2001-12-06-1357.** SDS expiry, exposure-group linkage, substitution duty. `register` module.
8. **HMS-kort + mandatory training enforcement per branch.** Sector-specific. `elearning` extension.

## 4. Future-module backlog

These are not yet designed in depth. When they come up, draft a `.claude/modules/<name>.md` matching the structure of the existing module files before writing schema.

### `risk` — risk register
- Inherent + residual scoring along configurable dimensions.
- Heatmap, trend, top categories, point-in-time auditor snapshots.
- Links risks → controls (via `templates`), risks → tasks (via `tasks`), risks → vendors.
- Distinct from `alert` (which is operational deviations and whistleblowing). Risk is forward-looking; deviation is backward-looking.

### `vendor` — third-party risk management
- Vendor inventory, intake forms, shadow-IT discovery.
- Risk scoring rubric. Procurement approval workflows.
- AI questionnaire automation (later).
- Cross-link with `document` for SOC 2 / ISAE 3402 / DPAs.

### `monitor` — continuous evidence collection
- Integrations framework: Supabase Edge Functions as connectors.
- Initial connectors: Microsoft 365, Google Workspace, Slack, GitHub, Azure AD.
- `monitor_tests` define pass/fail checks; results land in `evidence_items` consumable by audit packages.
- NAV / Altinn integration for `sickleave` submissions belongs here.

### `trust` — public trust center
- Branded compliance microsite per tenant.
- Pulls real-time control evidence (with audience gating).
- One-click NDA via DocuSign / scrive.no.
- AI chatbot answering visitor security questions from the trust library (later).

### `sickleave` — sykefraværsoppfølging
- See COMPLIANCE_EXTENDED.md §7.
- Statutory deadlines as computed columns.
- NAV digital submission via `monitor`.
- High-PII module — strict RLS, retention class `personnel_active`.

### `incident` — work-related injuries and illnesses (AML kap. 5)
- Distinct from `deviations`. Personal injury and illness with reporting timelines.
- Statutory notification workflows to Arbeidstilsynet and police.
- Long-retention class for CMR/asbestos exposure (60 years).

### `time-records` — arbeidstidsregistrering (AML § 10-7)
- One row per employee per day. Partitioned monthly.
- Schedules (§ 10-3) + averaging agreements (§ 10-6).
- Employee self-view; tillitsvalgte + HMS lead access.
- Export to nb-NO PDF + CSV for tilsyn.

### `equality` — ARP / likestillingsredegjørelse
- See COMPLIANCE_EXTENDED.md §5.
- Four-step assessment templates.
- Wage mapping CSV import (every other year for > 50 employee orgs).
- Annual report generator with aggregates only (no raw rows).

### `construction` — Byggherreforskriften
- See COMPLIANCE_EXTENDED.md §8.
- Optional, gated on `is_byggherre` flag.
- SHA-plan, daily site register with HMS-kort, forhåndsmelding.

### Cross-cutting layers (not modules)

- **`reporting`** — saved views, dashboards, audit-package export. Reads from every module via permission-gated views.
- **`ai`** — drafting, questionnaire answering, evidence verification. Surfaces in each module as Server Actions, not a destination.
- **`mobile`** — PWA + offline checklist sync. Required for vernerunde in the field.
- **`auditor-role`** — scoped read-only RBAC + an `/auditor/<token>` portal that doesn't require an account.
- **`org-hierarchy`** — parent → subsidiary → site. Schema extension in `admin`. Cross-tenant queries still go through explicit, audited functions.

## 5. Lessons from the NewAMU prototype

The prior project (`github.com/torlambrechts-sketch/NewAMU`, internally already called `"klarert"`) is mature — 175+ migrations, ~25 edge functions, a workflow engine with RFC-3161 TSA anchoring, 9 framework registries. We rebuild for stack reasons (React/Vite → Next.js App Router), not because the prior work was wrong. See `.claude/modules/AMU_LEGACY.md` for the full inheritance map.

### What worked — carry forward

- **Module taxonomy and Norwegian naming**: AMU / Verneombud / Vernerunde / Avvik / ROS / Stans av arbeid / Varsling / Undersøkelser / Dokumenter (Wiki) / Opplæringssenter / Oppgaver. Adopt verbatim.
- **7-kind alert taxonomy** (`work_injury_illness`, `near_miss`, `harassment_discrimination`, `violence_threat`, `psychosocial`, `whistleblowing`, `other`) — see `alert.md`.
- **13-module AML compliance dashboard seed** — AMU, Verneombud, ROS-analyser, Vernerunder, Avvik & forbedring, Sykefravær & IA, HMS-opplæring, Bedriftshelsetjeneste, Arbeidstid, Sikker jobbanalyse, Arbeidsmiljøkartlegging, Beredskap & brann.
- **23-lesson AML masterclass for leaders** — covers § 1-1 through § 19-1.
- **19 AMU system meeting templates** plus the 7 default council compliance items.
- **Regelverk registry of 9 frameworks** with paragraph text — AML, IK-f, LDL, GDPR, FOLM, Brannvern, Åpenhetsloven, BHT-f, Utf.arb.
- **Workflow engine with TSA anchoring** — see `workflow.md`.
- **HMAC fingerprinting** for cross-org alert dedup without PII leakage.
- **Agenda backlog drain** pattern in the AMU module — never delete, mark `drained_at` / `drained_into`.
- **Three-function public submission surface** — submit / status / purge-attachments.
- **Locale-decoupled system content** — `(parent template) + (per-locale child)` shape.
- **Domain rules** worth preserving as workflow triggers:
  - Vernerunde "Ikke OK" auto-creates an avvik.
  - ROS at medium/high cannot close until a mitigation task links.
  - Only verneombud can register and lift a "Stans av arbeid (§ 6-3)".
  - Verneombud role is *synced* from member role, not separately editable.
  - System courses live in a global catalog; orgs copy or consume; only `platform_admin` edits the catalog.
  - Annual rotation of AMU leader between employer and employee side — practice rule, surface as a reminder.
  - Min 4 AMU meetings/year — cadence monitor.
- **nb-NO copy to lift** — see `AMU_LEGACY.md` §1 for the seed list.

### What to never repeat — anti-patterns observed in the prototype

| Anti-pattern | Corrective rule |
|---|---|
| `check (col in (...))` on extensibility surfaces (`org_module_payloads.module_key`) — forced two follow-up migrations | Lookup table with FK. See DATABASE.md §13. |
| Composite primary keys (`regulations(organization_id, id)`) — single-column FKs fail with Postgres error 42830 | Single-column `id uuid` PKs. Cross-table tenant invariants via trigger. DATABASE.md §14. |
| Anonymity via `is_anonymous=true` trigger that nullifies `user_id` | Separate `anonymous_*` tables with no FK. SECURITY.md §3. |
| Six-call-site widget-kind sprawl (discriminated union duplicated across files) | One registry file; exhaustive switch type-checks automatically. ENGINEERING.md §3. |
| `SECURITY DEFINER` public RPCs (`public_submit_whistleblowing` etc.) | Public submissions via Edge Functions only, never direct SQL. SECURITY.md §7. |
| localStorage as persistence for compliance state (early Council / Tasks) | Server-first. CLAUDE.md rule 6. |
| Stray components at repo root (`DocumentTemplatesSettings.tsx`, `path/to/`) | Strict folder discipline enforced via `no-restricted-paths`. |
| Repo-root `.md` files for design/spec/roadmap | All instruction content in `.claude/modules/`. |
| Postgres enum `compliance_pack` requiring `ALTER TYPE` to extend | Lookup table `compliance_frameworks`. |
| Single `law_ref text` later joined by `law_refs text[]` — backfill migration required | Ship arrays from migration 0001 when multiplicity is plausible. |
| `crypto.randomUUID()` polyfills duplicated across pages | Single `freshId(prefix)` helper. |
| Manual "Run migration X" prompts in UI | CI applies migrations. Feature gates on schema presence at boot. |
| Outbox tables without workers (`hse_halt_alert_outbox` written, never drained) | Worker shipped in same PR. |
| Document center requiring a privileged user to "open once" to provision | Auto-provision via `organizations.insert` triggers. |
| Implicit tenant scoping (no `/[org]/` URL segment) | Mandatory `(app)/[org]/...`. |
| Schema drift surfacing as runtime errors ("Databasen mangler kolonnen scope") | Boot-time schema check or fail fast. |
| Half-built features with disabled buttons | No button without backend. |
| Feature flags leaking into UI strings ("når X er påslått") | Flags live in `module_config`. |

## 6. Scoring a feature request against this landscape

Before adding a module or a non-trivial feature, answer:

1. **Is this table-stakes?** If yes, prioritize.
2. **Is this a differentiator the wedge depends on?** (nb-NO, varsling, audit packages, BHT, sykefravær, AMU.) If yes, prioritize.
3. **Is this a Vanta integration play?** If yes, defer — it's their moat, not ours yet.
4. **Is this a VComply parity feature?** (Workflow builder UI, mobile field app, multi-entity.) Schedule, but it's not urgent.
5. **Does it fit an existing module?** If yes, extend. If no, draft a new `.claude/modules/<name>.md` before writing schema.
6. **Can it be a template + workflow trigger?** If yes, do that — not a new module.

## 7. Sources

- [Vanta features](https://www.vanta.com/features) · [Vanta Trust Center](https://www.vanta.com/products/trust-center) · [Vanta AI](https://www.vanta.com/products/ai) · [Vanta Risk](https://www.vanta.com/products/risk-management) · [Vanta TPRM](https://www.vanta.com/products/third-party-risk-management) · [Vanta pricing](https://www.vanta.com/pricing) · [Vanta NIS 2 / DORA / TISAX](https://www.vanta.com/resources/european-momentum-new-frameworks)
- [VComply product suite](https://www.v-comply.com/product) · [VComply OSHA / safety audit](https://www.v-comply.com/blog/best-osha-compliance-software-safety-audit/) · [VComply G2 reviews](https://www.g2.com/products/vcomply/reviews)
