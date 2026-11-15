-- Local development only (`pnpm db:reset` runs it; the hosted database never does).
-- The command gate (0053) refuses writes that do not come from the app's server. Locally the server falls back to
-- this well-known value when SUPABASE_COMMAND_SECRET is unset and the Supabase URL is on this machine
-- (src/lib/supabase/command-proof.ts). The hosted project gets its own random value: see scripts/hosted/README.md.
select vault.create_secret('klarert-local-command-secret', 'klarert_command_secret',
                           'Command gate (0053): local development value');
