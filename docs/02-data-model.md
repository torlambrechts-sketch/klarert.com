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
      │                     │                    ├─ item_updates (comments, automation posts)
      │                     │                    └─ workflow_instances ── workflow_decisions (approvals, §19)
      │                     ├─ views              form_links
      │                     └─ automations ─┬─ automation_pauses (per item)
      │                                     ├─ automation_runs
      │                                     ├─ scheduler_fired (dedupe)
      │                                     └─ outbound_webhooks (queue)
      ├─ notifications (per user)
      ├─ dashboards (config: { widgets: [...] })
      ├─ pack_installs (ref_map) ── packs (global catalogue); provenance on every row a pack makes (§15)
      ├─ library sheets: items.requirement_ref ── requirements ── frameworks, crosswalks (global catalogue, §17)
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
| `create_link_pair_items(sheet, group, rows, automation?)` (0038) | the requirement checks sync (≤ 50 rows): items with both links of the sheet's `uniqueLinkPair` (and two-way inverses), a pair that already has a live item skipped | `item.created` and `link.changed` per created item, through `create_item` and `set_item_links` |
| `verify_activity_chain(chain_key)` | Verify button | — |
| `workflow_submit(item, workflow, comment?, automation?, submitter?)` (0040) | Submit for approval, the `start_workflow` action (§19) | `workflow.submitted`, then the step field and status as `value.changed` |
| `workflow_decide(instance, decision, comment?)` (0040) | Approve / Reject (people only) | `workflow.decided` (who, step, round, decision, comment), `workflow.approved` / `workflow.rejected`, `value.changed`, `item.locked` |
| `workflow_withdraw(instance, comment?)` (0040) | Withdraw (the submitter, owners and admins) | `workflow.withdrawn`, the step field back to draft |
| `log_audit_export(org, kind, scope)` (0034) | audit exports (members, auditors too) | `audit.exported` on the workspace chain with the kind and a flat scope of known keys (docs/11 Audit outputs) |

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
- `verify_activity_chain(chain_key)` recomputes every hash and returns `{ ok, entries, last_hash }` or `{ ok:false, first_bad_id }` (since 0036 also `redacted`: personal values erased under retention, §18; the markers stay in the chain).
- `sheet_id`/`item_id` in the log have no foreign keys on purpose: history outlives archived or purged rows.

## 7. Row level security (summary)

Since P2 every sheet-scoped read and write below is narrowed further by the person's level on the sheet (owner, editor, commenter, viewer, none) and restricted fields are kept out of reach: see §16.

| Table group | Read | Write |
|---|---|---|
| Everything with `org_id` | members (`is_member`) | see below |
| Workspace admin tables (memberships, invites, teams, job_roles, entities, sites) | members (invites: admins) | admins |
| folders | members | insert: editors (a sheet from a template may create its folder, §13); update, delete: admins (0021) |
| sheets, groups, form_links | members | editors (archiving and restoring a sheet: admins, checked by the command) |
| automation_pauses | members | editors, through `set_automation_pause` (logs `automation.paused` / `automation.resumed` on the item's chain); the automation and the item must be on the same sheet of the workspace (0011) |
| fields, automations | members | editors if not `locked`; admins always. Automations: the sheet is in the workspace, `created_by` is the person inserting, new rows have no runs; workspace, sheet and creator never change (0011) |
| views | shared views: members; personal: owner | owner (personal) or editors (shared). `type`: `list` (the Table), `grid` (former), `kanban`, `calendar`, `form`, `insights` (0018). `config` (field keys, not ids): `{ filters, sort[], hidden[], labelFieldKey, dateFieldKey, summaries, summaryOff, form, insights, collapsedGroups[] }`; `collapsedGroups` (Table) lists the ids of the sheet's column groups this view shows collapsed (§ Column groups); `insights` = `{ rows: [{ id, height?, layout?, widgets: [{ id, type, span, title?, src?, filter, agg?, num?, by?, date?, top?, columns?, text? }] }] }` (≤ 12 rows, ≤ 4 widgets a row, spans 3/4/6/8/9/12 summing to ≤ 12, notes ≤ 2000 characters; `src` is another sheet's id, validated by `src/engine/insights/config.ts`); `sheets.settings.defaultViewId` is a shared view's id or a built-in view (`list`, `grid` …); `sheets.settings.tabs` orders, hides and names the tabs (§ Sheet tabs). A form link serves the layout of one form view (`form_links.view_id`). **Forms (0022):** many per sheet, shared, written by owners and admins only (RLS). `config.form` = `{ title, description, groupId, nameLabel, fields[], status: draft|open|closed, access: public|internal, opensAt, closesAt, maxResponses, confirmation, notify[], prefill[{key,value}], notice{ purpose, legalBasis, recipients, retention, rights, url, version, reviewedVersion, reviewedAt, reviewedBy } }` (absent status = draft, absent access = public). Trigger `views_form_guard`: the notice version moves when its words change; a review (reviewedVersion = version) is stamped with who and when by the database; a public form cannot be open without a complete, reviewed notice; every change to the name or `config.form` bumps `views.form_version` and logs `view.form_changed` (before/after summary, note "Changed: …") on the sheet chain; `view.form_created` / `view.form_deleted` too. Items from forms carry `source_form_id`, `form_version`, `source_channel` (public / internal). No IP or user agent is stored anywhere |
| items, item_links, activity_log | members | **only via RPCs** (no write policies) |
| item_updates | members | editors, as themselves, kind `update`; automation posts are written by the runner (below) |
| files | members | editors, as themselves, after the hash check |
| protected_values | admins + `fields.config.allowedUserIds` | same |
| notifications | the recipient | the recipient may set `read_at`/`done_at` |
| dashboards | members | editors, through the dashboard commands; inserted as yourself (`created_by = auth.uid()`); workspace and creator never change (0016). `config`: `{ widgets: [{ id, type, title, sheetId?, fieldKey?, conditions?, days? }] }`, at most 24 widgets; widget types live in `src/engine/dashboards` (fields by key, sheets by id). Changes are audited by `audit_schema` as `dashboards.insert/update/delete` on the workspace chain `sheet:<org_id>` |
| scheduler_fired, outbound_webhooks | service role only | service role only |
| workflow_instances, workflow_decisions (0040) | members who can read the item's sheet (decisions through their instance) | **only via RPCs** (no write policies); decisions are append-only (trigger), deleted only by the workspace purge |

Automation posts, notifications, webhook queue rows, run rows (`record_automation_run`) and the automation's item writes (the RPCs with `p_automation`) are made by the automation runner. In a request it uses a **server-only** client created with the service role, scoped by the org id it has already authorised. This is the one allowed service-role use in a request path; keep it inside `src/server/automations/effects.ts`. System notifications about an automation carry `notifications.automation_id` (failure notices at most once per hour).

RLS tests: add pgTAP tests in `supabase/tests/` (M1) for viewer cannot write, editor cannot touch locked field, member of org A cannot read org B, protected value hidden.

## 8. Storage

Bucket `files` (private). Path `org/<org_id>/item/<item_id>/<file_id>/<filename>`. Upload flow:
1. Browser computes SHA-256 (`crypto.subtle.digest`) and calls `prepareUpload` (command) → signed upload URL + file id.
2. Browser uploads.
3. `confirmUpload` (command) downloads the object server-side, recomputes SHA-256, compares, inserts the `files` row (with `valid_until = collected_at + config.validDays` for evidence), logs `file.added` via `set_item_values`-equivalent note (`activity_log` entry `file.added` written by a small RPC you add in M5: `log_file_event(item, field, file, action)`).

### Item files, downloads and controlled documents (0023)

- **Item files.** `files.field_id` is null for a file of the item's Files tab (not tied to a column); `check (field_id is not null or source = 'upload')`. Same path and upload flow. Per version: `description`, `category` (an option id of `orgs.settings.fileCategories`, default Evidence, Contract, Photo, Report, Document, Policy, Procedure, Other; stored by id, shown by label), `version_no` (the replaced version's + 1), `version_note`, `classification` (public, internal, confidential, restricted), `personal_data`, `scan_status` (not_scanned, clean, blocked: downloads refused when blocked; the scanner comes later), `archived_at/by`, and for documents `approved_at/by`, `superseded_at`.
- **Upload checks** (`confirmUpload`, `src/engine/item-files.ts`): 25 MB (also the bucket limit); an extension allow-list checked against the first bytes; programs, scripts, HTML, HTA, shortcuts, disk images, Java/Android packages, installers and macro-enabled Office files are refused, whatever the name (any dotted part) or content says. Refused uploads stay unreferenced objects.
- **RPCs:** `add_file(item, field|null, file, path, name, mime, size, sha256, replaces, meta)`; `set_file_meta(file, meta)` → `file.updated`; `archive_file(file, note)` and `restore_file(file)`, owners and admins, the whole version chain → `file.archived` / `file.restored`; `download_file(file)` (members; refuses blocked, and archived for non-admins) writes `file_access_log (org_id, file_id, item_id, user_id, at)`, readable by members, written by nothing else. Files are otherwise immutable; nothing is deleted.
- **Downloads and preview:** signed links of 60 s with `Content-Disposition: attachment`; PDF and images preview inline through `/[org]/files/<id>/preview`, with the content type forced from the extension and `nosniff`. SVG is download-only.
- **Evidence library** lists item files too (field "Item file") and leaves archived files out.

## 14. Controlled documents (0023)

A sheet with `settings.register = 'documents'` is a documents register (set by the "Documents and policies" start; changed in Sheet settings by owners and admins only, enforced by a trigger). Its status field's done option is Approved. `set_item_values` enforces, in the same transaction: only a person approves (never an automation), never the author (field key `author`, else the item's creator); approving needs a comment (the version note) and a current item file (category `document` first); the approval writes `approver` (the person approving), `approved_on` (today) and `version` (the file's version number), marks that file approved and the previously approved file superseded, and logs `file.approved`. Leaving Approved needs a comment. People cannot set `approver` or `approved_on` by hand, and a new document cannot start Approved. Errors read `document: …` and are shown as written.

Items link to documents through ordinary link fields whose target is a register; the Files tab shows each linked document's last approved version (never a draft) and "Draft in review" when a newer version exists.

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

### One item per pair of links (`sheets.settings.uniqueLinkPair`, 0038)

`uniqueLinkPair = ["<link field key>", "<link field key>"]`: no two live items of the sheet link to the same pair of targets through those fields (a supplier × requirement check exists once). The trigger `item_links_unique_pair` refuses the link that would complete a second item with the same pair, whoever writes it (code 23505, "duplicate pair: SRC-004 already links these two items"); pairs are serialised with a transaction advisory lock, so two writers cannot both pass. `create_link_pair_items` skips such pairs instead of failing. Packs set it with `uniqueLinks` on a sheet (docs/11).

### Column groups (`sheets.settings.columnGroups`)

- `sheets.settings.columnGroups = [{ id, name, fieldKeys[] }]`: named sections of a sheet's columns (Identify, Assess, Treat …), defined per sheet by owners and admins (`setColumnGroups`, withOrg `admin`; the settings write is logged by the sheets audit trigger). `id` is letters, digits, `-` and `_` (1–64), `name` 1–60 characters and unique per sheet, at most 30 groups; a field key is in at most one group. Read leniently (`parseColumnGroups`, `src/engine/views/column-groups.ts`): a broken group is dropped, unknown or deleted keys are dropped.
- A group's columns always sit together: groups are ordered by their first field, and when an admin assigns fields to a group the command moves those fields (fractional `fields.position`, as few as possible) to the end of that group's block (`planGroupPositions`). Fields in no group read as an implicit "Other", shown only when at least one group exists.
- Collapsing is per view (`views.config.collapsedGroups`); a view's hidden columns are its `hidden[]` plus every member of a collapsed group. Key columns (owner = first people field, status = the field that decides done, main date = the deadline) are derived from the fields (`keyColumns`), marked in the Columns menu and never forced visible.
- Templates give `columnGroups: [{ name, fields: [keys] }]` per sheet; the planner gives each an id and places its fields together.

### Sheet tabs (`sheets.settings.tabs`)

- `sheets.settings.tabs = [{ id, hidden?, label? }]`, in tab order. `id` is a built-in view type (`table`, `insights`, `kanban`, `calendar`, `form`) or the uuid of a **shared** view of the same sheet. `label` (trimmed, 1–40 characters) is display only: the id never changes. Absent = today's order (Table, Insights, Board, Calendar, Form, then shared views), so existing sheets are unchanged.
- Rules (`sheetTabsSchema`, `src/engine/views/tabs.ts`): 1–40 entries, ids unique, `table` present and never hidden, and `settings.defaultViewId` (same key as before) a listed tab that is not hidden. When a change hides the default, it falls back to `table` and the person is told.
- The bar (`applyTabLayout`, `src/components/views/tabs-model.ts`): the listed order; hidden tabs under "Hidden tabs" in More (they still open by `?view=` and stay the target of links); built-ins and shared views the list does not name are appended; each person's own personal views always come last, in `views.position` order. Hiding Form never touches `form_links`: public links keep serving.
- Written only by `setSheetTabs` (owners and admins, `withOrg('admin')`), merged into `settings` like `updateSheet`; every view uuid must be a shared view of the sheet. `deleteView` drops the view's entry (and the default, as before). The sheets audit trigger logs the change as `sheets.update` on the sheet's chain (old and new `settings`); `describeTabsChange` words it ("Tabs changed: hid Board, renamed Insights to Dashboard").
- `sheets.settings.tabsDefault`: the tab set the sheet started with (template or wizard start), for "Reset to template default" and the "customised" note. Templates give `tabs: [{ ref, hidden?, label? }]` and `defaultView` per sheet (`ref` = built-in type or a view name of the same template sheet; the built-ins left out are added hidden); the planner resolves names to the new views' ids. `copySheet` re-keys the uuids with the rest of the settings.
- The parent sheet gets a `subitems` field (non-value, docs/03); grants: the three RPCs to `authenticated`, the `_` helpers to nobody.

## 13. Folders (0021)

Folders organise sheets in the side menu (docs/05 §2.1). A folder restricts who sees its sheets only when an owner or admin restricts it (§16); otherwise every member sees every folder and sheet.

- **Columns:** `id, org_id, name (≤ 80), position, archived_at, created_at`. A sheet has at most one folder (`sheets.folder_id`, null = "Other sheets"). Sub-item child sheets (§12) are never in a folder and cannot be moved or renamed from the menu.
- **Positions:** fractional keys (§3). The menu sends the ids of the new neighbours (`before`, `after`); the command reads their current keys and stores a key between them (`src/engine/organise.ts` `placeBetween`). When the keys around the gap are equal or out of order (concurrent moves), or the new key would pass 50 characters, the whole level is re-keyed evenly. Sheet keys are compared per level (the sheets of one folder, or of "Other sheets"); a new sheet goes to the end. Keys are compared by code unit in TypeScript, not by the database collation. "Sort A–Z" rewrites the keys of one folder's sheets once; it is not a lasting sort.
- **Permissions:** owners and admins create, rename, reorder, sort, archive, restore and delete folders, and archive and restore sheets. Editors create, rename and move sheets (into, out of and between folders, and reorder them). Viewers change nothing. The commands check the role; RLS checks folders again (`folders_update`, `folders_delete` admins; `folders_insert` editors).
- **Template folders (the one exception for editors):** a wizard start may name a folder (`templates/starts.json` `folder`; sheet templates may set `folder` per sheet). A sheet created from that start goes into the active folder with that name, compared without case, or the folder is created at the end of the menu, unless the person picked another folder or "No folder" in the wizard. Creating it counts as created by the person and is allowed for editors because it is part of creating the sheet; the command only creates the start's own folder name. New workspaces start with no folders.
- **Archive:** `set_folder_archived(folder, archived)` (security invoker, admins, granted to `authenticated`) archives a folder and its active sheets in one transaction with one timestamp, and restoring the folder restores exactly the sheets that carry that timestamp; sheets archived on their own before stay archived. A sheet restored on its own while its folder is archived comes back without a folder. Workspace admin, Archived lists archived folders and sheets and restores them. A folder can be deleted only when no sheet (archived ones included) is in it.
- **Audit:** `folders_audit` (audit_schema) writes `folders.insert/update/delete` on the workspace chain (`sheet:<org_id>`); moves and reorders of sheets are `sheets.update` entries with the old and new `folder_id`/`position` on the sheet's chain. Every reorder is logged. Workspace admin, Archived shows the latest entries as sentences ("Moved Risk register from Operations to Risk and controls", "Reordered sheets in Operations", "Archived folder Suppliers"; `organiseText`).

## 11. Seed (M1)

`scripts/seed.ts` (run with the service role against local Supabase): creates users `maria@example.com` (owner), `james@example.com` (editor), `vic@example.com` (viewer), workspace "Meridian Components Ltd" (`meridian`), teams (Quality, IT, HSE), job roles (Compliance manager, Head of IT, HSE manager), entity "Meridian Components Ltd" (GB) with sites Leeds and Bradford, folder "Your sheets", and the two sheets from `templates/first-sheet.json` with the sample items listed there.

## 15. Packs (0024)

Packs are installable bundles of the core as data (docs/11): folders, sheets, fields, groups, views and forms, example items (also documents of a register and library items), links, automations and dashboards, each named by a stable **ref**.

- **`packs`** (`key`, `version` semver, `title`, `description`, `manifest` jsonb, `hash` = sha-256 of the manifest's canonical JSON, primary key `(key, version)`): the global catalogue, no `org_id`. Every signed-in person reads it; nobody writes it through the API. The seed path writes it from the repository (`syncCatalogue`, service role, run by `scripts/seed.ts`); a version never changes once written (a different manifest under the same version is an error: bump the version).
- **`pack_installs`** (`org_id`, `pack_key`, `version`, `status` installed | archived, `installed_by/at`, `archived_by/at`, `manifest_hash`, `ref_map`): one row per install; at most one `installed` row per pack and workspace (an archived install may be installed again). `ref_map` = `{ "sheet:ca": uuid, "field:ca.owner": uuid, "group:ca.open": uuid, "view:ca.form.report": uuid, "item:ca.burrs": uuid, "automation:stuck": uuid, "dashboard:overview": uuid, "folder:audit": uuid }`, kept so upgrades (P6) can map refs back to rows. Members read; written only by the RPCs below.
- **Provenance** on folders, sheets, fields, groups, views, automations, dashboards and items: `pack_install_id` (FK), `pack_ref`, `pack_hash` (sha-256 of the row as the plan shipped it), unique `(org_id, pack_install_id, pack_ref)`. Refs: sheets `ca` (sub-item child sheet `ca.subitems`), fields `<sheet>.<key>`, groups `<sheet>.<group ref>`, views `<sheet>.view.<n>`, forms `<sheet>.form.<form ref>`, items `<sheet>.<item ref>`, automations and dashboards their own ref. `pack_provenance_guard` (trigger) lets only `install_pack` write them (it sets `app.pack_op` for its transaction) and nobody change them.
- **`dashboards.archived_at`**: a pack's dashboards are archived with it; the dashboard pages list live ones.
- `automations.source` = `pack:<key>` for a pack's automations.

| RPC | Who | Does |
|---|---|---|
| `install_pack(org, plan)` (SECURITY DEFINER) | owners and admins of `org` (the seed's service role too) | Checks the catalogue row and its hash, that the pack is not installed, that every ref is present and unique and every reference stays inside the plan or the workspace (link targets, automation and widget sheets); writes the install row, folders, sheets (parents first), groups, fields, views, items (numbered like `create_items`, `item.created` note "Pack install"), links (`link.changed` per field and item; a link leaves the plan only through a requirement or control link field to a live library item of the workspace, 0033), automations (as the installer, on a sheet or its sub-item sheet) and dashboards, all with provenance, and `pack.installed` on the workspace chain (`sheet:<org_id>`) with the manifest hash and counts. One transaction: any failure leaves nothing behind. Returns `{ install_id, ref_map, counts }` |
| `archive_pack(install)` (SECURITY DEFINER) | owners and admins of the install's workspace | Turns the install's automations off, archives its sheets (one timestamp, restorable from Workspace admin › Archived), its folders that have nothing else left in them and its dashboards, marks the install archived and logs `pack.archived`. Items, links and the log stay |
| `upgrade_pack(install, plan)` (SECURITY DEFINER, 0035) | owners and admins of the install's workspace | Moves a live install to a newer catalogue version (docs/11 Upgrades). Checks the plan is for the version and `manifest_hash` installed now and the new version's hash, that every row it updates, archives or turns off is the install's own and every added ref is new to the install; updates only the columns the plan names (never a field's type, never an option removed, never an automation's on/off state), adds rows with the install's provenance (`app.pack_op = 'upgrade'`, which also lets rewritten rows take the new `pack_hash`), stamps new library items' `requirement_ref` (checked against the catalogue and the Ref value), archives sheets (only without client items), folders (only when empty), items and dashboards, turns removed automations off, logs item changes (`item.renamed`, `item.moved`, `value.changed`, `item.created`, `link.changed`, `item.archived`, note "Pack update") and `pack.upgraded` on the workspace chain (old and new version, counts, summary). Sets the install's version, hash and grown ref map. One transaction. Returns `{ install_id, version, ref_map, counts }` |
| `pack_member_emails(org)` | owners and admins (service role) | The members' emails, so a pack's example people (`people` by email) can be matched |

The plan (`p_plan`) is built by the pure planner `src/engine/packs/plan.ts` on the server from the catalogue manifest and a snapshot of the workspace (`src/server/packs/install.ts`); the browser never sends rows. Grants: the three functions to `authenticated` (`install_pack` and `pack_member_emails` also to `service_role`), `_pack_hash` and the guard to nobody.

## 16. Access control (0025–0028, P2)

Open by default: everyone in a workspace keeps the access their workspace role gives. Owners, and admins who have access themselves, can restrict a folder or a sheet and list people with a level. Everything is enforced in the database; the app only explains it.

**Roles and levels.** Workspace roles: owner, admin, editor, viewer and **auditor** (0025: read-only like a viewer; `memberships.expires_at` is required for auditors, checked by a constraint; invites carry `expires_at` and `accept_invite` copies it). `is_member` and `has_role` ignore a membership whose `expires_at` has passed, so every policy and every definer function ends an auditor's access at the end date with no job. Sheet levels: `owner | editor | commenter | viewer | none`. Commenter = viewer + post updates, @mention; no value, file or structure changes.

**Resolution** (`_sheet_levels(user, sheet)`, one place, 0026):

| Case | Level |
|---|---|
| Workspace owner | `owner`, always (break-glass) |
| Sheet not restricted | admin, editor → `editor`; viewer, auditor → `viewer` |
| Restricted, the person listed | the grant's level, capped by the role: viewers and auditors only ever `viewer` |
| Restricted, not listed (admins too) | `none` |

A sheet follows its folder (`sheets.access_inherit`, default true): restricted when `folders.restricted`, with the folder's list. With its own setting (`access_inherit = false`) the sheet's `restricted` flag and its own list replace the folder's (a sheet in a restricted folder can be opened on its own). Sub-item (child) sheets always resolve as their parent. Grants: `access_grants (org_id, folder_id | sheet_id, user_id, level, granted_by, granted_at)`, exactly one target, unique per target and person, indexed by target+person and by person. No write policies: only `set_sheet_access(sheet, inherit|restricted|open)`, `set_folder_access(folder, restricted)` and `set_access_grant(kind, target, user, level|null)` write them (owners, and admins with access to that sheet or folder; restricting as an admin lists the admin as an editor so they keep access). `sheets.restricted/access_inherit`, `folders.restricted` and `fields.restricted_to` change only through those functions (guard triggers, `app.access_op`) or `install_pack`. Moving a sheet into or out of a restricted folder (it would change who sees it) needs someone who manages both folders; adding a sheet to a folder needs edit access to the folder.

**Where it is enforced.**

- RLS reads: `sheet_id in (select readable_sheet_ids())` on sheets, fields, groups, views, form links, automations, automation runs and items; item-scoped tables (item_updates, files, file_access_log, protected_values, automation_pauses, notifications) through the readable item; `item_links` need both ends readable; activity_log entries need the sheet readable (workspace entries: members; folder access entries: owners and admins). `readable_sheet_ids()` is evaluated once per statement (a hashed subplan), not per row.
- RLS writes: structure tables need `editable_sheet_ids()`; `item_updates` need `commentable_sheet_ids()`.
- Definer RPCs: guard triggers on items, item_links, files, file_access_log, item_updates, protected_values, restricted_values and automation_pauses hold every RPC (old and new) to the person's level on the sheet (`_need_sheet`, cached per transaction for bulk writes). They apply to people only (`role = authenticated`); automations run as the service role and were authorised when saved (the automation commands refuse actions that write to sheets the author cannot edit; buttons need edit access).
- Notifications: a trigger drops a notification about an item its recipient cannot read, whoever sends it (mentions, forms, automations, webhook failures).
- Storage: an object is readable when its `files` row is; uploads go to items of sheets the person can edit.
- `my_sheet_access(org)` lists the sheets a person can read and, for owners and admins, the names of restricted sheets they cannot open (the side menu shows them as Restricted). `sheet_levels(ids)` tells "No access" from "does not exist" for link targets and widgets. `note_sheet_opened(sheet)` logs `restricted.accessed` on the sheet chain when an owner who is not listed opens a restricted sheet, at most once per person per day.

**Restricted fields** (0027). `fields.restricted_to = { userIds, roles }` (null: not restricted); owners always see. Set by `set_field_restriction(field, restricted, user_ids, roles)` (owners, and admins with edit access to the sheet), logged as `field.restricted / field.restriction_changed / field.unrestricted` on the sheet chain.

- Values leave `items.values` for `restricted_values (org_id, sheet_id, item_id, field_id, value)`, RLS: sheet readable and field visible (`hidden_field_ids()`). A BEFORE trigger on items moves any restricted key out of a written row (so `create_item`, imports, forms, sub-items, packs and the document workflow are all covered); `set_item_values` reads and writes the store for restricted keys (old value, clearing). Writing a restricted value needs sight of the field. Turning a restriction on or off moves existing values in one transaction. `fields.field_hidden` (a computed column) tells the app which fields the caller may not see.
- Links and files of a restricted field are readable only by people who see it.
- The log: a BEFORE INSERT trigger (`activity_a_mask`, before the hash chain) replaces a restricted field's old/new values (`value.changed`, `link.changed`, file events, and the field's entry in `item.created` values) with `{"$restricted": sha256(salt | value)}` and keeps the values in `restricted_activity` (RLS as `restricted_values`, append-only). The chain hashes the marker; `verify_activity_chain` also checks every stored value against its marker. Entries written before a field was restricted cannot change: RLS hides those that still hold its value from people who may not see it.
- Derived outputs: lookups, roll-ups and formulas over a restricted field or through a link to a sheet the person cannot read are shown as "Restricted" (`hiddenFor`, `readsHidden` in the field registry), as are summaries, Insights and dashboard widgets; automation messages, posts and webhook payloads always say "Restricted" for restricted (and protected) fields, whoever reads them, and stored run events mask restricted values. Public forms never show or accept a restricted field. Search and My work find items through a restricted people field only for people who see it.

**Packs.** A manifest's folders and sheets may say `"restricted": true` (P1 manifest, optional): `install_pack` creates them restricted and lists the installing person as an editor, logged as a grant.

## 17. Requirement library (0030, P3)

Frameworks, their requirements and the cross-walks between them are global, versioned reference data (docs/12): reference numbers with our own short titles, never a standard's text.

- **`frameworks`** (`key`, `version` = the edition, primary key `(key, version)`; `revision`, `title`, `short_title`, `publisher`, `kind` standard | law | regulation | internal, `source`, `licence`, `url`, `titles` = 'own-words' (checked), `pack_key` + `pack_version` → the library pack in `packs`, `hash`; 0037: the edition status `status` current | withdrawn | superseded-in-transition | revision-in-progress, `superseded_by` (`<key>@<version>`, required exactly when withdrawn or superseded), `transition_ends`, `revision_stage`, `revision_expected`, `status_note`, `status_checked_on`, updated in place by the seed, docs/12 Edition status).
- **`requirements`** (`framework_key`, `framework_version`, `ref`, primary key all three; `parent_ref` (FK to the same framework; themes have none, everything else has one), `kind` clause | control | article | paragraph | theme, `position`, `title` ≤ 80 characters, `guidance`, `tags`).
- **`crosswalks`** (`from_*` and `to_*` framework, version, ref, each end an FK to `requirements`; `relation` equivalent | partial | related; `note`; `source` = the mapping and its version, e.g. 'Klarert mapping v1'; unique per pair; never within one framework version).
- RLS: read to `authenticated`, no write grants (the seed path writes with the service role). `catalogue_guard`: nothing is deleted, a requirement's ref, parent and kind and a framework's key and version never change, a cross-walk never changes (a corrected mapping is a new source version). A revision may reword our titles and guidance and add requirements.
- **`items.requirement_ref`** (`<framework>@<version>#<ref>`, checked format; unique per sheet; indexed by workspace): written once by `adopt_framework` (`app.pack_op = 'adopt'`), never changed (`items_requirement_guard`); the same guard keeps a library item's Ref value (the field named by `sheets.settings.framework.refFieldKey`) as it was, except while `set_field_restriction` moves values.
- **`sheets.settings.framework`** = `{ key, version, refFieldKey }` on a library sheet made by adoption.
- **Links to any library**: a `requirement` or `controllink` field whose `targetSheetId` is null links to items of every library sheet of the workspace (`set_item_links` refuses any other target). A link field may mirror such a field (its `config.inverseFieldId` names it, e.g. a library's Controls field): `setLinks` writes the mirror for each target whose sheet has one.

| RPC | Who | Does |
|---|---|---|
| `adopt_framework(org, framework, version, plan)` (SECURITY DEFINER) | owners and admins of `org` | Checks the plan is the framework's library pack and the edition is not adopted (a live library sheet names its key and version; 0037 lets two editions live side by side), runs `install_pack` (provenance, `pack.installed`), stamps each library item's `requirement_ref` from the plan, checks every key is a non-theme requirement of the framework and equals the item's Ref, and that every requirement has its item, and logs `framework.adopted` on the workspace chain. One transaction. Returns install_pack's result with `sheet_id` and `requirements` |
| `move_framework_edition(org, from_sheet, to_sheet, copies, links)` (SECURITY DEFINER, 0037) | owners and admins of `org`, editors of both sheets | Both live libraries of one framework, the target's edition the one that replaces the source's (`superseded_by`), the source not moved yet. Each copy must join two items whose requirements are `equivalent` in `crosswalks`; writes it with `set_item_values` (note "Copied from …"), each link with `set_item_links`, locks every item of the old library (`set_item_lock`), sets `sheets.settings.framework.movedTo` and logs `framework.moved`. One transaction. Returns `copied`, `links`, `locked` |

Grants: `adopt_framework` and `move_framework_edition` to `authenticated`; `_library_ref_field`, `items_requirement_guard` and `catalogue_guard` to nobody.

## 18. Retention and erasure (0036)

Owner decision: **rules + review queue**. Retention periods are data per sheet; due records wait for a person.

**Personal data.** A field is personal data when `fields.config.personalData = true` (field settings, any stored field; packs set it in the manifest; `updateField` keeps it outside the type's schema and a type change keeps it). `sheets.settings.retention.personalNames = true` says the sheet's item names may hold personal data. Item files have their own `files.personal_data` flag (0023).

**The log without personal data in clear (the redaction design).** `activity_log` is append-only and hash-chained, and old entries hold old values, so erasure cannot touch them. Instead personal data never enters the log in clear: `activity_a_mask` (BEFORE INSERT, before `activity_chain`) replaces each personal value with a marker `{"$personal": sha256(salt | kind | value)}` and writes the value and a random salt to `personal_activity` (one row per entry and slot: `field` with `field_id`, `name`, or `file` with `file_id`; RLS like `restricted_activity`: the sheet readable and the field visible). Covered: `value.changed`, `link.changed` and file events of a personal field, the field's value in `item.created`, item names (`item.created`, `item.renamed`) on sheets with `personalNames`, and the name, description and version note of file events of item files marked personal data (key by key; category and version stay in clear). Personal data wins over a field restriction, so erasable values never land in the append-only `restricted_activity`. The chain hashes the marker, so erasing nulls the value **and the salt** in `personal_activity` (the only change its guard allows, inside `retention_execute` with `app.retention_op = 'erase'`); without the salt the marker cannot be tested against guesses. `verify_activity_chain` checks every value not yet erased against its marker and returns `redacted` (the number of erased values); the chain itself is untouched. Entries written before a field was marked stay as they are (append-only): mark fields before they hold data; erasure counts those entries (`earlier_entries_in_clear`) and says so. The item panel reads `personal_activity` for markers it may see and shows erased values as "erased"; audit exports print "Personal data" and never read it.

**Rules** (`sheets.settings.retention = { personalNames?, rules: [...] }`, `retentionRuleSchema` in `src/engine/retention`): `id` (stable, the queue's key), `name`, `from` (`{ kind: 'field', fieldKey }` a date field or a date formula, `created`, `updated`), `period` (`n` days, months or years), `action` (`erase`, `anonymise`, `archive`), `fieldKeys` (personal fields to erase; none = all), `files` (item files marked personal data), `comments`, `archiveItem`, `onlyDone`, `groupIds`, `conditions` (view filter operators), `note`. Manifests and templates give `groups` by ref instead of `groupIds`. Written by owners and admins (`saveRetentionRules`, Sheet settings › Retention), logged by the sheets audit trigger.

**Due and queued.** The pure `retentionDue` gives, per rule, the items (archived ones too for erase and anonymise) whose anchor date + period is today or earlier, skipping items whose own Retention field says Legal hold. The scheduler runs it once a day per workspace (`retention_claim_day`, service role) and owners and admins can **Check now**; both call `retention_enqueue(org, rows)`, which checks each row against the workspace, the sheet's current rule and the item, inserts into `retention_queue` once per (item, rule, due date) and logs `retention.due` on the item's chain, then notifies owners and admins once.

**Deciding** (Workspace admin › Retention; owners and admins with edit access to the sheet: the workspace has no DPO role, so a DPO needs the admin role):

| RPC | Does | Logs |
|---|---|---|
| `retention_postpone(queue, until, reason)` | a later date and a reason are required; the entry comes back on that date | `retention.postponed` |
| `set_retention_hold(item, on, reason)` | a legal hold (`retention_holds`, one live per item, reason required) blocks every retention action until released; the item's own Retention field set to Legal hold blocks too | `retention.hold_placed` / `retention.hold_released` |
| `retention_execute(queue, note)` | one transaction. **erase**: the rule's personal fields leave `items.values`, `restricted_values`, `protected_values` and `item_links`; their files (and with `files` the item files marked personal data) are marked `erased_at`, renamed "erased", hash zeroed, archived, and their storage paths returned; with `comments` the item's updates are deleted; the item's notifications are deleted and its automation run details and webhook payloads cleared; the matching `personal_activity` rows are erased. **anonymise**: the same with personal files and comments always, and the name replaced by "Anonymised <item label>" (its logged names erased). **archive**: `set_item_archived`. `archiveItem` archives after erasing. The item shell, its other fields and its chain stay | a tombstone `retention.erased` / `retention.anonymised` / `retention.archived` with the queue id, rule, due date, field keys and names, counts and the approver: never a value |

The command (`approveRetention`) then removes the returned objects through the Storage API with the person's own client (policy `files_erase`: owners and admins, erased files only); leftovers can be removed later ("Remove erased files from storage"). Grants: the four RPCs and `retention_enqueue` to `authenticated` (enqueue also `service_role`), `retention_claim_day` to `service_role` only, the `_` helpers and triggers to nobody. Sub-items are covered by rules on their own (child) sheet only.

## 19. Approval workflows (0040)

Multi-step approvals (docs/04 §13), owner-approved after the MVP. Definitions are data per sheet in **`sheets.settings.workflows`** (an array, `approvalWorkflowSchema`, `src/engine/approvals/definition.ts`). `sheets_workflows_guard`: only owners and admins change them (`only owners and admins change approval workflows`); a sheet inserted by someone who is not an admin (a copy) starts without them; packs write them through `install_pack` and `upgrade_pack` (`app.pack_op`). The sheets audit trigger logs every change on the sheet's chain.

- **`workflow_instances`** (`org_id`, `sheet_id`, `item_id`, `workflow_id`, `definition` = a copy taken at submit, `status` in_progress | approved | rejected | withdrawn, `step_index` (null once ended), `round` (up by one each time a rejection sends the item back to a step), `step_started_at`, `step_due_at` (the SLA), `approvers` (jsonb: the approvers of every step, fixed at submit), `step_approvers` (uuid[]: the current step's, GIN-indexed for the inbox), `submitted_by`, `submitted_at`, `submit_comment`, `automation_id` (set when `start_workflow` submitted it), `ended_at`, `ended_by`, `end_reason` approved | draft | closed | withdrawn). At most one in progress per item (partial unique index).
- **`workflow_decisions`** (`instance_id`, `item_id`, `step_index`, `step_id`, `step_name`, `round`, `user_id`, `decision` approved | rejected, `comment` ≤ 2000, `decided_at`), unique per instance, step, round and person; append-only (`workflow_decisions_append_only`).
- RLS: read where the item's sheet is readable (`readable_sheet_ids()`); no write grants for `authenticated`. Every write goes through the three RPCs (SECURITY DEFINER), which write the instance, the decision, the item's own changes and the **activity log entries in one transaction**: a decision is tamper-evident in the item's hash chain like any value change.

| RPC | Who | Does |
|---|---|---|
| `workflow_submit(item, workflow, comment?, automation?, submitter?)` | editors of the sheet (owners and admins also on a locked item); the runner as an automation (service role, `submitter` = the person who started the chain) | Checks the definition (it exists, is on and well formed), that no approval is in progress, the required fields (`requiredFields`); resolves every step's approvers (`_wf_resolve`: people, a people field, members whose job title is the role's name, team members; live members only), leaves the submitter out unless `allowSelfApproval`, and refuses with every problem in words: a step with nobody, approvers who cannot read the sheet (`_sheet_level_for`), auditors. Writes the instance, `workflow.submitted`, the step field's option and the status on submit (`_wf_apply`), and notifies step 1's approvers |
| `workflow_decide(instance, decision, comment?)` | people only: an approver of the current step who can read the item (view access is enough), not the submitter unless allowed, not an auditor, once per step and round | Inserts the decision and `workflow.decided`; any one / all; moves to the next step (approvers notified, SLA restarted), sends the item back to a step (round + 1), or ends it (`workflow.approved` / `workflow.rejected`), setting the step field, the status on approval or rejection (the documents register's rules and the sub-item close gate apply as for a person's edit) and the lock on approval (`item.locked`); notifies the submitter. Returns the outcome and the changed fields for the automation events |
| `workflow_withdraw(instance, comment?)` | the submitter, owners and admins who can read the item | Ends it withdrawn, `workflow.withdrawn`, the step field back to draft |

The item's own changes are written with `app.workflow_op = 'on'` for the statement, which `items_access_guard` lets through: approvers may hold only view access, and the RPC has checked who may act. The `workflowstep` field stays unwritable for people through `set_item_values`. Upgrades are written by `apply_pack_upgrade(install, plan)` (0040, granted to `authenticated`): `upgrade_pack` (whichever definition is current) and then `p_plan.update.workflows` (`[{ sheet_id, workflows }]`, sheets of the install only), which replaces a sheet's workflows, in one transaction; `upgrade_pack` keeps its contract. Grants: the three RPCs to `authenticated` (`workflow_submit` also to `service_role`), the `_wf_` helpers and the guards to nobody. pgTAP: `supabase/tests/0030_approval_workflows.sql`.
