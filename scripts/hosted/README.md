# Hosted database scripts

Run from the repo root against the hosted Supabase project (Frankfurt). The session's network proxy injects the
Management API token; nothing secret lives here.

- `python3 scripts/hosted/apply.py`: apply migrations not yet recorded
- `python3 scripts/hosted/runtests.py`: run pgTAP tests in rolled-back transactions
- `python3 scripts/hosted/q.py "select 1"`: ad-hoc SQL
- `python3 scripts/hosted/q.py -f catalogue.sql`: load output of `scripts/frameworks-sql.ts` or `scripts/packs-sql.ts`

After merging a migration or a catalogue change: `apply.py`, then regenerate and load the catalogue SQL.

## The command gate secret (migration 0053)

From 0053 the database refuses writes from people that do not carry the app server's proof. Before applying 0053,
in this order:

1. Generate a random value (`openssl rand -hex 32`).
2. Vercel (Production and Preview): set `SUPABASE_COMMAND_SECRET` to it and redeploy. The app then signs its writes;
   the database ignores the header until 0053 is applied.
3. Supabase dashboard › Project settings › Vault (or SQL): `select vault.create_secret('<value>', 'klarert_command_secret');`
4. Apply 0053 (`apply.py`). It sets `pgrst.db_pre_request` on the `authenticator` role and reloads PostgREST.

To rotate: add the new value with `vault.update_secret` and change the Vercel variable in the same minute; requests
signed with the old value are refused from then on. Without the Vault secret every write by a person is refused.

## Email (Brevo, docs/09 §11)

Invites are sent by email through Brevo's transactional API (the owner's existing account; Brevo keeps data in the EU,
in France and Germany). Without these steps nothing is sent: admins see "The email could not be sent. Copy the link
instead." and invites still work by copying the link. No migration or database setting is needed.

1. Brevo › Senders, Domains & Dedicated IPs › Domains › Add a domain: `mail.klarert.com` (or `klarert.com`), and
   choose to authenticate it. At the DNS host of `klarert.com`, add the records Brevo lists exactly as shown: the
   `brevo-code` TXT record (ownership), the DKIM record(s) and the DMARC TXT record (if `klarert.com` already has a
   DMARC record, keep it and do not add a second one for the same name). Press Authenticate in Brevo and wait until
   the domain shows Authenticated.
2. Brevo › Senders, Domains & Dedicated IPs › Senders › Add a sender: name `Compliance OS`, address
   `no-reply@mail.klarert.com` (an address on the authenticated domain).
3. Brevo › Transactional › Settings (tracking): turn off open tracking and click tracking if the account allows it.
   The app already asks for no open pixel and anonymised clicks per message, but only the account setting stops
   Brevo rewriting the accept link (docs/09 §11).
4. Brevo › SMTP & API › API keys › Generate a new API key, named for example `klarert-vercel`. Copy it once.
5. Vercel › the project › Settings › Environment Variables, for **Production only** (owner decision 15 Nov 2026:
   previews never email real people; there an invite falls back to its copy-link):
   - `BREVO_API_KEY` = the key (mark it Sensitive);
   - `EMAIL_FROM` = `Compliance OS <no-reply@mail.klarert.com>` (the sender from step 2).
   Redeploy so the functions pick them up.
6. Check: invite your own second address from Workspace admin › Members. The toast says "Invite sent to …". The
   Vercel function log shows `{"source":"email","tag":"invite","transport":"brevo","outcome":"sent"}`; without the
   key it shows `BREVO_API_KEY is not set: no email is sent …`, and with a wrong key `"outcome":"rejected","status":401`.

To rotate the key: generate a new one, change `BREVO_API_KEY` in Vercel, redeploy, then delete the old key in Brevo.
Preview deployments send real mail to the addresses invited there; leave the key out of Preview if that is not wanted.

## Auth emails

Supabase Auth sends the sign-in emails itself: confirm sign-up, sign-in link, reset password and change of email
address, and the security alerts when a password or an email address has changed (docs/09 §12). Invites are our own email (Brevo, `src/server/email/`), so Supabase's invite template is not
used. The subjects and HTML live in the repo (`supabase/templates/*.html`, subjects in `supabase/config.toml`
`[auth.email.template.*]`); Supabase Auth makes the plain-text part from the HTML.

The four link emails link to `{{ .SiteURL }}/auth/confirm` with `token_hash`, `type` and `redirect_to` (and `next`
for reset and email change): a page with one button, whose click posts to `/auth/callback`, which opens the session
with `verifyOtp`. So the links show our own address, work on any device, and a link scanner (Microsoft Defender Safe
Links) that opens every link in an email first does not use up the one-time token (docs/09 §12). The callback still
opens token-hash links by GET for emails sent before this change; that path goes two weeks after the templates are
applied (docs/09 §12).
Supabase's default templates link to `https://<ref>.supabase.co/auth/v1/verify` and come back with a PKCE code that
only the browser that asked can use: a reset link opened on a phone then fails with "This link has to be opened in the
same browser you asked from, or it has expired." Supabase refuses custom templates while the project has no custom
SMTP, so set up SMTP (below) before running `auth-config.py`. `auth-config.py` refuses a template that still uses
`{{ .ConfirmationURL }}`, that links straight to `/auth/callback?token_hash=`, or that lacks its `/auth/confirm` link.

A reset link opened through `verifyOtp` is recognised by an httpOnly cookie signed with `SUPABASE_COMMAND_SECRET`
(docs/09 §12): the Vercel Production environment must have that variable (it already needs it for every write).

`python3 scripts/hosted/auth-config.py --dry-run` prints, key by key, what differs on the hosted project; without
`--dry-run` it PATCHes the Management API (`/v1/projects/{ref}/config/auth`). It sets `site_url`
(`https://www.klarert.com`), `password_min_length` (12), `mailer_secure_email_change_enabled` (on), the subject and
HTML of the four templates, and the security alerts for a changed password or email address
(`mailer_notifications_{password_changed,email_changed}_enabled` on, `mailer_subjects_*_notification` and
`mailer_templates_*_notification_content` from `[auth.email.notification.*]`), and lists the settings it leaves alone.
It never sets SMTP settings or credentials.

### The owner's steps: SMTP through Brevo

Supabase's built-in email service only sends to the project's team and only a few emails an hour, so the hosted
project sends through Brevo.

1. Brevo › SMTP & API › SMTP: note the **SMTP login** and create an **SMTP key** (not an API key; an API key does not
   work as the SMTP password).
2. Supabase dashboard › Authentication › Emails › SMTP Settings: turn on **Enable custom SMTP** and enter
   - host `smtp-relay.brevo.com`, port `587`
   - username: the Brevo SMTP login
   - password: the Brevo SMTP key
   - sender email `no-reply@mail.klarert.com`, sender name `Compliance OS`
   The sending domain `mail.klarert.com` must be authenticated in Brevo (SPF, DKIM, DMARC), as for invites.
3. Supabase dashboard › Authentication › Rate limits › **Rate limit for sending emails**: about **30 per hour**. The
   limit counts every auth email of the project together. Sign-up is open without a bot check, and Forgot password
   answers the same for every address, so a script could otherwise make Supabase send mail to any number of
   addresses: that would use up the Brevo plan's sending quota and harm the sending domain's reputation, which
   invites depend on too. 30 an hour is well above what a small team's real sign-ins and resets need; when it is
   reached, people asking for a link wait until the hour is over. Raise it as the number of users grows.
4. In Brevo, keep open and click tracking off for transactional email (as for invites, docs/09 §11), so the links in
   these emails are not rewritten through a tracking domain and no tracking pixel is added.

Then run `auth-config.py` (the main session does) and send yourself a reset link from `/login/forgot-password` to
check the sender, the subject, that the link starts with `https://www.klarert.com/auth/confirm?token_hash=`, that it
shows "Set a new password" with **Continue to set a new password**, and that the button opens Set a new password, also
when opened on another device (a phone). With a Microsoft 365 mailbox (Defender Safe Links), check that the link still
works after the scanner has opened it.

## Deleting a user (migration 0072, docs/09 §12)

Prefer **Delete my account** (Your account): it asks the only owner of a workspace to hand over first, asks for a
two-step session when the person has an authenticator app, and logs the person as the one who left.

Deleting a user in the Supabase dashboard (Authentication › Users › Delete user) is safe from 0072: a trigger on
`auth.users` removes their memberships (logged `member.removed`, "account deleted by support"), renames the profile
"Former member" and marks it deleted, so everything they made still shows "Former member". Use it only when the person
cannot delete their account themselves, and use a hard delete (the Admin API's soft delete does not run the trigger).

**Risk:** the dashboard path does not refuse the only owner of a workspace. That workspace is left without an owner
(its log entry says "The workspace now has no owner"), and nobody in it can then make someone owner, invite an owner,
restrict sheets or fields, or change two-step sign-in. Before deleting, find the workspaces they own alone:

```sql
select o.id, o.name from memberships m join orgs o on o.id = m.org_id
 where m.user_id = '<user id>' and m.role = 'owner'
   and not exists (select 1 from memberships x where x.org_id = m.org_id and x.role = 'owner' and x.user_id <> m.user_id);
```

Afterwards, give each such workspace an owner again, with the agreement of that workspace's people. `memberships_guard`
lets only an owner or the service role change who owns a workspace, so the statement runs as the service role in one
transaction (logged `member.changed` by the system):

```sql
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update memberships set role = 'owner' where org_id = '<workspace id>' and user_id = '<new owner id>';
```

## Purging retired demo copies (migration 0078, docs/17)

The nightly demo rebuild (`.github/workflows/demo-nightly.yml`) renames yesterday's demo workspace aside and then
removes it with `purge_demo_workspace` (0078). Apply 0078 before the first nightly run; until then the purge step fails
("Could not find the function public.purge_demo_workspace") and the retired copies stay.

1. `python3 scripts/hosted/apply.py` (applies 0078), then `python3 scripts/hosted/runtests.py` (the pgTAP file
   `0078_demo_purge.sql` runs in a rolled-back transaction).
2. Check that no customer workspace is marked as a demo copy (expect no rows, or only `meridian-demo…`):
   `python3 scripts/hosted/q.py "select slug from orgs where settings ? 'demo'"`.
3. Check the grants (expect `service_role` only):
   `python3 scripts/hosted/q.py "select grantee from information_schema.routine_privileges where routine_name = 'purge_demo_workspace'"`.

What 0078 changes on the hosted project: a BEFORE INSERT OR UPDATE trigger on `orgs` (`orgs_demo_flag_guard`: no API
session may add, change or remove `settings.demo`), a BEFORE INSERT trigger on `activity_log` (`activity_0_purge`:
inside the purge of one workspace, entries for that workspace are dropped; every other insert is unchanged) and the
function itself (service role only; it refuses a workspace that is not marked or still has members). It touches no
existing row. Nothing in the app calls the purge; only `pnpm seed:demo:purge` does, as the service role.

A demo workspace built before 0078 has no mark; the next `DEMO_RESET=1` run marks it as it renames it aside, so the
purge after it takes it too.
