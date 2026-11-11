# src/server

Server-only code. Nothing here may be imported by a client component.

| Folder | Contents |
|---|---|
| `commands/` | All writes. A command authorises, validates with the field registry, calls a Postgres RPC that writes the row and the activity log in one transaction, runs automations, and returns toast messages (M4) |
| `repositories/` | Reads |
| `automations/` | Runner and `effects.ts`, one of the four places allowed to use the service role key (M7) |
| `scheduler/` | Vercel Cron entry point for date triggers (M9) |
| `webhooks/` | Queue worker with retries and dead letter (M9) |

The service role key is used only in the scheduler, the webhook worker, the public form route and `automations/effects.ts` (plus `scripts/seed.ts` locally). See CLAUDE.md rule 6.
