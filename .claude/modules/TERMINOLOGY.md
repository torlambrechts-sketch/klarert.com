# Terminology — Norwegian ⇄ English cheat sheet

Load this when writing user-facing strings, table names, or thinking about whether a concept exists in nb-NO.

Code identifiers and comments are English. Table and column comments, user-facing strings, and templates are nb-NO when the audience is Norwegian. Domain vocabulary uses the canonical Norwegian terms — do not invent English aliases.

When a concept has a precise Norwegian term, use it. Don't translate to a generic English word that loses the legal weight.

## Working environment / HMS

| nb-NO | English | Notes |
|---|---|---|
| arbeidsmiljø | working environment | The thing AML governs |
| HMS | HSE | Helse, miljø, sikkerhet |
| internkontroll | internal control | The system, not one document |
| HMS-arbeid | HSE work | Process noun |
| HMS-håndbok | HSE handbook | Mandatory document (Internkontroll § 5) |
| systematisk HMS-arbeid | systematic HSE work | AML § 3-1 |
| forsvarlig | proper / safe | Legal threshold used in AML |
| fullt forsvarlig | fully proper | AML § 4-1 |
| handlingsplan | action plan | Internkontroll § 5 pt 4 → `tasks` |
| risikovurdering | risk assessment | Output is data, not PDF |
| ROS | ROS / risk and vulnerability analysis | Risiko og sårbarhet — common term |
| sannsynlighet | likelihood | 1–5 scale |
| konsekvens | consequence | 1–5 scale |
| tiltak | mitigation / measure | Produced from risk assessments |
| medvirkning | employee participation | Provable, timestamped, non-editable |

## Roles and bodies

| nb-NO | English | Notes |
|---|---|---|
| verneombud (VO) | safety representative | Elected. ≥ 1 if ≥ 5 employees |
| hovedverneombud | chief safety representative | When multiple verneombud |
| vernetjeneste | safety service (structure) | Umbrella for verneombud + AMU |
| arbeidsmiljøutvalg (AMU) | working environment committee | ≥ 50 employees (or ≥ 20 on request) |
| bedriftshelsetjeneste (BHT) | occupational health service | Arbeidstilsynet-approved provider |
| tillitsvalgt | union representative | Access rights to time records etc. |
| varslingsmottak | whistleblowing intake | Designated handler role |
| verneombudsvalg | safety-rep election | Process — `meeting` module |
| arbeidsgiver | employer | Legal party |
| arbeidstaker | employee | Legal party |
| arbeidsgiverside / ansattside | employer side / employee side | AMU representation |

## Deviations and whistleblowing

| nb-NO | English | Notes |
|---|---|---|
| avvik | deviation / nonconformity | Regulation/quality breach. **Distinct from `incident`.** |
| nestenulykke | near miss | Light avvik form |
| stans av arbeid | work stoppage | AML § 6-3, verneombud-only |
| eskalering | escalation | Avvik → AMU agenda backlog |
| varsling | whistleblowing | AML kap. 2A. Structurally anonymous. |
| varsler | whistleblower / reporter | Identity legally protected |
| kritikkverdige forhold | reportable wrongdoing | Legal threshold for varsling |
| gjengjeldelse | retaliation | Forbidden under § 2A-4 |
| anonymitet | anonymity | Must be structural, not configured |
| sporingskode | tracking code | Reporter's only handle for follow-up |
| varslingsrutiner | whistleblowing routines | Mandatory written doc for ≥ 5 employees |
| forsvarlig saksbehandling | proper case handling | AML § 2A-2 |

## Checklists, surveys, training

| nb-NO | English | Notes |
|---|---|---|
| sjekkliste | checklist | `checklist` module |
| vernerunde | safety walkthrough | Periodic physical-workplace checklist |
| undersøkelse | survey | Generic |
| kartlegging | mapping / assessment | Survey used to map a state |
| psykososial kartlegging | psychosocial assessment | AML § 4-3, structurally anonymous |
| arbeidsmiljøkartlegging | working-environment mapping | Broader survey |
| pulsmåling | pulse survey | Recurring lightweight survey |
| MAP | MAP (psychosocial method) | Specific Norwegian assessment |
| opplæringssenter | training center | E-learning UI label |
| HMS-opplæring | HSE training | AML § 3-2 |
| ledelsesopplæring i HMS | leadership HSE training | AML § 3-5 |
| verneombudsopplæring | safety-rep training | FOR-2011-12-06-1355 § 3-19 |
| kurs | course | LMS object |
| modul | module | Course subdivision (don't confuse with platform "modules") |
| sertifikat | certificate | Issued on course completion |
| obligatorisk opplæring | mandatory training | Enforced by cron |

## Documents and meetings

| nb-NO | English | Notes |
|---|---|---|
| dokumentsenter | document center | UI label for `document` module |
| versjon | version | `document_versions` |
| godkjenning | approval | Pre-publish review |
| bekreftelse | acknowledgement | "Read and understood" |
| møte | meeting | Generic |
| AMU-møte | AMU meeting | Statutory committee meeting |
| protokoll | protocol | Meeting minutes |
| agenda / saksliste | agenda | Meeting agenda items |
| vedtak | decision / resolution | Binding meeting decision |
| signoff (sign-off) | signoff | Anglicism — use `attestere` in nb-NO |
| attestere | to attest / sign off | nb-NO verb |
| årsrapport HMS | annual HSE report | AMU produces |
| drøftelsesmøte | discussion meeting | AML § 15-1, pre-dismissal |

## Chemicals and exposure

| nb-NO | English | Notes |
|---|---|---|
| stoffkartotek | chemical / SDS register | Per workplace |
| sikkerhetsdatablad (SDS) | safety data sheet | Per chemical, per language |
| eksponeringsregister | exposure register | CMR/asbest/bly/biologi; 60-yr retention |
| grenseverdi | limit value | Numeric threshold |
| tiltaksverdi | action value | Numeric threshold below limit |
| faresymbol | hazard pictogram | CLP/GHS standardized |
| H-setninger | hazard statements | H-codes from CLP |
| P-setninger | precautionary statements | P-codes from CLP |
| signalord | signal word | Fare / Advarsel |
| substitusjonsplikt | substitution duty | Replace hazardous with less hazardous |

## Sick leave and inclusion

| nb-NO | English | Notes |
|---|---|---|
| sykefravær | sickness absence | The metric |
| sykmelding | medical certificate | From sykmelder |
| sykmelder | certifying physician | Issues sykmelding |
| sykefraværsoppfølging | sick-leave follow-up | Statutory process |
| oppfølgingsplan | follow-up plan | Structured doc shared with sykmelder, 4-week deadline |
| dialogmøte | dialogue meeting | Statutory series (7-week, 26-week) |
| IA-avtalen | Inclusive Working Life Agreement | 2025–2028 program |
| AKAN | addiction-at-work council | Policy template area |

## Employment

| nb-NO | English | Notes |
|---|---|---|
| arbeidsavtale | employment contract | Expanded fields since 1 Jul 2024 |
| fast ansatt | permanent employee | Default contract type |
| midlertidig ansatt | temporary employee | AML § 14-9, time-limited |
| innleie | hire-in | AML § 14-12 |
| bemanningsforetak | staffing agency | Must be Arbeidstilsynet-registered |
| innleid | hired-in worker | Counts toward verneombud/AMU thresholds |
| personalmappe | personnel file | Per-employee |
| oppsigelse | notice of termination | Form per § 15-4 |
| avskjed | summary dismissal | More severe than oppsigelse |
| permisjon | leave (e.g. parental) | Kap. 12 |
| arbeidstid | working time | § 10-7 record obligation |
| arbeidsplan | work schedule | ≥ 2 weeks ahead |

## Equality and discrimination

| nb-NO | English | Notes |
|---|---|---|
| likestilling | equality | Generic term |
| diskriminering | discrimination | Generic term |
| ARP | Activity & Reporting Duty | Likestillingsloven § 26 |
| aktivitetsplikt | activity duty | Step 1 of ARP |
| redegjørelsesplikt | reporting duty | Step 2 of ARP — annual statement |
| likestillingsredegjørelse | equality statement | Annual, in årsberetning |
| lønnskartlegging | wage mapping | Every other year for > 50 emp |
| ufrivillig deltid | involuntary part-time | Mapped together with wages |
| trakassering | harassment | Forbidden under AML § 4-3 + Likestillingsloven |

## Authorities

| nb-NO | English | Notes |
|---|---|---|
| Arbeidstilsynet | Labour Inspection Authority | Primary supervisor |
| Datatilsynet | Data Protection Authority | GDPR supervisor |
| NAV | NAV (welfare/labour agency) | Dialogmøte 2 organizer |
| Skatteetaten | Tax Administration | Personalliste cross-checks |
| Helsedirektoratet | Directorate of Health | Sykmelderveileder |
| Bufdir | Directorate for Children, Youth and Families | ARP guidance |

## Inspection and enforcement

| nb-NO | English | Notes |
|---|---|---|
| tilsyn | inspection / supervision | What Arbeidstilsynet does |
| pålegg | regulatory order | § 18-6 |
| tvangsmulkt | coercive fine | Per-day non-compliance penalty |
| stansing | shutdown order | § 18-8 |
| samordning | HMS coordination | Internkontroll § 6 |
| hovedbedrift | host enterprise | Coordinates a shared site |

## Data protection

| nb-NO | English | Notes |
|---|---|---|
| personopplysning | personal data | GDPR-defined |
| behandlingsansvarlig | data controller | The tenant |
| databehandler | data processor | The SaaS |
| databehandleravtale | data processing agreement | GDPR art. 28 |
| samtykke | consent | One legal basis among several |
| lagringsbegrensning | storage limitation | Retention principle |
| innsynsrett | right of access | Subject right |
| sletting | erasure | Subject right |
| portabilitet | portability | Subject right |

## Construction

| nb-NO | English | Notes |
|---|---|---|
| byggherre | building owner / project client | Legal site role |
| byggherreforskriften | "Building Owner Regulation" | FOR-2009-08-03-1028 |
| SHA-plan | safety/health/env plan | Site plan, retained 6 mo post-completion |
| HMS-kort | HSE / ID card | Construction & cleaning sectors |
| forhåndsmelding | advance notification | Sent to Arbeidstilsynet for large sites |
| oversiktsliste | site presence register | Daily who-was-on-site list |

## Common phrases (use verbatim in UI)

| nb-NO | When to use |
|---|---|
| Lagret | After save (no "Saved!" with exclamation) |
| Sendt | After submission |
| Lukket | After closing an alert/case |
| Konkludert | After concluding a varsling case |
| Trukket tilbake | After withdrawing |
| Du har ikke tilgang til dette | Forbidden error state |
| Fant ikke | Not-found error state |
| Noe gikk galt | Generic error; include request ID |
| Last opp en fil | Upload prompt |
| Bekreft sletting | Delete confirmation |
| Avbryt | Cancel button |
| Fortsett | Continue button |

## What not to do

- Don't translate "deviation" as `awvik` or any other invented form. It is `avvik`.
- Don't use English `whistleblowing` in nb-NO surfaces. It is `varsling`.
- Don't write "AMU committee" or "AMU panel" — it is just `AMU` or `arbeidsmiljøutvalget`.
- Don't translate `verneombud` to "safety officer" or "safety representative" in nb-NO copy. The Norwegian term is the legal term.
- Don't shorten `verneombud` to `VO` in user-facing text on first mention; spell out and put `(VO)` after.
- Don't write `helse-miljø-sikkerhet` — it's `helse, miljø og sikkerhet` (HMS).
- Don't use bokmål in code identifiers. Use English. nb-NO is for users.
- Don't conflate `avvik` and `hendelse` (incident). Avvik = regulation breach; incident = personal injury/illness with statutory reporting.
- Don't conflate `møte` and `samling` in HMS contexts. AMU has `møter`.
