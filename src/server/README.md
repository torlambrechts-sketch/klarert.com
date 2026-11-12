# src/server

Server-only code. Nothing here may be imported by a client component.

| Folder | Contents |
|---|---|
| `commands/` | All writes. A command authorises, validates with the field registry, calls a Postgres RPC that writes the row and the activity log in one transaction, runs automations, and returns toast messages (M4) |
| `repositories/` | Reads |
| `automations/` | `runner.ts` (the event loop, pure apart from its injected store and clock), `effects.ts` (the store: reads and writes as the automation; the one place in a request path that creates the service-role client) and `index.ts` (`runAutomations`, called by every command, buttons and forms) |
| `scheduler/` | Vercel Cron entry point for date triggers (M9) |
| `webhooks/` | Queue worker with retries and dead letter (M9) |

The service role key is used only in the scheduler, the webhook worker, the public form route and `automations/effects.ts` (plus `scripts/seed.ts` locally). See CLAUDE.md rule 6.
