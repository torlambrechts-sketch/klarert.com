# 02 · Data model

The schema is `supabase/migrations/0001_core.sql` (plain Postgres, tested) and `0002_storage_realtime.sql` (Supabase-only objects). This document explains the decisions so you can extend them correctly. Change the schema only with new numbered migrations.

## 1. Entity map

```
orgs ─┬─ memberships ── profiles (auth.users)
      ├─ teams ── team_members        job_roles        entities ── sites        invites
      ├─ folders ── sheets ─┬─ fields
      │                     ├─ groups ── items ─┬─ item_links (field_id, from_item → to_item)
      │                     │                    ├─ protected_values (item_id, field_id)
      │                     │                    ├─ files (item_id, field_id, sha256, valid_until, replaced_by)
      │                     │                    └─ item_updates (comments, automation posts)
      │                     ├─ views              form_links
      │                     └─ automations ─┬─ automation_pauses (per item)
      │                                     ├─ automation_runs
      │                                     ├─ scheduler_fired (dedupe)
      │                                     └─ outbound_webhooks (queue)
      ├─ notifications (per user)
      └─ activity_log (append-only, hash chain per item / per sheet for schema)
```

## 2. Where values live

| Field types | Stored in | Notes |
|---|---|---|
| All "value" types (text, number, status, people, date, checklist, riskmatrix …) | `items.values` jsonb, key = **field id** (uuid string) | Shape per type in docs/03 §3. Missing key = empty |
| `link`, `requirement`, `controllink` | `item_links` | One row per link. Two-way links: the field config has `inverseFieldId`; the command writes both directions |
| `evidence`, `attachment` | `files` | Current file = `replaced_by is null`. Old versions kept |
| `protected` | `protected_values` | Separate table so RLS can hide it per field |
| `lookup`, `rollup`, `formula`, `progress`, `clock`, `autoid`, `meta` | not stored | Computed by the engine on read (`src/engine/fields/*`). `autoid` = `items.display_id`; `meta` = created/updated columns |
| `button` | not stored | Clicking emits an event only |

`non_value_types()` in SQL lists the types that must never appear in `items.values`; `set_item_values` rejects them.

**Why jsonb and not a values table:** one row per item keeps grid reads to a single query (`select * from items where sheet_id = $1 and archived_at is null`), realtime sends whole rows, and the GIN index supports filters. Sorting and filtering for large sheets happens in Postgres via generated SQL from the view config (docs/03 §4 gives the SQL per operator); for ≤ 2,000 items the client may filter in memory.

## 3. Identity and ordering

- Primary keys: uuid v4 (`gen_random_uuid()`).
- Human item id: `display_id` = `sheets.id_prefix` + zero-padded `seq` (min 3 digits). Assigned in `_create_item` with `update sheets set next_seq = next_seq + 1 … returning` (row lock, no gaps under concurrency). Never reused, also after archive.
- Prefix: `^[A-Z0-9]{1,6}-$`, unique per workspace, changeable only while the sheet has no items.
- Field `key`: `^[a-z][a-z0-9_]{0,39}$`, unique per sheet, generated from the name at creation (`"Due date"` → `due_date`, de-duplicated with `_2`), never changed afterwards. Formulas and templates use keys.
- Ordering: `position text` using the `fractional-indexing` package (`generateKeyBetween(a, b)`). The client computes the key; the RPC stores it. Re-key a group only if a key exceeds 50 characters.

## 4. Write path (the only way items change)

```
UI (optimistic) ─► Server Action ─► src/server/commands/<command>.ts
                                       1. auth: get session, membership, role
                                       2. load sheet + fields (cached per request)
                                       3. validate input with the field registry (docs/03): normalise, required, min/max,
                                          pattern, unique, status rules, comment-on-value
                                       4. call RPC (one transaction: row + activity_log entries)
                                       5. run automations for the emitted events (docs/04), depth ≤ 3
                                       6. return { item, messages[], runs[] } ─► toast + cache update
```

| RPC (SECURITY DEFINER) | Used by | Logs |
|---|---|---|
| `create_item(sheet, group, name, position, values, automation?)` | add item, CSV import, automation `create` | `item.created` |
| `set_item_values(item, patch, name?, automation?, note?)` | every cell edit, bulk edit, automation `set` | `value.changed` per field, `item.renamed` |
| `move_item(item, group, position, automation?)` | drag, automation `move` | `item.moved` |
| `set_item_archived(item, archived)` | archive/restore | `item.archived` / `item.restored` |
| `set_item_lock(item, locked, reason?, automation?)` | admin lock, automation `lock` | `item.locked` / `item.unlocked` |
| `set_item_links(field, from, to[], mode, automation?)` | link editors, automation `create`/`updlinked` | `link.changed` (before → after id arrays) |
| `submit_form(token, name, values, position)` | public form route (anon) | `item.created` with actor `form` |
| `verify_activity_chain(chain_key)` | Verify button | — |

Structure tables (folders, sheets, fields, groups, views, automations) are written directly by commands with the user's Supabase client under RLS; triggers log them to the sheet's chain (`sheets.insert`, `fields.update` …), ignoring bookkeeping columns.

`p_automation`: when an automation performs a write it passes its id. The RPC allows it if the caller is a member and the automation is enabled, records `actor_kind = 'automation'`, `actor_id = automation id`. Automations may write to locked items (that is how "approved → lock" and later workflow steps work); people need admin for that.

Commands also write: `item_updates` (comments), `notifications`, `automation_runs`, `files`, `protected_values`.

## 5. Concurrency

- Item writes lock the row (`for update`). Two people editing different fields of the same item both win (patch semantics).
- Same field, same moment: last write wins; the activity log shows both. The client sends `expectedUpdatedAt` for long-text and checklist edits; if it differs, the command returns `conflict` and the editor shows the newer value with "Keep mine / Use theirs".
- Mutations are never retried automatically (TanStack Query `retry: false` for mutations), so a command runs at most once per user action. The client tags each mutation with a `mutationId` only to recognise its own realtime echo.

## 6. Activity log and the hash chain

- One chain per item (`chain_key = item id`) and one per sheet for schema changes (`chain_key = 'sheet:<id>'`).
- `activity_chain()` (BEFORE INSERT) takes an advisory lock on the chain, reads the last hash, sets `prev_hash` and `hash = sha256(prev | at | actor_kind | actor_id | action | field_id | old | new | note)`.
- `activity_append_only()` blocks UPDATE and DELETE. The only exception is DELETE during a workspace purge (`set local app.purge_org = '<org_id>'`), used by the GDPR "delete workspace" job.
- `verify_activity_chain(chain_key)` recomputes every hash and returns `{ ok, entries, last_hash }` or `{ ok:false, first_bad_id }`.
- `sheet_id`/`item_id` in the log have no foreign keys on purpose: history outlives archived or purged rows.

## 7. Row level security (summary)

| Table group | Read | Write |
|---|---|---|
| Everything with `org_id` | members (`is_member`) | see below |
| Workspace admin tables (memberships, invites, teams, job_roles, entities, sites) | members (invites: admins) | admins |
| folders, sheets, groups, form_links, automation_pauses | members | editors |
| fields, automations | members | editors if not `locked`; admins always |
| views | shared views: members; personal: owner | owner (personal) or editors (shared) |
| items, item_links, activity_log | members | **only via RPCs** (no write policies) |
| item_updates | members | editors, as themselves, kind `update`; automation posts are written by the runner (below) |
| files | members | editors, as themselves, after the hash check |
| protected_values | admins + `fields.config.allowedUserIds` | same |
| notifications | the recipient | the recipient may set `read_at`/`done_at` |
| scheduler_fired, outbound_webhooks | service role only | service role only |

Automation posts and notifications are inserted by the automation runner. In a request it uses a **server-only** client created with the service role, scoped by the org id it has already authorised. This is the one allowed service-role use in a request path; keep it inside `src/server/automations/effects.ts`.

RLS tests: add pgTAP tests in `supabase/tests/` (M1) for viewer cannot write, editor cannot touch locked field, member of org A cannot read org B, protected value hidden.

## 8. Storage

Bucket `files` (private). Path `org/<org_id>/item/<item_id>/<file_id>/<filename>`. Upload flow:
1. Browser computes SHA-256 (`crypto.subtle.digest`) and calls `prepareUpload` (command) → signed upload URL + file id.
2. Browser uploads.
3. `confirmUpload` (command) downloads the object server-side, recomputes SHA-256, compares, inserts the `files` row (with `valid_until = collected_at + config.validDays` for evidence), logs `file.added` via `set_item_values`-equivalent note (`activity_log` entry `file.added` written by a small RPC you add in M5: `log_file_event(item, field, file, action)`).

## 9. Realtime

Subscribe per open sheet to `items`, `item_links`, `fields`, `groups` (filter `sheet_id=eq.<id>`), per open item to `item_updates`, per user to `notifications`. On an event, patch the TanStack Query cache; ignore echoes of the user's own optimistic mutation (compare `updated_at` and `mutationId` stored in a local map).

## 10. TypeScript types

Generate with `pnpm db:types` into `src/lib/database.types.ts`. Domain types (`Sheet`, `Field<T>`, `Item`, `FieldValue<T>`, `Automation`) live in `src/engine/types.ts` and are what the engine and UI use; repositories map database rows to domain types.

## 11. Seed (M1)

`scripts/seed.ts` (run with the service role against local Supabase): creates users `maria@example.com` (owner), `james@example.com` (editor), `vic@example.com` (viewer), workspace "Meridian Components Ltd" (`meridian`), teams (Quality, IT, HSE), job roles (Compliance manager, Head of IT, HSE manager), entity "Meridian Components Ltd" (GB) with sites Leeds and Bradford, folder "Your sheets", and the two sheets from `templates/first-sheet.json` with the sample items listed there.
