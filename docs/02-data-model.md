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
      ├─ dashboards (config: { widgets: [...] })
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
| `submit_public_form(token, visitor_key, name, values, position, honeypot, consent)` | public form route only (service role, 0022): 10/min per visitor key (HMAC of IP + form id with a server secret, `form_rate_limits`, kept ≤ 1 h), 100/hour and 1 000/day per link (`form_link_hits`), honeypot, then `_submit_form` | `item.created` with actor `form` (actor_id = the form view) and `source` |
| `submit_internal_form(view, name, values, position)` | internal answers (editors, `authenticated`) | `item.created` as the person, with `source` |
| `_submit_form(…)` (internal, never granted) | both submits: the form's state (draft / closed / not open yet / full / internal only), only fields on the layout (public: no files, no people/team/role/entity), consent when the legal basis is consent, hidden prefilled values set from the form, group, notifications to the form's people | `item.created.new_value.source = { form_id, form_version, channel, notice_version, consent_at }` |
| `get_public_form(token)` | public form page (anon): `state`; when open the layout, the public fields, the notice and the controller (never hidden values or the people notified) | — |
| `form_link_create / form_link_regenerate / form_link_disable(view)` | owners and admins (Share). Regenerate disables every older link in the same transaction | `form.link_created`, `form.link_regenerated`, `form.link_disabled` on the sheet chain (no token) |
| `form_stats(sheet)` | Forms list (SECURITY INVOKER) | — |
| `filter_item_ids(sheet, where, params)` | server-side filters for sheets > 2 000 items (SECURITY INVOKER: RLS applies; refuses clauses with tokens `src/server/query/filters.ts` does not emit) | — |
| `create_subitem(parent, name, position, values, automation?)` | inline add, item panel (§12) | `item.created` on the sub-item, `subitem.added` on the parent |
| `create_subitems(parent, rows, automation?)` | From template, automation `create_subitems` (≤ 50) | as above, per row |
| `move_subitem(item, parent, position, automation?)` | "Move to another item", reorder | `subitem.moved` on the sub-item, `subitem.removed` / `subitem.added` on both parents |
| `verify_activity_chain(chain_key)` | Verify button | — |

Structure tables (folders, sheets, fields, groups, views, automations) are written directly by commands with the user's Supabase client under RLS; triggers log them to the sheet's chain (`sheets.insert`, `fields.update` …), ignoring bookkeeping columns.

`p_automation`: when an automation performs a write it passes its id. The RPC allows it only for the runner (service role, see §7) and only if the automation is enabled and in the item's workspace (since 0010; before, any member could name an automation), and records `actor_kind = 'automation'`, `actor_id = automation id`. Automations may write to locked items (that is how "approved → lock" and later workflow steps work); people need admin for that.

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
| folders | members | insert: editors (a sheet from a template may create its folder, §13); update, delete: admins (0021) |
| sheets, groups, form_links | members | editors (archiving and restoring a sheet: admins, checked by the command) |
| automation_pauses | members | editors, through `set_automation_pause` (logs `automation.paused` / `automation.resumed` on the item's chain); the automation and the item must be on the same sheet of the workspace (0011) |
| fields, automations | members | editors if not `locked`; admins always. Automations: the sheet is in the workspace, `created_by` is the person inserting, new rows have no runs; workspace, sheet and creator never change (0011) |
| views | shared views: members; personal: owner | owner (personal) or editors (shared). `type`: `list` (the Table), `grid` (former), `kanban`, `calendar`, `form`, `insights` (0018). `config` (field keys, not ids): `{ filters, sort[], hidden[], labelFieldKey, dateFieldKey, summaries, summaryOff, form, insights }`; `insights` = `{ rows: [{ id, height?, layout?, widgets: [{ id, type, span, title?, src?, filter, agg?, num?, by?, date?, top?, columns?, text? }] }] }` (≤ 12 rows, ≤ 4 widgets a row, spans 3/4/6/8/9/12 summing to ≤ 12, notes ≤ 2000 characters; `src` is another sheet's id, validated by `src/engine/insights/config.ts`); `sheets.settings.defaultViewId` is a shared view's id or a built-in view (`list`, `grid` …); `sheets.settings.tabs` orders, hides and names the tabs (§ Sheet tabs). A form link serves the layout of one form view (`form_links.view_id`). **Forms (0022):** many per sheet, shared, written by owners and admins only (RLS). `config.form` = `{ title, description, groupId, nameLabel, fields[], status: draft|open|closed, access: public|internal, opensAt, closesAt, maxResponses, confirmation, notify[], prefill[{key,value}], notice{ purpose, legalBasis, recipients, retention, rights, url, version, reviewedVersion, reviewedAt, reviewedBy } }` (absent status = draft, absent access = public). Trigger `views_form_guard`: the notice version moves when its words change; a review (reviewedVersion = version) is stamped with who and when by the database; a public form cannot be open without a complete, reviewed notice; every change to the name or `config.form` bumps `views.form_version` and logs `view.form_changed` (before/after summary, note "Changed: …") on the sheet chain; `view.form_created` / `view.form_deleted` too. Items from forms carry `source_form_id`, `form_version`, `source_channel` (public / internal). No IP or user agent is stored anywhere |
| items, item_links, activity_log | members | **only via RPCs** (no write policies) |
| item_updates | members | editors, as themselves, kind `update`; automation posts are written by the runner (below) |
| files | members | editors, as themselves, after the hash check |
| protected_values | admins + `fields.config.allowedUserIds` | same |
| notifications | the recipient | the recipient may set `read_at`/`done_at` |
| dashboards | members | editors, through the dashboard commands; inserted as yourself (`created_by = auth.uid()`); workspace and creator never change (0016). `config`: `{ widgets: [{ id, type, title, sheetId?, fieldKey?, conditions?, days? }] }`, at most 24 widgets; widget types live in `src/engine/dashboards` (fields by key, sheets by id). Changes are audited by `audit_schema` as `dashboards.insert/update/delete` on the workspace chain `sheet:<org_id>` |
| scheduler_fired, outbound_webhooks | service role only | service role only |

Automation posts, notifications, webhook queue rows, run rows (`record_automation_run`) and the automation's item writes (the RPCs with `p_automation`) are made by the automation runner. In a request it uses a **server-only** client created with the service role, scoped by the org id it has already authorised. This is the one allowed service-role use in a request path; keep it inside `src/server/automations/effects.ts`. System notifications about an automation carry `notifications.automation_id` (failure notices at most once per hour).

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

## 12. Sub-items (0020)

One level of items under an item. A sheet with sub-items has one hidden **child sheet** (`sheets.parent_sheet_id`, at most one per sheet, never a child of its own, no `id_prefix`, one hidden group, its own fields, automations and RLS like any sheet; hidden from the side menu, dashboards and the wizard). Sub-items are `items` of the child sheet with `parent_id` (an item of the parent sheet; a trigger enforces both directions) and `sub_seq`.

- **Display id** = parent's display id + `.` + `sub_seq` (`CA-014.2`), counted per parent in `items.next_sub_seq` under the parent's row lock: no gaps, never reused, **frozen** when the sub-item moves to another parent (it takes the new parent's next `sub_seq`; `(parent_id, sub_seq)` stays unique).
- `create_item` refuses child sheets; `move_item` refuses sub-items. `set_item_archived` on a parent archives its live sub-items (`archived_with = parent`) and restoring the parent brings back only those; a sub-item of an archived parent cannot be restored alone. Archiving or restoring one sub-item writes `subitem.archived` / `subitem.restored` on the parent's chain.
- **Gate** (`sheets.settings.subitems.blockClose`): `set_item_values` refuses to move the parent's status field (first `status`, else the first field with a done option) to a done option while a live sub-item is not done, with `subitems open: <Label> still open: CA-014.2 Root cause, … Close them before closing CA-014.` (people, bulk edits, imports and automations alike; the run log says `blocked`). `lockCascade`: a locked parent locks its sub-items for non-admins.
- `sheets.settings.subitems = { label, blockClose, lockCascade, template: [{ name, values by child field key }] }`; template values keep tokens (`$in:N`, `$today`, `$actor`) until applied.

### Sheet tabs (`sheets.settings.tabs`)

- `sheets.settings.tabs = [{ id, hidden?, label? }]`, in tab order. `id` is a built-in view type (`table`, `insights`, `kanban`, `calendar`, `form`) or the uuid of a **shared** view of the same sheet. `label` (trimmed, 1–40 characters) is display only: the id never changes. Absent = today's order (Table, Insights, Board, Calendar, Form, then shared views), so existing sheets are unchanged.
- Rules (`sheetTabsSchema`, `src/engine/views/tabs.ts`): 1–40 entries, ids unique, `table` present and never hidden, and `settings.defaultViewId` (same key as before) a listed tab that is not hidden. When a change hides the default, it falls back to `table` and the person is told.
- The bar (`applyTabLayout`, `src/components/views/tabs-model.ts`): the listed order; hidden tabs under "Hidden tabs" in More (they still open by `?view=` and stay the target of links); built-ins and shared views the list does not name are appended; each person's own personal views always come last, in `views.position` order. Hiding Form never touches `form_links`: public links keep serving.
- Written only by `setSheetTabs` (owners and admins, `withOrg('admin')`), merged into `settings` like `updateSheet`; every view uuid must be a shared view of the sheet. `deleteView` drops the view's entry (and the default, as before). The sheets audit trigger logs the change as `sheets.update` on the sheet's chain (old and new `settings`); `describeTabsChange` words it ("Tabs changed: hid Board, renamed Insights to Dashboard").
- `sheets.settings.tabsDefault`: the tab set the sheet started with (template or wizard start), for "Reset to template default" and the "customised" note. Templates give `tabs: [{ ref, hidden?, label? }]` and `defaultView` per sheet (`ref` = built-in type or a view name of the same template sheet; the built-ins left out are added hidden); the planner resolves names to the new views' ids. `copySheet` re-keys the uuids with the rest of the settings.
- The parent sheet gets a `subitems` field (non-value, docs/03); grants: the three RPCs to `authenticated`, the `_` helpers to nobody.

## 13. Folders (0021)

Folders organise sheets in the side menu (docs/05 §2.1). They do not restrict who can see a sheet: every member sees every folder and sheet.

- **Columns:** `id, org_id, name (≤ 80), position, archived_at, created_at`. A sheet has at most one folder (`sheets.folder_id`, null = "Other sheets"). Sub-item child sheets (§12) are never in a folder and cannot be moved or renamed from the menu.
- **Positions:** fractional keys (§3). The menu sends the ids of the new neighbours (`before`, `after`); the command reads their current keys and stores a key between them (`src/engine/organise.ts` `placeBetween`). When the keys around the gap are equal or out of order (concurrent moves), or the new key would pass 50 characters, the whole level is re-keyed evenly. Sheet keys are compared per level (the sheets of one folder, or of "Other sheets"); a new sheet goes to the end. Keys are compared by code unit in TypeScript, not by the database collation. "Sort A–Z" rewrites the keys of one folder's sheets once; it is not a lasting sort.
- **Permissions:** owners and admins create, rename, reorder, sort, archive, restore and delete folders, and archive and restore sheets. Editors create, rename and move sheets (into, out of and between folders, and reorder them). Viewers change nothing. The commands check the role; RLS checks folders again (`folders_update`, `folders_delete` admins; `folders_insert` editors).
- **Template folders (the one exception for editors):** a wizard start may name a folder (`templates/starts.json` `folder`; sheet templates may set `folder` per sheet). A sheet created from that start goes into the active folder with that name, compared without case, or the folder is created at the end of the menu, unless the person picked another folder or "No folder" in the wizard. Creating it counts as created by the person and is allowed for editors because it is part of creating the sheet; the command only creates the start's own folder name. New workspaces start with no folders.
- **Archive:** `set_folder_archived(folder, archived)` (security invoker, admins, granted to `authenticated`) archives a folder and its active sheets in one transaction with one timestamp, and restoring the folder restores exactly the sheets that carry that timestamp; sheets archived on their own before stay archived. A sheet restored on its own while its folder is archived comes back without a folder. Workspace admin, Archived lists archived folders and sheets and restores them. A folder can be deleted only when no sheet (archived ones included) is in it.
- **Audit:** `folders_audit` (audit_schema) writes `folders.insert/update/delete` on the workspace chain (`sheet:<org_id>`); moves and reorders of sheets are `sheets.update` entries with the old and new `folder_id`/`position` on the sheet's chain. Every reorder is logged. Workspace admin, Archived shows the latest entries as sentences ("Moved Risk register from Operations to Risk and controls", "Reordered sheets in Operations", "Archived folder Suppliers"; `organiseText`).

## 11. Seed (M1)

`scripts/seed.ts` (run with the service role against local Supabase): creates users `maria@example.com` (owner), `james@example.com` (editor), `vic@example.com` (viewer), workspace "Meridian Components Ltd" (`meridian`), teams (Quality, IT, HSE), job roles (Compliance manager, Head of IT, HSE manager), entity "Meridian Components Ltd" (GB) with sites Leeds and Bradford, folder "Your sheets", and the two sheets from `templates/first-sheet.json` with the sample items listed there.
