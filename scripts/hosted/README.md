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

## Email (Brevo, docs/09 §10)

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
   Brevo rewriting the accept link (docs/09 §10).
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
