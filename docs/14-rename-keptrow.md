# 14 · Rename to Keptrow: what changed and the go-live runbook

Owner decision, 16 Nov 2026, after advisory board rounds: the product "Compliance OS" (by Klarert, on klarert.com)
becomes **Keptrow** on **www.keptrow.com**. Reasons for the record: "Compliance OS" is taken by anecdotes.ai, and
"Klarert" is hard to spell in the UK and the US.

On 17 Nov 2026 the owner bought keptrow.com and decided to **switch now**; the trademark search runs in parallel and
does not hold up go-live (owner decision). The code is ready on the branch `claude/keptrow-rename`, brought up to date
with `main` on 17 Nov 2026 (own frameworks, private packs, email invites, the `/auth/confirm` Continue page, the ISO
9001 page, the demo workspace, landing v2, privacy and terms all read `BRAND`). It goes live with the owner's DNS,
Vercel, Brevo and Supabase steps in §4, in that order. Nothing here touches the hosted database or settings until the
owner runs the steps.

## 1. The name

| What | Value | Where |
|---|---|---|
| Name in running text | **Keptrow** (exactly so) | `BRAND.product`, `src/lib/brand.ts` |
| Wordmark | `Keptrow` (default). The board designer's camel-case option "KeptRow" is a one-line change | `BRAND.wordmark` |
| Descriptor | "Keptrow — the compliance spreadsheet" | `BRAND.descriptor`: the home page title, the footer, the share image |
| Site | `https://www.keptrow.com` (primary), canonical, sitemap, robots | `SITE_URL`; `SITE.url` in `src/components/landing/content.ts` |
| Support | `support@keptrow.com` | `SUPPORT_EMAIL`; `CONTACT` in content.ts; the security alert templates; `auth-config.py` |
| Email sender | `Keptrow <no-reply@keptrow.com>`, on the **root domain** (owner decision 17 Nov 2026: Brevo authenticates the root, as `no-reply@klarert.com` before) | `EMAIL_SENDER` (local Mailpit), Vercel `EMAIL_FROM` (invites), Supabase SMTP sender (auth emails, set by `auth-config.py`), `.env.example` |
| Authenticator label | `Keptrow` | `ISSUER`, `src/server/commands/two-step.ts` |
| Company | The legal entity stays the placeholder `[Company legal name]` in `legal.ts`; "by Klarert" is gone from the wordmark and the footer | `src/components/landing/legal.ts` |

`content.ts` re-exports `BRAND`, so the landing code keeps one import. Every page title, the sign-in pages' heading,
the Continue page of email links (`/auth/confirm`, "Sign in to Keptrow"), the invite email, the auth email subjects
and templates, the ISO 9001 page, the legal pages, "Not reviewed by Keptrow" on own frameworks and private packs, the
webhook User-Agent (`Keptrow-Webhooks/1.0`) and the public form footer read the constants. `src/lib/brand.test.ts`
scans `src/`, `supabase/templates/`, `scripts/`, `tests/`, `templates/` and the config files beside them, and fails
if "Compliance OS" (any spacing or case) or "klarert" appears outside its allow-lists (each entry with its reason),
or if any `mail.` sending subdomain comes back.

**Two-step sign-in.** The issuer only goes into the `otpauth://` address of a new set-up's QR code and typed-in key.
Supabase Auth stores a factor's secret and friendly name, not the issuer, and checks a code against the secret alone.
So changing `ISSUER` changes the label of apps set up from now on; apps set up before keep showing "Compliance OS"
and their codes keep working. Removing the app and adding it again (Your account) shows the new name. No migration,
no reset, nobody is locked out.

**Headers.** `Strict-Transport-Security: max-age=63072000; includeSubDomains` names no domain, so `next.config.ts`
needs no change. Browsers that hold the policy for `www.klarert.com` keep it, and that host only answers with HTTPS
redirects. The other headers (CSP `frame-ancestors 'self'`, X-Frame-Options, Referrer-Policy, Permissions-Policy)
are host-neutral.

## 2. klarert.com becomes a redirect

`klarert.com` and `www.klarert.com` answer **301** to the same path and query on `https://www.keptrow.com` for at
least 12 months. The rule is `LEGACY_REDIRECTS` in `src/lib/site/legacy-domain.ts`, served by `next.config.ts`
`redirects()` (host-based `has` rules, applied by Vercel before any page or middleware). Unit tests:
`src/lib/site/legacy-domain.test.ts`; end to end: `tests/e2e/landing.spec.ts` (requests with each old Host header).
For the rule to run, both klarert domains must stay **attached to the Vercel project as ordinary domains** (not
removed, and not set to Vercel's own "redirect to" option, which would answer first with its own status code).

The apex `keptrow.com` goes to `www.keptrow.com` through Vercel's primary-domain setting (§4 step 2).

Consequences to expect on the day:

- Sign-in cookies are per host, so everyone signs in again on www.keptrow.com.
- An email link sent before the switch points at klarert.com. Our templates' links
  (`/auth/confirm?token_hash=…&type=…&redirect_to=…`) are a GET, so the 301 carries them to www.keptrow.com with the
  whole query; the Continue page there posts to `/auth/callback` on the new host, and the token works on any browser,
  so they keep working (tests: `legacy-domain.test.ts`, and `landing.spec.ts` "an email link sent from klarert.com").
  A `redirect_to` still naming klarert.com is fine: only its path is read (`emailLinkNext`). A link from Supabase's
  default templates (a PKCE `code`, sent while the hosted project had no custom SMTP) also reaches
  `/auth/callback?code=…` on www.keptrow.com, but its code needs the verifier cookie of the browser that asked on
  klarert.com, so it fails with "ask for a new link". Invite links (`/invite/<token>`) and public form links
  (`/f/<token>`) keep working through the redirect.
- A person half-way through a password reset (between opening the link and setting the password) at the deploy asks
  for a new link: the reset-link cookie is per host.
- Printed QR posters and shared form links point at klarert.com; they work through the redirect for as long as it
  stands (see After go-live in §4).

## 3. What keeps "klarert" on purpose (never rename)

| String | Where | Why |
|---|---|---|
| `x-klarert-command` | `src/lib/supabase/command-proof.ts`, migration 0053, pgTAP 0044 | The header the database's `api_request_guard` checks on every write |
| `klarert_command_secret` | Vault secret, migration 0053, `supabase/seed.sql`, `scripts/hosted/README.md`, `.env.example` | The database reads the secret by this name |
| `klarert-local-command-secret` | `LOCAL_COMMAND_SECRET`, `supabase/seed.sql` | The local secret's value, seeded into every developer's database |
| `X-Klarert-Signature` | `src/server/webhooks/worker.ts`, the automation builder's help text, migration 0056, docs/04 | Webhook receivers already verify this header |
| "Klarert mapping v1" | `templates/frameworks/crosswalks.json`, migration 0030, docs/02, docs/12 | Stored as the source of every cross-walk and cited on audit outputs; a new mapping version may carry the new name |
| `klarert.setup-dismissed.*` | `src/components/packs/setup-card.tsx` | A browser storage key; renaming it brings back every dismissed setup card |
| `klarert-reset-link` | `RESET_LINK_COOKIE`, `src/lib/reset-link.ts` | The httpOnly cookie that marks a session opened by a reset link. Never shown; cookies are per host, so the switch already ends any reset under way, and a new name would only do the same on a later deploy. Kept to change nothing for nothing |
| `project_id = "klarert.com"` | `supabase/config.toml` | Names the local Docker containers and volumes; changing it starts every local database afresh |
| Applied migrations and DB function names | `supabase/migrations/*` | Applied migrations are never edited (CLAUDE.md) |
| The repository `klarert.com` | GitHub | Owner decision: the repo keeps its name |
| `klarert.com`, `www.klarert.com` | `src/lib/site/legacy-domain.ts` | The redirect above |
| `klarert.com` in Brevo | Brevo | Stays authenticated through the transition (step 3); the old sender is `no-reply@klarert.com` |
| klarert.com in Supabase redirect URLs | Supabase Auth | Kept through the transition (step 5) |

Each place in the code carries a comment that points here.

## 4. Go-live runbook (owner), in order

The **trademark search** ("Keptrow" and close variants such as "KeptRow", "Keprow", "Keep Row"; EUIPO eSearch plus /
TMview, USPTO, UKIPO; classes 9 and 42) runs **in parallel** and does not hold up these steps (owner decision 17 Nov
2026). If it finds a live conflicting mark, stop and ask a trademark attorney; the name is one constant
(`src/lib/brand.ts`), the domain a few more.

1. **DNS at the keptrow.com registrar.**
   - Apex `keptrow.com`: the A record Vercel shows (Vercel › Domains gives the exact value).
   - `www.keptrow.com`: CNAME to the target Vercel shows (`cname.vercel-dns.com` or the project-specific one).
   - Brevo for the **root domain** `keptrow.com`: the `brevo-code` TXT (ownership), the DKIM record(s) and a DMARC TXT
     on `_dmarc.keptrow.com` (only one DMARC record per name; keep an existing one), exactly as Brevo lists them in
     step 3. If the registrar already has an SPF TXT on the apex, merge Brevo's include into it rather than adding a
     second SPF record.
   - Leave the klarert.com DNS as it is (its apex and www stay on Vercel; its Brevo records stay).
2. **Vercel domains.** Project › Settings › Domains: add `www.keptrow.com` and `keptrow.com`; set
   **www.keptrow.com as primary** and let `keptrow.com` redirect to it (choose 301 or 308). Keep `klarert.com` and
   `www.klarert.com` attached as ordinary domains of the project, with no redirect option set on them: the app's own
   rule (§2) sends them to www.keptrow.com with a 301, the same path and the same query.
3. **Brevo.** Senders, Domains & Dedicated IPs › Domains › add and **authenticate** `keptrow.com` (the root, after
   step 1's records resolve). Senders › add `Keptrow` / `no-reply@keptrow.com`. Transactional › Settings: keep open
   and click **tracking off**. Keep klarert.com authenticated during the 12 months (old mail threads, and the fallback
   if anything goes wrong). The API key and SMTP key do not change.
4. **Vercel environment (Production).** `NEXT_PUBLIC_APP_URL` = `https://www.keptrow.com` and `EMAIL_FROM` =
   `Keptrow <no-reply@keptrow.com>`, then **redeploy** (invite, reset, form and poster links are built from
   `NEXT_PUBLIC_APP_URL`, a `NEXT_PUBLIC_` value baked in at build time; until the merge in step 6 the deployed `main`
   still says Compliance OS, but its links and invites already go to www.keptrow.com, which serves the same app).
5. **Supabase Auth redirect URLs.** Dashboard › Authentication › URL Configuration › Redirect URLs: add
   `https://www.keptrow.com/**` and `https://keptrow.com/**`, and **keep the klarert.com ones** during the transition.
6. **Merge** the branch `claude/keptrow-rename` to `main` (one PR; Vercel deploys production). Then the main session
   runs `python3 scripts/hosted/auth-config.py --dry-run` and, when it shows only the expected changes (`site_url` →
   `https://www.keptrow.com`, the subjects and templates of the four auth emails and the two alerts, and, with SMTP set
   up, `smtp_admin_email` → `no-reply@keptrow.com` and `smtp_sender_name` → `Keptrow`), `python3
   scripts/hosted/auth-config.py`. The script sets the sender through the Management API (`PATCH
   /v1/projects/{ref}/config/auth`), never the SMTP host, user or key. Without custom SMTP (`scripts/hosted/README.md`
   › Auth emails) it leaves the sender alone and says so, and Supabase keeps sending its default templates.
7. **Checks on www.keptrow.com.**
   - `https://klarert.com/privacy` and `https://www.klarert.com/login?mode=signup` answer 301 to the same path on
     www.keptrow.com; `https://keptrow.com` goes to www.
   - An email link from before the switch: `https://www.klarert.com/auth/confirm?token_hash=x&type=email` answers
     301 to `https://www.keptrow.com/auth/confirm?token_hash=x&type=email` (`curl -sI`).
   - Sign in with an email link: the email comes from `Keptrow <no-reply@keptrow.com>`, its subject says Keptrow, the
     link starts with `https://www.keptrow.com/auth/confirm?token_hash=` and the Continue page says "Sign in to
     Keptrow".
   - Invite a second address from Workspace admin › Members: the email comes from `Keptrow <no-reply@keptrow.com>`,
     says "… on Keptrow", the link is on www.keptrow.com and joins. The Vercel log shows
     `"transport":"brevo","outcome":"sent"`.
   - Forgot password: the reset email arrives and Set a new password works; the "password was changed" alert names
     `support@keptrow.com`.
   - Two-step: set up an authenticator app on a test account; the app shows "Keptrow (<email>)". An app set up before
     the rename still signs in.
   - The page source of `/` has the canonical `https://www.keptrow.com`, the title "Keptrow — the compliance
     spreadsheet", the `og:image` on `https://www.keptrow.com/opengraph-image`, and `/robots.txt` names
     `https://www.keptrow.com/sitemap.xml`; `/standards/iso-9001` is titled "ISO 9001 · Keptrow".
   - Mail to `support@keptrow.com` reaches the owner (set up the mailbox or forward at the registrar).

After go-live:

- **Search Console.** Verify the `keptrow.com` domain property, then in the klarert.com property use **Settings ›
  Change of address** to www.keptrow.com and submit `https://www.keptrow.com/sitemap.xml`.
- **After 12 months, retire klarert.com.** First check the Vercel logs for traffic still arriving on klarert.com
  (printed posters, old form links, webhooks configured by people), reprint posters and tell the owners of any
  remaining links. Then remove the klarert redirect URLs from Supabase, retire klarert.com in Brevo, remove
  `LEGACY_REDIRECTS` (and its tests and the allow-list entries) in a PR, and detach the domains from Vercel. Keep the
  klarert.com registration itself so nobody else can take it.
