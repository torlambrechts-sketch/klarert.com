# 16 · Front page handoff (for Claude Design)

The brief for the public home page of **Keptrow, the compliance spreadsheet**, on www.keptrow.com. Everything a designer
needs is here.

**The name.** "Keptrow", read from `BRAND` (`src/lib/brand.ts`); the rename went live on 17 Nov 2026 (docs/14).
There is no "by Klarert": klarert.com only redirects to www.keptrow.com.

**The one rule.** Every statement is true of the product today, or it sits in the band marked "Coming soon".

## 1. Purpose and audience

**Who lands here:** compliance, quality and security leads at small and mid-sized companies (most start with one
standard), DPOs, consultants with many clients, CEOs asked for a certificate, and auditors sent a link by a client.

**What they need to believe, in order:**

1. "This is my work, already organised": registers I recognise, for my standard.
2. "It is a spreadsheet, so my team can use it": not a project, not a rigid tool.
3. "My auditor can check it": the record proves itself.
4. "There is no catch": free while in early access, no card, EU-hosted, no third-party trackers.

**The one action: Create your workspace.** Every section leads to that button.

## 2. Value description

### The narrative (about 150 words)

> Most teams run their management system in spreadsheets: one file per standard, the same risk typed three times,
> evidence in email, and a week of searching before every audit.
>
> Keptrow is the compliance spreadsheet. It keeps one set of registers for risks, incidents, nonconformities,
> documents, suppliers and actions. Pick your standard and it installs on top as ordinary sheets, with its requirement
> library, example items and a short setup checklist. Record a risk once and it counts for every standard that uses
> it, so your second standard is a smaller job than your first.
>
> It works like the spreadsheet your team already knows: add a column, paste from Excel, change anything. And it keeps
> the proof. Every change goes into an activity log your auditor can verify without trusting us. On audit day you hand
> over read-only access, the statement of applicability and an audit pack.
>
> Free while in early access. Hosted in Frankfurt, EU.

### The six core values (live today)

| # | Headline | Supporting line | Proof point (show it in UI) |
|---|---|---|---|
| 1 | Record it once | A risk or incident counts for every standard that uses it. | "Used by ISO 27001, ISO 9001, NIS2" chip on a register; "Also satisfies" on a requirement. |
| 2 | Start from your standard | Registers, example items and a setup checklist of 4 to 8 steps. | Home's "Next step" card; items marked "Example:". |
| 3 | A spreadsheet you can change | 58 field types, paste from Excel, and updates that keep your changes. | The field picker; "Keep mine" when an update arrives. |
| 4 | An activity log you can verify | Every change is chained per item, so a changed entry shows. | "Verify audit trail" in the item panel, answering "Audit trail intact". |
| 5 | Ready for audit day | Auditor access that ends by itself, the SoA and an audit pack. | The auditor's "Start here" panel; the audit pack's file list. |
| 6 | EU-hosted, private by design | Frankfurt hosting, two-step sign-in, no third-party analytics or trackers. | "Require two-step sign-in" in Workspace admin; "Restricted" shown in place of a value. |

### Coming soon values (always labelled "Coming soon")

| Headline | Supporting line | Status | Allowed claim lines |
|---|---|---|---|
| Your own requirements | Add a customer's security schedule, your internal policies, or a code we don't ship. | Being built now | "They get the same library, statement of applicability, coverage and links to your controls as ISO/IEC 27001." · "Map them to ISO/IEC 27001 or NIS2 yourself, and see where one control covers both." |
| Save your setup | Build your method once. Install it in every client workspace. | Next | "Publish a new version; each client takes the update and keeps their own changes." · "Personal data and webhook addresses are never copied." |

**Positioning line** (owner decision, 16 Nov 2026): "Our standards or your own requirements, in one set of registers.
Save your setup and reuse it in every workspace."

- The first sentence becomes a live claim only when own requirements ship; the second only when saved setups ship.
- Until then it appears only inside the "Coming soon" band (3.8), never in the hero.
- The main promise stays **Record it once. Prove it for every standard.**

## 3. The page, section by section

**Example data.** Every product card shows the fictional **Meridian Components Ltd**, labelled "Example workspace":
real product UI redrawn crisply, without browser chrome.

**Page frame.** Full width, white. Soft blue glows at the top behind the hero visual, never behind body text. No dot
pattern. Content about 1,200 px wide; 16 px gutter at 390 px. Large gaps between sections (about 128 px desktop, 72 px
mobile).

### 3.1 Header and nav

- **Job:** orient; keep the main action one click away.
- **Copy:** wordmark "Keptrow". Links: Platform (/platform), Standards (/frameworks), How it works (anchor to 3.5),
  Questions (anchor to 3.11). Right: "Sign in" text link, "Create workspace" dark button.
- **Visual:** white, sticky, a thin bottom line once the page scrolls.
- **Desktop:** wordmark and links left, actions right.
- **390 px:** wordmark, "Create workspace" and a "Menu" button holding the links and Sign in.
- **Feel and do:** "I know where I am." Scroll, or sign in if returning.

### 3.2 Hero

- **Job:** say what it is in one read and start sign-up.
- **Copy:**
  - Eyebrow: **The compliance spreadsheet for ISO, GDPR and NIS2**
  - H1: **Record it once. Prove it for every standard.**
  - Subhead: **A shared spreadsheet for your management system. Start with one standard; a risk or incident you record
    counts for the next one too.**
  - Primary CTA (dark): **Create your workspace**
  - Secondary CTA (outlined): **See how it works** (scrolls to 3.5)
  - Reassurance, muted, under the buttons: **Free while in early access. No card needed. Hosted in Frankfurt, EU.**
- **Visual:** the "Risk register" card in Table view, with the chip "Used by ISO 27001, ISO 9001, NIS2". Columns Ref,
  Risk, Owner, Level, Treatment, Review date. Example rows:
  - R-014 · Laptop lost while travelling · Anna Berg · ▲ High · In progress · 12 Jan 2027
  - R-015 · Key supplier fails to deliver · Tom Weller · ● Medium · Planned · 3 Feb 2027
  - R-016 · Customer data sent to the wrong person · Sara Lund · ▲ High · ✓ Done · 20 Dec 2026
  - R-017 · Example: phishing email opened · Unassigned · ● Medium · Not started · –

  Behind it, offset, R-014's item panel on its activity tab: "Level changed from Medium to High · Anna Berg · 11 Nov
  2026 14:02" and "✓ Audit trail intact. 3 entries".
- **Desktop:** text left (5 of 12 columns), visual right (7 of 12) over the glow. H1 on two lines.
- **390 px:** text, stacked full-width buttons, reassurance, then the card showing Ref, Risk and Level only.
- **Feel and do:** "I get it, and that looks like my risk register." Press Create your workspace.

### 3.3 Standards band

- **Job:** answer "do they have mine?" in a glance.
- **Copy:** **Ready-made sets for** ISO/IEC 27001 · ISO 9001 · ISO 14001 · ISO 45001 · GDPR · NIS2 · Supplier
  management.
- **Visual:** names as text in muted ink at label size. No logos, no badges.
- **Desktop:** one centred row between thin lines. **390 px:** wraps to centred lines.
- **Feel and do:** "They have mine." Keep scrolling.

### 3.4 The problem

- **Job:** name the enemy.
- **Copy:**
  - Eyebrow: **The problem**
  - H2: **One file per standard does not hold**
  - Body: **Most management systems live in spreadsheets, inboxes and shared drives. The work gets done, but nobody can
    show it without a week of searching.**
  - Points: **The same risk, typed three times.** Copies drift apart. · **Evidence in inboxes.** Nobody knows which
    certificate is current. · **Audits rebuilt every year.** Who changed what is pieced together from memory.
- **Visual:** three greyed file cards ("Risks_ISO27001_v7.xlsx", "Risks_9001_FINAL.xlsx", "NIS2 risks (copy).xlsx")
  joining into one "Risk register" card with the "Used by" chip.
- **Desktop:** text left, visual right. **390 px:** stacked.
- **Feel and do:** "That is exactly us." No button; read on.

### 3.5 How it works in 3 steps

- **Job:** remove the fear of a set-up project. This is the real flow today.
- **Copy:**
  - Eyebrow: **How it works**
  - H2: **Your first register in one sitting**
  - 1. **Create your workspace.** Sign up with your email, then add your name and your organisation's name.
  - 2. **Open Create and pick your standard.** It installs as ordinary sheets with example items and a setup checklist.
    Nothing is created until you press Create.
  - 3. **Add your first item and invite your team.** Replace an example with your own. The invite arrives by email;
    everything else happens in the app.
  - Under the steps: **Your setup checklist takes it from there, one step at a time.** CTA **Create your workspace**
- **Visual:** a UI card per step: (1) sign-up with one email field; (2) Create's preview for ISO/IEC 27001 with the
  sheets it adds and a dark "Create" button; (3) Home's "Next step: ISO/IEC 27001" card, "Step 1 of 4 · Define the
  scope", and "Reminders are in test mode. Review and turn them on."
- **Desktop:** three columns. **390 px:** a vertical list, each step followed by its card.
- **Feel and do:** "This is not a project." Press Create your workspace.

### 3.6 The six values

- **Job:** the reasons to choose Keptrow, each with something to see.
- **Copy:** eyebrow **Why teams switch**; H2 **The freedom of a spreadsheet. The proof an auditor asks for.**; six
  blocks, headline and line, as in the table in section 2.
- **Visual:** each card shows its proof point (section 2) as a small UI fragment; the field picker opens on "Risk
  matrix".
- **Desktop:** 3 by 2 grid of bordered cards. **390 px:** one column.
- **Feel and do:** "Familiar, but safer." Read on.

### 3.7 Start from your standard

- **Job:** turn interest into a specific start.
- **Copy:** eyebrow **Start from your standard**; H2 **Which standard are you working on?**; body **Pick one. It
  installs as sheets you can change, with example items and a guided setup.** Seven cards:
  - **ISO/IEC 27001:2022.** Scope and risk treatment · the 93 Annex A controls as a library · a statement of
    applicability built from it. First step "Define the scope". **Start with ISO 27001**
  - **ISO 9001:2026.** Processes and complaints · CAPA that closes after the effectiveness check · calibration cycles.
    First step "Decide what applies". **Start with ISO 9001**
  - **ISO 14001:2026.** Aspects rated for significance · obligations in the legal register · monitoring. First step
    "Decide what applies". **Start with ISO 14001**
  - **ISO 45001:2018.** Hazards with the people who do the work · injuries and near misses · consultation and drills.
    First step "Decide what applies". **Start with ISO 45001**
  - **GDPR.** Records of processing · requests with a deadline · breaches with the 72-hour clock. First step "Record
    your processing". **Start with GDPR**
  - **NIS2.** A scope check per entity · the Art. 21 measures as controls · incident reports with their deadlines.
    First step "Check each entity is in scope". **Start with NIS2**
  - **For consultants.** The same registers in every client workspace · tailor each one · take our updates and keep
    their changes. **Set up your first client workspace**
  - Under the grid: **Something else? Start blank or from a CSV.** Small print: **Requirement libraries describe each
    requirement in our own words and never include the text of the standards.**
- **Visual:** text cards with an edition chip and the first step. The consultants card has a light grey fill.
- **Desktop:** three columns of six, the consultants card full width below. **390 px:** one column.
- **Feel and do:** "They have mine." Press the card. Until the deep link is built, every card opens sign-up.

### 3.8 Your own requirements and your own packages (coming soon)

- **Job:** show where the product is going without claiming it is here.
- **Copy:**
  - Chip: **Coming soon**
  - H2: **Your own requirements and your own setup**
  - Body: **Our standards or your own requirements, in one set of registers. Save your setup and reuse it in every
    workspace.**
  - **Your own requirements** · chip **Being built now**. Supporting line plus the two claim lines from section 2.
  - **Save your setup** · chip **Next**. Supporting line plus the two claim lines from section 2.
  - Small print: **Not available yet. We will say here when each one is live.**
  - Link: **Tell us what you need** (mailto support@keptrow.com)
- **Visual:** a subtle grey band with a dashed outline around each block, so it reads as not yet built. No product UI
  cards here.
- **Desktop:** H2 and body left, two blocks right. **390 px:** stacked.
- **Feel and do:** "They are honest, and it grows with us." No sign-up button in this band.

### 3.9 Proof: verifiable log, auditor access, audit pack

- **Job:** show the outcome: a calm audit.
- **Copy:**
  - Eyebrow: **Audit day**
  - H2: **Hand over links, not a folder**
  - Body: **Give your auditor read-only access that ends by itself, the statement of applicability, and an audit pack
    whose log they can check without our software.**
  - **An activity log you can verify.** Each entry carries a fingerprint of itself and the one before. Change one and
    the chain no longer adds up.
  - **Auditor access with an end date.** Read-only, and it ends on the date you set.
  - **The audit pack.** One zip: every register as CSV, the SoA, an evidence index with SHA-256 fingerprints and the
    log.
  - CTA: **Create your workspace**
- **Visual:** three cards. (1) Verify result for R-014: "✓ Audit trail intact. 12 entries". (2) SoA table: Ref, Title
  (official short title only), Applies, Justification, Status, e.g. "A.5.1 · Policies for information security · Yes
  · Required by contract · ✓ Implemented". (3) Audit pack file list: risk-register.csv, soa.csv, evidence-index.csv,
  activity-log.csv, method.txt.
- **Desktop:** three cards in a row. **390 px:** stacked; the SoA shows Ref, Applies and Status.
- **Feel and do:** "I will look prepared."

### 3.10 Trust and security

- **Job:** pass the first vendor check before the trial.
- **Copy:**
  - Eyebrow: **Trust**
  - H2: **Hosted in Frankfurt. Two-step sign-in. No third-party trackers.**
  - **Hosted in the EU.** The app and database are in Frankfurt.
  - **Two-step sign-in.** Use an authenticator app, and require it for everyone.
  - **Row level security.** Every table is protected; restricted fields show "Restricted" to everyone else.
  - **No third-party analytics or trackers.** Fonts come from our own domain.
  - Line: **Erase personal data without breaking your audit trail. Built to WCAG 2.1 AA as a target, with automated
    accessibility checks.**
  - Link: **Read about security** (/platform#security)
- **Visual:** four plain cards with line icons. **Desktop:** four columns. **390 px:** two by two.
- **Feel and do:** "It passes my vendor check."

### 3.11 FAQ and objections

- **Job:** answer the question that stops the click, next to the button.
- **Copy:** H2 **Questions before you start**. The first answer is open by default.
  - **What does it cost?** Nothing while in early access, and no card is needed. Paid plans will come with [notice
    period] notice, and we will publish them first.
  - **What does our auditor see?** Only what you give them: read-only access until a date you set, the SoA, the
    evidence index and a log they can verify. Whether they accept it is their decision.
  - **Can we get our data out?** Every register exports as CSV in the audit pack, with the log and evidence index. A
    one-click export of a single sheet is not built yet.
  - **We use Excel.** Keptrow works like it. Paste straight in or import a CSV. You gain one copy instead of many, and
    a record of every change.
  - **We only have one standard.** Start with it. Add the next later, on the same registers.
  - **Do you cover SOC 2?** No. If SOC 2 is your main goal, a SOC 2 tool is the better fit.
  - **How long does it take to start?** A workspace takes a few minutes. A standard installs in one step; its
    checklist has 4 to 8 steps that move as fast as your decisions.
  - Under the list: **Create your workspace** · Free while in early access. No card needed.
- **Visual:** a plain accordion. **Desktop:** H2 left, list right. **390 px:** one column.
- **Feel and do:** "No catch." Press Create your workspace.

### 3.12 Final CTA

- **Job:** the last, low-risk push.
- **Copy:** H2 **Start with one standard**; body **Add the next on the same registers when you are ready.**; buttons
  **Create your workspace** (dark) and **Talk to us** (outlined, mailto support@keptrow.com); small print **Free while
  in early access. No card needed.**
- **Visual:** Home's "Next step" card, a faint blue glow behind it. **Desktop:** text left, card right. **390 px:**
  stacked.
- **Feel and do:** "Low risk to try." Press Create your workspace.

### 3.13 Footer

- **Job:** close with the facts and legal links.
- **Copy:** **Keptrow** · Keptrow — the compliance spreadsheet. Links: Platform · Standards · Privacy · Terms ·
  support@keptrow.com. Facts: **Hosted in Frankfurt, EU. No third-party analytics or trackers.** Small print:
  **Requirement libraries are in our own words; buy the standard for the requirements. Keptrow is not affiliated with
  ISO or IEC. Certification bodies certify; we do not.** © 2026 [Company legal name] (the legal entity is still a
  placeholder, as in `legal.ts`).
- **Visual:** plain text on subtle grey. **Desktop:** brand left, links right. **390 px:** one column.
- **Feel and do:** "A real company."

## 4. Microcopy

| Where | Copy |
|---|---|
| Header | Platform · Standards · How it works · Questions · Sign in · Create workspace |
| Menu button (390 px) | Menu (accessible name "Open menu") |
| Hero | Create your workspace · See how it works |
| Under every primary CTA | Free while in early access. No card needed. |
| UI card label | Example workspace |
| Standard cards | Start with ISO 27001 (and ISO 9001, ISO 14001, ISO 45001, GDPR, NIS2) |
| Consultant card | Set up your first client workspace |
| Under the standards | Something else? Start blank or from a CSV. |
| Coming soon band | Coming soon · Being built now · Next · Tell us what you need |
| Trust link | Read about security |
| Final CTA | Create your workspace · Talk to us |
| Pricing line | Paid plans will come with [notice period] notice. |

Buttons say what happens: "Create your workspace", never "Get started" or "Sign up now".

## 5. Claims guardrails

**Say:** the promise, the free line and the analytics line as written · "Hosted in Frankfurt, EU" · "an activity log
you can verify", "tamper-evident", "a changed entry shows" · "helps you prepare for certification" · product numbers
only: 58 field types, six standards plus supplier management, 4 to 8 setup steps, 93 Annex A controls.

**Do not say:**

- "Tamper-proof", "immutable", "blockchain".
- "SOC 2 support", "supports any framework", "mapped automatically", or any AI claim.
- "Marketplace", "synced", "live sync", "share with anyone", "white-label", "multi-client overview".
- "Free forever", "free trial", any price or plan name, or a notice period before it is decided.
- "ISO certified", "GDPR certified", "compliant out of the box", "guarantees certification", "audit-ready in N days".
- "No trackers" or "no analytics" without "third-party".
- SSO, an API, email reminders or one-click sheet export as available.
- Customer names, logos, testimonials, user counts, time or money saved. None exist yet.
- "Unlimited", uptime or speed figures, sub-processor names.

**Coming soon:** own requirements and saved setups appear only in the labelled band (3.8).

**Standards:** number and edition ("ISO/IEC 27001:2022"). Never quote or closely paraphrase ISO text; reference
numbers and official short titles only. Never use the ISO or IEC logo.

## 6. Design tokens in words

The product uses the Geist design system. Reuse these roles; do not invent colours.

**Colour roles.**

- **Ink:** near-black, for headings, body text and icons.
- **Muted:** mid grey for secondary text, at least 4.5:1 on white.
- **Faint:** light grey for dividers and icons, never body text.
- **Line:** translucent grey for 1 px borders of cards, tables and controls.
- **Subtle:** off-white for the footer, table headers and the coming-soon band.
- **Brand dark:** the same near-black, for primary buttons with white text; hover lightens slightly.
- **Blue glow:** a very pale blue radial wash at the top of the page and behind a few key cards. Never saturated.
- **Focus:** a clear mid blue for focus rings and the selected cell.
- **Status green, amber, red:** dark text on a pale fill of the same hue, always with a word and a symbol: "✓ Done",
  "● Medium", "▲ High" or "Overdue".

**Type roles** (Geist; Geist Mono for references and numbers in tables):

- **Display** (hero H1): about 64 to 72 px desktop, 40 px mobile, semibold, tight tracking.
- **Section heading** (H2): 40 to 48 px desktop, 32 px mobile. **Card heading:** 20 to 24 px.
- **Lead:** 18 to 20 px, muted. **Body:** 16 px. **Label:** 12 to 14 px for eyebrows, chips and small print.
- **UI cards** keep the app's own sizes (13 to 14 px).

**Shape and depth.** Radius 6 px on buttons and inputs, 12 px on cards, 24 px on large panels. Shadows soft and low:
a hairline plus a wide faint blur; slightly deeper on the hero visual. An 8 px spacing grid.

**Accessibility.** Target WCAG 2.1 AA (text 4.5:1, large text and UI parts 3:1). Touch targets at least 44 by 44 px.
Visible focus and labelled icon buttons. Colour is never the only signal. Reduced motion: no parallax or autoplay,
fades only, none when reduced motion is set. No sideways page scroll or layout shift at 390 px. One H1, alt text on
every UI card.

## 7. What not to do

- No fake logos: no "Trusted by" rows, no ISO, IEC or certification body logos.
- No fake stats; only the product numbers in section 5.
- No stock photos of people. The product is the picture.
- No dot or grid backgrounds, no busy gradients.
- No exclamation marks.
- No jargon in headlines: "GRC", "single source of truth", "hash-chained", "SoA", "CAPA".
- No marketing adjectives: powerful, seamless, robust, effortless.
- No countdowns or pre-ticked boxes.
- Nothing coming soon shown as live, and no real customer data.
