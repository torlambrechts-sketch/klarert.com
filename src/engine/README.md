# src/engine

Pure TypeScript: data in, data out. No React, Next.js or Supabase imports (enforced by ESLint), and no `Date.now()` or random ids unless injected through `Ctx`. The same code runs in the browser for previews and on the server as the source of truth.

| Folder | Contents (built in M2) |
|---|---|
| `fields/` | One file per field type plus `registry.ts`, the contract in docs/03 |
| `formula/` | Tokenizer, parser, evaluator, functions |
| `conditions/` | Condition operators per value kind |
| `automations/` | Trigger matching, action planning, templating, loop guard |
| `values/` | Projections: `toText`, `toNumber`, `toDate`, `compare`, `isEmpty`, `isDone` |

Every field type, trigger and action has unit tests next to it (`*.test.ts`).
