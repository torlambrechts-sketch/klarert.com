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

## Email (Resend, docs/09 §10)

Invites are sent by email through Resend. Without these steps nothing is sent: admins see "The email could not be
sent. Copy the link instead." and invites still work by copying the link. No migration or database setting is needed.

1. Create an account at resend.com (the owner's company account).
2. Resend › Domains › Add domain: `mail.klarert.com`, region **EU (Ireland)**. Only the subdomain: mail for
   `klarert.com` itself is not touched.
3. At the DNS host of `klarert.com`, add the records Resend lists for `mail.klarert.com` exactly as shown (an MX and a
   TXT record for the sending subdomain, used for bounces and SPF, and a TXT record with the DKIM key; Resend also
   suggests a DMARC TXT record, which is recommended). Then press Verify in Resend and wait until the domain shows
   Verified.
4. Resend › API keys › Create API key: permission **Sending access**, domain `mail.klarert.com` only. Copy it once.
5. Vercel › the project › Settings › Environment Variables, for **Production** and **Preview**:
   - `RESEND_API_KEY` = the key (mark it Sensitive);
   - `EMAIL_FROM` = `Compliance OS <no-reply@mail.klarert.com>` (any address on the verified domain).
   Redeploy so the functions pick them up.
6. Check: invite your own second address from Workspace admin › Members. The toast says "Invite sent to …". The
   Vercel function log shows `{"source":"email","tag":"invite","transport":"resend","outcome":"sent"}`; without the
   key it shows `RESEND_API_KEY is not set: no email is sent …`.

To rotate the key: create a new one, change `RESEND_API_KEY` in Vercel, redeploy, then delete the old key in Resend.
Preview deployments send real mail to the addresses invited there; leave the key out of Preview if that is not wanted.
