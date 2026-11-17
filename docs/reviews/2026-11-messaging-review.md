# Messaging review: what makes a visitor sign up

The brief (docs/15) checked against the live copy and the real sign-up path in the code, 16 Nov 2026. "Keptrow"
ships as "Compliance OS" (`BRAND`) until the trademark is cleared. Only claims the brief's section 8 allows.
Items for the owner are marked **Owner decision**.

## 1. Verdict

1. The brief is strong: one sharp idea ("Record it once. Prove it for every standard."), an honest claims list, and proof that is real (the log, the SoA, the audit pack).
2. The live site sells features, not a start: "Run your management system in one shared spreadsheet", then "Create account" and "Sign in" as the only two buttons.
3. Nothing says what signing up costs or gives. No price, no trial, no "free", and the terms hold a placeholder for plans. A careful SME buyer reads that as "sales call later" and leaves.
4. The visitor's standard is lost. They arrive for ISO 27001; sign-up, onboarding and Home never ask, and Home's first run teaches spreadsheet basics ("Create a sheet", "Add 5 items") instead of "Set up ISO 27001".
5. Fix the promise, carry the standard from the URL to an installed set, and lead with one standard. That is two small builds and a copy pass, not a redesign.

## 2. Panel findings

Severity: high stops sign-ups, medium loses some, low is polish.

### 2.1 Head of growth (B2B SaaS, product-led)

| # | Sev | Finding | Quote | Fix |
|---|---|---|---|---|
| G1 | High | The second hero button is for people who already have an account. | `Actions`: "Create account" / "Sign in" | Primary "Create your workspace"; secondary "See how it works" (anchor). Keep Sign in in the header only. |
| G2 | High | No sign-up promise. A visitor cannot tell if this is free, a trial or a demo request. | legal.ts: "Plans, prices and payment terms" (placeholder) | Decide (section 3) and put one true line under every primary CTA. |
| G3 | High | The standard the visitor came for is dropped at the door. | frameworks.tsx: "Create account to set up {set}" links to `/login?mode=signup` with no standard | Deep link `?standard=iso-27001` through sign-up into Create (section 8, A1). |
| G4 | Medium | The stats row lists internals, not reasons to sign up. | STATS: "field types", "automation loop guard" | Replace with three buyer facts: "6 standards on shared registers", "Hosted in Frankfurt, EU", "A log your auditor can verify". |
| G5 | Medium | The sign-up page forgets why the visitor came. | login page: "Create an account" / "Choose a password to create your account." | Heading and helper from the microcopy kit (section 6), with the chosen standard named when present. |
| G6 | Medium | Only two CTA moments (hero, closing). The frameworks teaser sends people away to "See every framework". | landing.tsx | A CTA after the standard picker and after the objections block. |

### 2.2 Senior copywriter

| # | Sev | Finding | Quote | Fix |
|---|---|---|---|---|
| C1 | High | The live headline describes a container, not an outcome. "Management system" means nothing to a first-time buyer. | HERO.title: "Run your management system in one shared spreadsheet" | Use the brief's line A, with the spreadsheet in the subhead (section 4). |
| C2 | Medium | Brief subhead A is 44 words and lists six standards. | §1 A: "Keptrow is a shared spreadsheet for your management system. A risk, an incident…" | 25 words or fewer; name standards in the eyebrow or the picker instead. |
| C3 | Medium | Engine words on the home page. | FEATURES: "hash-chained per item. Verify recomputes the chain." | Home: "Change an entry and it shows." Keep "hash-chained" on /platform with the plain-words gloss from §10. |
| C4 | Medium | A number the product does not back. Setups have 4 to 8 steps (ISO 27001: 4, NIS2: 6, GDPR: 8), not 8. | §5: "8-step setup checklists"; §11: "Step 1 of 8" | "A guided setup for each standard", or read the count from the pack. |
| C5 | Medium | A sales line that over-promises on day one: pack automations that notify start in test mode, and notifications are in the app only. | §3 #4: "Reminders and follow-ups run themselves" | "Reminders and follow-ups run on their own once you switch them on." Say "in the app" wherever notifications appear. |
| C6 | Low | The closing contradicts the standards-first story. | CLOSING: "Start with your first sheet" | "Start with one standard. Add the next on the same registers." |

### 2.3 Brand and positioning strategist

| # | Sev | Finding | Quote | Fix |
|---|---|---|---|---|
| B1 | High | The category is hedged between two names. | §7: "a compliance spreadsheet, or 'the management system spreadsheet'" | Own **"the compliance spreadsheet"**: people search and say it. Use "for your management system" as the qualifier for ISO readers. |
| B2 | High | The idea to own is "record it once"; the enemy is "one file per standard". The live site leads with neither. | PROBLEM: "One file per standard, so the same risk is typed in three places" | Make both the spine of every page. |
| B3 | Medium | The most memorable line is buried. | §1 B: "The freedom of a spreadsheet. The proof an auditor asks for." | Use it as the heading of section 2 of the page. |
| B4 | Medium | The real competitor for an SME is Excel, not Vanta. The page never says "why not Excel". | §9: "We already use Excel." | A short "Already in Excel?" block near the CTA, with the brief's answer. |
| B5 | Medium | Three names in play (Compliance OS, Keptrow, Klarert). | §0: "swap the name back wherever copy ships" | Copy reads the name from `BRAND` only; launch Keptrow in one change, with redirects and the email sender (board note 4). |

### 2.4 User adoption and onboarding expert

The real flow on main: "Create account" opens the password form (the email link is the third link down); with the hosted "Confirm email" on, the person must leave and come back; `/onboarding` asks name, initials and avatar colour, then workspace name, web address and time zone; Home shows My work tiles at 0 and a Getting started list of spreadsheet basics. A standard is reached only through Create → Solve a problem → set → Next → Name, Owner, Review by → Create. That is 8 inputs before any value, and the standard is found only by someone who knows to open Create.

| # | Sev | Finding | Quote | Fix |
|---|---|---|---|---|
| A1 | High | The site promises standards; first run teaches a blank spreadsheet. | home.ts `checklist`: "Create a sheet", "Add 5 items" | First step for owners with no standard: "Set up your first standard", opening Create at Solve a problem. |
| A2 | High | The standard cannot be carried in. `createWorkspaceAction` always redirects to `/${slug}`; `CreateRequest` takes a card, folder or goal, not a set. | onboarding/actions.ts: `redirect(\`/${result.data.slug}\`)` | Carry `standard` through `next` and open Create on that set (section 8, A1). |
| A3 | High | Eight inputs before value; three of them (initials, avatar colour, web address) can wait. | forms.tsx: "Initials", "Avatar colour", "Web address" | Ask name and workspace name; derive initials, colour and address; keep the time zone guessed, editable later. |
| A4 | Medium | When email confirmation is on, the success message renders as a red alert, and the `next` address is not passed to the confirmation link. | actions.ts: `fail('failed', 'Check your email to confirm…')`; `emailRedirectTo` without `next` | Show a "Check your email" status like the link form; add `next` to the confirmation link. |
| A5 | Medium | The automations a standard brings start in test mode, so "work moves by itself" needs an admin step nobody is told about in setup. | home.ts: "74 automations are in test mode." | After the first install, one line in the bundle banner: "Reminders are in test mode. Review and turn on." |
| A6 | Medium | The aha moment (Verify on the activity log) is the last checklist step. | "Open the activity log of an item" | After the first item is added, offer "See its activity log" in the toast. |

### 2.5 Compliance buyer (skeptical SME quality and security manager)

"I have one audit in March, no budget approved, and a boss who will ask what this costs."

| # | Sev | Finding | Quote | Fix |
|---|---|---|---|---|
| K1 | High | "What does it cost?" No answer means I assume enterprise pricing and leave. | brief §9: "Plans are not published yet." | A Pricing page with the decided promise (section 3) and what every workspace includes. |
| K2 | High | "Will my auditor accept it?" The best answer is in the brief, not on the site. | §9: "The decision is always theirs." | Put it in the objections block next to the CTA. |
| K3 | High | "Can I get my data out?" A one-click export of a single sheet is not built; the audit pack exports every register as CSV. | §6: "A one-click CSV export of any single sheet is not built." | Say the true thing ("Every register exports as CSV in the audit pack") and build the per-sheet export (section 8, A6). |
| K4 | Medium | "Does it email my team?" Only invites are emailed. | §6 Coming: "Email notifications and digests" | State it: "Reminders arrive in each person's inbox in the app. Email reminders are coming." |
| K5 | Medium | "Who is behind this?" No company facts, no person. | site has a contact email only | A short founder note and company facts (registered name, country), only what is true. |
| K6 | Medium | "Is this the real product?" The hero is a mock. | `hero-mock.tsx` | Real screenshots from the app, labelled with the fictional company "Meridian Components Ltd". |

### 2.6 SEO and content marketer

| # | Sev | Finding | Quote | Fix |
|---|---|---|---|---|
| S1 | High | No page per standard. Six intents compete for one URL (/frameworks). | SITEMAP_PATHS: "/", "/platform", "/frameworks" | Seven landing pages (section 7). |
| S2 | High | Titles carry the brand, not the search term. | SITE.title: "Compliance OS by Klarert" | Home: "The compliance spreadsheet for ISO, GDPR and NIS2 · Keptrow"; one keyword-led title per standard page. |
| S3 | Medium | The highest-intent searches for SMEs are for templates ("risk register template", "records of processing template"). The packs already hold those structures in our own words. | docs/11: example items, own words | Template pages with a free CSV built from the pack manifests, and "Open it as a live sheet". |
| S4 | Medium | The rename resets brand search. | §0 | Ship Keptrow once, with 301s from any changed URL; keep "Klarert" in titles for the first months. |
| S5 | Medium | Licensing applies to content too. | §8: "Never quote clause or control text" | Template and checklist content uses reference numbers and short titles only; route each through the docs/12 check. |
| S7 | Low | `PUBLIC_PATHS` says only `/`, `/privacy`, `/terms` are indexed, but /platform and /frameworks are too. New pages could be missed. | content.ts: "The pages search engines may index" | Make one list the source for indexing and the sitemap before adding standard pages. |

## 3. The sign-up promise

**Today**, from the code and docs: an account, a workspace they own, every built feature and all seven ready-made sets; no card, no billing, no trial clock. "Plans, trial and billing" is coming (§6), the terms hold a placeholder for prices, and the brief rules out "free forever". After sign-up they see Home's Getting started list, not their standard.

**This is undecided. Owner decision.** Options:

| Option | Line under the CTA | Build | Risk |
|---|---|---|---|
| A. Free early access | "Free while in early access. We will tell you before plans start." | None (copy and terms) | People wonder what it will cost; answer with "Plans will be published here" and a date when known |
| B. Free trial, fixed length | "Free for N days. No card needed." | Trial clock, expiry state, billing: L | A clock before billing exists punishes early users; N needs a decision |
| C. Free for one standard | "Free for one standard. Pay when you add more." | Plan limits and billing: L | Locks pricing early; fits "start with one standard" well |

**The panel's pick: A now, C as the long-term model to test.** A is true today, costs nothing to build and removes the biggest bounce reason (K1). Do not print a notice period until it is decided. "No card needed" is true today; print it once the owner confirms it stays true.

## 4. Rewritten hero

| | Option 1: Record once | Option 2: Spreadsheet plus proof | Option 3: Start from your standard |
|---|---|---|---|
| Eyebrow | The compliance spreadsheet for ISO, GDPR and NIS2 | For ISO 27001, ISO 9001, GDPR and NIS2 | Ready-made registers for six standards |
| Headline | Record it once. Prove it for every standard. | Your spreadsheet, with the proof auditors ask for | Pick your standard. Its registers are ready. |
| Subhead | A shared spreadsheet for your management system. Start with one standard; a risk or incident you record counts for the next one too. (23 words) | Registers, actions and evidence in sheets your team already knows how to use. Every change goes into an activity log your auditor can verify. (24 words) | ISO 27001, ISO 9001, ISO 14001, ISO 45001, GDPR or NIS2: install it as sheets you can change, with example items and a guided setup. (25 words) |
| Primary CTA | Create your workspace | Create your workspace | Start with your standard (scrolls to the picker) |
| Secondary CTA | See how it works | See a register (real screenshot) | See every standard |
| Reassurance | Hosted in Frankfurt, EU. No card needed. Free while in early access. | Same | Same |

Reassurance line: "Hosted in Frankfurt, EU" is true. "No card needed" is true today (no billing exists) but needs the owner to confirm it stays true. "Free while in early access" needs the section 3 decision. Until then, ship only "Hosted in Frankfurt, EU. Two-step sign-in. No trackers."

**Winner: Option 1**, with Option 3's picker as the very next section. It owns the one idea (record once), the subhead fixes the board's "every standard is a hurdle" dissent by starting with one, and the picker gives the one-standard start in the first scroll.

**What to test.** Option 1 against Option 2 (the board's A against B), then "Create your workspace" against "Start with your standard". Traffic will be low, so run five-second tests with five quality or security managers first, then test in sequence on the section 10 counts, and do not call a winner on a few dozen sign-ups.

## 5. The page that sells

| # | Section | Job | Copy (heading, then lines) | Visual | CTA |
|---|---|---|---|---|---|
| 1 | Hero | Say what it is and start | Option 1 above | Risk register card in Table view with "Used by ISO 27001, ISO 9001, NIS2" | Create your workspace; See how it works |
| 2 | Start from your standard | Turn interest into a specific start | **Which standard are you working on?** Pick one. Your workspace opens with its registers, example items and setup steps. | Six tiles: ISO/IEC 27001, ISO 9001, ISO 14001, ISO 45001, GDPR, NIS2, each with edition and the first setup step; a seventh, "Something else: start blank" | Each tile links to `/login?mode=signup&standard=<key>` |
| 3 | How it works in 3 steps | Remove fear of a set-up project | See below | Three real screenshots: sign-up, Create's preview, Home's Next step card | Create your workspace |
| 4 | The problem | Name the enemy | **One file per standard does not hold.** The same risk is typed three times and the copies drift. Evidence sits in email. Every audit starts with a week of searching. | Three file cards fading into one register | none |
| 5 | The middle path | Why not Excel, why not a rigid tool | **The freedom of a spreadsheet. The proof an auditor asks for.** Add any field, paste from Excel, change anything. The structure that matters in an audit stays fixed. | Field picker on the left, activity log with "Chain intact" on the right | none |
| 6 | Record once | The differentiator | **Record a risk once. It counts for every standard that uses it.** Add ISO 9001 next to ISO 27001 and both work on the same registers. | Requirement card with "Also satisfies" | See every standard |
| 7 | Proof on audit day | The outcome | **Hand over links, not a folder.** Read-only auditor access that ends by itself, the statement of applicability, and an audit pack whose log your auditor can check without our software. | Verify result card; SoA table card | See an example audit pack (section 9) |
| 8 | Privacy and security | Pass the first vendor check | **Hosted in Frankfurt. Two-step sign-in. No trackers.** Row level security on every table, restricted fields, and erasure that keeps the audit trail intact. | Four fact cards | Read about security (`/platform#security` until a security page exists) |
| 9 | Questions before you start | Objections next to the CTA | See below | Plain list | Create your workspace |
| 10 | Closing | Last push | **Start with one standard.** Add the next on the same registers when you are ready. | Home's Next step card | Create your workspace; Talk to us |

**How it works (matches the code):**

1. **Create your workspace.** Your email, then your name and your organisation's name.
2. **Pick your standard.** It installs as ordinary sheets with example items. Nothing is created until you press Create.
3. **Follow the next step.** Home shows the first setup step for your standard. Add your first item and invite your team.

Step 2 needs A1 or A2 (section 8); until then write "Open Create and pick your standard".

**Standard picker: build item.** Today neither onboarding nor Create accepts a preselected set: `CreateRequest` has `card`, `folderId` and `goal` only, the workspace form redirects to `/${slug}`, and the frameworks page links to sign-up without the set. Size M (A1). Shortcut: pass the standard as Create's `goal`; `templates/intents.json` already matches "iso 27001", "nis2" and the others to their sets.

**Objections block (section 9 of the page):**

- *What does it cost?* The section 3 line, and a link to Pricing.
- *We already use Excel.* Keptrow works like it: paste straight in or import a CSV. You gain one copy instead of many, and a record of every change.
- *Will our auditor accept it?* They get read-only access, the SoA, an evidence index with fingerprints and a log they can verify themselves. The decision is theirs.
- *Can we get our data out?* Every register exports as CSV in the audit pack.
- *We have one standard.* Start with it. Add the next later on the same registers.
- *We need SOC 2.* It is not in our catalogue. A SOC 2 tool is the better fit.

## 6. CTA and microcopy kit

All under 12 words.

| Context | Copy |
|---|---|
| Hero primary | Create your workspace |
| Hero secondary | See how it works |
| Header | Create workspace · Sign in |
| Standard tile | Start with ISO 27001 |
| Standard landing page | Set up ISO 27001 in your workspace |
| Template lead magnet | Download the template · Open it as a live sheet |
| Pricing page | Create your workspace · Talk to us |
| Closing | Start with one standard |
| Consultant page | Set up your first client workspace |
| Sign-up heading | Create your workspace |
| Sign-up helper (no standard) | Your registers, hosted in Frankfurt. No card needed. *(card line: owner decision)* |
| Sign-up helper (with standard) | Next, we set up ISO 27001 for you. |
| Sign-up method links | Email me a link instead · I have an account |
| Confirmation (status, not error) | Check your email. Open the link to continue. |
| First onboarding screen, heading | Name your workspace |
| First onboarding screen, helper | Usually your organisation's name. You can change it later. |
| Onboarding button | Create workspace |
| Home, no standard yet | Set up your first standard |
| Home, its helper | It adds registers, example items and setup steps. |
| Home, needs-you empty | Nothing needs you yet. Add an item to start. |
| Home, recent activity empty | Changes to items show here, each one logged. |
| Home, invite step | Invite a colleague to work with you |
| Invite email subject | {Inviter} invited you to {workspace} on Keptrow |
| Invite subject, alternative to test | {Inviter} wants your help with {workspace}'s registers |

## 7. Standard-specific landing pages

Each page: hero, the standard's sheets and setup steps, "Record once", the edition note, objections and the CTA with the standard preselected. Each lead magnet is a CSV built from the pack manifest (own words, reference numbers and short titles only, docs/12).

| Page | Search intent | Headline | 3 bullets | CTA | Lead magnet |
|---|---|---|---|---|---|
| ISO/IEC 27001 | "ISO 27001 software", "ISO 27001 risk register template" (commercial, template) | ISO/IEC 27001:2022, in a spreadsheet your team knows | Scope, risk treatment plan and the 93 Annex A controls as a requirement library · A statement of applicability built from it, ready to export · NIS2 measures cross-walked where they ask the same | Set up ISO 27001 | Risk register and risk treatment template (CSV) |
| ISO 9001 | "ISO 9001 spreadsheet", "ISO 9001 2026 software" | ISO 9001:2026 quality registers, ready to change | Processes, customer feedback and complaints, external providers · Nonconformities and CAPA with a closure that waits for the effectiveness check · The CAPA app for reporting on a phone | Set up ISO 9001 | Complaints and CAPA register template (CSV) |
| ISO 14001 | "ISO 14001 aspects and impacts register" | Environmental aspects, obligations and monitoring in one place | Aspects and their significance · Compliance obligations in the Legal register · ISO 14001:2026 library; 2015 shown as withdrawn | Set up ISO 14001 | Aspects and impacts register template (CSV) |
| ISO 45001 | "ISO 45001 hazard register template" | Hazards, incidents and actions on shared registers | Hazard identification with the hierarchy of controls · Injuries and near misses as incidents · Worker consultation records | Set up ISO 45001 | Hazard register template (CSV) |
| GDPR | "GDPR record of processing template", "data breach register" | Records of processing, requests and breaches, with their deadlines | Records of processing and processors with DPAs · Data subject requests and breaches with the 72-hour clock · Retention and erasure that keep the audit trail intact | Set up GDPR | Records of processing template (CSV) |
| NIS2 | "NIS2 register template", "NIS2 scope check" | NIS2: scope, measures and incident reports in one sheet set | A scope self-check per legal entity · The Art. 21 risk-management measures as controls · Incident reports with their deadlines | Set up NIS2 | NIS2 scope self-check (CSV), carrying the product's own warning that country details are "Not verified yet" until checked |
| Consultants | "ISO consultant software", "ISO templates for consultants" | The same registers in every client workspace | Tailor each client's sets; keep their changes when we update · Switch between client workspaces · Give each client's auditor read-only access that ends by itself | Set up your first client workspace | "How to hand an auditor a log they can verify": the audit pack method, in plain words. Say a multi-client overview is coming, not built |

Gate the templates? **Owner decision.** The panel recommends no email gate: the CSV is a sample, and the conversion is "Open it as a live sheet", which is sign-up with the standard preselected.

## 8. Adoption gaps that hurt conversion

Each was checked in the code; none is assumed.

| # | Change | State today | Size | Why it lifts sign-up or activation |
|---|---|---|---|---|
| A1 | **Preselected standard from the URL**: `?standard=` kept through sign-up (`next`), onboarding and workspace creation, then Create opens at Solve a problem with the set chosen | Not built; `next` dropped at workspace creation and in the confirmation link | M | Turns every standard page and picker tile into a one-path start |
| A2 | **First-run step "Set up your first standard"** on Home for owners and admins with no standard | Getting started is spreadsheet basics | S | Matches the site's promise in the first screen after sign-up |
| A3 | **Shorter onboarding**: name and workspace name; derive initials, colour and web address; guessed time zone shown, editable | 8 inputs | S | Fewer fields, faster first value |
| A4 | **Confirmation message as a status**, and `next` in the confirmation link | Red alert, `next` lost | S | Stops people thinking sign-up failed |
| A5 | **Email link as the default sign-up** (one field), password as the alternative | Password first; link third | S | One field instead of two; no 12-character password at the door. **Owner decision** with the hosted "Confirm email" setting |
| A6 | **One-click CSV export of a sheet** | Not built (audit pack only) | S–M | Answers "can I get my data out" before sign-up |
| A8 | **Sample data and a guided first item** | Built: every set adds "Example:" items and highlights "Add your first …" | none | Say it on the site; add "See its activity log" after the first item |
| A10 | **Demo workspace or tour** | None | L for a live public demo (anonymous access needs a security review); S for real screenshots or a two-minute recorded walkthrough | Lets the skeptic see the real product before giving an email |
| A11 | **Pricing page** with the section 3 promise | None | S | Removes the top bounce reason |
| A12 | **Email reminders** | Coming | L | Keeps the buyer's team active; until then, say "in the app" |

## 9. Proof without fakes

Only items that are true or can be made true from what is built:

- **A public example audit pack.** Generate it from a seeded workspace of the fictional "Meridian Components Ltd" (already the placeholder in the workspace form), clearly labelled as an example: SoA CSV, registers as CSV, evidence index with SHA-256, the log with every chain checked and `method.txt`. The strongest proof we have: a buyer or their auditor can recompute a hash.
- **The log method in plain words.** One page: what is hashed, how the chain links, how to check it without our software. Avoid "tamper-proof"; say "a changed entry shows".
- **A transparent security page.** Frankfurt hosting, row level security on every table, two-step sign-in that owners can require, passwords of 12 characters or more, no trackers, fonts from our own domain. Do not name sub-processors until the DPA and list are published (board note 6).
- **Licence and edition honesty.** The licence note, edition badges, and plain statements such as "ISO 14001:2015 was withdrawn in April 2026".
- **A founder note** (owner decision on names and photos) and a **public changelog**: the sets are versioned (Core 1.3.0, ISO/IEC 27001 2.3.0), so a dated list shows a living product.
- **"Coming next" in public**, labelled as such. Saying what is not built earns belief for what is.
- **Accessibility statement.** "Built to WCAG 2.1 AA as a target, with automated accessibility checks", never "certified".

## 10. Metrics

The funnel: **visit → sign-up → workspace created → first standard installed → first item → invite sent.**

Most steps are already in the data, with no tracker:

| Step | Source |
|---|---|
| Sign-up | Account created (Supabase Auth `created_at`) |
| Workspace created | `orgs` |
| First standard installed | `pack_installs` of a set with a guided setup, per workspace |
| First item | First `item.created` in the activity log by a person, not by an install |
| Invite sent | `invites` |
| Activated (proposed) | Standard installed, 5 items by people and 1 invite within 7 days |

**Visits and CTA clicks** need something new. Options, all **Owner decision**:

1. **First-party aggregate counts** (panel pick): a server route or middleware adds 1 to a daily counter per path, `standard` value and CTA id. No cookies, no IP stored, no third party. "No trackers" stays true; "no analytics" becomes "no third-party analytics". Size S–M.
2. **An EU-hosted, cookieless analytics service.** Easier reports; the "no analytics" line changes and the privacy notice names the processor.
3. **Vercel Web Analytics.** Cookieless and on our host; the same copy change.

Also store the `standard` a visitor arrived with on the account, first-party. Review weekly: step conversion, time from sign-up to first install, installs per standard.

## 11. Top 10 actions

Ranked by expected sign-up impact, then effort.

| # | Action | Impact | Effort | Owner decision |
|---|---|---|---|---|
| 1 | Decide the sign-up promise and print it under every CTA and on a Pricing page | High | S | Yes: pricing and trial |
| 2 | Rewrite the hero (Option 1), CTAs ("Create your workspace", "See how it works") and the stats row | High | S | No |
| 3 | Standard picker on Home with deep links, carried through sign-up into Create (A1) | High | M | No |
| 4 | Home first run: "Set up your first standard" for owners with none (A2) | High | S | No |
| 5 | Cut onboarding to two fields; fix the confirmation message and the lost `next` (A3, A4) | High | S | Email link as default: yes |
| 6 | Objections block near the CTA, including price, auditor, data out, Excel and SOC 2 | Medium | S | No |
| 7 | Seven standard and consultant landing pages with keyword-led titles | Medium | M | Indexing list: yes (it was an owner decision) |
| 8 | Template lead magnets as CSV from the pack manifests, with "Open it as a live sheet" | Medium | M | Gated or not: yes |
| 9 | Real screenshots, a recorded walkthrough and the public example audit pack | Medium | M | Publish the example: yes |
| 10 | First-party funnel counts (section 10) | Enables all tests | S–M | Yes: analytics approach |

Next: the per-sheet CSV export (A6), reminders in setup (A7), and the brief's fixes C4 and C5.
