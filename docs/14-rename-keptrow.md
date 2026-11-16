# 14 · Rename to Keptrow: what changed and the go-live runbook

Owner decision, 16 Nov 2026, after advisory board rounds: the product "Compliance OS" (by Klarert, on klarert.com)
becomes **Keptrow** on **www.keptrow.com**. Reasons for the record: "Compliance OS" is taken by anecdotes.ai, and
"Klarert" is hard to spell in the UK and the US.

The code is ready on the branch `claude/keptrow-rename`. It goes live only after the trademark search and the owner's
DNS, Brevo, Vercel and Supabase steps below, in that order. Nothing here touches the hosted database or settings until
the owner runs the steps.

## 1. The name

| What | Value | Where |
|---|---|---|
| Name in running text | **Keptrow** (exactly so) | `BRAND.product`, `src/lib/brand.ts` |
| Wordmark | `Keptrow` (default). The board designer's camel-case option "KeptRow" is a one-line change | `BRAND.wordmark` |
| Descriptor | "Keptrow — the compliance spreadsheet" | `BRAND.descriptor`: the home page title, the footer, the share image |
| Site | `https://www.keptrow.com` (primary), canonical, sitemap, robots | `SITE_URL`; `SITE.url` in `src/components/landing/content.ts` |
| Support | `support@keptrow.com` | `SUPPORT_EMAIL`; `CONTACT` in content.ts; the security alert templates; `auth-config.py` |
| Email sender | `Keptrow <no-reply@mail.keptrow.com>` | `EMAIL_SENDER` (local Mailpit), Vercel `EMAIL_FROM` (hosted), `.env.example` |
| Authenticator label | `Keptrow` | `ISSUER`, `src/server/commands/two-step.ts` |
| Company | The legal entity stays the placeholder `[Company legal name]` in `legal.ts`; "by Klarert" is gone from the wordmark and the footer | `src/components/landing/legal.ts` |

`content.ts` re-exports `BRAND`, so the landing code keeps one import. Every page title, the sign-in pages' heading,
the invite email, the auth email subjects and templates, the webhook User-Agent (`Keptrow-Webhooks/1.0`) and the public
form footer read the constants. `src/lib/brand.test.ts` fails if "Compliance OS" (any spacing or case) appears in
`src/` or `supabase/templates/`, or "klarert" appears outside the allow-list below, each entry with its reason.

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

The apex `keptrow.com` goes to `www.keptrow.com` through Vercel's primary-domain setting (step 3).

Consequences to expect on the day:

- Sign-in cookies are per host, so everyone signs in again on www.keptrow.com.
- An email link sent before the switch (sign-in, reset, confirm) points at klarert.com. The redirect carries it to
  www.keptrow.com, but a link that needs the browser's sign-in cookie from klarert.com fails; the person asks for a
  new link. Invite links (`/invite/<token>`) and public form links (`/f/<token>`) keep working through the redirect.
- Printed QR posters and shared form links point at klarert.com; they work through the redirect for as long as it
  stands (see step 10).

## 3. What keeps "klarert" on purpose (never rename)

| String | Where | Why |
|---|---|---|
| `x-klarert-command` | `src/lib/supabase/command-proof.ts`, migration 0053, pgTAP 0044 | The header the database's `api_request_guard` checks on every write |
| `klarert_command_secret` | Vault secret, migration 0053, `supabase/seed.sql`, `scripts/hosted/README.md`, `.env.example` | The database reads the secret by this name |
| `klarert-local-command-secret` | `LOCAL_COMMAND_SECRET`, `supabase/seed.sql` | The local secret's value, seeded into every developer's database |
| `X-Klarert-Signature` | `src/server/webhooks/worker.ts`, the automation builder's help text, migration 0056, docs/04 | Webhook receivers already verify this header |
| "Klarert mapping v1" | `templates/frameworks/crosswalks.json`, migration 0030, docs/02, docs/12 | Stored as the source of every cross-walk and cited on audit outputs; a new mapping version may carry the new name |
| `klarert.setup-dismissed.*` | `src/components/packs/setup-card.tsx` | A browser storage key; renaming it brings back every dismissed setup card |
| `project_id = "klarert.com"` | `supabase/config.toml` | Names the local Docker containers and volumes; changing it starts every local database afresh |
| Applied migrations and DB function names | `supabase/migrations/*` | Applied migrations are never edited (CLAUDE.md) |
| The repository `klarert.com` | GitHub | Owner decision: the repo keeps its name |
| `klarert.com`, `www.klarert.com` | `src/lib/site/legacy-domain.ts` | The redirect above |
| `mail.klarert.com` | Brevo | Stays authenticated through the transition (step 4) |

Each place in the code carries a comment that points here.

## 4. Go-live runbook (owner), in order

1. **Trademark clearance.** Search "Keptrow" (and close variants such as "KeptRow", "Keprow", "Keep Row") in EUIPO
   (eSearch plus / TMview), USPTO (Trademark Search) and UKIPO, in **classes 9 (software) and 42 (SaaS)**. Do not go on
   if there is a live conflicting mark; ask a trademark attorney when unsure. Consider filing in the same classes.
2. **DNS at the keptrow.com registrar.**
   - Apex `keptrow.com`: the A record Vercel shows (Vercel › Domains gives the exact value).
   - `www.keptrow.com`: CNAME to the target Vercel shows (`cname.vercel-dns.com` or the project-specific one).
   - Brevo for `mail.keptrow.com`: the `brevo-code` TXT (ownership), the DKIM record(s) and a DMARC TXT
     (`_dmarc.mail.keptrow.com` or the apex's, one per name), exactly as Brevo lists them in step 4.
   - Leave the klarert.com DNS as it is (its apex and www stay on Vercel; `mail.klarert.com` stays on Brevo).
3. **Vercel domains.** Project › Settings › Domains: add `www.keptrow.com` and `keptrow.com`; set
   **www.keptrow.com as primary** and let `keptrow.com` redirect to it (choose 301 or 308). Keep `klarert.com` and
   `www.klarert.com` attached as ordinary domains of the project, with no redirect option set on them: the app's own
   rule (§2) sends them to www.keptrow.com with a 301 and the same path.
4. **Brevo.** Senders, Domains & Dedicated IPs › Domains › add and **authenticate** `mail.keptrow.com` (after step 2's
   records resolve). Senders › add `Keptrow` / `no-reply@mail.keptrow.com`. Transactional › Settings: keep open and
   click **tracking off**. Keep `mail.klarert.com` authenticated during the 12 months (old mail threads, and the
   fallback if anything goes wrong). The API key and SMTP key do not change.
5. **Vercel environment (Production).** `EMAIL_FROM` = `Keptrow <no-reply@mail.keptrow.com>` and
   `NEXT_PUBLIC_APP_URL` = `https://www.keptrow.com` (invite, reset, form and poster links are built from it, and a
   `NEXT_PUBLIC_` value is baked in at build time, so it takes effect with the deploy in step 7).
6. **Supabase Auth.** Dashboard › Authentication › URL Configuration › Redirect URLs: add
   `https://www.keptrow.com/**` and `https://keptrow.com/**`, and **keep the klarert.com ones** during the transition.
   In Authentication › Emails › SMTP Settings, change the sender to `no-reply@mail.keptrow.com`, name `Keptrow`
   (SMTP must be configured first: `scripts/hosted/README.md` › Auth emails). Then the main session runs
   `python3 scripts/hosted/auth-config.py --dry-run` and, when it shows only the expected changes (`site_url` →
   `https://www.keptrow.com`, the six subjects and templates), `python3 scripts/hosted/auth-config.py`.
7. **Merge** the branch `claude/keptrow-rename` to `main` (one PR; Vercel deploys production).
8. **Checks on www.keptrow.com.**
   - `https://klarert.com/privacy` and `https://www.klarert.com/login?mode=signup` answer 301 to the same path on
     www.keptrow.com; `https://keptrow.com` goes to www.
   - Sign in with an email link: the email comes from `Keptrow <no-reply@mail.keptrow.com>`, its subject says Keptrow
     and the link opens www.keptrow.com.
   - Invite a second address from Workspace admin › Members: the email says "… on Keptrow", the link is on
     www.keptrow.com and joins. The Vercel log shows `"transport":"brevo","outcome":"sent"`.
   - Forgot password: the reset email arrives and Set a new password works; the "password was changed" alert names
     `support@keptrow.com`.
   - Two-step: set up an authenticator app on a test account; the app shows "Keptrow (<email>)". An app set up before
     the rename still signs in.
   - The page source of `/` has the canonical `https://www.keptrow.com`, the title "Keptrow — the compliance
     spreadsheet", and `/robots.txt` names `https://www.keptrow.com/sitemap.xml`.
9. **Search Console.** Verify the `keptrow.com` domain property, then in the klarert.com property use **Settings ›
   Change of address** to www.keptrow.com and submit `https://www.keptrow.com/sitemap.xml`.
10. **After 12 months, retire klarert.com.** First check the Vercel logs for traffic still arriving on klarert.com
    (printed posters, old form links, webhooks configured by people), reprint posters and tell the owners of any
    remaining links. Then remove the klarert redirect URLs from Supabase, retire `mail.klarert.com` in Brevo, remove
    `LEGACY_REDIRECTS` (and its tests and the allow-list entries) in a PR, and detach the domains from Vercel. Keep
    the klarert.com registration itself so nobody else can take it.
