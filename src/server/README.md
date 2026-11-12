# src/server

Server-only code. Nothing here may be imported by a client component.

| Folder | Contents |
|---|---|
| `commands/` | All writes. A command authorises, validates with the field registry, calls a Postgres RPC that writes the row and the activity log in one transaction, runs automations, and returns toast messages (M4) |
| `repositories/` | Reads |
| `automations/` | `runner.ts` (the event loop, pure apart from its injected store and clock), `effects.ts` (the store: reads and writes as the automation; the one place in a request path that creates the service-role client) and `index.ts` (`runAutomations`, called by every command, buttons and forms) |
| `scheduler/` | `date-checks.ts`: date, clock and evidence triggers for one workspace, claimed once per occurrence and run through the runner. Called by the cron route `src/app/api/cron/scheduler` (service role, every workspace) and by "Run date checks now" (the admin's own client, their workspace) |
| `webhooks/` | `worker.ts` (claim, send, backoff, dead letter; network and database injected), `ssrf.ts` (the address guard), `transport.ts` (one HTTPS POST whose DNS lookup is guarded). Called by the cron route `src/app/api/cron/webhooks` |
| `cron-auth.ts` | The `Authorization: Bearer ${CRON_SECRET}` check of both cron routes, in constant time |

The service role key is used only in the scheduler and webhook worker cron routes (`src/app/api/cron/*/route.ts`, which create the client after the secret matched), the public form route and `automations/effects.ts` (plus `scripts/seed.ts` locally). See CLAUDE.md rule 6.
