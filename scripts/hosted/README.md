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
