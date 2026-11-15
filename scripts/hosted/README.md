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

## Auth emails

Supabase Auth sends the sign-in emails itself: confirm sign-up, sign-in link, reset password and change of email
address (docs/09 §11). Invites are our own email (Brevo, `src/server/email/`), so Supabase's invite template is not
used. The subjects and HTML live in the repo (`supabase/templates/*.html`, subjects in `supabase/config.toml`
`[auth.email.template.*]`); Supabase Auth makes the plain-text part from the HTML.

`python3 scripts/hosted/auth-config.py --dry-run` prints, key by key, what differs on the hosted project; without
`--dry-run` it PATCHes the Management API (`/v1/projects/{ref}/config/auth`). It sets `site_url`
(`https://www.klarert.com`), `password_min_length` (12), `mailer_secure_email_change_enabled` (on) and the subject and
HTML of the four templates, and lists the settings it leaves alone. It never sets SMTP settings or credentials.

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
4. In Brevo, keep open and click tracking off for transactional email (as for invites, docs/09 §10), so the links in
   these emails are not rewritten through a tracking domain and no tracking pixel is added.

Then run `auth-config.py` (the main session does) and send yourself a reset link from `/login/forgot-password` to
check the sender, the subject and that the link opens Set a new password.
