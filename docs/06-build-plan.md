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
- [x] Owner decision (15 Nov 2026): the workspace chain's entries (exports, packs, frameworks, folders, settings) in the audit pack's `activity/log.csv` as rows of the sheet "Workspace", and the workspace chain in the hash-chain check; masked as item entries are
- [x] Owner decision (15 Nov 2026): the Exports list on Audit outputs (owners, admins and auditors; newest first, paged; what, who, when and the filters used); `exportRow` unit tests, pgTAP `0040_audit_exports_read.sql` (no new grant needed), e2e in `audit-outputs.spec.ts`

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
- [x] Owner decision (14 Nov 2026): an **App** card next to Solve a problem lists the apps of the catalogue and of live installs (`appStarts`, `src/engine/create/apps.ts`) with the shortest path to each: open it, create the set that carries it (same preview, `createBundle`, `create_bundle`; Core first when it reads Core's registers, the registers you already have named), or Workspace admin › Packs when its pack is live without it; owners and admins create, others preview; goal matching finds apps as apps (`templates/intents.json`); an add-on app's screens over the Core registers count in the preview (`appNeeds`)
- [x] Owner decision (14 Nov 2026): pack settings in Create's Details step (a section, not a fourth step: docs/05 §4 Create) with the same picker and unverified notice as Packs › Settings; migration 0047 `create_bundle` records `bundle.settings` with `set_pack_settings` in the same transaction; editable later in Packs
- [x] Tests: `src/lib/create/apps.test.ts`, `src/lib/create/intents.test.ts`, `src/lib/packs/select.test.ts`, pgTAP `0037_create_bundle_settings.sql`, e2e `tests/e2e/create-wizard.spec.ts` (App card by keyboard only, NIS2 with Norway then Packs, 390 px)
- [x] Owner decision (15 Nov 2026): CAPA reuses Core's register. `start-capa` 1.2.0 has an optional requirement on Core (docs/11 Optional requirements): in a Core workspace Create › App › CAPA makes no second register and the app works on Nonconformities and CAPA; without Core it keeps its own. Tests `src/lib/packs/capa.test.ts`, e2e `tests/e2e/apps.spec.ts`

### Approval workflows  [Opus]
Owner-approved (14 Nov 2026), moved here from After the MVP. docs/04 §13, docs/02 §19, docs/05 (My work, item panel, Sheet settings), docs/11 (manifests).
- [x] Definitions as data per sheet (`sheets.settings.workflows`): ordered steps with approvers (named people, a people field, a job role, a team; the owner's manager is not modelled), any one / all, an SLA, on reject (back to a step, to draft, close), required fields, a step field, a status set as it moves, lock on approval, the self-approval block (off only when the definition allows it); owners and admins only (trigger)
- [x] Migration 0040: `workflow_instances` (approvers of every step fixed at submit, one in progress per item) and append-only `workflow_decisions`, RLS by the item's sheet; `workflow_submit`, `workflow_decide`, `workflow_withdraw` write the instance, the decision, the item's own changes and the activity log in one transaction; approvers without access or auditors reported at submit; `apply_pack_upgrade` (upgrade_pack plus manifest workflows, one transaction)
- [x] Triggers `workflow_step_decided`, `workflow_approved`, `workflow_rejected`, `approval_overdue` (scheduler, dedupe per instance, round and step); action `start_workflow`; builder pickers; the loop guard applies
- [x] Sheet settings › Approval workflows editor (reachable from the Workflow screen), the item panel's Approval section (state in words and a symbol, submit, approve, reject with a reason, withdraw, timeline), My work › Needs my approval with Approve, Reject and Open; the My work badge counts approvals waiting
- [x] Pack manifests declare `workflows` per sheet (checked, planned, upgraded three ways); `iso-27001` 1.3.0: Document approval on ISMS documents (owner review → top management, status and lock on approval)
- [x] Tests: `src/engine/approvals/approvals.test.ts`, `src/server/approvals/events.test.ts`, the upgrade and ISO 27001 pack tests, pgTAP `0030_approval_workflows.sql`, e2e `tests/e2e/approvals.spec.ts`
- [ ] Reassign an approver mid-flight, delegation while away, working-day SLAs, reminders before the SLA (not asked for yet)

### Core registers  [Opus]
Owner decision (Nov 2026, board unanimous, option B): one set of shared registers (the Core registers) that every standard builds on as an add-on, so a risk, an incident or a document is recorded once and counts for every standard that uses it (docs/11 Core registers, Extends).

Phase 1 (platform and the Core pack):
- [x] Manifest `extends` (fields, groups, views, forms, items, automations, options of existing option fields), `standard`, `system`, domain folders and `<pack>:<folder>`; refs in the extender's namespace and ref map; extends only into packs in `requires`; the planner resolves the targets through the Core install's rows and plans them as virtual template sheets; options merged by id in plan and upgrade; cross-pack links (both ways) resolved (`src/engine/packs/extend.ts`)
- [x] Upgrades: an add-on's new columns and options reach the Core sheets; a Core update that removes or retypes a key an add-on uses (or drops a sheet it extends) is blocked
- [x] Migration 0041: `folders.domain`, `fields.system` with its guard, field keys unique among live fields, `install_pack` / `upgrade_pack` accept rows on required packs' sheets and merge options, `archive_pack` refuses a pack another builds on and takes back an add-on's columns, views, empty groups and standard option, keeping every item; granted to `authenticated`; pgTAP `0030_core_registers.sql`
- [x] `core` 1.0.0 (Starter: Documents and policies, Objectives and KPIs, Risk register, Risk categories, Incidents, Nonconformities and CAPA, Actions; Full adds Legal register, Competence and training, Internal audits, Management reviews, Controls library, Assets), five domains, a locked Standards field on every sheet, Table, Board by status and Calendar views, 7 automations, "Management system overview"
- [x] Install order does not matter: an add-on installs Core first (or raises it to the level it needs, `neededLevel`); Core alone installs; Create installs Core first too
- [x] Side menu Registers (non-empty domains in order) then Your sheets; System board and Used by in the sheet header; system columns with their lock text, not deletable or retypeable; per-standard view and Standards option added when an add-on installs
- [x] Demonstration add-on `iso-14001` 1.0.0: the Environmental risk category (its own scales and appetite), the Environmental incident type, ISO 14001 tags and views on the registers it uses, an aspect column on the risk register linked both ways to its own Environmental aspects sheet under Operations, one automation
- [x] Tests: `src/engine/packs/extend.test.ts`, `system.test.ts`, `src/lib/packs/core.test.ts`, the catalogue planning every pack on top of what it requires, `src/server/commands/packs.test.ts` (Core first), pgTAP 0031, e2e `tests/e2e/core-registers.spec.ts`

Phase 2a (platform for the pack quality bar, owner-approved by the board):
- [x] Automation test mode (docs/04 §14): `automations.mode`, test runs in the run log ("Would notify Maria"), no effects; migration 0042 with `set_pack_automations_mode` and the admin-only guard; the Live switch on the Automations page, "Turn on all automations from <pack>" and the test mode banner on Home and Workspace admin › Packs; pgTAP 0032
- [x] Manifest keys `startInTestMode` (default: automations that notify or send out start in test mode), `advanced` + `description`, `kind`, `personalData` (installed restricted, personal fields required), `headline`, `formsNotApplicable`
- [x] Outbound off by default on every install path (`installPack` opts in with `allowOutbound`); personal data sheets restricted; dashboard widgets on sheets a person cannot read show "No access" (verified: read with the person's client)
- [x] Pack quality lint (`src/lib/packs/quality.ts`, docs/11 Pack quality bar) over every pack in `templates/packs`, with `quality-allowlist.json` for packs not upgraded yet (each phase 2 rewrite removes itself); `scripts/pack-quality.ts`

Phase 2 (open; a separate task):
- [x] Rewrite the standard packs as add-ons to the Core registers with the pack quality bar: ISO/IEC 27001, ISO 9001, ISO 14001 (replacing the demonstration add-on), ISO 45001, GDPR, NIS2 and Supplier management; their own sheets only where Core has none, the rest as extends
  - [x] GDPR 2.0.0 add-on (docs/11 The GDPR add-on): own sheets in Privacy and security and Suppliers, Privacy risk category, incident-to-breach cascade, three approval workflows, retention rules kept; meets the quality bar; unit and e2e tests
  - [x] NIS2 1.0.0 add-on (docs/11 The NIS2 add-on): scope self-check and registration, the Art. 21(2) measures in the Controls library, incident reports with the 24-hour, 72-hour and one-month stages and clocks, management body approval and training; meets the quality bar; unit and e2e tests
  - [x] ISO 9001 2.0.0 add-on (docs/11 The ISO 9001 add-on): processes and customer feedback (Starter), external providers, measuring equipment, release records and design and development (Full) in Core domains; the Quality risk category; process, provider, release and design approval workflows; the complaint SLA clock, complaint-to-nonconformity cascade, the CAPA effectiveness gate and the overdue ladder on Core; meets the quality bar; unit and e2e tests
  - [x] ISO 14001 2.0.0 add-on (docs/11 The ISO 14001 add-on, replacing the demonstration): aspects with significance and its approval, monitoring, environmental communications (personal data) and emergency preparedness; compliance obligations in Core's Legal register (Core Full); meets the quality bar; unit and e2e tests
  - [x] ISO 45001 1.0.0 add-on (docs/11 The ISO 45001 add-on, 2018 edition, 2027 edition announced): HIRA with the hierarchy of controls and risk acceptance, worker consultation, injuries and near misses on Core's Incidents; contractors, drills and health surveillance (personal data) in Full; meets the quality bar; unit and e2e tests
  - [x] Platform for add-ons: dashboard widgets and own automations may name a required pack's sheet (`core:nc`), extension items link into a required library, previews do not block while Core is installed first; Create offers the add-ons for quality, environment and health and safety goals
  - [x] ISO/IEC 27001 2.0.0 add-on (docs/11 The ISO/IEC 27001 add-on): ISMS scope and context and the Risk treatment plan (risk acceptance workflow) as own sheets in Core domains; Information security category, Annex A and residual risk, ISMS documents, security incidents with a 24-hour containment clock, ISMS nonconformities, audits, reviews, training on the Core registers; the ISMS CAPA app over Core; meets the quality bar; unit and e2e tests
  - [x] Supplier management 2.0.0 add-on (docs/11 The Supplier management add-on): register, reviews, requirement library and per-supplier checks with the sync kept, in the Suppliers domain; supplier documents in Core Documents and policies; Supplier approval workflow; meets the quality bar; unit and e2e tests
  - [x] Platform for the 27001 and supplier add-ons (docs/11, docs/13): app screens over a required pack's sheets (`core:nc`), the server loads library links of extension items, a widget's conditions on the add-on's own columns are not Core uses, `update_linked` keys belong to the linked sheet, updates only within a major version
  - [x] Pack settings (docs/11 Pack settings, migration 0043): the NIS2 country rules for the 27 EU and 3 EEA countries as data, chosen at install or later, setting the authority and CSIRT defaults; pgTAP 0033
  - [x] Core registers 1.1.0 (docs/11 Core registers, from the add-on builders' suggestions; an update to 1.0.0 installs): Document approval, Risk acceptance and CAPA closure workflows; Context and interested parties; a Suppliers register; a shared Requirements column; What was found and Found on, What happened and Noticed at; residual risk; review input checkboxes; a kind and a tab set on every sheet; a new lowest level Foundations (5 sheets); meets the quality bar (the allowlist is empty)
  - [x] Platform: `extends[].workflows` (planned, merged by id, upgraded three ways per pack namespace, kept by the required pack's update, taken back on archive) and `extends[].level` (`neededLevel` per level, `requiredFirst` by the chosen level); tab sets compared and written by upgrades; migration 0044 (install_pack, apply_pack_upgrade, archive_pack), granted to `authenticated`; pgTAP 0034
  - [x] Add-ons link their supplier records to Core Suppliers: ISO 9001 2.1.0 (External providers, Full), ISO 45001 1.1.0 (Contractors, Full), GDPR 2.1.0 (Processors); Supplier management keeps its own register in 2.0.0 (extending Core's register is a new major, later)
  - [x] Tests: `src/lib/packs/core-upgrade.test.ts` (Core 1.1.0, the update from 1.0.0 with ISO/IEC 27001 2.0.0 and Supplier management 2.0.0 installed), `src/engine/packs/extend.test.ts` (workflows and levels in extends), pgTAP `0034_extension_workflows.sql`, e2e `tests/e2e/core-upgrade.spec.ts`
- [x] Core registers 1.2.0 (owner decision, Nov 2026; an update to 1.1.0 installs): Document approval goes to the new people field **Approve by**; Approver and Approved on stay the read-only record the approval fills in. An approval workflow can no longer take its approvers from, or require, a field only the approval fills in (`approvalRecordProblems`: the editor, the save command, the catalogue checks; `src/lib/packs/approvers.test.ts` over every pack's workflows). No other Core or add-on workflow had the problem
- [x] Headline dashboards agree (owner decision, Nov 2026): a widget's `scope` (the items it looks at; a count's "of N"); the add-ons' widgets on the Core registers take their Standards tag as the scope: ISO/IEC 27001 2.1.0 (the residual risk count now reads ISO 27001 risks only), ISO 9001 2.2.0, ISO 14001 2.1.0, ISO 45001 1.2.0 (`src/lib/packs/headline-dashboards.test.ts`)
- [x] One test mode banner on Home and Workspace admin › Packs that names every pack still in test mode, with Turn on by pack (owner decision, Nov 2026); e2e `tests/e2e/test-mode-banner.spec.ts`
- [x] Supplier management 3.0.0 (docs/11 The Supplier management add-on, a new major: a fresh install, 2.0.0 stays in the catalogue): extends Core's Suppliers register instead of its own (its columns, forms, examples, automations and the Supplier approval workflow on Core's rows, Core's Owner, Status, Criticality and Next review); reviews, the requirement library and the checks stay its own sheets in the Suppliers domain, the sync on Core's suppliers. Platform: two-way links between two sheets an add-on extends, setup steps on a required pack's sheet, the sync ranks a criticality dropdown, Create drops what a left-out sheet's extends need. Meets the quality bar; unit and e2e tests
- [x] New item dialog (owner decision, 14 Nov 2026; docs/05 §3.7). Phase A: "+ New", Create › Entry and N open a dialog asking the name, required fields and fields marked **Ask when adding** (`config.askWhenAdding`), the rest under More fields; Create and add another; "Discard this item?"; one engine module (`src/engine/views/new-item.ts`) for the dialog and `createItem`; the source (dialog, inline, form) in the `item.created` entry (migration 0046, pgTAP 0036); "Missing: owner, due date" on rows and a "Missing required" filter (`__missing`). Packs mark their audit registers: Core 1.3.0, GDPR 2.2.0, ISO 14001 2.2.0, ISO/IEC 27001 2.2.0, ISO 45001 1.3.0, ISO 9001 2.3.0, NIS2 1.1.0, Supplier management 3.1.0, each an update without a conflict. Phase B: Sheet settings › New item form (`sheets.settings.newItemForm`), stepped forms ("Step 2 of 3"), intake forms in packs (`intake`): Core's New nonconformity and New incident, ISO/IEC 27001's New information security risk to choose. Unit tests, e2e `tests/e2e/new-item.spec.ts`
- [x] Approving a document by hand (Status set to Approved outside Document approval) fills in Approver and Approved on as the workflow does, so Core's status rule no longer asks for an Approver nobody may set (`manualApprovalValues`, `src/engine/documents.ts`)
- [x] Owner decision (15 Nov 2026): ISO/IEC 27001 2.3.0, ISMS CAPA's Needs my check asks Effectiveness checked by (as CAPA on Core does), not the owner; a conflict-free update of 2.2.0 (fixture `tests/e2e/fixtures/catalogue/iso-27001@2.2.0.json`); the quality bar's allowlist stays empty. Tests `src/lib/packs/iso-27001.test.ts`, e2e `tests/e2e/iso-27001.spec.ts`
- [x] The forms Copy dialog and the sheet pickers (link targets, automations) list the current workspace's sheets, archived ones out, every page past the API's 1000-row cap (`fetchAllPages`, `src/lib/sheet-query.ts`)
- [x] Owner decision (15 Nov 2026): every page past the 1000-row cap for the retention scheduler (`workspacesWithRetention`, service role, first), the scheduler's per-workspace lists (`workspacesWithDateChecks`, scheduled automations, live sheets, pauses, approvals past their SLA, a sheet's archived items), the side menu (`readNav`, `my_sheet_access`, and `getSheetAccess` reading its one row), Platform › Design (`readDesignLists`), dashboard sources (`fetchSheetMetas`, `listDashboards`), search, Evidence, My work (`fetchLiveSheets`, `fetchDirectory`) and the Workflow page's automations; documented bounds stay (Evidence shows at most 500 rows, My work's 500 items, Home's latest entries, design health). Unit tests per helper against `src/lib/fake-db.testing.ts`, which caps a request at 1000 rows as PostgREST does
- [ ] Add-ons onto Core's shared Requirements column: not a minor update (an update cannot move a column's links to another column); options in docs/11 Core registers, for the owner to decide
- [ ] Reset the demo workspaces onto Core plus the add-ons
- [ ] Workspace settings › Standards in scope (the design's scope filter) over the Standards tags

### Design area (owner decision, 15 Nov 2026; board consulted)
- [x] Engine `src/engine/flow` (pure): a sheet's steps in four groups (inputs, sheet, logic, outputs) with health in words, pack provenance (unchanged, changed, added here) and data that leaves the workspace; the workspace graph (sheets, link, create, update, button and sync edges), filters by app, pack, folder, Registers domain and "differs from pack", the Connections rows; auto layout for both maps; restricted field names and webhook addresses masked (`maskWorld`); unit tests for every kind of step and edge
- [x] "Differs from pack" decided as an upgrade decides it: the installed version planned as `install_pack` wrote it (`planInstalledBase`, extracted from the upgrade planner without changing it) compared row by row (`packDrift`), kept per install version
- [x] The Design view tab (docs/05 §3.8): a registry entry, never a saved view, under More until shown; the list with health and the pack marker, the "Coming later" API / webhook row; the side window reusing the existing editors (the automation builder extracted into `AutomationEditor`, the form builder, the approval workflow editor, field settings, sheet settings, the New item form); + Add in create mode; the Map toggle; arrow keys, Enter, Escape and focus back on the row; viewers and auditors read only
- [x] Health from aggregates only: migration 0048 `design_health` (run log and webhook queue, bounded, granted to `authenticated`); pgTAP `0038_design_health.sql`. Configuration only, never item rows (`readDesign`)
- [x] Build › Design (docs/05 §4; was Platform › Design): Sheets and Connections tables (the default and the only view under 760 px) and the map in folder columns; filters and views in the URL (`?app=`, `?group=` …); a sheet opens its Design tab; an app's screens link to its design
- [x] Leaves the system: every outside destination, the fields sent, personal-data flags, addresses masked; owners, admins and auditors (open question to the owner)
- [x] Export for auditors: `/[org]/design/print` (one sheet, the workspace with its filters, or the data-flow record), printed to PDF from the browser (no server-side PDF path exists to reuse)
- [x] Owner decision (15 Nov 2026): exporting the data-flow record is logged as the audit exports are (`audit.exported`, kind `data_flow_record`, who, when and the filters, never an address or a value); migration 0049 extends `log_audit_export` (owners, admins and auditors for this kind, granted to `authenticated` only), pgTAP `0039_data_flow_export_log.sql`, e2e in `design.spec.ts`. The flow and workspace prints are not logged
- [x] e2e `tests/e2e/design.spec.ts`: the Core nonconformities list with a pack automation and the intake form, an automation edited in the side window and its activity log entry, the Map toggle, the overall map and table with the app filter, keyboard only, 390 px, a viewer reading only, the export
- [ ] Later (not v1): the clause coverage lens; inbound webhooks and the API (owner sign-off and a security review); a free canvas was rejected

### Simple (owner decisions, 15 Nov 2026; board quality review, Usability)
- [x] Words: "sheet" and "item" in every screen and message; a noun table in docs/05 §6.5. The Create wizard's Entry card is removed: "+ New" in the sheet header is the one way to add an item (UX-4, UX-7)
- [x] Menu in four groups, Work, Registers, Reports, Build; Build for editors and up, Workspace admin for admins and owners; no "Platform"; one search (the top bar's, `/`), the menu filter removed (UX-1, UX-2, UX-5)
- [x] Phone: one Menu (bottom bar), one Search and one Inbox (top bar), 44 px bottom bar cells and menu rows (UX-6, UX-15)
- [x] Standards vocabulary at display time (`src/engine/packs/words.ts`, docs/11 Words people see): standard, Shared registers, Basic / Recommended / Everything (Recommended, not Standard, since 15 Nov 2026); no manifest or version changed (A1, A6)
- [x] Home: one Next step per installed standard (`nextSteps`) and one test-mode banner with one link (UX-3, A2)
- [x] The app's Dialog for deleting an approval workflow, reduced motion, 2 px focus rings on inputs, the 13.5 and 9.5 type steps rounded, global-error on the tokens (UX-8, UX-11, UX-12, UX-14)
- [x] e2e `tests/e2e/simple-ui.spec.ts`: the menu by role (owner, editor, viewer), one Menu, Search and Inbox at 390 px, Home's Next steps and banner
- [x] Owner decisions (15 Nov 2026, second round): the Starter level reads Recommended, never Standard (`words.ts`, `catalogue-words.test.ts`); Getting started only until the first standard is installed (`showGettingStarted`); Create hidden from viewers and auditors (menu and phone; Create and `/s/new` refuse them with Back to Home); no "New sheet" button on Home (Getting started's first step opens Create)
- [x] e2e `simple-ui.spec.ts`: a viewer sees no Create button and Create refuses them, Home with a standard has no Getting started, Home has no "New sheet" button, the level reads Recommended

### T1 · Keptrow look across the app  [Sonnet; Opus for the bulk commands]
Owner decisions (18 Nov 2026): the whole app takes the Keptrow look, replacing the Geist look of docs/05 §6. docs/18 (§3–§8, decisions C1–C10) wins on look; docs/05 wins on content, routes, menu groups, roles, behaviour and phone navigation. References: `reference/keptrow-prototype.html`, `reference/keptrow-look/prototype.css` and the screenshots `reference/keptrow-look/desktop-*.jpg` and `phone-*.jpg`. Build it in this order and keep every existing e2e suite green after each step.
- [ ] Tokens and type (docs/18 §3, C3): the Keptrow tokens in `globals.css` replace the Geist colour and type tokens; Figtree 400/500/600/700 self-hosted from `src/fonts/` with `next/font/local` (no Google Fonts request), Geist Mono kept for codes; body 15 px; the type scale as Tailwind utilities; the 3 px focus ring; no hex or ad-hoc px in components; unit test that white on `--brand`, `--navy` and every `--opt-*` is ≥ 4.5:1
- [ ] Shell (docs/18 §4, C9): 69 px white top bar (logo, search pill, workspace switcher, bell, user pill), 80 px navy rail (panel toggle, one button per docs/05 menu group, Help, Settings), 288 px `--panel` side panel with docs/05's groups, counts and collapse, the navy hero (crumbs, title, description, decoration hidden from screen readers) and the page overlapping it by 88 px; matches `desktop-01-home.jpg`
- [ ] Components (docs/18 §5): shadcn variants for pill buttons (44/40/32 px, primary, secondary, danger, link), pills and segments, uppercase underline tabs, 44 px inputs, badge tones with ✓ and !, tags, switch with words, KPI tiles, date chips, list rows, cards and the summary card, take-action banner, tiles, widgets and charts, the assistant panel, kanban, the item panel drawer with the navy header, dialogs, the navy toast, callouts, the flow editor nodes and edges, the relationship map
- [ ] Pages (docs/18 §6): Home, Dashboards, Sheet (Table, Kanban, dashboard, Insights), item panel, Workflows and the automation builder, the relationship map, Frameworks, Audit room, Activity log, then every other page in the same shell and components; each matches its reference image at 1440 px allowing for real content
- [ ] The menu rule everywhere (docs/18 §7): a shared `OverflowTabs` component (two tabs + More ▾, the active tab shown on the trigger) and Radix `DropdownMenu` patterns for action, choice, toggle and icon groups; no group on any screen has more than three related buttons; Enter / ↑ / ↓ / Escape with focus return; menus close on outside click and scroll; never clipped
- [ ] Toolbar (C8): View ▾ (quick views with counts, saved Table views, Save current view…), search, Filter ▾ (one panel: quick views, Missing required, options with counts per option and people field), Sort ▾, More ▾ (Group by, Show one group, Columns, density, Add field, sub-items, Actions, Export to CSV), ⚡ n; `toolbar-styles.ts` updated; the old controls removed, nothing lost
- [ ] Cells (C1, C7): option values fill the cell in `--solid-<colour>` with white words, "!" and ✓; empty cells `--soft`; the option picker under the cell (listbox, current option ringed, Clear for dropdowns); people cells a 28 px avatar and short name with a people picker; every change through the existing commands (one activity log entry per item)
- [ ] Rows 40 px with 52 px as comfortable density (C4); group header, summary row on by default (C6: status battery, Σ, date range, avatars, "n of m" files), "+ Add item" that sets the grouped value when grouped by a field
- [ ] Width (C2): field columns fill the card in proportion to their default or resized width, checkbox, "+" and "…" fixed, never below the default; computed in the TanStack column model, recomputed on resize and when panels open or close; the clear right edge (1 px `--surface-line`, 8 px radius); the sticky name column keeps its 1 px line (C5)
- [ ] Bulk bar: Status, the people field and More (Duplicate, Export to CSV, Delete… with a confirm); bulk changes through one command per item kind, the toast says how many changed and which automations ran
- [ ] Phones (docs/18 §4, C10): docs/05 §5 navigation (bottom bar Menu, Search, Inbox) in navy, the side panel as a full-height `--panel` sheet, hero 30 px title, Table cards with solid option blocks; nothing scrolls the page sideways at 390 px
- [ ] Tests: unit tests for the contrast of the tokens, the width split and `OverflowTabs`; e2e `tests/e2e/keptrow-look.spec.ts` (the shell landmarks and collapse, the menus by keyboard, the option picker by keyboard, a bulk status change and its log entries, grouping by status with + Add item, 1920 px fill with the side panel collapsed, 390 px on every page in docs/18 §6); Playwright screenshots of Home, a sheet, the item panel and the flow editor at 1440 and 390 px attached to the PR for review; the existing suites still pass

### NIS2 pack
- [x] Owner decision (14 Nov 2026): NIS2 country rules are a pack setting listing all EU/EEA countries with defaults (registration authority, deadlines, extra fields), chosen per workspace. Built as the general pack settings mechanism (docs/11 Pack settings); every country entry ships unverified until someone checks it.

### P8 · Your own frameworks  [Opus]
Owner decisions (16 Nov 2026), all as the advisory board recommended (part A of the review "your own frameworks and saving a setup as a package"); docs/12 Your own frameworks, docs/02 §17.
- [x] Migration 0074: `org_id` on `frameworks`, `requirements` and `crosswalks` with the reserved key form `w<8 hex>-<slug>`; `requirements.text`; titles `customer`; cross-walks insert-only with `created_by`, `created_at`, `retired_at`; `packs.owner_org_id` (P9's groundwork); `framework_drafts`; reads `org_id is null or is_member(org_id)`; `catalogue_guard` for both kinds of row; RPCs `publish_framework`, `set_crosswalk`, `retire_crosswalk`, `save_framework_draft`, `delete_framework_draft` (owners and admins, `authenticated` only); `adopt_framework`, `install_pack`, `upgrade_pack` and `move_framework_edition` refuse another workspace's framework or pack
- [x] Engine (pure, tested): `ownFrameworkProblems` (row numbers; ref, title 80, text 4,000, a group plus 4 levels, 2,000 requirements), `importRequirements` (pasted tab-separated or CSV through `parseCsv`), `copyStructure` (refs, hierarchy and kinds only), `publishDecision` (revision or edition), `editionMappingFor`, `toFramework`; `frameworkToPack`, `frameworkHash`, `planEditionMove`, `alsoSatisfies`, `coverageOf` and `buildSoa` reused
- [x] Commands `src/server/commands/own-frameworks.ts` (authorise → Zod → RPC → log): create, save and delete a draft, publish, map and unmap
- [x] Workspace admin › Frameworks: Adopted, Your frameworks ("Yours", "Written by <workspace>. Not reviewed by Klarert."), the Catalogue; Add your own: paste or CSV (problems with row numbers), blank, copy a structure; the draft grid with each row's problems; the publish dialog with the licence confirmation and the source line; Adopt through the existing preview and adopt
- [x] Item panel: "Map to …" on an own requirement (catalogue picker, relation default related, note); "Also satisfies" shows "Your mapping · person · date" apart from Klarert's mapping; the SoA licence note "Provided by <source>. Owned by <workspace>."
- [x] Tests: `src/engine/frameworks/own.test.ts`, `src/server/frameworks/catalogue.test.ts`, pgTAP `0074_own_frameworks.sql` (key constraint, RLS between workspaces, adopt/install/upgrade/move refused, publish and revision logged, editors refused, catalogue guard, cross-walks insert-only with retire, a new edition), e2e `tests/e2e/own-frameworks.spec.ts` (paste → problems → fix → publish → adopt → library text → SoA note; map to 27001 → "Your mapping"; a reworded revision taken as an update keeping applicability; another workspace sees nothing; 1440 and 390 px)
- [ ] Later (board): suggested mappings (`suggestMappings`, person accepts each, never "automatic"), .xlsx upload, bulk cross-walk CSV, an e2e for a new edition moved end to end in the browser

### P9 · Save your setup (private packs)  [Opus]
Owner decisions (16 Nov 2026), part B of the advisory board review "your own frameworks and saving a setup as a package": a pack belongs to the workspace it is published from; the first install into another workspace needs an owner or admin of both and shares it; no JSON export or import yet; for private packs the safety rules always apply and the quality bar is advice. docs/11 Your own packs, docs/02 §15.
- [x] Migration 0075: `packs.published_by`, `published_at`, `withdrawn_at`, `withdrawn_by`; versions written once (`packs_write_once`); `pack_shares(pack_key, org_id, granted_by, granted_at)` with RLS and a guard (written only by `install_pack`, never changed); reads `pack_visible` (ours, a member of the publisher, or shared to a workspace I belong to) and `framework_shared_to_me` (an own framework listed by a shared pack); RPCs `publish_pack` (owners and admins; key, version and write-once, the safety rules re-checked on the JSON, `pack.published` with version, hash, counts and what was left out) and `withdraw_pack` (`pack.withdrawn`); `install_pack` (the first install by an owner or admin of both writes the share and `pack.shared` on the publisher's chain; a withdrawn pack takes no new install), `upgrade_pack` (only where shared) and `adopt_framework` check visibility and shares; `pack.installed` / `pack.upgraded` carry `source: private` and the publisher; `pack_publisher` names the publisher on a preview
- [x] Engine (pure, tested): `captureManifest` (stable refs from row ids; own sheets, sub-items, forms as drafts, tab sets, column groups, automations, approval workflows and dashboards; what a person added to our sheets as `extends` in the pack's namespace with every `{field_key}` rewritten; people, webhook addresses and outside emails never copied; job roles and teams by name; every automation in test mode), `leftOutReport`, `suggestVersion` (patch for wording, minor for the rest), `versionProblem`, `privatePackKey`; `bundleParts`, `togglePart`, `closeExclusions`, `selectManifest`, `namespaceOf`, `extendsProblems`, `packQualityProblems`, `planPackInstall` and `planPackUpgrade` reused
- [x] Commands `src/server/commands/pack-publish.ts`: `previewPublish`, `publishPack`, `withdrawPack`, `listYourPacks` (the workspace read with the person's own client); `previewPack` names the publisher and `installPack` adopts the pack's own frameworks from it
- [x] Workspace admin › Packs › Your packs: Save your setup (the publisher named, "Publish from your practice or head-office workspace, not a client's", the part picker of Create, what it adds to our registers, the Left out report, "Example items come later", name, description, the suggested version with the major-version warning, advice not blockers); the packs published here with their versions, installs and Withdraw; the packs of your other workspaces where you are an owner or admin, through the ordinary preview and install (required packs first, the publisher named); updates through the ordinary Update available
- [x] Tests: `src/engine/packs/capture.test.ts`, `src/lib/packs/capture.test.ts` (a workspace on Core captured, checked by the schema and against Core, planned into another workspace with Core, a 1.1.0 planned as an update that keeps the client's change), pgTAP `0075_private_packs.sql` (48: no read, install, update or adopt without a share; the first install needs an admin of both; after the share any admin of the target updates; withdraw blocks new installs, not updates; editors refused; every log entry; shares cannot be written, changed or removed), e2e `tests/e2e/private-packs.spec.ts` (1440 and 390 px)
- [x] Owner decisions of 16–17 Nov 2026 recorded in docs/11 (publishing after a withdrawal keeps the pack withdrawn; members of the publisher read its packs, owners and admins list and install them; personal-data sheets install restricted to the installer; the builder's small rules) and implemented: restricted columns carried with their roles only (`restrictedTo: { roles }` on a manifest field, `captureManifest`, the planner, the upgrade's three-way "who sees it" with Keep mine / Take the pack's; the "installs open" Left out line gone); migration 0076 (`_pack_restrict_field`; `install_pack` and `upgrade_pack` apply it, `publish_pack` refuses people or other roles in it; `orgs_publisher_guard`: a publisher with installs elsewhere is not deleted, in words); the update dialog's personal-data line; tests `src/engine/packs/capture.test.ts`, `src/lib/packs/capture.test.ts`, `src/lib/packs/manifest.test.ts`, pgTAP `0076_pack_restricted_fields.sql` (26), e2e `private-packs.spec.ts` (a restricted column stays restricted in the client workspace)
- [ ] Later (board): example items (each string shown before publishing), carrying changes to what we shipped, JSON export and import, the multi-workspace view, sharing to workspaces you do not administer by invite

Later: consultant multi-workspace view, pack signing and marketplace, SSO.

Later (owner decision 15 Nov 2026): the script Content-Security-Policy with nonces and a stricter HSTS, after the demo, as their own change.

---

## After the MVP (do not start without Tor)

- Readiness scoring, app builder for customers, AI proposals (packs and apps: see "Packs and apps" above)
- SSO (Microsoft Entra ID, Google), email digests, Teams app, public API and webhooks in
