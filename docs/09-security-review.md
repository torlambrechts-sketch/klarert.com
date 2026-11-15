# 09 · Security review (M10)

Date of review: 12 Nov 2026, branch `m10-first-sheet`. Scope: the MVP as built through M10. What was checked, how it
is kept checked, what was fixed, and what is left open.

## 1. Every command validates its input and checks the caller

All writes go through the commands in `src/server/commands/` (CLAUDE.md rule 2). The list below is generated from the
code by `pnpm security:commands` (`scripts/security/commands.ts`); `scripts/security/commands.test.ts` (part of
`pnpm test`) fails when a command does not parse its input with Zod **before its first await**, or has no role check.

Role check: `member`, `editor` and `admin` are `withOrg(slug, role, …)` (`src/server/commands/context.ts`), which looks
up the caller's membership of the workspace named in the input; `signed in` is `getSession()` for the onboarding
commands (no workspace yet); `public (token)` is the public form only. RLS then applies the same rules again in the
database, and the definer functions check `can_write` / `is_admin` themselves. "Also" lists further checks found in
the body (admin-only branches, item and field locks, own rows).

| Command | File | Zod schema | Role check | Also |
|---|---|---|---|---|
| `getSheetAccess` | `access.ts` | `sheetInput` | member |  |
| `getFolderAccess` | `access.ts` | `folderInput` | member |  |
| `setSheetAccess` | `access.ts` | `sheetModeInput` | admin |  |
| `setFolderAccess` | `access.ts` | `folderModeInput` | admin |  |
| `setAccessGrant` | `access.ts` | `grantInput` | admin |  |
| `setFieldRestriction` | `access.ts` | `fieldInput` | admin |  |
| `createAutomation` | `automations.ts` | `createAutomationInput` | editor |  |
| `updateAutomation` | `automations.ts` | `updateAutomationInput` | editor | admin-only branch, locks |
| `toggleAutomation` | `automations.ts` | `toggleAutomationInput` | editor | admin-only branch, locks |
| `duplicateAutomation` | `automations.ts` | `automationRefInput` | editor |  |
| `deleteAutomation` | `automations.ts` | `automationRefInput` | editor | admin-only branch, locks |
| `setAutomationPause` | `automations.ts` | `pauseAutomationInput` | editor |  |
| `createDashboard` | `dashboards.ts` | `createDashboardInput` | editor | admin-only branch |
| `updateDashboard` | `dashboards.ts` | `updateDashboardInput` | editor | admin-only branch |
| `deleteDashboard` | `dashboards.ts` | `deleteDashboardInput` | editor |  |
| `readDesign` | `design.ts` | `readDesignInput` | member | configuration only; restricted field names and webhook addresses masked before it leaves the server |
| `seedDashboard` | `dashboards.ts` | `seedDashboardInput` | editor | admin-only branch |
| `itemDocuments` | `documents.ts` | `itemDocumentsInput` | member |  |
| `searchDocuments` | `documents.ts` | `searchDocumentsInput` | member |  |
| `addDocumentsField` | `documents.ts` | `addDocumentsFieldInput` | editor |  |
| `setDocumentsRegister` | `documents.ts` | `setRegisterInput` | admin |  |
| `addField` | `fields.ts` | `addFieldInput` | editor |  |
| `updateField` | `fields.ts` | `updateFieldInput` | editor | admin-only branch, locks |
| `addFieldOption` | `fields.ts` | `addFieldOptionInput` | editor | admin-only branch, locks |
| `moveField` | `fields.ts` | `moveFieldInput` | editor | admin-only branch, locks |
| `duplicateField` | `fields.ts` | `fieldRefInput` | editor |  |
| `deleteField` | `fields.ts` | `fieldRefInput` | editor | locks |
| `restoreField` | `fields.ts` | `fieldRefInput` | editor |  |
| `listDeletedFields` | `fields.ts` | `deletedFieldsInput` | member |  |
| `changeFieldType` | `fields.ts` | `changeTypeInput` | editor | admin-only branch, locks |
| `prepareUpload` | `files.ts` | `prepareUploadInput` | editor |  |
| `confirmUpload` | `files.ts` | `confirmUploadInput` | editor |  |
| `downloadFile` | `files.ts` | `downloadFileInput` | member |  |
| `previewFile` | `files.ts` | `downloadFileInput` | member |  |
| `setFileDetails` | `files.ts` | `setFileDetailsInput` | editor |  |
| `archiveFile` | `files.ts` | `archiveFileInput` | admin |  |
| `createFolder` | `folders.ts` | `folderInput` | admin |  |
| `renameFolder` | `folders.ts` | `renameFolderInput` | admin |  |
| `moveFolder` | `folders.ts` | `moveFolderInput` | admin |  |
| `sortFolderAZ` | `folders.ts` | `folderRef` | admin |  |
| `deleteFolder` | `folders.ts` | `folderRef` | admin |  |
| `createForm` | `form-admin.ts` | `createFormInput` | admin |  |
| `saveForm` | `form-admin.ts` | `saveFormInput` | admin |  |
| `duplicateForm` | `form-admin.ts` | `duplicateFormInput` | admin |  |
| `copyFormToSheet` | `form-admin.ts` | `copyFormInput` | admin |  |
| `deleteForm` | `form-admin.ts` | `deleteFormInput` | admin |  |
| `changeFormLink` | `form-admin.ts` | `formLinkInput` | admin |  |
| `setNewItemForm` | `form-admin.ts` | `setNewItemFormInput` | admin |  |
| `submitInternalForm` | `form-admin.ts` | `internalSubmitInput` | editor |  |
| `submitPublicForm` | `forms.ts` | `publicSubmitInput` | public (token) |  |
| `createGroup` | `groups.ts` | `createGroupInput` | editor |  |
| `updateGroup` | `groups.ts` | `updateGroupInput` | editor |  |
| `moveGroup` | `groups.ts` | `moveGroupInput` | editor |  |
| `deleteGroup` | `groups.ts` | `deleteGroupInput` | editor |  |
| `createItem` | `items.ts` | `createItemInput` | editor | locks |
| `finishItem` | `items.ts` | `finishItemInput` | editor |  |
| `setValues` | `items.ts` | `setValuesInput` | editor |  |
| `bulkSetValues` | `items.ts` | `bulkSetValuesInput` | editor |  |
| `moveItems` | `items.ts` | `moveItemsInput` | editor | locks |
| `archiveItems` | `items.ts` | `archiveItemsInput` | editor | locks |
| `lockItem` | `items.ts` | `lockItemInput` | admin | locks |
| `setLinks` | `items.ts` | `setLinksInput` | editor | admin-only branch, locks |
| `clickButton` | `items.ts` | `clickButtonInput` | editor |  |
| `createInvite` | `members.ts` | `createInviteInput` | admin |  |
| `revokeInvite` | `members.ts` | `revokeInviteInput` | admin |  |
| `changeRole` | `members.ts` | `changeRoleInput` | admin |  |
| `removeMember` | `members.ts` | `removeMemberInput` | admin |  |
| `markNotificationsRead` | `notifications.ts` | `markReadInput` | member |  |
| `noteActivityLogOpened` | `notifications.ts` | `orgInput` | member |  |
| `saveProfile` | `onboarding.ts` | `profileInput` | signed in |  |
| `createWorkspace` | `onboarding.ts` | `createWorkspaceInput` | signed in |  |
| `acceptInvite` | `onboarding.ts` | `acceptInviteInput` | signed in |  |
| `listPacks` | `packs.ts` | `listPacksInput` | member | admin-only branch |
| `previewPack` | `packs.ts` | `previewPackInput` | admin |  |
| `installPack` | `packs.ts` | `installPackInput` | admin | locks |
| `archivePack` | `packs.ts` | `archivePackInput` | admin |  |
| `verifyActivity` | `panel.ts` | `verifyActivityInput` | member |  |
| `searchItems` | `panel.ts` | `searchItemsInput` | member |  |
| `runDateChecksNow` | `scheduler.ts` | `input` | admin |  |
| `search` | `search.ts` | `input` | member |  |
| `createSheet` | `sheets.ts` | `createSheetInput` | editor | admin-only branch, own rows |
| `importCsv` | `sheets.ts` | `importCsvInput` | editor |  |
| `copySheet` | `sheets.ts` | `copySheetInput` | editor | locks, own rows |
| `updateSheet` | `sheets.ts` | `updateSheetInput` | editor |  |
| `setColumnGroups` | `sheets.ts` | `setColumnGroupsInput` | admin |  |
| `archiveSheet` | `sheets.ts` | `archiveSheetInput` | admin |  |
| `renameSheet` | `sheets.ts` | `renameSheetInput` | editor |  |
| `moveSheet` | `sheets.ts` | `moveSheetInput` | editor |  |
| `createTeam` | `structure.ts` | `teamInput` | admin |  |
| `deleteTeam` | `structure.ts` | `teamRef` | admin |  |
| `addTeamMember` | `structure.ts` | `teamMemberInput` | admin |  |
| `removeTeamMember` | `structure.ts` | `teamMemberInput` | admin |  |
| `createJobRole` | `structure.ts` | `jobRoleInput` | admin |  |
| `deleteJobRole` | `structure.ts` | `jobRoleRef` | admin |  |
| `createEntity` | `structure.ts` | `entityInput` | admin |  |
| `deleteEntity` | `structure.ts` | `entityRef` | admin |  |
| `createSite` | `structure.ts` | `siteInput` | admin |  |
| `deleteSite` | `structure.ts` | `siteRef` | admin |  |
| `enableSubitems` | `subitems.ts` | `enableSubitemsInput` | editor |  |
| `updateSubitemSettings` | `subitems.ts` | `subitemSettingsInput` | editor |  |
| `createSubitem` | `subitems.ts` | `createSubitemInput` | editor | locks |
| `createSubitemsFromTemplate` | `subitems.ts` | `subitemsFromTemplateInput` | editor | locks |
| `moveSubitem` | `subitems.ts` | `moveSubitemInput` | editor |  |
| `postUpdate` | `updates.ts` | `postUpdateInput` | editor | own rows |
| `editUpdate` | `updates.ts` | `editUpdateInput` | editor |  |
| `deleteUpdate` | `updates.ts` | `deleteUpdateInput` | editor |  |
| `createView` | `views.ts` | `createViewInput` | member | admin-only branch, own rows |
| `updateView` | `views.ts` | `updateViewInput` | member | admin-only branch, own rows |
| `duplicateView` | `views.ts` | `duplicateViewInput` | member | admin-only branch, own rows |
| `deleteView` | `views.ts` | `deleteViewInput` | member | own rows |
| `setDefaultView` | `views.ts` | `setDefaultViewInput` | editor | own rows |
| `setSheetTabs` | `views.ts` | `setSheetTabsInput` | admin | own rows |
| `filterItemIds` | `views.ts` | `filterItemsInput` | member |  |

111 commands (regenerated for P2, 13 Nov 2026), 111 with a Zod schema parsed first, 111 with a role check. Helpers in the same folder that are not commands
(`withOrg`, `createInverseField`, `detachInverse`, `confirmWith`, `setSheetTabsWith`, `loadPublicForm`) are called only by commands.

Server Actions (`'use server'` files in `src/app`) only bind these commands; the two that do more are the login action
(Zod, then Supabase Auth's magic link) and the public form action (hashes the IP, see §4).

## 2. Row level security

- `supabase/tests/0012_security.sql` (new): RLS is on for **every** table in `public`; every workspace table has
  `org_id`; tables without policies are only the service-role ones (`scheduler_fired`, `outbound_webhooks`,
  `form_rate_limits`); the activity log's append-only and hash-chain triggers are enabled.
- `supabase/tests/0001_rls.sql` … `0011_first_sheet.sql`: viewer cannot write, editor cannot change a locked field,
  members of one workspace cannot read another's rows, protected values, function grants (least-privilege EXECUTE),
  automations, scheduler, inbox, the template import's `create_items` note.
- `pnpm db:test`: 12 files, 200 assertions, all passing.

## 3. The service role key stays on the server

- Used in exactly the allowed places: `src/app/api/cron/scheduler/route.ts`, `src/app/api/cron/webhooks/route.ts`,
  `src/app/f/[token]/actions.ts` (public form), `src/server/automations/effects.ts`, and `scripts/seed.ts` (local
  data; it refuses a non-local project unless `SEED_ALLOW_REMOTE=1`). The template importer
  (`src/server/templates/importer.ts`) receives a client and is called only by the seed.
- CI: after `pnpm build`, `pnpm security:bundle` (`scripts/security/check-client-bundle.mjs`) searches every file in
  `.next/static` for the key value, its payload and signature separately, and the strings `SUPABASE_SERVICE_ROLE_KEY`
  and `service_role`. It fails the build on any hit (checked locally: 94 files, no hit; a planted file is caught).
- The e2e suite runs the seed for fresh workspaces and, for the webhook back-off row of docs/07 (B9), moves
  `next_attempt_at` forward with `psql` against the **local** database. Neither is app code.

## 4. Public form

- Tokens are 32 random bytes from the database (`form_links.token`, 64 hex), revocable ("Disable link").
- Rate limit: 10 submissions per minute per hashed IP, kept in Postgres (`submit_public_form`, migration 0009);
  pgTAP `0007_views_forms.sql` checks that the 11th submission in a minute is refused with `rate_limited`, that
  signed-out callers cannot reach `submit_form` directly, that only the service role may call `submit_public_form`,
  and that fields not on the form are refused. A filled honeypot is rejected silently.
- The route hashes the IP with a server-side salt; the database never sees the address.

## 5. Found and fixed in this review

| Finding | Fix |
|---|---|
| `scheduler_fired` had no `org_id` (rule 6) | migration 0013 adds it (filled from the automation), `claim_schedule_occurrence` sets it; pgTAP 0012 now checks every workspace table |
| No automated guard that commands keep Zod and role checks | `scripts/security/commands.test.ts` |
| No guard against the key reaching the browser | CI step `pnpm security:bundle` |
| No check that RLS stays on for new tables | pgTAP `0012_security.sql` |

## 6. Open (not fixed here; for Tor to decide)

1. **Rate-limit salt.** `hashIp` uses `FORM_RATE_LIMIT_SALT`, else `CRON_SECRET`, else an empty salt. Set
   `FORM_RATE_LIMIT_SALT` in Vercel so the hashes do not depend on another secret (and are not unsalted).
2. **Client IP header.** The form action takes the first `x-forwarded-for` entry, then `x-real-ip`. On Vercel these are
   set by the platform; behind any other proxy a visitor could choose their own IP and step around the rate limit.
   Keep the app on Vercel or read the platform's header only.
3. **Cron secret strength.** `/api/cron/*` accept `Authorization: Bearer $CRON_SECRET` (constant-time compare, unit
   tested). Use a long random value in every environment.
4. **Manual review still worth doing:** dependency audit (`pnpm audit`) and Supabase Auth settings in the EU project
   (redirect allow list, email rate limits), which live outside the repository.

## 7. Sheet access (P2, 13 Nov 2026, branch `access-p2`)

Model in docs/02 §16. One resolution, `_sheet_levels(user, sheet)` (migration 0026), answers owner / editor /
commenter / viewer / none from the workspace role, the membership's end date (auditors), the folder's or the sheet's
own restriction and list, the parent of a sub-item sheet, and owners always. Everything below uses it, through
`readable_sheet_ids()` / `commentable_sheet_ids()` / `editable_sheet_ids()` (RLS, evaluated once per statement),
`sheet_access(sheet)` (commands), `_need_sheet(sheet, level)` (guard triggers, cached per transaction) and
`_sheet_level_for(user, sheet)` (notifications to someone else). Restricted fields (0027) keep values in
`restricted_values` and `restricted_activity`, RLS by sheet and field visibility (`hidden_field_ids()`).

### 7.1 RLS policies over sheet data

| Table | Read | Write |
|---|---|---|
| folders | members; a restricted folder: owners and admins (its name), people with access, or anyone who can read a sheet in it | insert: editors; update/delete: admins with access to it |
| sheets | `readable_sheet_ids()` (admins without access get the name only through `my_sheet_access`) | insert: editors, into folders they can edit, parents they can edit; update/delete: `editable_sheet_ids()`; restriction columns only through the access functions (trigger); moving into or out of a restricted folder only by people who manage both (trigger) |
| fields, groups | readable sheet | editable sheet (fields: locked rule as before); `restricted_to` only through `set_field_restriction` (trigger) |
| views | readable sheet, shared or own | personal: readable sheet; shared: editors of the sheet; forms: admins who can edit the sheet |
| form_links | readable sheet | admins who can edit the sheet |
| automations | readable sheet | editable sheet (+ 0011 rules) |
| automation_pauses | the automation is readable | editors of the automation's sheet |
| automation_runs | readable sheet (runs without a sheet: admins) | service role only |
| items | `readable_sheet_ids()` | definer RPCs only, guarded (7.2) |
| item_links | both items readable and the field not hidden | definer RPCs only, guarded |
| item_updates | item readable | commenters and up, as themselves (`commentable_sheet_ids()`); edit/delete own within 15 min, guarded |
| files | item readable, field not hidden (item files: no field) | editors of the sheet, guarded |
| file_access_log | item readable | `download_file` only, guarded (read access) |
| protected_values | item readable and (admin or listed) as before | as before, guarded (edit access) |
| restricted_values, restricted_activity (new) | sheet readable and field visible | definer functions only (no write policies), guarded |
| activity_log | sheet readable (workspace entries: members; folder access entries: admins); entries written before a field was restricted that still hold its value: hidden from people who may not see it | definer functions and audit triggers only |
| notifications | own, and the item readable | `read_at` only; inserts dropped for recipients who cannot read the item (trigger) |
| dashboards | members (config only: the data behind each widget follows the sheet; "No access" when it cannot be read) | editors as before |
| access_grants (new) | the person's own, owners and admins, people with access to the target | access functions only |
| storage.objects (files bucket) | the object's `files` row is readable | uploads to items of sheets the person can edit |

pgTAP: `supabase/tests/0020_access.sql` (110 assertions): a role × object matrix over a restricted sheet (owner;
admin not listed / listed; editor listed / not; commenter; viewer listed / not; auditor active / expired; another
workspace) × sheet, fields, items, sub-items, links, files, downloads, updates, activity, automations, runs, views and
forms, for reads and for writes (values, uploads to storage, comments, sub-items, links, files, downloads, internal forms, form links,
managing access), folder inheritance and own settings, moving sheets between folders, notifications, restricted
values never readable (direct select, `set_item_values` output, the log, search by person, filters, public forms),
restriction moving values in and out, chain verification with masked entries, break-glass logging and the grants.

### 7.2 SECURITY DEFINER functions that read or write sheet data

Definer functions bypass RLS, so each is held by its own check or by a guard trigger on the table it writes (the
triggers apply to people, `role = authenticated`; automations run as the service role and are authorised when saved):

| Function | Covered by |
|---|---|
| `create_item`, `_insert_item`, `_create_item`, `create_items`, `create_subitem(s)`, `_create_subitem`, `move_item`, `move_subitem`, `set_item_archived`, `set_item_lock`, `hold_item`, `release_item`, `delete_group` (item moves) | `items_access_guard` (edit access); `create_items` and `set_item_values` also check first |
| `set_item_values`, `_document_transition` | explicit `_need_sheet(editor)`, items guard, `restricted_values_guard` (edit access and sight of a restricted field) |
| `set_item_links` | `item_links_access_guard`: edit access to the item it starts from, read access to the target (two-way links: edit access to both) |
| `add_file`, `set_file_meta`, `archive_file`, `restore_file` | `files_access_guard` (edit access) |
| `download_file` | `file_access_log_access_guard` (read access) |
| `notify_mention`, `_submit_form` (notify), `record_webhook_attempt` | `notifications_access_guard`: recipients who cannot read the item get nothing |
| `edit_update`, `delete_update` | `item_updates_access_guard` (comment access) |
| `set_protected_value` | `protected_values_access_guard` (edit access) |
| `set_automation_pause` | `automation_pauses_access_guard` (edit access) |
| `delete_group`, `form_link_create / _regenerate / _disable`, `install_pack`, `archive_pack` (structure rows) | `structure_access_guard` (0029) on groups, fields, views, form links and automations, for writes from inside definer functions (direct writes: RLS) |
| `submit_internal_form` | explicit: the sheet readable, edit access (auditors and viewers refused) |
| `submit_public_form`, `get_public_form` | public token; restricted fields never on a public form (0027) |
| `verify_activity_chain` | explicit: the chain's sheet readable; checks restricted values against their markers |
| `set_folder_archived` (invoker) | refuses when the folder holds sheets the caller cannot see |
| `items_for_people`, `filter_item_ids`, `form_stats`, `item_update_summaries` | SECURITY INVOKER: RLS on items, restricted_values, item_updates |
| `claim_schedule_occurrence`, `record_automation_run`, `claim_outbound_webhooks` | service role (admins for date checks now); no content returned |
| `install_pack` | admins and owners; restricted folders and sheets created restricted with the installer listed; structure guard |
| `adopt_framework` (0030, P3) | admins and owners; calls `install_pack` (same guards) and stamps `items.requirement_ref` under `items_requirement_guard`; library sheets are ordinary sheets for RLS and sheet access |
| access functions (`set_sheet_access`, `set_folder_access`, `set_access_grant`, `set_field_restriction`, `note_sheet_opened`, `sheet_access_info`, `folder_access_info`, `my_sheet_access`, `sheet_levels`) | owners, and admins with access; every change logged on the sheet's or the workspace's chain |

Grants: every new function is executable by `authenticated` only (and `service_role` where the runner needs it);
`_` helpers by nobody (pgTAP 0017 and 0020 check).

### 7.3 Server read paths

| Path | How it is covered |
|---|---|
| `src/lib/sheet-query.ts` (grid, panel, commands, Insights sources) | person's client, RLS; restricted values merged only from `restricted_values` the person may read; `fields.field_hidden` marks the rest; `sheet_levels` marks link targets without access ("Restricted" lookups) |
| `src/server/sheet-context.ts` (commands' write context) | as above |
| `src/server/repositories/sheets.ts` (side menu, sheet page) | RLS; `my_sheet_access` adds restricted names for owners and admins, marked no access; the sheet page shows "This sheet is restricted" without content; owners not listed are logged once a day |
| `src/server/commands/search.ts` | RLS on sheets and items; people matches through `items_for_people` (restricted people fields only for people who see them) |
| `src/server/repositories/my-work.ts` | RLS; `items_for_people` as above |
| `src/server/repositories/dashboards.ts` | RLS; widgets over sheets without access say "No access", over hidden fields "Restricted" |
| Insights (`src/components/insights/use-insights-data.ts`, `src/engine/insights`) | browser client, RLS; hidden fields left out of the pickers and a widget naming one says "Restricted"; sheets without access "No access" |
| `src/server/repositories/evidence.ts` (Evidence library) | RLS on files (item readable, field not hidden) |
| `src/server/repositories/workflow.ts` | RLS (`fetchItemsOfSheets`) |
| Activity tab, trend lines, Workspace admin and pack logs | RLS on activity_log; restricted values are markers ("Restricted") |
| `src/server/automations/effects.ts` (service role) | messages, posts and webhook payloads say "Restricted" for restricted fields and for lookups into restricted sheets; stored run events mask restricted values; notifications only reach people who can read the item (trigger); actions that write to sheets the author cannot edit are refused when the automation is saved; buttons need edit access |
| Scheduler and webhook worker (service role) | as effects; the queue holds masked payloads |
| Public form route (service role) | no restricted field shown or accepted; notifications filtered |
| Exports | none in the app yet (no data export command); copying cells uses what the person sees |

### 7.4 Performance

10 000 items × 30 fields (`pnpm perf:sheet`), read as an editor, median of 6 runs inside Postgres (EXPLAIN ANALYZE plan:
index scan on `items_group_idx` with a hashed subplan filter, the subplan run once):

| Query | Before (`is_member(org_id)` per row) | After (`sheet_id in (select readable_sheet_ids())`) |
|---|---|---|
| The whole sheet (10 000 rows) | 93.4 ms | 32.1 ms |
| One page (1 000 rows, sorted) | 72.6 ms | 9.1 ms |
| Count | 68.3 ms | 3.0 ms |

Creating the 10 000 items through `create_items` as an editor took 2.2 s with the guard triggers (the per-transaction
cache keeps it to one level check). Grants are indexed by (sheet, person), (folder, person) and (person, workspace).

### 7.5 Open (for Tor)

1. Teams in grants come later (people only now); the panel shows people.
2. A copied sheet starts open and unrestricted (structure only, no items are copied).
3. Restricted values are not sent over realtime: people who may see them get them on the next refetch.
4. Server-side filters for sheets over 2 000 items (`filter_item_ids`) read `items.values` only, so they cannot filter
   on a restricted field (no leak; the filter finds nothing).
5. `archive_pack` stops with "no access" when the pack holds restricted sheets the admin cannot open (their
   automations are held by the structure guard): an owner, or an admin on their lists, archives it.
