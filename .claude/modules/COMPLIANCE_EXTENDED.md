# Compliance — extended

Load this when working on regulatory scope beyond what `COMPLIANCE.md` covers. The baseline file maps AML kap. 2A/3/4/6/7, Internkontrollforskriften §5, and chemicals. This file fills the gaps.

Not legal advice. Authoritative sources: [lovdata.no](https://lovdata.no/), [arbeidstilsynet.no](https://www.arbeidstilsynet.no/), [datatilsynet.no](https://www.datatilsynet.no/), [bufdir.no](https://www.bufdir.no/), [nav.no](https://www.nav.no/).

## 1. AML — chapters beyond the baseline

### Kap. 5 — Registrerings- og meldeplikt

| § | Requirement | Module / table | Status |
|---|---|---|---|
| 5-1 | Register all work-related injuries and illnesses | New `incident` module — `incidents` table (distinct from `deviations`) | not built |
| 5-2 | Immediate notice to Arbeidstilsynet + police on serious injury or death; written report follows | Workflow trigger on `incident.severity = 'serious'` | not built |
| 5-3 | Doctor-reported suspected occupational illness — employer follow-up | `incidents.physician_report_id` | not built |

`incidents` is **not** the same as `deviations`. Deviations are regulation/quality breaches (Internkontroll § 5 pt 5). Incidents are personal injury/illness with statutory reporting timelines, restricted to HR + verneombud, retention up to 60 years for CMR/asbestos exposure cases.

### Kap. 10 — Arbeidstid

| § | Requirement | Module / table |
|---|---|---|
| 10-3 | Written work schedule (arbeidsplan) ≥ 2 weeks ahead when hours vary | `schedules` table with signoff |
| 10-6 | Overtime ceilings; written averaging agreements | Approval workflow + signed document |
| 10-7 | Continuously updated record of actual hours per employee; accessible to Arbeidstilsynet + tillitsvalgte | New `time-records` module |

`time-records` is high-volume — one row per employee per day. Partition `time_records` monthly. RLS: `organization_id` scope + employee self-view + tillitsvalgte access. One-click nb-NO PDF + CSV export.

### Kap. 12 — Permisjoner

Notice periods 1 / 4 / 12 weeks depending on leave duration. If the platform is not the HRIS, expose `leave_acknowledgements` so external HR remains source of truth but statutory deadlines and compliance evidence are recorded here.

### Kap. 14 — Ansettelse

| § | Requirement | Module |
|---|---|---|
| 14-5, 14-6 | Written contract within 7 days; expanded mandatory content since 1 July 2024 | `document` templates + signed-delivery workflow |
| 14-9 | Midlertidig ansettelse — written grounds; convert to fast after 3/4 years | `employment_records` with type enum + tenure trigger |

### Kap. 14A / 14-12 — Innleie

- Verify provider is in [Arbeidstilsynet's bemanningsforetak register](https://www.arbeidstilsynet.no/en/pay-and-engagement-of-employees/engagement-of-employees/hiring-of-labour/).
- Equal-treatment documentation per hired worker.
- Innleide count toward verneombud + AMU thresholds — `admin` headcount calc includes them.
- New table `hired_workers(provider_id, period_start, period_end, equal_treatment_evidence_id)`.

### Kap. 15 — Opphør

| § | Requirement | Module |
|---|---|---|
| 15-1 | Drøftelsesmøte before any dismissal decision; written invitation citing § 15-1; protocol mandatory | `meeting` module with `droftelsesmote_15_1` template, RLS restricted to HR + designated leader (legally privileged) |
| 15-4 | Form/content of notice of dismissal | `document` template + signed-delivery record |

### Kap. 18 — Tilsyn

| § | Requirement | Module |
|---|---|---|
| 18-4, 18-5 | Arbeidstilsynet may demand any relevant document | Audit Package export (baseline) |
| 18-6 | Pålegg with deadline | New `regulatory_orders` table |
| 18-7 | Tvangsmulkt — coercive fine | Status on pålegg row |
| 18-8 | Stansing — shutdown order | Status on pålegg row + visible banner |

`regulatory_orders(palegg_id, issued_by, deadline, status, evidence_doc_id)`. RLS: org admin + AMU leder. Stansing status surfaces a banner across the app.

## 2. Internkontrollforskriften beyond §5

### § 6 Samordning

When ≥ 2 employers operate on one site, a written coordination agreement is required; if combined workforce > 10 a hovedbedrift is designated. See [Arbeidstilsynet § 6](https://www.arbeidstilsynet.no/regelverk/forskrifter/internkontrollforskriften/6/).

This is the **only** cross-tenant relationship in the system. Model as `coordinated_sites(site_id, hovedbedrift_org_id)` + `site_participants(site_id, organization_id, role)`. Only the agreement document and a minimal site roster cross tenant boundaries. All underlying HMS data stays isolated.

### § 7 Tilsyn

Covered by the Audit Package export.

## 3. Arbeidsmiljøforskriftene — the full bundle

| Forskrift | Coverage strategy |
|---|---|
| Forskrift om utførelse av arbeid (FOR-2011-12-06-1357) — manual handling, heights, hot work, asbestos, biology | Checklist + e-learning template families per topic |
| Forskrift om organisering, ledelse og medvirkning (FOR-2011-12-06-1355) | § 3-19 verneombud training in baseline; rest is RBAC + workflow |
| Forskrift om tiltaks- og grenseverdier (FOR-2011-12-06-1358) — limit/action values for chemicals, noise, vibration | New `measurements` child of `chemicals`: `(substance_id, measured_value, unit, grenseverdi_ref, date, location)`. `over_limit` boolean auto-creates a deviation |
| Byggherreforskriften (FOR-2009-08-03-1028) | Optional `construction` module — see §9 below |

## 4. GDPR / Personopplysningsloven

Norway implements GDPR via [Personopplysningsloven](https://lovdata.no/dokument/NL/lov/2018-06-15-38). [Datatilsynet](https://www.datatilsynet.no/) enforces.

| Obligation | Implementation |
|---|---|
| **Lagringsbegrensning** — retention limits per category | `data_categories(retention_class, retention_days, legal_basis)`; nightly `purge_expired()` via pg_cron |
| **Rett til sletting** — subject access requests resolved within 30 days | `subject_rights_requests` workflow; cascading soft-delete; exemptions per legal basis |
| **Varslingssaker retention** — identifying data purged when no longer necessary | `whistleblowing_closed` retention class, default 5 years from conclusion |
| **Databehandleravtale (DPA)** per GDPR art. 28 | Auto-generated, version-controlled DPA at tenant signup; sub-processor list with change notifications |
| **E-postinnsyn** (FOR-2018-07-02-1108) | If platform offers employer-mailbox-access tooling: written notice template, justification log, employee-present opportunity |
| **Personalmappe retention** — until employment ends + buffer | `personnel_post_exit` retention class (5 years post-exit) |
| **Cross-border transfer** | Supabase region pinned to `eu-central-1` or `eu-west-1`. No US transfers |
| **Breach notification** — 72 hours to Datatilsynet from awareness | Runbook in `docs/runbooks/breach.md` |

Schema implication: every personal-data table needs a `retention_class` column; pg_cron drains nightly; soft-delete first (90-day grace) then hard-delete; the purge itself is audited.

See SECURITY.md §9 for the operational side.

## 5. Likestillings- og diskrimineringsloven — ARP

[Likestillingsloven § 26](https://lovdata.no/dokument/NL/lov/2017-06-16-51/%C2%A726) and [Bufdir's guide](https://www.bufdir.no/fagstotte/produkter/aktivitets__og_redegjorelsesplikt_for_arbeidsgivere/):

- All employers: activity duty (kartlegge, analysere, tiltak, evaluere).
- Public + private **> 50 employees**: full four-step + annual report in årsberetning.
- Private **20–50**: same if one party requests.
- Wage mapping + involuntary part-time mapping every **other** year.

New **`equality`** module. Template-driven four-step. CSV pay-mapping import. Annual report generator. Schema:

```sql
equality_assessments(year_pair, step, finding, action_task_id)
wage_mappings(year, job_category, median_male, median_female, gap_pct, headcount)
```

Annual report aggregates only — never raw rows.

## 6. Bedriftshelsetjeneste (BHT)

[Forskrift FOR-2009-09-10-1173](https://lovdata.no/dokument/SF/forskrift/2009-09-10-1173). Mandatory industries: construction, healthcare, education, food production, transport, hairdressing, restaurants, automotive repair, cleaning. See [Arbeidstilsynet — BHT](https://www.arbeidstilsynet.no/hms/roller-i-hms-arbeidet/bht/).

- `organizations.bht_provider_id` references `bht_providers`.
- `bht_providers(name, godkjenning_expires_at, approval_status)` — Arbeidstilsynet approvals are 5-year and lapse audibly.
- Warning surfaces when an org's BHT provider's approval expires within 90 days.
- AMU module gets a `bht_rep` attendee role — BHT has statutory right to attend per AML § 7-2(4).

## 7. Sykefraværsoppfølging

Folketrygdloven § 8-7a + AML § 4-6. See [NAV — oppfølging](https://www.nav.no/arbeidsgiver/oppfolging-sykmeldte) and [Helsedirektoratet's sykmelderveileder](https://www.helsedirektoratet.no/veiledere/sykmelderveileder).

Statutory milestones:
- **4 weeks**: oppfølgingsplan written, shared with sykmelder.
- **7 weeks**: dialogmøte 1 (employer + employee, sykmelder invited).
- **26 weeks**: dialogmøte 2 organized by NAV.

New **`sickleave`** module:

```sql
sick_leave_cases(
  id, organization_id, user_id, started_at, status, oppfolgingsplan_id, retention_class,
  computed week_4_due, week_7_due, week_26_due
)
sick_leave_events(case_id, event_type, due_at, completed_at, evidence_doc_id)
```

Workflow triggers create tasks 7 and 25 days before each deadline. Oppfølgingsplan is a structured document (NAV-mandated fields), not free text. NAV digital submission via Altinn — exposed as an integration in the `monitor` module backlog.

[IA-avtalen 2025–2028](https://www.regjeringen.no/no/tema/arbeidsliv/arbeidsmiljo-og-sikkerhet/inkluderende_arbeidsliv/innsikt/ia-avtalen-2025-2028/id3151146/) adds branch programs (home services, retail, child welfare, schools+leisure). Tenants tag a `bransje`; branch-specific templates load.

## 8. Construction — Byggherreforskriften (optional module)

[FOR-2009-08-03-1028](https://lovdata.no/dokument/SF/forskrift/2009-08-03-1028). Required artifacts:

- **SHA-plan** before site start, on site, updated, retained 6 months post-completion.
- **HMS-kort** worn visibly by every worker on site.
- **Oversiktsliste** of everyone on site at any time (§ 15) — daily register.
- **Forhåndsmelding** to Arbeidstilsynet for sites > 30 days or > 500 person-days.

Optional **`construction`** module gated by `organization_modules.enabled` and a tenant-level `is_byggherre` flag:

```sql
projects(id, organization_id, name, start_date, end_date, is_forhandsmeldt)
sha_plans(project_id, document_id, retained_until)
site_register(project_id, user_id_or_external_name, hms_kort_no, checked_in_at, checked_out_at)
```

## 9. Arbeidstilsynet inspection — extended request list

Beyond baseline items 1–12 (HMS handbook, verneombud, training certs, AMU member list, protocols, annual report, risk assessments, action plan, deviation log, varslingsrutiner, SDS register), an inspector commonly also asks for:

13. **Arbeidstidsoversikt (§ 10-7)** for last 12 months.
14. **Personalliste** with employment-type breakdown.
15. **Innleie-register** and equal-treatment evidence.
16. **Sykefraværsoppfølgingsplaner** for active cases.
17. **ARP-redegjørelse** (last year) for ≥ 50 employees.
18. **BHT-avtale** + last BHT activity report.
19. **Drøftelsesmøteprotokoller** for any dismissals in last 12 months.
20. **Eksponeringsregister** (CMR, asbest, bly, støv) — retained ≥ 60 years for some categories.
21. **Samordningsavtale** (Internkontroll § 6) if multi-employer site.

The **Audit Package** export grows to include items 13–21 conditionally on active modules. Filenames in Norwegian. Include a `manifest.json` listing every artifact + version + legal basis.

## 10. Sources

- AML: [lovdata kap. 5](https://lovdata.no/lov/2005-06-17-62/%C2%A75-1) · [kap. 10](https://lovdata.no/nav/lov/2005-06-17-62/kap10) · [kap. 12](https://lovdata.no/nav/lov/2005-06-17-62/kap12) · [kap. 14](https://lovdata.no/nav/lov/2005-06-17-62/kap14) · [§ 15-1](https://arbeidsmiljoloven.com/paragraf/drofting-for-beslutning-om-oppsigelse/) · [kap. 18](https://lovdata.no/lov/2005-06-17-62/%C2%A718-3)
- Internkontrollforskriften: [§ 6](https://www.arbeidstilsynet.no/regelverk/forskrifter/internkontrollforskriften/6/)
- Grenseverdier: [FOR-2011-12-06-1358](https://lovdata.no/dokument/SF/forskrift/2011-12-06-1358)
- Byggherreforskriften: [Arbeidstilsynet](https://www.arbeidstilsynet.no/regelverk/forskrifter/byggherreforskriften/)
- E-postinnsyn: [FOR-2018-07-02-1108](https://lovdata.no/dokument/SF/forskrift/2018-07-02-1108)
- Datatilsynet: [lagringsbegrensning](https://www.datatilsynet.no/rettigheter-og-plikter/personvernprinsippene/grunnleggende-personvernprinsipper/lagringsbegrensning/) · [databehandleravtale](https://www.datatilsynet.no/rettigheter-og-plikter/virksomhetenes-plikter/hvordan-lage-en-databehandleravtale/) · [sletting](https://www.datatilsynet.no/rettigheter-og-plikter/den-registrertes-rettigheter/rett-til-sletting/) · [personalmappe](https://www.datatilsynet.no/personvern-pa-ulike-omrader/personvern-pa-arbeidsplassen/personalmappe/)
- ARP: [Bufdir guide](https://www.bufdir.no/fagstotte/produkter/aktivitets__og_redegjorelsesplikt_for_arbeidsgivere/)
- BHT: [Arbeidstilsynet](https://www.arbeidstilsynet.no/hms/roller-i-hms-arbeidet/bht/)
- Sykefravær: [NAV](https://www.nav.no/arbeidsgiver/oppfolging-sykmeldte) · [Helsedirektoratet](https://www.helsedirektoratet.no/veiledere/sykmelderveileder)
- IA-avtalen 2025–2028: [regjeringen.no](https://www.regjeringen.no/no/tema/arbeidsliv/arbeidsmiljo-og-sikkerhet/inkluderende_arbeidsliv/innsikt/ia-avtalen-2025-2028/id3151146/)
- Innleie: [Arbeidstilsynet](https://www.arbeidstilsynet.no/en/pay-and-engagement-of-employees/engagement-of-employees/hiring-of-labour/)
- Arbeidstid registrering: [Arbeidstilsynet](https://www.arbeidstilsynet.no/arbeidsforhold/arbeidstid/registrering-av-arbeidstid/)
- Krav til arbeidsavtaler 2024: [NHO Arbinn](https://arbinn.nho.no/arbeidsrett/ansettelser/krav-til-innhold-i-arbeidsavtaler/)
