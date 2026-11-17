# 17 · The demo workspace

**Meridian Components Ltd** is the fictional example workspace the public site shows ("Example workspace: Meridian
Components Ltd" under every screenshot). It is a precision-parts manufacturer with 180 staff at two sites, Leeds (UK)
and Tilburg (NL), mid-way through its management system. Owner decisions of 17 Nov 2026.

| | |
|---|---|
| Address | `/meridian-demo` (the first-sheet sample workspace `/meridian` is separate and unchanged) |
| Build | `pnpm seed:demo` (scripts/seed.ts `--demo`, content in `scripts/demo/`) |
| Check | `pnpm seed:demo:check`: rebuilds it and checks coverage, sign-in and an activity chain (local stack only) |
| Screenshots | `pnpm screenshots` (scripts/screenshots.ts): signs in as the demo login and writes `public/site/screens/` |
| Sign in | `demo@meridian.example` with `DEMO_PASSWORD` (`meridian-demo-local` on the local stack only) |

## What it holds

- **People** (`scripts/demo/people.ts`): eight fictional people with example.com addresses: the owner (the demo
  login, job title Top management), the quality manager, the ISMS lead (information security officer), the HSE
  manager, the DPO, two editors and an external auditor whose access ends 45 days after the build. Only the demo login
  can sign in: the others are blocked when the build finishes.
- **Standards**: the shared registers at Everything, ISO 9001 (Everything) with ISO 9001:2015 adopted first (Meridian
  is certified to it) and ISO 9001:2026 alongside through the pack, ISO/IEC 27001, ISO 14001 and ISO 45001
  (Everything), GDPR (Everything), NIS2 (country: Netherlands), supplier management and the CAPA app. The packs'
  "Example:" items are archived. Automations of the shared registers, ISO 9001 and supplier management are switched to
  live; the others stay in test mode, so the test-mode banner shows.
- **Content** (`scripts/demo/content/*.ts`): about 250 items over every register, with history (stage changes, KPI
  results month by month), comments, links between registers, evidence and document files (small fictional PDFs),
  approvals in progress and one sent back, an internal audit in progress, last year's and a recent management review
  (compiled by the app), supplier evaluations, calibration dates, GDPR records with personal data marked, and the NIS2
  scope of the Dutch company.
- **Libraries** (`content/library.ts`): applicability with justifications, implementation status, owners, review dates
  and evidence (current, expiring and expired). Targets: ISO 9001:2015 about 70% covered, ISO/IEC 27001:2022 about
  55%, the others earlier on. The build prints the coverage the Frameworks page shows.
- **Own framework**: "Acme customer quality requirements" (P8), published, adopted and mapped to ISO 9001:2015.

Dates are written relative to the day of the build (`scripts/demo/clock.ts`; `DEMO_TODAY=YYYY-MM-DD` to pin it), so the
workspace always looks current. The activity log records the real time of the build: it is append-only and its
timestamps are never back-dated.

## How it is written

CLAUDE.md rule 6 allows the service role in `scripts/seed.ts` only, so the seed owns it and hands it to
`scripts/demo/index.ts`, which uses it for what the seed has always done: auth users and profiles, the demo login's
password, blocking the others, memberships with job titles and the auditor's end date, teams, job roles, entities and
sites. **Everything else goes through the app's own server commands** (`src/server/commands`), signed in as the person
the content names: `createWorkspace`, `previewPack`/`installPack`, `previewAdoption`/`adoptFramework`, `createBundle`,
`createItem`, `setValues`, `bulkSetValues`, `setLinks`, `prepareUpload`/`confirmUpload`, `postUpdate`,
`submitForApproval`/`decideApproval`, `setAccessGrant`, `setPackAutomationsMode`, the own-framework commands,
`createManagementReview` and `runDateChecksNow`. So validation, status rules, RLS, the command gate (0053), the
activity log and its hash chains, automations and their run log are the real ones.

The commands run outside Next.js through `scripts/demo/runtime.cjs` (preloaded with `tsx --require`): it resolves
`server-only` to its empty module, as the server build does, and gives `next/headers` a cookie jar that holds the
session of the person the seed is acting as (`scripts/demo/session.ts`: a one-time sign-in link from the auth admin
API, never emailed, or the demo login's password).

**Repeatable.** A workspace already at `/meridian-demo` is refused with a message, unless `DEMO_RESET=1`: the old one
is then renamed aside (`meridian-demo-retired-<time>`, its members removed) and a new one is built. Nothing is deleted:
the activity log is append-only.

## The live run (owner-approved step, not done yet)

Building it on the hosted project is a separate decision. It needs `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_COMMAND_SECRET` (the hosted command gate's
secret), `SEED_ALLOW_REMOTE=1` and a strong `DEMO_PASSWORD`, run from a trusted machine:
`SEED_ALLOW_REMOTE=1 DEMO_PASSWORD=… pnpm seed:demo`. It also writes the catalogue first (as `pnpm seed` does), so
run it after the deploy whose packs it expects.
