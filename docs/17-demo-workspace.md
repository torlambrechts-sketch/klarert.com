# 17 · The demo workspace

**Meridian Components Ltd** is the fictional example workspace the public site shows ("Example workspace: Meridian
Components Ltd" under every screenshot). It is a precision-parts manufacturer with 180 staff at two sites, Leeds (UK)
and Tilburg (NL), mid-way through its management system. Owner decisions of 17 Nov 2026.

| | |
|---|---|
| Address | `/meridian-demo` (the first-sheet sample workspace `/meridian` is separate and unchanged) |
| Build | `pnpm seed:demo` (scripts/seed.ts `--demo`, content in `scripts/demo/`) |
| Check | `pnpm seed:demo:check`: rebuilds it and checks coverage, sign-in and an activity chain (local stack only) |
| Purge | `pnpm seed:demo:purge`: removes the retired copies `DEMO_RESET=1` leaves (migration 0078) |
| Nightly | `.github/workflows/demo-nightly.yml` rebuilds the live demo at 03:17 UTC (below, The live demo) |
| Screenshots | `pnpm screenshots` (tests/screens): signs in as the demo login, and as the admin login for admin-only screens, and writes `public/site/screens/` |
| Sign in | `demo@meridian.example` (a read-only viewer) with `DEMO_PASSWORD` (`meridian-demo-local` on the local stack only) |
| Admin | optional: `DEMO_ADMIN_EMAIL` with `DEMO_ADMIN_PASSWORD`, added as an admin |

## What it holds

- **People** (`scripts/demo/people.ts`): nine fictional people: the owner, Hannah Whitfield (`owner@meridian.example`,
  job title Top management), the quality manager, the ISMS lead (information security officer), the HSE manager, the
  DPO, two editors, an external auditor whose access ends 45 days after the build (example.com addresses), and the
  demo login, Sam Carter (`demo@meridian.example`, non-executive director), a **viewer**. Only the demo login can
  sign in: the owner and the others are blocked when the build finishes, and the seed acts as them through one-time
  sign-in links (owner decision 17 Nov 2026). With `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` set, that person is
  an admin as well (below).
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
`createManagementReview` and `runDateChecksNow`. The seed never acts as the demo login: a viewer changes nothing. So validation, status rules, RLS, the command gate (0053), the
activity log and its hash chains, automations and their run log are the real ones.

The commands run outside Next.js through `scripts/demo/runtime.cjs` (preloaded with `tsx --require`): it resolves
`server-only` to its empty module, as the server build does, and gives `next/headers` a cookie jar that holds the
session of the person the seed is acting as (`scripts/demo/session.ts`: a one-time sign-in link from the auth admin
API, never emailed).

**Repeatable.** A workspace already at `/meridian-demo` is refused with a message, unless `DEMO_RESET=1`: the old one
is then renamed aside (`meridian-demo-retired-<time>`, its members removed) and a new one is built. The seed marks
every demo workspace `settings.demo = true` (the service role only; no API session can set or clear it, 0078).
`pnpm seed:demo:purge` then deletes the retired copies through `purge_demo_workspace` (0078): the one way past the
append-only activity log, for a workspace that is marked as a demo copy and has no members, run by the service role
only. Their stored files are removed through the Storage API first. So a rebuild and a purge leave one demo
workspace.

## The live demo (owner decisions of 17 Nov 2026)

On the live site, visitors sign in to the demo as a **read-only viewer**. The workspace is rebuilt every night by a
GitHub Action, so whatever a visitor did is gone by the morning.

### Who is in it

| Login | Role | Signs in | Used for |
|---|---|---|---|
| `demo@meridian.example` (Sam Carter) | viewer | yes, with `DEMO_PASSWORD` | visitors of the live site |
| `owner@meridian.example` (Hannah Whitfield) | owner | never: blocked | the seed acts as her (one-time links) |
| the seven other fictional people | admin, editor, auditor | never: blocked | the seed acts as them |
| `DEMO_ADMIN_EMAIL` (optional) | admin | yes, with its own password | the owner's own demos and the screenshots |

The admin login is never hard-coded. It can be the owner's own address. When the address has no account yet, the
seed creates one with `DEMO_ADMIN_PASSWORD` (named "Demo admin"); when it has one, the seed adds the membership and
leaves the account's password, name and two-step sign-in exactly as they are (so an existing password is never
overwritten by the secret). Set both or neither: one without the other stops the seed.

What a viewer sees (docs/09 §15 has what enforces it): Home, My work, every register that is not restricted, the item
panel with its activity log and "Verify audit trail", the framework libraries, the SoA, dashboards, Insights, the
design map (without where data leaves the workspace, which owners, admins and auditors see), automations and their
run log (with a note that they are read only) and the audit outputs page (without the list of exports). A viewer does
not see Workspace admin, the restricted personal-data sheets (data subject requests, breaches, consent, health
surveillance, environmental communications) or the exports list, and changes nothing. So `pnpm screenshots` takes the
design map, the automations, the run log, the audit pack and the three Workspace admin › Frameworks shots as the admin
login, and everything else as the demo login. It needs `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` set when it runs
(and `pnpm seed:demo` run with them); the home shot now shows the viewer's home.

### The nightly rebuild

`.github/workflows/demo-nightly.yml` runs at 03:17 UTC and on demand (Actions › Demo nightly › Run workflow). It is
not a required check: it never runs on a pull request. One run at a time (concurrency group `demo-nightly`). It
checks the secrets are there and names any that is missing, then runs `SEED_ALLOW_REMOTE=1 DEMO_RESET=1 pnpm seed:demo`
and `pnpm seed:demo:purge`. Nothing prints a secret. A failed rebuild leaves the retired copies in place (the purge
only runs after a good build); the next good night removes them. Each run also resets the demo login: its password
from `DEMO_PASSWORD`, its name, its block lifted, and any two-step factor a visitor added removed.

### The owner's steps

1. **Apply 0078 to the hosted database** (scripts/hosted/README.md, "Purging retired demo copies"), after the deploy
   that carries this branch.
2. **Create the GitHub secrets**: GitHub › the repository › Settings › Secrets and variables › Actions › New
   repository secret, one each:
   - `DEMO_SUPABASE_URL`: the hosted project's URL (Supabase › Project settings › API), `https://<ref>.supabase.co`
   - `DEMO_SUPABASE_ANON_KEY`: the project's anon (public) key
   - `DEMO_SUPABASE_SERVICE_ROLE_KEY`: the project's service role key
   - `DEMO_COMMAND_SECRET`: the same value as Vercel's `SUPABASE_COMMAND_SECRET` (the command gate, 0053)
   - `DEMO_PASSWORD`: the demo login's password, at least 12 characters. If it will be public on the sign-in page
     (step 5), use a password used nowhere else
   - optional, both or neither: `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` (at least 12 characters; used only when
     the address has no account yet)
   - optional: the repository **variable** (Variables tab, not a secret) `DEMO_APP_URL` if the app is not at
     `https://www.klarert.com`: links the automations write into the demo point there
3. **Enable the workflow** once GitHub Actions billing is fixed: Actions › Demo nightly. Scheduled workflows run on
   the default branch only, so it starts once this is merged to `main`.
4. **The first run by hand**: Actions › Demo nightly › Run workflow (branch `main`). It takes some minutes. Check the
   log ends with "1 retired demo copies purged" or "0 …" and "Demo workspaces now: /meridian-demo.", then sign in as
   `demo@meridian.example` on the live site and look around.
5. **The sign-in link (optional)**: Vercel › the project › Settings › Environment Variables, Production:
   `NEXT_PUBLIC_DEMO_EMAIL` = `demo@meridian.example`, and either `NEXT_PUBLIC_DEMO_PASSWORD` = the value of
   `DEMO_PASSWORD` (the password is then public) or nothing (the page says "Ask us for the demo password"). Redeploy.
   The sign-in page then shows a quiet "Try the demo workspace" link, which shows the details and fills them in. Off
   when `NEXT_PUBLIC_DEMO_EMAIL` is not set (the default). Keep the two passwords the same: a changed `DEMO_PASSWORD`
   needs the Vercel variable changed and a redeploy too.

### Risks

- **A shared login can be locked for a day.** Everyone signs in as the same viewer. Supabase Auth lets any signed-in
  person change their own password, add an authenticator app (two-step sign-in), change their name or delete their
  account, directly against Supabase's API, past the app. One visitor can so lock the others out until the next
  rebuild, which resets the password, removes the factors, restores the name and recreates a deleted login. Changing
  the email address needs the old address to confirm (`mailer_secure_email_change_enabled` is on, and `.example`
  receives no mail), so it cannot complete. A stronger fix is open (below).
- **Visitors see each other's traces** until the night: saved personal views, read notifications, the display name
  if someone changed it. Nothing they can write reaches the registers (docs/09 §15).
- **The service role key lives in GitHub** as a secret. Anyone who can change workflows on `main` could use it.
  Keep branch protection on `main` and give write access to people who may hold that key. Rotate it in Supabase and
  in the secret if in doubt.
- **The purge deletes.** It is limited in SQL to workspaces marked as demo copies (which only the service role can
  mark) with no members; the live demo always has members. A mistake in the seed cannot reach a customer's workspace
  through it.
- **A failed night** leaves yesterday's demo retired and today's half-built at `/meridian-demo`; the next good run
  replaces it. The workflow fails visibly (GitHub emails the people who watch Actions).
- **Load**: the build writes about 250 items with history through the app's own commands on the production project,
  once a night at 03:17 UTC, a quiet hour for European customers.

### Switching it off

- The link: remove `NEXT_PUBLIC_DEMO_EMAIL` (and `NEXT_PUBLIC_DEMO_PASSWORD`) in Vercel and redeploy.
- The rebuild: Actions › Demo nightly › ⋯ › Disable workflow (or delete `.github/workflows/demo-nightly.yml`).
- The login: block `demo@meridian.example` in Supabase › Authentication › Users, or delete the GitHub secret
  `DEMO_PASSWORD` (the next run then fails at the secrets check and changes nothing).
- The workspace itself stays at `/meridian-demo`, with nobody able to sign in once the login is blocked. The purge
  never takes it (it has members). Removing it for good is a separate decision: no command does that today.

### Open (for the owner)

- **Account changes on the shared login.** Today the nightly reset is the only remedy for a visitor who changes the
  demo login's password, adds two-step sign-in or deletes it. Options: (a) accept a day's lock-out at worst (as
  built); (b) refuse those changes in the app for the demo address and have the seed check, before each run, that
  the password still works; (c) rebuild more often (hourly costs more load). Recommendation: (a) now; (b) if it
  happens.
