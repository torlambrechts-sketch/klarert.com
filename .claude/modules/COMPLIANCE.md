# COMPLIANCE.md

Norwegian regulation → feature mapping. Reference this when you need to justify a design choice or check that a module covers what the regulation expects.

Not legal advice. When in doubt, the source documents on lovdata.no and arbeidstilsynet.no are authoritative.

## Arbeidsmiljøloven (AML)

### Chapter 2A — Varsling (whistleblowing)

| Provision | Requirement | Implemented in |
|---|---|---|
| § 2A-1 | Right to report kritikkverdige forhold | Alert module — `whistleblowing_reports` |
| § 2A-2 | Procedure must be forsvarlig | Public submission form with clear guidance |
| § 2A-3 | Employer must investigate within reasonable time | Workflow triggers + committee dashboard |
| § 2A-4 | Protection against retaliation; reversed burden of proof | Audit log of all status changes; isolated access |
| § 2A-6 | Mandatory written routines for orgs ≥ 5 employees | Document module — `policy_varsling_routines_nb` template |
| § 2A-7 | Confidentiality of reporter identity | Structural anonymity — see `.claude/modules/alert.md` |

Key principle: anonymity must be structural. The schema must make it impossible to identify a reporter, not merely configured to hide them.

### Chapter 3 — HMS arbeid

| Provision | Requirement | Implemented in |
|---|---|---|
| § 3-1 | Systematic HMS work | Whole platform; AMU + checklist + deviation flow |
| § 3-2 | Training for safe work | E-learning module + acknowledgements |
| § 3-5 | Mandatory HMS training for leaders | `hms_for_leaders_nb` system course |

### Chapter 4 — Krav til arbeidsmiljøet

| Provision | Requirement | Implemented in |
|---|---|---|
| § 4-1 | General requirement: fully forsvarlig | Foundational; AMU oversees |
| § 4-3 | Psychosocial work environment | Survey module — anonymous psychosocial assessments |
| § 4-4 | Physical work environment | Checklist module — vernerunder |
| § 4-5 | Chemical and biological exposure | Register module |

### Chapter 6 — Verneombud

| Provision | Requirement | Implemented in |
|---|---|---|
| § 6-1 | Verneombud required ≥ 5 employees | Admin module — `verneombud` role |
| § 6-5 | Training requirement | E-learning module — `verneombud_basic_nb` |

### Chapter 7 — Arbeidsmiljøutvalg (AMU)

| Provision | Requirement | Implemented in |
|---|---|---|
| § 7-1 | AMU required ≥ 50 employees (or ≥ 20 on request) | Meeting module + cadence enforcement |
| § 7-2 | AMU tasks: review structural HMS issues | Backlog aggregates trends, not individual cases |
| § 7-3 | Meeting frequency: minimum 4 per year | `pg_cron` cadence monitor |

## Internkontrollforskriften

| Provision | Requirement | Implemented in |
|---|---|---|
| § 5 point 1 | Goals and policies | Document module |
| § 5 point 2 | Org structure with responsibilities | Admin module — departments and roles |
| § 5 point 3 | Map risks | Survey + checklist modules |
| § 5 point 4 | Action plans | Task module — actions tied to source |
| § 5 point 5 | Routines for handling regulation breaches | Alert module — deviations |
| § 5 point 6 | Systematic review of HMS work | AMU annual report |
| § 5 point 7 | Continuous improvement | Workflow engine, audit log |
| § 5 point 8 | Documentation | Everything is in the database, exportable |

## Forskrift om utførelse av arbeid (Chemicals)

| Provision | Requirement | Implemented in |
|---|---|---|
| Chapter 1 | SDS must be available to workers | Register module — readable by all employees |
| Chapter 3 | Risk assessment for chemical exposure | Register + Survey modules |

## Forskrift om organisering, ledelse og medvirkning

| Provision | Requirement | Implemented in |
|---|---|---|
| § 3-19 | Verneombud training (typically 40h) | E-learning — `verneombud_basic_nb` |
| § 3-2 | Medvirkning (employee participation) | Surveys with audience scoping; checklist signoffs; document acknowledgements |

## ISO 27001 / ISO 45001 readiness (future)

The architecture is designed to be ISO-extensible without code changes:

- ISO controls become **templates** (one template per control or control group)
- Evidence gathering becomes **checklists** with required evidence
- Management reviews become **AMU-style meetings** (use the same module, different template)
- Nonconformities become **deviations** (already supported)
- Risk register becomes a **document** type with structured content (extension)

When you onboard an ISO framework: ship template packs, don't write new modules.

## What an Arbeidstilsynet inspector will ask for

Build the system so the org can hand the inspector this list quickly:

1. HMS handbook (current version) — Document module export
2. Verneombud designation — Admin module role assignment with date
3. Verneombud training certificate — E-learning module
4. HMS training certificates for all leaders — E-learning module
5. AMU establishment and member list — Meeting module
6. AMU meeting protocols for the past year — Document module (protocols are documents)
7. Annual HMS report — Document module
8. Risk assessment(s) — Survey results + checklist completions
9. Action plan with status — Task module export
10. Deviation log with closures — Alert module
11. Varslingsrutiner (written) — Document module
12. SDS register — Register module export

Build an "Audit Package" export that bundles all of these into a single ZIP. This is a killer feature.
