# Compliance OS · Sheets MVP

Instruction pack for Claude Code. It contains everything needed to build the spreadsheet core (57 field types, views, item panel, automations and triggers, audit trail) and to load the first spreadsheet.

## Start

1. Create an empty GitHub repository and copy this folder into it (keep `.claude/`).
2. Create a Supabase project in **EU (Frankfurt)** and a Vercel project (region `fra1`); fill `.env.local` from `.env.example`.
3. Install Docker (for local Supabase), Node 22 and pnpm.
4. Open the repository in Claude Code and run `/milestone` (M0). Repeat `/milestone` for M1 … M10, one session and one PR per milestone.
5. When M10 is merged, `pnpm seed` loads the first sheet (`templates/first-sheet.json`) and `docs/07-first-sheet.md` is your acceptance walkthrough.

## Contents

| Path | What |
|---|---|
| `CLAUDE.md` | Rules for Claude Code: stack, architecture, conventions, model use |
| `docs/01-product-spec.md` | Scope and every functional requirement |
| `docs/02-data-model.md` | Tables, write path, audit hash chain, RLS, storage, realtime |
| `docs/03-field-types.md` | The 57 field types: value shapes, config, filters, formula language |
| `docs/04-automations.md` | Events, 11 triggers, conditions, 11 actions, runner, scheduler, webhooks, builder |
| `docs/05-ui-layout.md` | Routes, shell, views, item panel, phones, tokens |
| `docs/06-build-plan.md` | Milestones M0–M10 with prompts and acceptance boxes |
| `docs/07-first-sheet.md` | The first spreadsheet, end to end |
| `supabase/migrations/` | `0001_core.sql` (smoke-tested in PGlite / Postgres 18 with a stubbed auth schema) and `0002_storage_realtime.sql` (Supabase-only) |
| `scripts/test-migration.mjs` | Runs `0001_core.sql` in PGlite and exercises items, values, links, locks, forms and the hash chain |
| `templates/` | Wizard starts, the first sheet template, automation recipes |
| `reference/` | The two working prototypes (open in a browser) |
| `.claude/commands/milestone.md` | The `/milestone` command |
