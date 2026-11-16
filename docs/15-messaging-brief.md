# 15 · Messaging brief

The positioning and messaging brief for the public site, sales and onboarding copy. It is written for **Keptrow**,
the planned name of the product called "Compliance OS" today; the rename waits on a trademark search. Until it is
cleared, swap the name back wherever copy ships. The company stays Klarert.

Written by the nine-person advisory board (docs/10) on 16 Nov 2026, from the docs, the build plan (docs/06) and the
code on main. It describes only what is built; anything else is marked **coming**. The site copy lives in
`src/components/landing/content.ts` and its numbers in `src/lib/site/catalogue.ts`; this brief is the source for
rewriting both.

## 1. One-line promise

|     | Headline                                                     | Subhead                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Record it once. Prove it for every standard.                 | Keptrow is a shared spreadsheet for your management system. A risk, an incident or a document is recorded once and counts for ISO 27001, ISO 9001, ISO 14001, ISO 45001, GDPR and NIS2. Every change lands in an activity log your auditor can check. |
| B   | The freedom of a spreadsheet. The proof an auditor asks for. | Your registers, actions and evidence in sheets your team already knows how to use, with automations that keep work moving and a record of every change that cannot be quietly rewritten.                                                              |
| C   | Compliance work, without the folder of files.                | Ready-made registers for six standards, shaped to how you work, hosted in the EU.                                                                                                                                                                     |

**The board's pick: A**, with B's idea carried into the second section of the home page.

- One promise with an outcome (less duplicate work, a stronger audit), not a feature.
- No competitor in section 7 makes this claim in this form: shared registers under every standard, plus a log anyone
  can verify. "Prove it" sets up the proof the page then shows: the log, the SoA and the audit pack.
- Dissent: the founder and the adoption specialist note that most small buyers start with one standard, so "every
  standard" can read as "not for me yet". The subhead must start with the spreadsheet, and the page must show a
  one-standard start in the first scroll. The language expert prefers B for readers who have never been audited.

## 2. Core message

Most management systems live in spreadsheets, inboxes and shared drives. The same risk is typed into three files, one
per standard, and the copies drift apart. Evidence sits in email. Before every audit, someone spends a week working out
who changed what, and when.

Keptrow keeps your registers in one shared spreadsheet that the whole team works in. Each standard adds its columns,
requirement library, forms and automations to the same registers, so a risk or an incident is recorded once and counts
everywhere it applies. Automations chase dates and owners. Every change is written to an activity log that is
hash-chained per item, so a changed entry shows.

What changes: less re-typing, no hunt before the audit, and proof you can hand over on the day.

## 3. What makes us unique

Competitors have some of these. None we know of has all of them together, and the combination is the point: the
freedom of a spreadsheet with the proof of a system of record.

| #   | Differentiator                                           | What it means in Keptrow                                                                                                                                                                                                                                                                                                                                | Why the buyer cares                                                                                             | Proof in the product                                                         | Sales line                                                                   |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | One shared set of registers for every standard           | The shared registers (Core pack 1.3.0: documents, risks, incidents, nonconformities and CAPA, actions, suppliers and more) sit under every standard. A standard installs as an add-on that adds its columns, views and Standards tag to them. Cross-walks link requirements that ask for the same thing                                                 | No duplicate risk registers. One incident can count for ISO 27001, GDPR and NIS2 at once                        | The "Used by …" chip on a shared register; "Also satisfies" on a requirement | "Record a risk once. It counts for every standard that uses it."             |
| 2   | A real spreadsheet                                       | 58 field types, from text and dates to risk matrices, statutory clocks, evidence with expiry and formulas. Table, Board, Calendar, Forms and Insights on every sheet; one level of sub-items; paste from Excel                                                                                                                                          | People work in it without training, and the structure fits the work rather than the other way round             | The field picker's four families; the Table's keyboard editing               | "If your team can use a spreadsheet, they can use Keptrow."                  |
| 3   | Standards install as data you own                        | A standard is a pack: ordinary sheets, fields, forms, automations and dashboards you can change. Updates use a three-way comparison: your changes are kept, and a conflict asks you ("Keep mine" is the default). Archiving a standard never deletes items or the log                                                                                   | No lock-in to a vendor's template. You can tailor it and still take our updates                                 | "Update available" and Keep mine on Workspace admin › Packs                  | "Change anything. Keep your changes when we update."                         |
| 4   | Automations you can watch                                | When a field changes, a date arrives, a form is sent, an approval is decided or a button is pressed; if conditions match; then set a value, notify, request an update, create an item, start an approval or send a webhook. Each run is in the run log. Chains stop at three levels. New pack automations that notify start in test mode                | Work moves without chasing, and you can see why something happened                                              | 18 triggers, 16 actions; a test run reads "Would notify Maria"               | "Reminders and follow-ups run themselves, and every run is written down."    |
| 5   | An activity log anyone can verify                        | Every change is written in the same database transaction, append-only and hash-chained per item. Verify recomputes the chain. The audit pack carries the log with every hashed input and the method, so an auditor can recompute each hash without our software                                                                                         | An auditor can trust the record without trusting us                                                             | "Verify audit trail" in the item panel; `method.txt` in the audit pack       | "Your audit trail does not ask to be believed. It can be checked."           |
| 6   | Built for the audit itself                               | A read-only auditor role with an end date, after which access ends by itself. A statement of applicability built from the requirement library. An audit pack (zip): SoA, registers, evidence index with SHA-256, the log with chains checked. Management review inputs compiled from your data. Every export is logged                                  | Audit preparation becomes handing over links and files                                                          | The auditor's Start here panel; the Exports list                             | "Give your auditor read-only access that ends by itself."                    |
| 7   | Privacy built in                                         | Mark fields as personal data; values are masked in the log and can be erased without breaking the chain. Retention rules per sheet with a review queue, postpone with a reason, and legal hold. Notes on value changes and approval comments are masked too. Restricted fields show "Restricted" everywhere. Sheets of personal data install restricted | GDPR duties are met inside the tool that holds the data                                                         | The retention review queue; "Restricted" in place of a value                 | "Erase personal data without breaking your audit trail."                     |
| 8   | EU-hosted and locked down                                | Database and app in Frankfurt. Two-step sign-in with an authenticator app, which an owner can require for the whole workspace. Row level security on every table. No analytics or trackers; fonts served from our own domain                                                                                                                            | Answers the first security questions a compliance buyer asks of any vendor                                      | Workspace admin › Security › Require two-step sign-in                        | "Hosted in Frankfurt. Two-step sign-in. No trackers."                        |
| 9   | Apps, approvals and a data-flow map over the same sheets | Apps give one job a few screens (the CAPA app: Report a problem, My actions, Needs my check). Approval workflows with ordered steps, time limits and a block on approving your own item. Build › Design maps what feeds each sheet, what acts on it and what leaves the workspace                                                                       | Front-line staff get simple screens; admins see the whole system; privacy teams get a data-flow record to print | The CAPA app on a phone; Build › Design's map                                | "Simple screens for the people doing the work, and a map of it all for you." |
| 10  | Licence-safe requirement libraries                       | Libraries hold reference numbers and official short titles only; purpose, guidance, audit questions and typical evidence are our own words. Each library shows its edition status (current, withdrawn, revision in progress)                                                                                                                            | Safe to use and to share with clients; never a copy of a paid standard                                          | The licence note on every library; edition badges                            | "Guidance in plain words, and we tell you when an edition changes."          |

The no-code point (the brief's last candidate) is not a separate differentiator: it is the proof behind 2, 3 and 9.

## 4. Flexibility: the middle path

**Structure where it counts, freedom everywhere else.** Rigid tools give you their idea of your management system. A
blank spreadsheet gives you no idea at all. Keptrow ships a structure that holds up in an audit and lets you change
the rest.

**What a customer can change without us** (editors, unless marked admin):

- Sheets: create from a start, from a CSV, or by copying one; name, item label, ID prefix, folder, groups and colours.
- Fields: add any of the 58 types; rename, reorder, hide, set required, defaults, validation, help text, "ask when
  adding", visibility rules and status rules ("when Status becomes Closed, require Root cause").
- Views: saved Table views, Board, Calendar, Insights layouts, filters and sorts, personal or shared; the tabs a sheet
  shows (admin).
- Forms: internal or public, with their own questions, opening dates and limits.
- Automations: build from scratch or from a recipe, switch them on or off; move pack automations from test to live (admin).
- Approval workflows: steps, approvers, time limits, what a rejection does (admin).
- Dashboards: widgets and layout.
- Access: restrict folders, sheets and fields to chosen people (admin).
- Standards: install at the level you need, add the next level later, take updates or keep your version, archive (admin).

**What stays fixed, on purpose:** the activity log (append-only); a field's key once created; a requirement's reference
in a library; the system columns of the shared registers (hide or rename them, never delete or retype them, so every
standard keeps working); the loop guard; the self-approval block unless a workflow allows it.

|                       | Rigid GRC tool                     | Keptrow                              | Blank spreadsheet            |
| --------------------- | ---------------------------------- | ------------------------------------ | ---------------------------- |
| Structure             | The vendor's, changed by a project | Ready-made, changed by you           | None until you build it      |
| Audit trail           | Usually yes                        | Hash-chained per item, verifiable    | Version history at best      |
| Standards content     | Yes, often locked                  | Yes, as data you can edit and update | No                           |
| First useful register | After a set-up project             | One step, from a ready-made set      | Quick, then the copies drift |
| Who changes it        | The admin or a consultant          | Editors and admins                   | Anyone, without a record     |

## 5. Customer value by persona

| Persona                                   | Pains                                                                                     | What they get                                                                                                                                                         | Outcome                                                                       | Proof point                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Compliance or ISO lead                    | One file per standard; chasing owners; rebuilding the audit file every year               | Shared registers, automations for reviews and overdue work, My work, the audit pack                                                                                   | Runs several standards from one place and spends audit week on the audit      | Next step card per standard on Home; 8-step setup checklists               |
| CISO                                      | Needs control over risk and evidence without another rigid tool; must pass vendor reviews | ISO 27001:2022 with 93 Annex A controls, risk treatment, NIS2 measures, restricted fields, two-step sign-in, EU hosting                                               | A security programme that also stands up to its own scrutiny                  | Cross-walks Annex A ↔ NIS2 Art. 21(2); RLS on every table                  |
| Quality, HSE or environment manager       | Nonconformities, complaints, hazards and aspects in separate trackers; CAPA that stalls   | ISO 9001:2026, 14001:2026 and 45001:2018 add-ons on the same registers; CAPA app; approvals; complaint and incident cascades                                          | Problems are reported, acted on and closed with proof of effectiveness        | CAPA closure workflow; "Report a problem" on a phone                       |
| DPO                                       | Records of processing in one place, breaches in another; erasure breaks the audit trail   | GDPR add-on: records of processing, data subject requests with deadlines, breaches with the 72-hour clock, DPIAs; retention and erasure; Design's "Leaves the system" | Can show where personal data goes and prove deadlines were met                | Statutory clock field; erasure keeps the chain intact                      |
| SME CEO or CFO                            | Pays for audits and consultants; fears a failed certification and a costly tool           | One tool for several standards, ready-made sets, read-only auditor access                                                                                             | Fewer tools and less consultant time per audit (no figures promised)          | A standard installs at the Recommended level in one step                   |
| External ISO consultant with many clients | Rebuilds the same templates per client; clients' files drift                              | The same packs in every client workspace, tailored per client, updated without losing changes; switch between workspaces                                              | Repeatable delivery and clients who keep their system alive after the project | Three-way updates; workspace switcher. Multi-client overview is **coming** |
| Auditor                                   | Screenshots, emailed spreadsheets, no way to check history                                | Read-only role with an end date, Start here panel, SoA, evidence library, verifiable log, audit pack                                                                  | Samples and checks the record directly                                        | Access ends by itself; exports logged; hashes recomputable                 |

**How to lead with each:** the ISO lead with "record once" and a register they recognise on the first screen; the
CISO with EU hosting, two-step sign-in and the verifiable log, honest that SSO and an API are coming; the quality
manager with the CAPA app and a closure that waits for the effectiveness check; the DPO with the 72-hour clock and
erasure that keeps the chain; the CEO or CFO with one tool across standards, never with savings figures; the
consultant with tailoring that survives updates; the auditor, a strong voice though not a buyer, with Verify and the
audit pack's method file.

## 6. Features and functionality (built)

### Sheets and the 58 field types

- **Sheets with groups, items and IDs** (CA-014): every register has its own place and every item a stable reference.
- **Basic input (18):** text, long text, comment, number, value (money), percentage, yes/no, checkbox, date, date and
  time, duration, timeline, recurrence, rating, email, phone, URL, location: capture anything a register needs.
- **Choice and people (10):** status, dropdown, multi-select, people, role, team, entity and site, country,
  classification, severity: options and people stored by id, so renaming never rewrites a value.
- **Compliance (19):** requirement, control link, evidence, attachment, signature, acknowledgement, justification,
  applicability, finding, checklist, question, risk matrix, maturity, measurement, statutory clock, protected text,
  personal data marker, retention, version: the fields compliance work needs, built in.
- **Linked and computed (11):** link to items, lookup, rollup, formula, progress, auto ID, created and updated,
  workflow step, button, AI proposal (stores a proposed value for a person to accept; nothing generates it yet),
  sub-items: registers that connect and calculate.
- **Field rules:** required, validation, defaults, status rules, visibility rules, locked fields: the structure
  enforces itself.
- **Sheet wizard and Create:** start blank, from a register, tracker, log, inspection or a compliance start, from a
  CSV, or from a goal ("What do you need to handle?"): a useful first sheet without building from scratch.

### Views

- **Table:** spreadsheet editing with the keyboard, copy and paste with Excel, column groups, saved views.
- **Board, Calendar, Forms, Insights:** drag work between stages, see dates, collect input, chart a sheet.
- **Filters, sort, search and saved views,** personal or shared. **Phones:** cards at 390 px.

### Items and sub-items

- **Item panel:** details, linked items both ways, updates with @mentions, the activity log: the whole story of one
  item in one place.
- **Sub-items** (one level, own fields and IDs such as CA-014.2) with roll-ups: break a CAPA into steps.
- **New item dialog** asking only the key fields; **bulk edit, archive and restore**; **realtime** updates.

### Forms

- **Internal and public forms** with opening dates, answer limits, a QR code, spam checks and a rate limit: let anyone
  report a problem without an account.
- **Stepped intake forms** ("Step 2 of 3"): guide people through a report.

### Automations

- **18 triggers:** item created, form sent, field changed or becomes a value, number above or below, date arrives,
  statutory clock warning, evidence expiring, button, checklist "No", sub-item events, approval decided, approved,
  rejected or overdue.
- **Conditions:** the same operators as filters.
- **16 actions:** set a field, notify, request an update, create an item, update linked items, move, assign, lock, post
  an update, webhook (Slack, Teams or generic), raise a version, create or update sub-items, set the parent's field,
  keep supplier checks in step, start an approval.
- **Schedules** (once per item per occurrence), **buttons**, **recipes**, **test mode**, **pause per item**,
  **loop guard** (three levels), the **run log** with every step's outcome, and the **in-app inbox**.

### Approvals and workflow

- **Approval workflows:** ordered steps, approvers by person, field, job role or team, any one or all, time limits,
  what a rejection does, lock on approval, no approving your own item: sign-off an auditor accepts.
- **Needs my approval** in My work; the **Workflow** page shows each sheet's lifecycle.

### Packs and the catalogue

| Set                         | Version | Edition it builds on                                                                                     |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Shared registers (Core)     | 1.3.0   | the base for all                                                                                         |
| ISO/IEC 27001 ISMS          | 2.3.0   | ISO/IEC 27001:2022 (with Amd 1:2024)                                                                     |
| ISO 9001 quality            | 2.3.0   | ISO 9001:2026                                                                                            |
| ISO 14001 environment       | 2.2.0   | ISO 14001:2026                                                                                           |
| ISO 45001 health and safety | 1.3.0   | ISO 45001:2018 (revision at DIS, expected 2027)                                                          |
| GDPR privacy                | 2.2.0   | Regulation (EU) 2016/679                                                                                 |
| NIS2 cybersecurity          | 1.1.0   | Directive (EU) 2022/2555, with country settings for 27 EU and 3 EEA countries (unverified until checked) |
| Supplier management         | 3.1.1   | links to 27001, 9001 and GDPR                                                                            |

Levels read Basic, Recommended and Everything. **Requirement libraries in the catalogue:** ISO/IEC 27001:2022,
ISO 9001:2015 (withdrawn) and :2026, ISO 14001:2015 (withdrawn) and :2026, ISO 45001:2018, GDPR, NIS2. Each set has a
setup checklist, a headline dashboard, intake forms and approval workflows.

### Requirement libraries, SoA and coverage

- **Adopt a framework:** a library sheet with applicability, justification, implementation status, owner and evidence.
- **Statement of applicability** as a saved view, printable and exportable as CSV.
- **Cross-walks** (Klarert mapping v1): "Also satisfies" and one-click suggested equivalents.
- **Coverage** per framework; **edition status** badges and a guided **move to a new edition**.

### Evidence and files

- **Files with SHA-256** checked before and after upload, **versions** kept on replace, up to 25 MB.
- **Evidence with expiry:** current, expiring within 30 days or expired, in words; the **Evidence library** across
  sheets; automations before expiry.

### Activity log and audit pack

- **Append-only, hash-chained per item, Verify** in the panel.
- **Audit pack** (zip), **SoA export**, **management review inputs**, **data-flow record**; the **Exports** list.

### Retention and GDPR

- **Personal data fields,** masked in the log; **retention rules** per sheet; **review queue**, postpone, **legal
  hold**; **erasure** that keeps the chain; a daily check and Check now.

### Roles, access and invites

- **Owner, admin, editor, viewer, auditor** (with an end date); **restricted folders, sheets and fields**.
- **Invites by email** with a link that lasts 14 days; resend; logged.

### Security

- **EU hosting** (Frankfurt), **two-step sign-in** (requirable), **row level security**, passwords
  of at least 12 characters, **no trackers**.

### Apps, Design, dashboards, Home and My work

- **Apps:** CAPA and ISMS CAPA, working on a phone.
- **Design:** a list and a map of each sheet's inputs, logic and outputs, with health in words; what leaves the
  workspace.
- **Dashboards:** key figures, risk heat map, follow-up, counts, overdue.
- **Home:** one Next step per installed standard; **My work:** approvals, overdue, due soon, requests to me.
- **Search** with `/`.

### Import and export

- **CSV import** with type guessing; **paste from Excel**; **copy a sheet**.
- **Export:** SoA CSV and print, the audit pack (every register as CSV), management review inputs, the data-flow
  record. A one-click CSV export of any single sheet is not built.

### Coming next (do not present as built)

- Policy lifecycle: write, approve, publish and read-and-accept with re-attestation.
- Email notifications and digests (only invites are emailed today).
- Single sign-on (Microsoft, Google), then SAML and SCIM.
- Readiness score per standard with what to fix first.
- Public API and inbound webhooks.
- Plans, trial and billing.
- A frozen, approved SoA; gates for internal audit and management review.
- Multi-client overview for consultants; private and client packs.
- An auditor app; a trust page; supplier questionnaires (board suggestions, not committed).
- Approval reassignment and delegation; standards in scope per workspace; a clause coverage lens.

## 7. Competitive framing

We describe competitors by their general positioning, never with figures we cannot source. Never disparage.

| Alternative               | Where they are strong                                                                                                       | Where Keptrow wins                                                                                                                                                                        | When Keptrow is not the right fit                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Vanta, Drata, Secureframe | SOC 2 and security certifications for software companies; automated evidence from cloud, identity and HR tools; trust pages | ISO management systems beyond security (quality, environment, health and safety); shared registers across standards; a structure you change yourself; EU hosting; a log anyone can verify | You need SOC 2 or automated evidence from many connected systems now                     |
| Classic GRC suites        | Breadth for large enterprises; deep configuration; established with risk and audit teams                                    | Ready from a ready-made set, not a project; no consultant needed to change a field; plain words                                                                                           | You need enterprise-wide risk across many business units with SSO and integrations today |
| OneTrust                  | Broad privacy, consent and trust programmes                                                                                 | Privacy and ISO standards on the same registers; retention and erasure inside the record; smaller to adopt                                                                                | You need cookie consent, a consent platform or large-scale data mapping                  |
| Excel and SharePoint      | Free, familiar, flexible                                                                                                    | The same familiarity with field types, automations, an audit trail, the SoA and standards content                                                                                         | Your whole system is a handful of short lists and nobody audits it                       |
| monday.com and Notion     | Flexible work management loved by teams                                                                                     | Standards, requirement libraries, the SoA, approvals, retention and a verifiable log built in                                                                                             | You need general project management, not a management system                             |

**Category line:** a compliance spreadsheet, or "the management system spreadsheet". Not "GRC platform" (sounds heavy)
and not "compliance automation" (that category means connectors).

## 8. Claims

**We may say** anything section 6 lists as built, in the words of section 3, with the numbers read from the code (58
field types, 18 triggers, 16 actions, three levels of loop guard, seven ready-made sets). Two wordings need care:
"an activity log you can verify" (not "tamper-proof"), and "built to WCAG 2.1 AA as a target, with automated
accessibility checks" (never "certified accessible").

**We must never say:**

- "ISO certified", "ISO approved", "SOC 2 compliant", "GDPR certified" or any certification Klarert does not hold.
- "Guarantees certification" or "audit-ready in N days".
- "AI-powered" or any AI claim. The AI proposal field stores a value; nothing generates it.
- Customer names, logos, testimonials, user counts, time or money saved: none exist yet.
- Integrations or connectors beyond outbound webhooks to Slack, Teams or any URL.
- SSO, an API, email notifications, a readiness score or policy attestation as available.
- "Unlimited", uptime figures, response-time promises or performance numbers.
- "Tamper-proof". Say "a changed entry shows" or "tamper-evident".

**Naming ISO standards:**

- Use the number and edition: "ISO/IEC 27001:2022", "ISO 9001:2026". "ISO/IEC 27001" for 27001; "ISO" alone for the
  others.
- Never quote clause or control text, and never paraphrase it closely. Reference numbers and official short titles
  only, as the libraries do (docs/12).
- Say "helps you prepare for certification", never "makes you compliant". Certification bodies certify; we do not.
- Say an edition's status when it matters ("ISO 14001:2015 was withdrawn in April 2026").
- Do not use ISO's logo.

## 9. Objections and answers

| Objection                                | Answer                                                                                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "We already use Excel."                  | Good: Keptrow works like it, and you can paste straight in or import a CSV. What you gain is one copy instead of many, reminders that run themselves, and a record of every change your auditor can check. |
| "We need SOC 2."                         | SOC 2 is not in our catalogue today. Keptrow is built for ISO management systems, GDPR and NIS2. If SOC 2 is your main goal, a SOC 2 tool is the better fit.                                               |
| "Is our data safe?"                      | It is hosted in Frankfurt. Two-step sign-in can be required for everyone. Every table has row level security, sensitive fields can be restricted, and there are no trackers.                               |
| "Can it do X?"                           | If X is a register, a tracker or a review cycle, almost certainly: add the fields, a form and an automation yourself. If X is an integration, SSO or an API, it is coming; ask us.                         |
| "What about price?"                      | Plans are not published yet. Talk to us at support@klarert.com. (Placeholder until pricing is decided.)                                                                                                    |
| "Do we have to use your templates?"      | No. Change anything, or start blank. When we update a standard, your changes are kept and conflicts ask you.                                                                                               |
| "Will the auditor accept it?"            | The auditor gets read-only access, the statement of applicability, an evidence index with fingerprints and a log they can verify themselves. The decision is always theirs.                                |
| "We are a small team with one standard." | Start with that standard at the Recommended level. Add the next standard later on the same registers.                                                                                                      |

## 10. Voice and words

**Tone:** calm, plain and exact. Short sentences. The customer's nouns: register, risk, action, evidence, audit. We
show, we do not shout. No exclamation marks, sentence case everywhere, dates as 11 Nov 2026, times in 24 hours.

| We say                                                       | We avoid                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| sheet, item; register inside a proper name ("Risk register") | record, entry or row for an item; board for a sheet                                |
| standard                                                     | add-on, pack (in words people read)                                                |
| shared registers                                             | Core                                                                               |
| Basic, Recommended, Everything                               | Foundations, Starter, Full                                                         |
| activity log you can verify                                  | immutable, blockchain, tamper-proof                                                |
| two-step sign-in                                             | MFA, 2FA                                                                           |
| automation, when, if, then                                   | workflow engine, AI                                                                |
| helps you prepare for an audit                               | guarantees, compliant out of the box                                               |
| hosted in the EU, in Frankfurt                               | sovereign cloud                                                                    |
| —                                                            | powerful, seamless, robust, next-generation, revolutionary, effortless, AI-powered |

**Plain words for the jargon:**

- **SoA (statement of applicability):** the list of every control in a standard, with whether it applies to you, why
  or why not, and how far you have put it in place.
- **CAPA (corrective and preventive action):** what you do when something goes wrong: contain it, find the cause, fix
  it, and check the fix worked.
- **Hash-chained:** each entry in the log carries a fingerprint of itself and of the entry before it. Change one entry
  and the chain no longer adds up, so the change shows.
- **Cross-walk:** a note that two requirements in different standards ask for the same thing.
- **Requirement library:** a standard's requirements as a list you work through, in our own words.

## 11. Site structure for the redesign

**Visual style:** light and airy, white with soft blue glows, real product UI as cards (taken from the app, not
mock-ups), generous space, Geist type. No dot patterns, no stock photos, no badges we have not earned.

**Pages:** Home, Platform, Frameworks, Pricing (placeholder). Later: For consultants, For auditors.

### Home

| #   | Section              | Message to land                                                                  | CTA                                     | Visual idea                                                                                                 |
| --- | -------------------- | -------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Hero                 | Record it once. Prove it for every standard.                                     | Create your workspace; See the platform | A risk register card in Table view with a "Used by ISO 27001, ISO 9001, NIS2" chip, a soft blue glow behind |
| 2   | The problem          | Three files, evidence in inboxes, an audit rebuilt every year                    | none                                    | Three small cards fading into one register                                                                  |
| 3   | The middle path      | The freedom of a spreadsheet, the proof an auditor asks for                      | none                                    | Split card: a field picker on the left, the activity log with "Chain intact" on the right                   |
| 4   | Record once          | One register, every standard; cross-walks show what else a requirement satisfies | Explore the standards                   | A requirement card with "Also satisfies" listing three standards                                            |
| 5   | Work moves by itself | When, if, then, with a run log                                                   | See automations                         | The automation sentence card and a run log row "Would notify Maria"                                         |
| 6   | Proof on audit day   | Verify, the SoA, the audit pack, auditor access that ends                        | See audit outputs                       | The Verify result card and an SoA table card                                                                |
| 7   | Privacy and security | Frankfurt, two-step sign-in, restricted fields, erasure that keeps the chain     | Read about security                     | Four fact cards, each with a small product detail                                                           |
| 8   | Standards band       | Seven ready-made sets on shared registers, libraries in our own words            | See every set                           | A row of quiet name tiles with editions, no logos                                                           |
| 9   | Start                | Start with one standard; add the next on the same registers                      | Create your workspace; Talk to us       | The Home "Next step · Step 1 of 8" card                                                                     |

### Platform

Hero ("Everything Keptrow does today, in plain words"), then one section per group in section 6, in this order:
sheets and field types, views, automations, approvals, activity log and audit pack, requirement libraries and SoA,
evidence, retention and GDPR, roles and auditor, security, apps and Design, import and export. Each section: the
message, three points, one real UI card. End with "Coming next" as a plain list, labelled as such, and the CTA. The
message for the page: one engine, one set of sheets, one log.

### Frameworks

Hero ("Ready-made sets for the standards you work to"); the shared registers first (the base); then the sets grouped
by Security and privacy, Quality, environment and safety, Supply chain, each with version, edition, what it adds and
what it shares; then the libraries with edition status badges; then the licence note. CTA: Create your workspace.
Visual: a stacked diagram in words, shared registers at the bottom and standards as layers on top.

### Pricing (placeholder)

"Plans are on the way." What every workspace includes today (from section 6), auditors read-only, and a contact
link. No prices, no plan names, no "free forever". CTA: Talk to us.

## 12. Board notes

1. **Compliance officer / ISO lead auditor.** "Prove it" is fair only because the log, the SoA and the audit pack are
   real. Keep "helps you prepare"; never imply we certify. Show the evidence index, auditors trust fingerprints.
2. **UI/UX designer.** Use real UI cards at a size people can read, one idea per card. Every status in the visuals
   needs words and a symbol, as in the app. Check the hero at 390 px first.
3. **Adoption specialist.** Show the first five minutes: pick a standard, see a register, add an item. Lead with one
   standard; "every standard" is the second thought, not the first hurdle.
4. **Senior web developer.** Keep numbers flowing from the code (`src/lib/site/catalogue.ts`), not typed into copy.
   The rename touches `BRAND` and `SITE` in `content.ts` and the email sender; plan it as one change.
5. **Compliance SaaS founder.** Sell to ISO-certifying SMEs and consultants first, not the SOC 2 buyer. Dissent: the
   headline's "every standard" oversells for a one-standard buyer; keep the multi-standard proof below the fold.
6. **Security and privacy / DPO.** Put the privacy facts in the first half of the page. Say "tamper-evident", never
   "tamper-proof". Do not name sub-processors until the DPA and the list are published.
7. **Multi-client ISO consultant.** Tailor and update without losing changes is my reason to switch. Do not promise a
   multi-client overview until it exists; the workspace switcher is enough to mention.
8. **B2B SaaS marketing consultant.** One promise, the combination as the moat, proof under every claim. The category
   is "the management system spreadsheet"; stay out of "compliance automation".
9. **Sales messaging and language expert.** Reading level is right when a quality manager in Lyon reads the hero once
   and can say it back. Dissent: I would lead with B for first-time visitors; test A against B once traffic allows.
