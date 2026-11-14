# 06 · Build plan

Eleven milestones. Each is one branch, one PR, one Claude Code session. Start each session with `/milestone` (or paste the milestone's prompt). Tick a box only when it is true in the running app **and** covered by a test where the box says so. The suggested model is in brackets.

Global gate for every milestone: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` green in CI, Vercel preview deploys, no console errors.

---

## M0 · Repository and tooling  [Sonnet]

**Prompt:** "Read CLAUDE.md. Set up the repository for M0 in docs/06-build-plan.md: Next.js 15 app with TypeScript strict, Tailwind v4, shadcn/ui, self-hosted fonts, Supabase CLI config, Vitest, Playwright, ESLint/Prettier, GitHub Actions CI, the scripts listed in CLAUDE.md, and the folder layout. No product features yet."

- [x] `pnpm create next-app` with App Router, `src/`, TypeScript strict (`noUncheckedIndexedAccess: true`)
- [x] Tailwind v4 + shadcn/ui initialised; tokens from docs/05 §6 in `globals.css`; fonts via `next/font/local` from `src/fonts/` (Geist and Geist Mono woff2 from the `@fontsource/geist` and `@fontsource/geist-mono` packages (the versions Google Fonts serves), `pnpm fonts:copy`)
- [x] Supabase CLI (`supabase init`), migrations folder contains `0001_core.sql`, `0002_storage_realtime.sql`; `pnpm supabase:start && pnpm db:reset` works
- [x] Vitest with one passing test; Playwright with one smoke test (home page renders)
- [x] GitHub Actions: install, lint, typecheck, unit, start Supabase, e2e
- [x] Vercel project linked, region `fra1`, env vars from `.env.example`
- [x] Folder layout from CLAUDE.md created with README stubs in `src/engine` and `src/server`

## M1 · Schema, auth, tenancy, seed  [Opus]

**Prompt:** "Implement M1: apply the migrations, generate types, magic-link auth, onboarding (create workspace / accept invite), workspace settings (members, teams, job roles, entities and sites), the seed script, and pgTAP RLS tests."

- [x] Migrations apply cleanly on local Supabase and on the EU project
- [x] `pnpm db:types` generates `src/lib/database.types.ts`
- [x] Magic link sign-in; profile created on first sign-in (display name, initials, colour)
- [x] Onboarding: create workspace (name → slug) makes the user owner; invite by email (token link) adds a member with the chosen role
- [x] Settings page: members (invite, change role, remove; cannot remove the last owner), teams + team members, job roles, entities + sites
- [x] `scripts/seed.ts` creates the seed from docs/02 §11 (people from `templates/first-sheet.json`, workspace, teams, roles, entity, sites, folder) — sheets come in M10
- [x] pgTAP tests in `supabase/tests/`: viewer cannot call `set_item_values`; editor cannot update a locked field; member of org A cannot select org B rows; protected value hidden from an editor not in `allowedUserIds`; `activity_log` update fails
- [x] Workspace switcher in the top bar lists the user's workspaces

## M2 · Engine core (pure TypeScript)  [Opus]

**Prompt:** "Implement M2: the pure engine in src/engine — domain types, the field type registry with all 57 types per docs/03, value projections, the condition operators per kind, and the formula parser. 100 % of the logic unit-tested; no React or Supabase imports in src/engine."

- [x] `src/engine/types.ts`: Sheet, Field, Group, Item, Person, Ctx, Issue, Automation types
- [x] Registry with exactly the 57 ids (test compares to the SQL list)
- [x] Each type: valueSchema, configSchema + defaults, normalize, parseText, validate, isEmpty, isDone, toText, toNumber, toDate, compare, compute (computed types) — tests per docs/03 §9
- [x] Generic validation: required, min/max, pattern, unique hook, status rules, justification, visibility
- [x] Conditions: every operator in docs/03 §4 with tests, including `overdue`, `at_least`, `includes_me`, `expires_within`
- [x] Formula: tokenizer, parser, evaluator, functions, errors `#REF #LOOP #ERR #DIV0`; 40+ test cases; no `eval`
- [x] Ordering helpers wrap `fractional-indexing`; key generator for fields; id-prefix suggestion

## M3 · App shell and sheets  [Sonnet]

**Prompt:** "Implement M3: the app shell from docs/05 §2 (rail with codes, sections, hover expand and pin; second panel; top bar), routes from docs/05 §1, folders, the new sheet wizard (all starts incl. CSV import and copy), sheet settings, groups CRUD."

- [x] Rail: top block (Home, My work + badge), folders with sheet codes (unique, no punctuation), bottom block (Automations, Settings, Keep menu open); hover expand 236 px; pin remembered
- [x] Second panel per page as specified; collapsible
- [x] Top bar: workspace switcher, search box (wired in M9), inbox button (wired in M9), avatar menu
- [x] Wizard: Blank, Register, Tracker, Log, Inspection from `templates/starts.json`; columns editable; prefix and keys per the rules in `starts.json`
- [x] Import CSV: parse (Papaparse), type detection per `starts.json`, confirm table, creates fields + items through commands; 10 000 rows < 20 s locally
- [x] Copy a sheet: fields, groups, views, automations (re-keyed to the new field ids), no items
- [x] Sheet settings: name, description, item label, prefix (locked once items exist), folder, library flag, archive
- [x] Groups: add, rename, recolour, reorder, collapse, delete when empty / move items first
- [x] Phone (< 760 px): bottom bar + menu sheet per docs/05 §5

## M4 · Grid view and commands  [Opus for commands, Sonnet for cells]

**Prompt:** "Implement M4: the command layer (createItem, setValues, moveItem, archive, setLinks) per docs/02 §4 with optimistic TanStack Query mutations and realtime, then the Grid view per docs/05 §3.2 with a Cell and an Editor for every field type and column management."

- [x] Commands in `src/server/commands/` with Zod input, role check, registry validation, RPC call, returned messages; automations hook stubbed (no-op) until M7
- [x] Optimistic updates with rollback + error toast; realtime patching; own echoes ignored
- [x] Grid: groups blocks, sticky name column, per-group summaries (docs/03 §8), "+ Add item" with Enter-to-continue, virtualised rows and columns (10 000 × 30 smooth)
- [x] Cells + editors for all 57 types (computed types read-only with an explanation popover); evidence/attachment editors open the file dialog (upload wired in M5)
- [x] Keyboard: arrows, Enter/F2, Esc, Tab/Shift+Tab, Space for check, Delete clears, Cmd/Ctrl+C/V TSV (paste uses `parseText`, shows "8 cells pasted, 1 skipped: not a date")
- [x] Column header menu, add field popover (12 essentials + search + all types), field settings sheet incl. rules and visibility, resize, reorder, hide, duplicate, delete (soft), type change with preview (docs/03 §5)
- [x] Multi-select rows: bulk set field, move, archive (with Undo)
- [x] Drag to reorder items and move across groups (dnd-kit)
- [x] Status rule blocks show the message; comment-on-value opens the comment box
- [x] Locked items/fields behave per docs/01 §4

## M5 · Item panel, files, links, activity  [Sonnet]

**Prompt:** "Implement M5: the item panel per docs/05 §3.4 (Details with summary, linked items both ways, all fields; Updates with mentions; Activity log with Verify), file upload with SHA-256 per docs/02 §8, two-way links, lookup and rollup."

- [x] Panel opens from name click, `?item=` in URL, J/K navigation, Expand, Copy link, Esc
- [x] Details summary strip, linked items (outgoing + incoming), all fields editable respecting visibility; "Automations on this item" placeholder (wired in M8)
- [x] Updates: post, @mention people and job roles → notifications; edit/delete own update within 15 min (logged)
- [x] Activity log: readable lines for every action type; Verify calls `verify_activity_chain`
- [x] Files: prepare/confirm upload, hash check server-side, versions (replace keeps old), evidence freshness, download via signed URL; `log_file_event` RPC migration
- [x] Two-way link fields: wizard creates the inverse field; editing either side updates both; link picker searches the target sheet
- [x] Lookup and rollup compute from linked items (cached items of other sheets loaded on demand)

## M6 · List, Kanban, Calendar, Form, filters, views  [Sonnet]

**Prompt:** "Implement M6: List view (default) per docs/05 §3.1 incl. phone cards, Kanban, Calendar, Form view with public links, filters/sort/search, and saved views."

- [x] List view exactly as specified: 360 px name column, status first, editable cells, "+" column, locks, More columns fade, pagination, dismissible hint
- [x] Phone: cards per docs/05 §5
- [x] Kanban with drag (runs rules), lane choice per view
- [x] Calendar by any calendar-capable field; click a day to add
- [x] Form builder + `/f/[token]` public form (rate limit 10/min/IP, honeypot field), internal form; submit → `submit_form` → automations (M7)
- [x] Filters UI (conditions builder using the registry's operators), multi-sort, sheet search; server-side filtering for sheets > 2 000 items
- [x] Views: create, rename, duplicate, delete, personal vs shared, default view per sheet; URL `?view=`

## M7 · Automation runner  [Opus]

**Prompt:** "Implement M7: the automation engine per docs/04 §1–§7 — pure trigger matching, conditions and action planning in src/engine/automations, the server runner with depth, once-per-chain, time budget, run log, notifications and automation posts. Wire it into every command, buttons and forms."

- [x] Pure: `matchTrigger` for all 11 triggers (number triggers on computed fields compute before/after), `checkConditions`, `planActions` for all 11 actions, `renderTemplate`; unit tests per trigger and action
- [x] Runner: event loop, depth ≤ 3 with `stopped` run, once-per-chain, 5 s budget, isolation per effect, outcomes per step, `automation_runs` rows, counters
- [x] Effects: set_field via `set_item_values(p_automation)`, notify/request (notifications + automation post), create_item (+ link + owner copy), update_linked (out/in), move_to_group, assign, lock_item, post_update, webhook (queue row), raise_version
- [x] Buttons call the runner; spinner; toast lists steps
- [x] Forms run `form_submitted` automations (service role, scoped)
- [x] Every acceptance test in docs/04 §12 that does not need the scheduler or webhooks passes

## M8 · Automation builder and pages  [Sonnet]

**Prompt:** "Implement M8: the Automations page and the builder per docs/04 §10, recipes from templates/automation-recipes.json, the run log, and per-item automations with pause in the item panel."

- [x] Automations page (all sheets / per sheet): list with toggles, runs, last run, source; delete; duplicate
- [x] Builder: When / if / then sentence, compatible pickers from the registry, value editors per field type, template autocomplete, self-trigger guard, auto name
- [x] "Test on an item" shows match, conditions and planned steps without writing
- [x] Recipes: pick → map roles to fields → save
- [x] Run log tab with filters and expandable steps; link to the item
- [x] ⚡ button on the sheet header opens this sheet's automations in a side sheet
- [x] Item panel: automations on this item with pause toggles (`automation_pauses`)

## M9 · Scheduler, webhooks, notifications, My work, search  [Opus]

**Prompt:** "Implement M9: the scheduler and webhook worker per docs/04 §8–§9 with Vercel Cron, the inbox, My work, Home, and global search."

- [x] `/api/cron/scheduler` (secret) fires date/clock/evidence triggers exactly once per occurrence; "Run date checks now" for admins
- [x] `/api/cron/webhooks` with backoff, dead letter, SSRF guard, creator notification
- [x] `vercel.json` cron entries
- [x] Inbox popover with unread count, mark read, open item; realtime
- [x] Requests marked done when the requested person next changes the item
- [x] My work page per docs/05 §4 with filters in the second panel; rail badge
- [x] Home per docs/05 §4 (all numbers computed from data)
- [x] Global search (`/`): sheets, items by id/name, items by person; keyboard

## M10 · First sheet, hardening, acceptance  [Opus]

**Prompt:** "Implement M10: the template importer for templates/first-sheet.json, then run the end-to-end acceptance in docs/07-first-sheet.md, fix what fails, and complete the hardening list."

- [x] Zod schema for templates; importer per the `importer` notes in the template (commands with automations and rules off, actor `system`)
- [x] `pnpm seed` loads people, workspace and both sheets with items, links and the 9 automations
- [x] Playwright suite `tests/e2e/first-sheet.spec.ts` implements every step of docs/07 and passes
- [ ] Performance: 10 000-item sheet generated by a script scrolls smoothly; cell edit round-trip < 500 ms p95 against the EU project
  - Scroll: done (`scripts/perf/generate-sheet.ts` and `tests/e2e/perf.spec.ts`: p95 frame 17–33 ms, at most 50 ms after the full suite, no long tasks; production build, headless Chromium). Round trip: `pnpm perf:roundtrip`, local p95 464 ms visible to another person (command alone p95 97 ms); this box stays open until it is run against the EU project
- [x] Accessibility: axe checks on Home, Sheet (List, Grid), Item panel, Automation builder with zero serious issues; full keyboard pass recorded
- [x] Security review: every command has Zod + role checks; RLS tests green; no service-role key in client bundles (`grep` in CI); public form rate-limited
- [x] Error, empty, loading and offline states on every page (docs/05 §7)

## Sub-items  [Opus]

One level of sub-items per item on a hidden child sheet (docs/02 §12): own fields, IDs (`CA-014.2`, frozen on move), activity log and automations.

- [x] Migration 0020: `sheets.parent_sheet_id`, `items.parent_id / sub_seq / next_sub_seq / archived_with`, guards (one level, right parent), `create_subitem(s)`, `move_subitem`, archive cascade, the close gate and lock cascade in `set_item_values`; grants; pgTAP `0015_subitems.sql`
- [x] Field type `subitems` (58), roll-ups `worst`, `earliest`, `countExpired`; triggers `subitem_created`, `subitem_field_becomes`, `all_subitems_done` (projected at the same depth); actions `create_subitems`, `set_parent_field`, `update_subitems`; recipes
- [x] Table: chevron and "3/5" chip, sub-header, indented rows, inline edit, "+ Add", From template, Move, Archive, keyboard (→ ← ↓, Shift+Enter, Ctrl+Shift+E), search opens parents; item panel tab and breadcrumb; phone cards; Kanban chip; My work context
- [x] Sheet settings: turn on, label, rules, template, the sub-items' fields; wizard starts CAPA, Internal audit, Incident, Control, Risk treatment; `first-sheet.json` Corrective actions with Steps
- [ ] Lazy loading per expanded parent for sheets with more than 2 000 sub-items (all load with the sheet today); Insights "Items / Sub-items" scope; quick filters (status, owner) matching sub-items

## Packs and apps (approved by Tor, advisory board review 13 Nov 2026)

Packs are installable bundles of the core as DATA (CLAUDE.md): folders, sheets, fields by key, links, sub-items, views, forms, tab sets, column groups, automations and recipes, dashboards, documents and library items. Apps are packs with a front door (navigation + screens over existing views), never custom code. Board decisions: never ship ISO/IEC clause text (IDs + own paraphrased titles only; EU law text is fine; counsel to confirm); decide retention before the GDPR pack.

### P1 · Pack framework  [Opus]
- [x] Migration: `packs` (key, version, manifest, hash) and `pack_installs` (org, pack key, version, status, installed by, manifest hash); provenance `pack_install_id` + `pack_ref` + `pack_hash` on folders, sheets, fields, groups, views, automations, dashboards (and items seeded by a pack); unique `(org_id, pack_install_id, pack_ref)`
- [x] Manifest schema (Zod, `src/lib/packs/manifest.ts`) extending the sheet template schema: key, semver version, `requires`, folders by ref, sheets, link fields by `sheetRef`, dashboards with `sheetRef`/`fieldKey`, documents, library items with stable refs (not names), id prefixes with collision renaming
- [x] Pure install planner (`src/engine/packs/plan.ts`): manifest + workspace snapshot → operations (create / skip / conflict), reusing the template planner; preview text
- [x] One transactional RPC `install_pack` (owners/admins; grant to authenticated) writing every row and a `pack.installed` log entry; commands `previewPack`, `installPack`, `archivePack` (uninstall archives, never deletes items or the log)
- [x] The template importer moved onto the pack path; the first-sheet template and one start shipped as packs
- [x] Workspace admin → Packs: available packs, preview (what will be created), install with progress, installed packs with version and Archive; audit entries readable
- [x] Tests: planner and manifest units; pgTAP for the RPC (atomic, admin-only, provenance, grants); e2e install → preview → install → archive

### P2 · Access control  [Opus]
- [x] Per-folder and per-sheet roles (owner / editor / commenter / viewer / no access) enforced in RLS, covering links, roll-ups, lookups, search, dashboards, Insights, exports and notifications; field-level hide for sensitive columns; a `restricted` flag packs can set; an auditor read-only role
- [x] Migrations 0025–0029: `auditor` role and `memberships.expires_at` (is_member/has_role end access at the date); `access_grants`, `folders.restricted`, `sheets.restricted/access_inherit`; one resolution `_sheet_levels` (owner always; open by role; restricted by grant capped by role; sheets follow their folder unless they have their own setting; sub-item sheets follow the parent) used by every RLS policy, guard triggers on the tables definer functions write, and a notifications guard (docs/02 §16)
- [x] Restricted fields: values in `restricted_values`, the log masked with a salted digest and the values in `restricted_activity` (chain verifies both), links and files of the field hidden, public forms never show or accept them; owners and admins with access set them, every change logged
- [x] Access panel for folders and sheets (side menu "…" › Access, the sheet's Access button, Sheet settings › Access) with levels and the access log; locks in the menu; admins without access see a restricted sheet's name only; owners opening a restricted sheet they are not listed on are logged once a day
- [x] "Restricted" in cells, cards, the panel, lookups, roll-ups, formulas, summaries, Insights and dashboards ("No access" for sheets that cannot be read), search and My work, automation messages, posts, notifications and webhook payloads, stored run events and the activity log
- [x] Auditor role in Workspace admin and invites with an end date (required), a read-only banner, read-only everywhere; access ends at the date without a job
- [x] Packs: `restricted` on manifest folders and sheets, the installer listed as an editor
- [x] Tests: pgTAP 0020 role × object matrix (110), unit tests for resolution, restricted fields, templating, lookups and the log (`src/engine/access.test.ts`), e2e `tests/e2e/access.spec.ts`; security inventory in docs/09 §7; 10 000-item read faster than before (docs/09 §7.4)

### P3 · Requirement library and cross-walks  [Opus]
- [x] Migration 0030: global `frameworks` (key, version, revision, kind, source, licence, `titles = own-words`, library pack), `requirements` (ref, parent, kind, position, own-words title ≤ 80, guidance, tags) and `crosswalks` (equivalent / partial / related, note, source), read-only to people (RLS read, no write grants) and append-only for everyone; `items.requirement_ref` written once by `adopt_framework`, never changed, the item's Ref locked too (docs/02 §17)
- [x] Catalogue as data (`templates/frameworks/*.json`, Zod at load), no ISO/IEC text: ISO/IEC 27001:2022 clauses 4–10 and all 93 Annex A controls (37/8/14/34), ISO 9001:2015 and :2026, 14001:2015 and :2026, 45001:2018, GDPR and NIS2 (Art. 20, 21(2)(a)–(j), 23 reporting); Klarert mapping v1 cross-walks (harmonised clauses, Annex A ↔ NIS2 21(2), GDPR 32/33/34/35 ↔ 27001); the seed writes them, `scripts/frameworks-sql.ts` for hosted projects (docs/12)
- [x] Adopt (owners and admins) through the pack install path: each framework's library is a generated pack (`frameworkToPack`), `adopt_framework` = `install_pack` + requirement keys + `framework.adopted` in one transaction; optional controls sheet linked both ways; library sheets follow sheet access
- [x] Library sheet: groups by theme, Ref on the name's subline, Applicable, Justification (required when not applicable), Implementation status, Owner, Evidence, Last reviewed, Controls; licence note in the description; SoA saved view and an "Applicability" Insights layout seeded from the framework's data
- [x] Requirement and control link fields may link to any library sheet; a control shows "Covers" across frameworks and "Suggested equivalents" with a one-click Link; a requirement shows its controls and "Also satisfies"; coverage per framework (Workspace admin › Frameworks)
- [x] Pure engine with tests: requirement keys, cross-walk expansion and index, also satisfies, suggestions, coverage, the library roll-up, the library pack, catalogue integrity (`src/lib/frameworks/catalogue.test.ts`)
- [x] Tests: pgTAP 0021 (catalogue read-only and append-only, adopt admin-only, atomic, provenance, requirement and Ref locked, links to libraries, sheet access); e2e `tests/e2e/frameworks.spec.ts` (adopt 27001 and 9001, applicability and justification, a linked control, coverage, Also satisfies, the SoA view, a suggested equivalent mirrored both ways, editors refused, 390 px)

### P4 · First pack: ISO 27001:2022  [Opus + Sonnet]
- [x] Scope, risk register and treatment, Annex A library (93 controls, IDs + own titles), SoA, document set, evidence, internal audit, CAPA, management review; Starter and Full levels; guided setup and an 8-step checklist (1.1.0)
- [x] Manifest `levels` (lowest level per folder, sheet, form, automation, dashboard), `frameworks` (adopted at install when missing), `setup` and widgets on a required library (`library`); migration 0032 `pack_installs.level` and `install_pack` adding a higher level to the live install (`pack.extended`); `scripts/packs-sql.ts` for hosted catalogues
- [x] Install dialog with the level choice and what each level creates; "Add Full" on an installed pack; the setup checklist on Workspace admin › Packs and a dismissible card on Home, progress from `setupProgress`
- [x] Tests: manifest levels and the pack (`src/lib/packs/iso-27001.test.ts`), `setupProgress` (`src/engine/packs/setup.test.ts`), pgTAP 0022 (levels, extending an install), e2e `tests/e2e/iso-27001.spec.ts` (Starter with adoption, checklist, Home card, Full on top)
- [x] 1.1.0: pack automations on sub-items (`subitems: true`, the CAPA actions' overdue reminder); the internal form "Report a security incident" (Full) opened from the setup checklist; example risks and treatments linked to Annex A by requirement key (`requirements`), resolved at install; migration 0033 (`install_pack` links into a library); pgTAP 0023

### P5 · Audit outputs  [Opus]
- [x] SoA export; audit pack (PDF/zip: SoA, registers, evidence index, log extract with chain verification); management review inputs compiled from existing data (docs/11 Audit outputs; 0034)

### P6 · Pack upgrades  [Opus]
- [x] Three-way diff (shipped hash, client's current, new manifest): apply untouched, flag conflicts, archive removed, fields add-only, keep client options and automation on/off; dry run and rollback

### P7 · Apps  [Sonnet]
- [x] App manifest (navigation sections → screens: view / form / dashboard / workflow / item over sheet refs; role visibility); `/[org]/apps/[key]/[screen]`; first app: CAPA ("Report a problem", "My actions", "Needs my approval") — docs/13; CAPA app in start-capa 1.1.0 (templates/apps/capa.json) and ISMS CAPA in iso-27001 1.2.0; e2e `tests/e2e/apps.spec.ts`

### ISO 9001 pack  [Opus]
- [x] `iso-9001` 1.0.0 on the 9001:2015 library (1.1.0 on 9001:2026, see Edition currency): Starter (context, policy and objectives, processes, risks and opportunities, quality documents, nonconformities with sub-item actions, customer feedback and complaints) and Full (external providers, competence, measuring equipment, internal audits and findings, management review, design and development, release); 8 automations, internal forms "Report a complaint" and "Report a nonconformity", "QMS overview" dashboard, 8-step setup, example items linked to clauses; management review inputs mapped (docs/11)
- [x] Tests: `src/lib/packs/iso-9001.test.ts`; e2e `tests/e2e/iso-9001.spec.ts` (Starter with adoption, a complaint raising a linked nonconformity, the form from the checklist, the dashboard, Full on top)

### Edition currency  [Opus]
Owner finding (14 Nov 2026): ISO 14001:2015 was withdrawn and the catalogue did not say so.
- [x] Edition status as catalogue data: `status` (current, withdrawn, superseded-in-transition, revision-in-progress), `supersededBy`, `transitionEnds`, `revisionStage`, `revisionExpected`, `statusNote`, `statusCheckedOn`; left out of the content hash, written in place by the seed; migration 0037 columns (docs/12 Edition status)
- [x] ISO 14001:2026 and ISO 9001:2026 as new versions (own pack keys and prefixes, side by side with 2015); 2015 editions withdrawn with transition ends, 45001 revision at DIS, 27001 (Amd 1:2024), GDPR and NIS2 current; 2015 → 2026 edition mapping and cross-walks to the other standards (Klarert mapping v1, additions)
- [x] Workspace admin › Frameworks: badges on the catalogue and adopted libraries, the status note and check date; adopting a withdrawn edition needs a confirmation and recommends the new one
- [x] Move to the new edition: adopt alongside, then copy answers and control links where the edition mapping is equivalent one to one, a review list for the rest, the old library locked with a link (`planEditionMove`, `move_framework_edition`, 0037)
- [x] ISO 9001 pack 1.1.0 on iso-9001@2026; an update from 1.0.0 keeps the 2015 library and says so
- [x] Standards watch (monthly, docs/12) and a unit test that fails when a status is older than 120 days
- [x] Tests: `src/engine/frameworks/status.test.ts`, `edition.test.ts`, `src/lib/frameworks/catalogue.test.ts`, the upgrade warning in `src/engine/packs/upgrade.test.ts`, pgTAP `0027_framework_editions.sql`, e2e `tests/e2e/framework-editions.spec.ts` (badges, the confirmation, a move)
- [ ] Verify the clause titles listed in docs/reviews (Edition currency) against the purchased ISO 14001:2026 and ISO 9001:2026

### Retention  [Opus]
Owner decision: "rules + review queue".
- [x] Migration 0036: personal-data values masked in the activity log (`personal_activity`, salted markers, erasable without touching the chain), `retention_queue` (dedupe per item, rule and due date), `retention_holds`, `retention_checks`; RPCs `retention_enqueue`, `retention_postpone`, `set_retention_hold`, `retention_execute` (one transaction, tombstone entry), `retention_claim_day` (scheduler); storage delete policy for erased files; pgTAP `0026_retention.sql` (docs/02 §18)
- [x] Fields marked personal data (field setting `config.personalData`); per-sheet rules in Sheet settings › Retention and in pack manifests (`retention`); the daily scheduler check and "Check now"; Workspace admin › Retention (approve, postpone with a reason, legal hold; owners and admins); the activity panel and audit exports show erased and masked values as such
- [x] Tests: `src/engine/retention/retention.test.ts`, pgTAP 0026, e2e `tests/e2e/gdpr.spec.ts`

### GDPR pack  [Opus]
- [x] `gdpr` 1.0.0 on the gdpr@2016 library: Starter (records of processing, data subject requests with the one-month deadline and extensions, personal data breaches with the 72-hour clock, DPIAs, processors and DPAs, transfers, retention schedule) and Full (consent records, DPO and training); 10 automations (request deadline in 7 days and overdue, breach alerts at 24 and 60 hours, high-risk breach, DPIA and DPA review due, form intake, closing date); internal forms "Submit a data subject request" and "Report a personal data breach" without notices (each workspace writes its own); "Privacy overview" dashboard; 8-step setup; examples linked to Art. 5, 6, 7, 12, 15, 17, 19, 25, 28, 30, 33, 34, 35, 37–39, 44–46; retention rules shipped as suggestions (docs/11)
- [x] Management review inputs: customer feedback source (ISO 9001 complaints) and neutral incident wording
- [x] Tests: `src/lib/packs/gdpr.test.ts`; e2e `tests/e2e/gdpr.spec.ts`

### Create wizard  [Opus + Sonnet]
Owner-approved design (advisory board, all seven agreed, 14 Nov 2026). docs/05 §4 Create, docs/11 Bundles.
- [x] One Create button at the top of the side menu (and the phone menu), Ctrl/Cmd+K and the empty states; "New sheet" and "New sheet here" open Create at the Sheet card
- [x] Goal box "What do you need to handle?" with example chips, keyword matching over `templates/intents.json` (Zod-checked; nothing sent anywhere), 3–5 closest matches; cards Solve a problem, Sheet, Entry, Automation, Form, Dashboard
- [x] At most three steps with a stepper; a ready-made set's preview from the same manifest the install plans, with tick boxes (dependencies left out or brought back with a note), public forms and outbound automations flagged and off, who can see it; name, owner, review date, folder, level (Starter by default, Full under More options)
- [x] Migration 0038: `pack_installs` bundle name, owner, review date, origin, reviewed by/at; `create_bundle` (install and stamp in one transaction, `bundle.created` "created via Create from …") and `mark_bundle_reviewed` (the named owner only, `bundle.reviewed`); granted to `authenticated`
- [x] Sheets of a set show "Created by …" and "Generated from template, not yet reviewed" until the owner marks it reviewed; owners and admins archive the whole set (archive_pack); after Create the sheet opens with "Add your first …" and a toast of what was made
- [x] Entry → a sheet (recently used first) and the add-item flow; Automation → a recipe and a sheet in the builder; Form → the sheet's Forms tab with New form; Dashboard → New dashboard
- [x] Incident and Internal audit starts ship as packs too (`start-incident`, `start-audit` 1.0.0)
- [x] Tests: `src/engine/create/match.test.ts`, `src/lib/create/intents.test.ts`, `src/lib/packs/select.test.ts`, pgTAP 0028, e2e `tests/e2e/create-wizard.spec.ts`

### Approval workflows  [Opus]
Owner-approved (14 Nov 2026), moved here from After the MVP. docs/04 §13, docs/02 §19, docs/05 (My work, item panel, Sheet settings), docs/11 (manifests).
- [x] Definitions as data per sheet (`sheets.settings.workflows`): ordered steps with approvers (named people, a people field, a job role, a team; the owner's manager is not modelled), any one / all, an SLA, on reject (back to a step, to draft, close), required fields, a step field, a status set as it moves, lock on approval, the self-approval block (off only when the definition allows it); owners and admins only (trigger)
- [x] Migration 0040: `workflow_instances` (approvers of every step fixed at submit, one in progress per item) and append-only `workflow_decisions`, RLS by the item's sheet; `workflow_submit`, `workflow_decide`, `workflow_withdraw` write the instance, the decision, the item's own changes and the activity log in one transaction; approvers without access or auditors reported at submit; `apply_pack_upgrade` (upgrade_pack plus manifest workflows, one transaction)
- [x] Triggers `workflow_step_decided`, `workflow_approved`, `workflow_rejected`, `approval_overdue` (scheduler, dedupe per instance, round and step); action `start_workflow`; builder pickers; the loop guard applies
- [x] Sheet settings › Approval workflows editor (reachable from the Workflow screen), the item panel's Approval section (state in words and a symbol, submit, approve, reject with a reason, withdraw, timeline), My work › Needs my approval with Approve, Reject and Open; the My work badge counts approvals waiting
- [x] Pack manifests declare `workflows` per sheet (checked, planned, upgraded three ways); `iso-27001` 1.3.0: Document approval on ISMS documents (owner review → top management, status and lock on approval)
- [x] Tests: `src/engine/approvals/approvals.test.ts`, `src/server/approvals/events.test.ts`, the upgrade and ISO 27001 pack tests, pgTAP `0030_approval_workflows.sql`, e2e `tests/e2e/approvals.spec.ts`
- [ ] Reassign an approver mid-flight, delegation while away, working-day SLAs, reminders before the SLA (not asked for yet)

### NIS2 pack (not built yet)
- Owner decision (14 Nov 2026): NIS2 country rules are a pack setting listing all EU/EEA countries with defaults (registration authority, deadlines, extra fields), chosen per workspace.

Later: NIS2, consultant multi-workspace view, private and forked packs, pack signing and marketplace, SSO.

---

## After the MVP (do not start without Tor)

- Readiness scoring, app builder for customers, AI proposals (packs and apps: see "Packs and apps" above)
- SSO (Microsoft Entra ID, Google), email digests, Teams app, public API and webhooks in
