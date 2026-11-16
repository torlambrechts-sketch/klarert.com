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
   (The secret's name keeps "klarert" after the rename to Keptrow: migration 0053 reads it by this name, docs/14.)
4. Apply 0053 (`apply.py`). It sets `pgrst.db_pre_request` on the `authenticator` role and reloads PostgREST.

To rotate: add the new value with `vault.update_secret` and change the Vercel variable in the same minute; requests
signed with the old value are refused from then on. Without the Vault secret every write by a person is refused.

## Email (Brevo, docs/09 §11)

Invites are sent by email through Brevo's transactional API (the owner's existing account; Brevo keeps data in the EU,
in France and Germany). Without these steps nothing is sent: admins see "The email could not be sent. Copy the link
instead." and invites still work by copying the link. No migration or database setting is needed.

The product is Keptrow on keptrow.com (docs/14). Until the rename goes live the hosted project still sends from
`mail.klarert.com`; keep that domain authenticated in Brevo through the 12-month transition.

1. Brevo › Senders, Domains & Dedicated IPs › Domains › Add a domain: `mail.keptrow.com`, and
   choose to authenticate it. At the DNS host of `keptrow.com`, add the records Brevo lists exactly as shown: the
   `brevo-code` TXT record (ownership), the DKIM record(s) and the DMARC TXT record (if `keptrow.com` already has a
   DMARC record, keep it and do not add a second one for the same name). Press Authenticate in Brevo and wait until
   the domain shows Authenticated.
2. Brevo › Senders, Domains & Dedicated IPs › Senders › Add a sender: name `Keptrow`, address
   `no-reply@mail.keptrow.com` (an address on the authenticated domain).
3. Brevo › Transactional › Settings (tracking): turn off open tracking and click tracking if the account allows it.
   The app already asks for no open pixel and anonymised clicks per message, but only the account setting stops
   Brevo rewriting the accept link (docs/09 §11).
4. Brevo › SMTP & API › API keys › Generate a new API key, named for example `keptrow-vercel`. Copy it once.
5. Vercel › the project › Settings › Environment Variables, for **Production only** (owner decision 15 Nov 2026:
   previews never email real people; there an invite falls back to its copy-link):
   - `BREVO_API_KEY` = the key (mark it Sensitive);
   - `EMAIL_FROM` = `Keptrow <no-reply@mail.keptrow.com>` (the sender from step 2).
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

`python3 scripts/hosted/auth-config.py --dry-run` prints, key by key, what differs on the hosted project; without
`--dry-run` it PATCHes the Management API (`/v1/projects/{ref}/config/auth`). It sets `site_url`
(`https://www.keptrow.com`; run it only at go-live, docs/14 step 6), `password_min_length` (12), `mailer_secure_email_change_enabled` (on), the subject and
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
   - sender email `no-reply@mail.keptrow.com`, sender name `Keptrow`
   The sending domain `mail.keptrow.com` must be authenticated in Brevo (SPF, DKIM, DMARC), as for invites.
3. Supabase dashboard › Authentication › Rate limits › **Rate limit for sending emails**: about **30 per hour**. The
   limit counts every auth email of the project together. Sign-up is open without a bot check, and Forgot password
   answers the same for every address, so a script could otherwise make Supabase send mail to any number of
   addresses: that would use up the Brevo plan's sending quota and harm the sending domain's reputation, which
   invites depend on too. 30 an hour is well above what a small team's real sign-ins and resets need; when it is
   reached, people asking for a link wait until the hour is over. Raise it as the number of users grows.
4. In Brevo, keep open and click tracking off for transactional email (as for invites, docs/09 §11), so the links in
   these emails are not rewritten through a tracking domain and no tracking pixel is added.

Then run `auth-config.py` (the main session does) and send yourself a reset link from `/login/forgot-password` to
check the sender, the subject and that the link opens Set a new password.

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
