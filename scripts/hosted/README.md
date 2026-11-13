# Hosted database scripts

Run from the repo root against the hosted Supabase project (Frankfurt). The session's network proxy injects the
Management API token; nothing secret lives here.

- `python3 scripts/hosted/apply.py`: apply migrations not yet recorded
- `python3 scripts/hosted/runtests.py`: run pgTAP tests in rolled-back transactions
- `python3 scripts/hosted/q.py "select 1"`: ad-hoc SQL
- `python3 scripts/hosted/q.py -f catalogue.sql`: load output of `scripts/frameworks-sql.ts` or `scripts/packs-sql.ts`

After merging a migration or a catalogue change: `apply.py`, then regenerate and load the catalogue SQL.
