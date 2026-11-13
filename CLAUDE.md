# Compliance OS — Sheets MVP

Read this file first, every session. It tells you what we are building, how the repo is organised and the rules you must follow. The detail lives in `docs/`.

## What we are building

A monday.com-style spreadsheet for compliance and operations work. A workspace holds **sheets**; a sheet has **fields** (58 types), **groups** and **items**; an item can have one level of **sub-items** (a hidden child sheet, docs/02 §12). **Automations** (trigger → conditions → actions) run on every change, on a schedule and on button clicks. Everything a person or an automation changes is written to a **hash-chained activity log**.

This MVP is the spreadsheet core only. Compliance packs (ISO 27001, ISO 9001 …), dashboards and the app builder come later and will be built *on* this core as data, not code. If a design choice would make packs harder later, stop and ask.

Done means: a person can sign in, create their first sheet from the wizard, add fields of any of the 57 types, enter items in the Grid and List views, open an item, and build an automation that fires on a change, a date or a button, with every step visible in the run log and the activity log.

## Documents (read the one you need before you start a task)

| File | Read it when |
|---|---|
| `docs/01-product-spec.md` | Always, once per session: scope, concepts, every functional requirement |
| `docs/02-data-model.md` | Touching the database, RPCs, RLS, storage |
| `docs/03-field-types.md` | Touching any cell, editor, validation, filter, summary or formula (58 types) |
| `docs/04-automations.md` | Touching triggers, conditions, actions, scheduler, run log, notifications |
| `docs/05-ui-layout.md` | Building any screen. Look: the Geist design system (§6, tokens in `src/app/globals.css`); behaviour reference: `reference/compliance-os-sun-v2.html` |
| `docs/06-build-plan.md` | Picking the next milestone; tick acceptance boxes as you finish |
| `docs/07-first-sheet.md` | Milestone M10 and the end-to-end acceptance test |
| `supabase/migrations/0001_core.sql` | The schema. Change it only through new numbered migrations. `node scripts/test-migration.mjs` smoke-tests it without Docker |
| `templates/*.json` | Sheet templates used by the wizard and the seed |
| `reference/sheets-mvp.html` | Working prototype of 57 of the field types (not `subitems`) and the automation engine. Open it in a browser and read its source when behaviour in the docs is unclear. The docs win if they disagree |

## Stack (do not change without asking)

- Next.js 15 (App Router, React 19, Server Components + Server Actions), TypeScript `strict`
- Tailwind CSS v4, shadcn/ui (Radix), lucide-react icons, Geist + Geist Mono **self-hosted** via `next/font/local` (no Google Fonts requests)
- Supabase: Postgres 15+, Auth, Storage, Realtime. **EU region (Frankfurt)**. Local dev with the Supabase CLI
- Vercel for hosting (region `fra1`) and Vercel Cron for the scheduler
- TanStack Query (server state, optimistic updates), Zustand (UI state only), Zod (all input), date-fns, `fractional-indexing` (ordering), dnd-kit (drag and drop), TanStack Table + `@tanstack/react-virtual` (grid)
- Vitest (unit), Playwright (end to end), ESLint + Prettier, pnpm, GitHub Actions CI

## Repository layout

```
src/
  app/                      Next.js routes (see docs/05-ui-layout.md for the route list)
  components/               UI: shell/, grid/, list/, item-panel/, editors/, automations/, ui/ (shadcn)
  engine/                   PURE TypeScript. No React, no Supabase, no Date.now() without injection
    fields/                 one file per field type + registry.ts (the contract in docs/03)
    formula/                tokenizer, parser, evaluator, functions
    conditions/             condition operators per value kind
    automations/            trigger matching, action planning, templating, loop guard
    values/                 projections: toText, toNumber, toDate, compare, isEmpty, isDone
  server/                   Server-only: commands (all writes), repositories, automation runner, scheduler, webhooks
  lib/                      supabase clients, auth helpers, query keys, formatting helpers
supabase/migrations/        SQL migrations (0001_core.sql is the baseline)
templates/                  sheet templates (JSON, validated by Zod at load)
tests/                      e2e (Playwright). Unit tests live next to the code as *.test.ts
```

## Architecture rules (non-negotiable)

1. **Data, not code.** Field types, view types, triggers and actions are registries keyed by string ids. A new field type or action is one new file plus one registry line. Never `switch` on a field type outside `src/engine/fields/`.
2. **All writes go through commands** in `src/server/commands/` (Server Actions call them). A command: authorises → validates with the field registry → calls a Postgres RPC that writes the row *and* the activity log in one transaction → runs automations → returns messages for the toast. The browser never writes to tables directly.
3. **The engine is pure.** `src/engine/**` gets data in and returns data out. The clock and id generator are injected. Every field type and every trigger/action has unit tests. The same engine code runs in the browser (formulas, validation, previews) and on the server (truth).
4. **Values are stored by id, shown by label.** Option fields store option ids, people fields store user ids, links live in `item_links`. Renaming an option, a person or an item never rewrites values.
5. **Field keys are stable.** Formulas and templates reference `{field_key}`; renaming a field changes `name`, never `key`.
6. **RLS everywhere.** Every table has `org_id` and RLS. The service role key is used in exactly four server-only places: the scheduler, the webhook worker, the public form route, and `src/server/automations/effects.ts` (automation posts and notifications, after the runner has authorised the org) — plus `scripts/seed.ts` for local data. Never in client code, never anywhere else.
   New SQL functions are not executable by API roles by default (migration 0008): grant EXECUTE explicitly to `authenticated` (or `anon` for public forms) in the migration that adds them, and never grant internal `_` helpers.
7. **Append-only audit.** `activity_log` is insert-only and hash-chained per item (docs/02). Restoring an old value writes a new entry.
8. **Automations are bounded.** Chains stop at depth 3 (loop guard, logged). Scheduled triggers fire once per item per occurrence (dedupe key). Webhooks go through a queue with retries and a dead letter.
9. **No inline business rules in components.** Components read derived data from the engine (e.g. `fieldType.format(value, cfg)`), they do not compute it themselves.
10. **English UI copy**, sentence case, plain words. No exclamation marks. Dates `11 Nov 2026`, times 24 h, the user's time zone.

## Commands

```
pnpm dev                 # Next.js on :3000 against local Supabase
pnpm supabase:start      # supabase start (Docker)
pnpm db:reset            # supabase db reset (runs migrations + seed)
pnpm db:types            # supabase gen types typescript --local > src/lib/database.types.ts
pnpm test                # vitest run
pnpm test:watch
pnpm e2e                 # playwright test
pnpm lint && pnpm typecheck
```
Add these scripts in M0 if they do not exist.

## How to work

- Work milestone by milestone from `docs/06-build-plan.md`. Use `/milestone` (see `.claude/commands/milestone.md`).
- Before coding a milestone: write a short plan (files to touch, tests to add) in the chat, then build.
- A milestone is done when its acceptance boxes are ticked **and** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` pass. Tick the boxes in `docs/06-build-plan.md` in the same commit.
- Commit small, conventional messages (`feat(grid): inline editor for timeline`). One milestone = one PR to `main`; Vercel previews every PR.
- If the docs are silent or contradict each other, **ask** before choosing. Do not invent business rules, limits or constraints that are not written down.
- Never weaken a test to make it pass. Never disable RLS, the loop guard or the audit trigger.

## Model use in Claude Code

- Opus 5.5: planning a milestone, the schema and RPCs (M1), the engine and formula parser (M2), the automation runner and scheduler (M7, M9), any debugging that crosses layers.
- Sonnet 5.5: UI components, editors, views, tests, refactors inside one layer.
- Keep one milestone per session; start a fresh session per milestone and re-read this file.

## Definition of done for any UI work

Keyboard reachable, visible focus, labels on icon buttons, colour never the only signal (status shows text, and a symbol for action-needed and done states), works at 390 px wide, no layout shift when data loads, empty state written, loading state skeleton, error state with a retry.

Uses the Geist tokens and type styles from globals.css (docs/05 Design system); no ad-hoc px font sizes or hex colours.
