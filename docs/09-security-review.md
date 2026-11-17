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
| `logDataFlowExport` | `design.ts` | `dataFlowExportInput` | member | owners, admins and auditors only (also in `log_audit_export`, 0049); logs the filters and counts, never an address or a value |
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

1. ~~**Rate-limit salt.**~~ Fixed (§8.4, SA-10): public forms use `FORM_RATE_LIMIT_SALT` only and refuse every
   answer without it.
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
| form_links | admins who can read the sheet (the token is the form's only key, 0062) | admins who can edit the sheet |
| automations | readable sheet (webhook addresses are not in the row, 0056) | editable sheet (+ 0011 rules); every sheet the actions write to editable by the person saving (0052) |
| automation_pauses | the automation is readable | `set_automation_pause` only (0057) |
| automation_runs | readable sheet (runs without a sheet: admins) | service role only |
| items | `readable_sheet_ids()` | definer RPCs only, guarded (7.2) |
| item_links | both items readable and the field not hidden | definer RPCs only, guarded |
| item_updates | item readable | commenters and up, as themselves (`commentable_sheet_ids()`); edit/delete own within 15 min, guarded |
| files | item readable, field not hidden (item files: no field) | `add_file` only (0054), guarded; a restricted field's files need sight of the field |
| file_access_log | item readable | `download_file` only, guarded (read access) |
| protected_values | item readable and (admin or listed) as before | `set_protected_value` only (0051), guarded (edit access); the list is changed by owners and admins only |
| restricted_values, restricted_activity (new) | sheet readable and field visible | definer functions only (no write policies), guarded |
| activity_log | sheet readable (workspace entries: members; folder access entries: admins); entries written before a field was restricted that still hold its value: hidden from people who may not see it | definer functions and audit triggers only |
| notifications | own, and the item readable | `read_at` only; inserts dropped for recipients who cannot read the item (trigger) |
| dashboards | members (config only: the data behind each widget follows the sheet; "No access" when it cannot be read) | editors as before |
| access_grants (new) | the person's own, owners and admins, people with access to the target | access functions only |
| storage.objects (files bucket) | after a logged `download_file` by the same person in the last two minutes, never blocked or erased, archived for admins only (0054); a pending upload: its uploader | uploads to items of sheets the person can edit; a pending upload can be removed by its uploader |

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

## 8. Application security fixes (15 Nov 2026, branch `claude/security-app`)

From the board's application security review (SA-*) and engineering review (E1). The database findings (SA-1, SA-3,
SA-4, SA-5, SA-8, SA-9, SA-12, SA-14) are fixed on `claude/security-db`, which owns every migration.

### 8.1 Redirects after sign-in (SA-2)

Every `next` (the sign-in page, the password and email-link actions, the email-link callback, onboarding and the
two-step page) goes through `safeNext` (`src/lib/safe-next.ts`). It refuses backslashes, control characters (tab, line
feed, carriage return …) and their percent-encoded forms (decoded up to three times), anything not starting with one
`/`, then parses the value with `new URL(next, base)` and keeps it only when the origin is still the base's. The result
is the parsed path, query and hash. Unit tests list the known bypasses (`/\evil.com`, `/\t/evil.com`, `/%5Cevil.com`,
`//evil.com`, `https://evil.com`, `/%09/evil.com` and more); `tests/e2e/password.spec.ts` checks the redirects.

### 8.2 Two-step sign-in (SA-6)

Supabase Auth MFA with an authenticator app (TOTP). The words in the product are "two-step sign-in", never "MFA".

- **Your account** (`/account`, docs/05 §1): set up an app (QR code, the key to type by hand, the first code),
  add a spare, remove one, and recovery guidance. There are no recovery codes (Supabase's are experimental): a spare
  app or the saved key is the way back. Otherwise the person asks their workspace owner, who contacts Compliance OS
  support. Support confirms who they are (from an owner of the same workspace, by a channel other than the account
  itself), then deletes the factor in the Supabase dashboard (Authentication › Users › the user › MFA factors). The
  app does not reset factors, because that would need a fifth service-role place (CLAUDE.md rule 6). Revisit
  Supabase recovery codes once they are stable (decided 15 Nov 2026).
- **At sign-in:** a person with an app who signed in with a password or an email link holds an `aal1` session.
  `getSession()` (`src/server/auth.ts`) treats that session as signed out, so every page, server read and command
  refuses it; pages send it to `/login/two-step`, commands answer "Enter the code from your authenticator app to
  finish signing in." The code raises the session to `aal2`.
- **Workspace setting:** Workspace admin › Security › "Require two-step sign-in for this workspace", stored as
  `orgs.settings.requireTwoStep` (owners change it, admins read it; an owner must use two-step sign-in before turning
  it on). `requireMember` sends a member whose session is not `aal2` to `/account?required=<slug>`, and `withOrg`
  refuses every command of that workspace ("This workspace requires two-step sign-in. Set it up in Your account, then
  try again."). The rules are pure (`src/lib/two-step.ts`) and unit tested, with `withOrg` tests in
  `src/server/commands/context.test.ts` and e2e in `tests/e2e/two-step.spec.ts` (desktop and 390 px, keyboard).
- **Enforced in the database too (0063, §9):** `_aal_ok` inside `is_member`, `has_role` and `_sheet_levels`, so a
  password-only session reads nothing through PostgREST either. The setting changes only through
  `set_require_two_step` (owners, `aal2`, logged), which `setWorkspaceTwoStep` calls.
- Local development: `supabase/config.toml` `[auth.mfa.totp]` enroll and verify on.

Passwords are at least 12 characters (`MIN_PASSWORD`, `src/lib/passwords.ts`, and
`minimum_password_length` in `supabase/config.toml`). On the hosted project, set the same minimum and turn on leaked
password protection (Authentication › Passwords). Who must use two-step sign-in is the workspace switch only for now;
a per-role rule can come later (decided 15 Nov 2026).

### 8.3 Sessions (SA-17)

A session ends 12 hours after sign-in (`timebox`, one working day) or after 2 hours in which its refresh token was not
used (`inactivity_timeout`). An open tab refreshes its 1-hour access token about once an hour, so the inactivity limit
must stay above `jwt_expiry`; it signs out laptops that were shut and tabs that were closed. Values in
`supabase/config.toml` `[auth.sessions]`; the hosted project needs the same (Pro plan). Supabase does not expose when a
session will end (the time box is a project setting, not a claim), so Your account shows "Signed in since …" (the
first sign-in step's time from the token's `amr`) instead of "Signed in until".

### 8.4 Public forms fail closed (SA-10)

The "page served at" stamp and the per-visitor rate-limit key use `FORM_RATE_LIMIT_SALT` only (at least 32
characters, `src/server/form-stamp.ts`). Without it the form page says "This form cannot take answers right now. Try
again later.", every submission is refused, and each refusal logs `FORM_RATE_LIMIT_SALT is missing or shorter than 32
characters: public forms refuse every submission until it is set`. There is no fallback to `CRON_SECRET`.

### 8.5 Smaller fixes

- **Grid copy (SA-11):** copied cells that a spreadsheet would run as a formula get the apostrophe CSV exports use
  (`escapeFormula`, `src/engine/audit/csv.ts`); number columns are copied as they are, and pasting a copied cell back
  drops the apostrophe (`unescapeFormula`).
- **Files (SA-13):** download, preview, edit details and archive check the file's workspace before any RPC that writes
  or logs.
- **File preview (SA-15):** `/[org]/files/[fileId]/preview` answers with `Content-Security-Policy: sandbox;
  default-src 'none'; base-uri 'none'; frame-ancestors 'self'` (set in `next.config.ts`: config headers replace a
  route's own). Chromium's PDF viewer still renders under it (checked in full Chromium by
  `tests/e2e/item-files.spec.ts`). The iframe gets no `sandbox` attribute: Chromium then shows a "blocked" page in
  place of the PDF (tried 15 Nov 2026).
- **Headers (SA-7, in part):** `Permissions-Policy` turns off camera, microphone, geolocation, payment, USB and the
  other features the app does not use; `Strict-Transport-Security: max-age=63072000; includeSubDomains`. HSTS
  `includeSubDomains` applies only to names under the host that sends it (`*.www.klarert.com`), never to the apex
  `klarert.com` (another product) or its other subdomains, so it is safe whatever they serve; `preload` would need
  the apex to send it and is left out. The nonce-based script CSP comes after the demo.

### 8.6 CI (E1)

31 of the last 33 failed runs on `main` stopped at "Generated types are up to date": `src/lib/database.types.ts` had
been edited by hand (`design_health.last_failed_at` made nullable) or not regenerated after a migration. Because that
step came first, the build, the bundle secret check and e2e never ran. Fixed: the file is regenerated, the nullable
read is cast where it is used, and CI is split into jobs so one failure no longer hides the others (`static`: lint,
typecheck, unit tests, migration smoke test; `database`: migrations, pgTAP, types; `e2e`: seed, build, bundle check,
Playwright). When the types differ, the job prints how to fix it and uploads the generated file as an artifact, so a
builder without Docker can download it. See `README.md` › Generated types and Branch protection.

## 9. Database security fixes (15 Nov 2026, branch `claude/security-db`)

The board's database and application reviews (security-db H1–L9, security-app SA-1, SA-3–SA-5, SA-8, SA-9, SA-12,
SA-14, compliance C-01) found rules that lived only in the TypeScript commands, so a signed-in person calling
PostgREST or Storage directly could step round them. Every rule below is now enforced in the database, and each has a
pgTAP file that runs the attack as `authenticated` and shows it refused.

| Finding | Enforced in the database | Migration | pgTAP |
|---|---|---|---|
| H1, SA-14, L8 | `org_id` and parent keys fixed on every workspace table; a row's workspace is its sheet's or item's on insert; `hidden_field_ids()` / `field_visible()` judge by the sheet's workspace; `next_seq` only through item creation | 0050 | 0041 |
| H2 | a protected field's list only by owners and admins; `protected_values` only through `set_protected_value` (logged) | 0051 | 0042 |
| SA-1, M1 | automation action targets editable by the person saving (insert and every change but switching off); `acts_as`; the runner asks `automation_authority` before every run and records `stopped` with the reason when the person left, lost the editor role or can no longer edit a target | 0052 | 0043, runner unit test |
| SA-3 | `api_request_guard` (PostgREST pre-request): mutating requests from people need the server's HMAC proof (Vault secret `klarert_command_secret`, `SUPABASE_COMMAND_SECRET`), bound to the user and five minutes; reads and the service role pass | 0053 | 0044, `command-proof.test.ts` |
| SA-4, M3, SA-9, M2, M4 | Storage reads only after a logged download (blocked, erased, archived-for-admins rules as `download_file`); refused uploads removed by their uploader; bucket MIME allow-list; restricted fields' files guarded; no direct `files` inserts | 0054 | 0045, `confirm-upload.test.ts` |
| M2 | `set_item_links` checks sight of the field and edit access first and returns only readable targets; `set_protected_value` needs sight of the field | 0055 | 0046 |
| SA-5, SA-12 | webhook addresses in `automation_secrets` (service role only), actions keep `urlRef` / `urlHost`; the log shows hosts; earlier entries with an address for admins only; data migration; per-automation `signing_key` and `X-Klarert-Signature` | 0056 | 0047, worker and engine unit tests |
| M4, SA-8 | every membership insert logged with how; joins only by invite or workspace creation; `automation_pauses` only through the function; invite links 14 days; a confirmed email to accept | 0057 | 0048 |
| M5, L5 | `chain_seq` assigned under the chain's lock; verification by `chain_seq` (earlier entries by id); v2 hash covers org, sheet, item, chain and place; no TRUNCATE | 0058 | 0049 |
| M6 | comment bodies and sub-item names masked in the log; `restricted_activity` erasable by retention; tombstone counts every copy in clear | 0059 | 0050 |
| M7 | `settings.retention` only by owners and admins; `personalData` turned off only by them (editors may turn it on, 0064) | 0060, 0064 | 0051 |
| C-01 | ack entries only the person's own, time set by the database; signatures only as oneself, time and hash set by the database; automations never acknowledge or sign | 0061 | 0052 |
| Two-step sign-in (app SA-6, enforced in the database) | `_aal_ok` in `is_member`, `has_role` and `_sheet_levels`: a person with a verified factor needs an `aal2` session, and a workspace with `requireTwoStep` needs one from everyone; workspaces and one's own memberships stay readable; `set_require_two_step` (owners, `aal2`, logged) is the only way to change the setting; `orgs` changes logged; `member_two_step` for the Members list | 0063 | 0054 |
| L1, L2, L3, L4, L7, L9 | definer helpers scoped to the caller's workspaces; form tokens for admins, public form configs without internal ids; restricted folders' log entries; ended auditors list no profiles; approvers never from restricted fields; retention and schedule claims need read access | 0062 | 0053 |

### 9.1 Open (for the owner)

1. **Command gate secret** (0053): set it in Vault and Vercel before applying 0053 (scripts/hosted/README.md); without
   it every write by a person is refused.
2. ~~**Pending uploads never confirmed**~~: removed by the scheduler every hour once an hour old (0067, §10).
3. ~~**Personal data still in clear in the log**~~: notes of value changes and approval comments are masked like
   comment bodies (0065, §10). Display names in `member.*` notes stay in clear as access-provisioning evidence (owner
   decision 15 Nov 2026, docs/02 §18).
4. **Restricted `ack` / `signature` fields — accepted (owner decision 15 Nov 2026):** clearing such a value goes to
   `restricted_values` by delete, which the attestation guard does not see (clearing a signature is allowed anyway;
   clearing others' acknowledgements of a restricted ack field is not stopped). Accepted for now; no change.
5. ~~**Public form configs** filtered by a deny-list~~: an allow-list per field type from the field registry (0066,
   §10).
6. ~~Two-step setting from the app~~: `setWorkspaceTwoStep` calls `set_require_two_step` (done when the branches
   merged).

## 10. Security follow-ups (15 Nov 2026, branch `claude/security-followups`)

The open items of §9.1 the owner decided on 15 Nov 2026, and two reads that stopped at the API's 1 000-row cap.

| Item | Now | Migration | Tests |
|---|---|---|---|
| §9.1.3 Free text in the log | A person's note on a value change and every approval comment become a personal-data marker; the note and its salt live in `personal_activity` (slot `note`, under the entry's field). Retention erasure with `comments` (and anonymise) erases them; the tombstone counts them in `log_values_erased` and the notes still in clear in `earlier_entries_in_clear`; `verify_activity_chain` checks each against its marker. Entries written before 0065 cannot change (append-only): their notes stay in clear and are counted. System notes (automations, pack operations, the framework edition move) and member names in `member.*` notes stay in clear (docs/02 §18) | 0065 | pgTAP `0058_note_masking.sql`; engine `activity.test.ts`, `audit.test.ts`; e2e first-sheet, approvals |
| §9.1.2 Abandoned uploads | The scheduler (service role, the existing 15-minute cron route, first tick of each hour) lists objects no `files` row holds that are over an hour old (`stale_pending_uploads`, service role only, never younger than an hour) and removes them through the Storage API; a log line per workspace. There is no pending row to remove: `files` is written only on confirmation | 0067 | pgTAP `0057_pending_upload_cleanup.sql`; `files.test.ts`, `pending-uploads.test.ts` |
| Audit pack hash columns | `activity/log.csv` carries every hashed input as hashed (`org_id`, `chain_seq`, `hash_v`, `at_utc`, the jsonb text of the values, the note as JSON …) and `activity/method.txt` the v1 and v2 recipe, so an auditor recomputes each hash without the database (docs/02 §6) | — | `hash-recipe.test.ts` (fixture made by the database's own functions), pgTAP `0056_audit_hash_recipe.sql`, e2e audit-outputs recomputes every row of a real pack |
| Paging past 1 000 rows | Pack planning (install: the workspace snapshot, the required packs' sheets, fields, groups, views and items, the library items; upgrade: what the install made, the items it created, the catalogue) and the CSV importer's member list read every page (`fetchAllPages`, `every` in `src/server/packs/install.ts`, `fetchPeople`). Before, a register over 1 000 items could get a new item at a position already taken, or an upgrade miss rows it made | — | `src/server/packs/paging.test.ts`, `src/lib/sheet-query.test.ts` (the capped fake client) |
| §10.1.1 Approval comments outside the log (owner decision 15 Nov 2026: erase them with comments) | `retention_execute` with `comments` (and anonymise) sets `workflow_decisions.comment` and `workflow_instances.submit_comment` to null for the item; the tombstone counts them (`approval_comments_erased`). `workflow_decisions_append_only` allows that and nothing else: inside erasure only (`app.retention_op`, transaction-local, set by `retention_execute`), comment to null only, every other column unchanged; `workflow_instances_comment_guard` the same for the submit comment. The decision itself stays | 0068 | pgTAP `0059_approval_comment_erasure.sql` |
| §10.1.2 Field type conversion notes (owner decision 15 Nov 2026: log them as the system's) | `changeFieldType` writes converted values through `convert_item_value` (SECURITY INVOKER: `set_item_values` with the caller's rights and every check, `app.system_note` on for that call); the note "Field type changed to <type>" is built in the database from a type's name (pattern checked, never free text) and stays in clear | 0069 | pgTAP `0060_field_conversion_note.sql`; `type-label.test.ts` (every type label passes the pattern) |
| §9.1.5 Public form configs | `_public_field_config(type, config)` keeps only the keys the type lists in `publicConfigKeys` (field registry); unknown types and keys show nothing. `public-config.test.ts` fails when the SQL list and the registry differ, when a public type has no list, or when a list names an internal key | 0066 | pgTAP `0055_public_config_allow_list.sql`, `0053_low_findings.sql`; `public-config.test.ts` |

### 10.1 Decided (owner, 15 Nov 2026)

1. ~~**Approval comments outside the log**~~: erased with comments (0068, above).
2. ~~**Field type conversion notes**~~: logged as the system's, in clear (0069, above).
3. **Other notes stay in clear:** archive notes, retention reasons (postpone, legal hold), the notes on retention
   tombstones and file archive notes are kept in clear in the log. Only value-change comments and approval comments
   are masked (0065).

## 11. Email (15 Nov 2026, branch `claude/email-invites`)

Invites are sent by email (board review A4). The module is `src/server/email/`, server-only, and is the one way the
app sends mail; reminders, read-and-accept requests and notifications will add a template and a tag to it.

- **Shape.** `templates.ts` is pure: data in, `{ subject, text, html }` out. Plain and accessible: one column, real
  text, `lang="en"`, the link both linked and written out, no images, no remote resources, no tracking pixels or
  click tracking. Names from people are escaped in the HTML and kept to one line in the subject. Dates read
  `29 Nov 2026` in the workspace's time zone. `transport.ts` holds the interface
  `send({ to, subject, text, html, tag, idempotencyKey })`, the transports and the choice; `index.ts` wires it to
  `process.env`, `fetch` and the log (`sendEmail(message)`, `canSendEmail()`). It never throws: the result is
  `{ sent: true, id }` or `{ sent: false, reason: 'not_configured' | 'rejected' | 'unavailable' }`.
- **Transports.** *Brevo* (owner decision 15 Nov 2026: the owner's existing account; Brevo keeps data in the EU,
  France and Germany): `POST https://api.brevo.com/v3/smtp/email` with the headers `api-key: $BREVO_API_KEY`,
  `content-type` and `accept: application/json`; body `sender` (from `EMAIL_FROM`, its name when one is given), `to`,
  `subject`, `htmlContent`, `textContent`, `tags: [tag]` and `headers: { "X-Mailin-custom": <key> }`. Success is 201
  with a `messageId`; 400 (bad request) and 401 (bad key) are refusals, 429 and 5xx "try later"; each is logged with
  the tag and the status code only. **Brevo has no idempotency key** (its API reference, checked 15 Nov 2026,
  documents none), so the key travels as `X-Mailin-custom` (to find the message in Brevo's logs) and duplicates are
  prevented on our side: the app never retries a send; an invite is emailed once when it is created, and an address
  has at most one open invite per workspace (`invites_open_email_idx`), so a double click fails before a second send;
  resends are counted and rate-limited in the database (below). **Tracking:** each recipient is sent with
  `contactPixelTrackingConsent: false` (opens and clicks anonymised) and `removeTrackingPixel: true` (no open pixel,
  honoured on Brevo Enterprise plans only). Brevo has no per-message switch for click tracking; the owner turns open
  and click tracking off for transactional email in the Brevo account (scripts/hosted/README.md › Email), otherwise
  Brevo adds a pixel and rewrites the accept link through its tracking domain. *Local*: Mailpit, the Supabase local stack's mail
  catcher, through its HTTP send API (`$MAILPIT_URL/api/v1/send`, default `http://127.0.0.1:54324`, the
  `[local_smtp]` port in `supabase/config.toml`; the SMTP port is not published to the host). The e2e tests read the
  mail back from Mailpit (`appMail` in `tests/e2e/helpers.ts`; app mail is tagged, sign-in links from Supabase Auth
  are not).
- **Choice, failing closed.** Brevo when `BREVO_API_KEY` is set and `EMAIL_FROM` is an address. Otherwise Mailpit,
  only when `NEXT_PUBLIC_SUPABASE_URL` is on this machine (the same test as the command gate's local secret,
  `isLocalUrl` in `src/lib/supabase/command-proof.ts`). Otherwise nothing is sent and every attempt logs one error
  that says what to set (`BREVO_API_KEY is not set: no email is sent until BREVO_API_KEY and EMAIL_FROM are set`,
  or that `EMAIL_FROM` is missing), as public forms do without `FORM_RATE_LIMIT_SALT` (§8.4). **No real mail from
  CI:** when `CI` is set and `VERCEL` is not (a CI runner, not a Vercel build), the key is ignored, so CI uses Mailpit
  or sends nothing.
- **What is logged.** One JSON line per attempt, `source: "email"`: the tag (`invite`, `invite_resend`), the transport
  and the outcome (`sent`, `rejected`, `unavailable`, `not_configured`), with the provider's status code or the error
  name on failure. Never the address, the subject or the body: they are personal data. Provider error messages are
  not logged either (they can echo the address).
- **No service role, no database.** Sending needs no database privilege. The invite commands authorise the admin
  (`withOrg`) and write through the person's own client; then the server sends. Rule 6's list is unchanged.
- **Invites** (`src/server/commands/members.ts`). `createInvite` writes the invite, then emails the workspace name,
  the inviter's display name, the role with one sentence on what it can do (`ROLE_SUMMARIES`), the accept link, the
  day the link ends (14 days, 0057) and, for an auditor, the day their access ends. The result says whether the
  email went (`emailSent`); when it did not, the invite stays and the admin reads "The email could not be sent. Copy
  the link instead." Copy link stays as the secondary action. Trace key `invite/<id>`.
- **Sending again, rate-limited** (`resendInvite`, `resend_invite`, migration 0070). Owners and admins send an open invite
  again: **at most once every 10 minutes and 5 times per invite**, and only while its link works (an ended link is
  revoked and invited again). The limit is counted in the database (`invites.resend_count`, `resent_at`) under the
  invite's row lock. Without a transport nothing is counted. Trace key `invite/<id>/resend/<n>`.
- **Logged on the workspace chain** (0070, `sheet:<org_id>`): `invite.created` (invite id, role, auditor end date,
  link end date), `invite.resent` (invite id, role, which resend) and `invite.revoked` (an open invite deleted; who
  and the role). Never the address: the log is append-only, and the invite id links these entries to the
  `member.added` entry written when the person joins (0057). pgTAP `0070_invite_email.sql`.

Environment variables (server only, Vercel **Production only**, so previews never email real people and fall back to
copy-link; see `scripts/hosted/README.md` › Email):

| Variable | Value |
|---|---|
| `BREVO_API_KEY` | A Brevo API key (SMTP & API › API keys), used only by the server |
| `EMAIL_FROM` | The sender, e.g. `Compliance OS <no-reply@mail.klarert.com>` |
| `MAILPIT_URL` | Local only, optional: Mailpit's web address if not `http://127.0.0.1:54324` |

### 11.1 Open (for the owner)

1. **Creating invites is not rate-limited.** An admin can create (and revoke and create again) any number of invites,
   each one an email. Brevo's own sending limits apply. A per-workspace daily limit can be added if abuse appears.
2. **Bounces and complaints** are not read back. A Brevo webhook could mark an invite "not delivered"; it would need
   a public route and its own secret.
3. **Brevo API keys are not scoped.** A Brevo key can use the whole API of the account (contacts, campaigns), not only
   sending. Keep it in Vercel only, and consider an IP allow-list in Brevo if the plan offers one (Vercel's egress IPs
   change unless a static IP add-on is used).

## 12. Account essentials (15 Nov 2026, branch `claude/auth-essentials`)

Forgot password, Your account › Email address, Password and Delete my account, the auth emails and the security
alerts. Everything runs on the person's own session through Supabase Auth or our own RPC; no new service-role place
(CLAUDE.md rule 6). Two migrations: 0071 (Delete my account) and 0072 (a user deleted in the Supabase dashboard).
Screens in docs/05 §1.1.

- **Forgot password** (`requestPasswordReset`, `src/app/(auth)/login/actions.ts`): `resetPasswordForEmail` with
  `redirectTo` = `/auth/callback?next=/login/new-password` (plus the page's own `next`, through `safeNext`). The
  answer is always "If an account uses that address, we have sent a link to reset your password.", also when Supabase
  Auth refuses: it refuses a second request within `max_frequency` for existing addresses only, so passing that on
  would tell which addresses have accounts. Refusals are logged with code and status, never the address.
- **The callback** (`/auth/callback`, `afterEmailLink` in `src/lib/auth-links.ts`, unit tested): a code opens the
  session and goes to `next`; a failed reset link goes back to Forgot password (`?error=link`); for Your account, the
  first of two email change links (only a `message`, no code) gives `?email=confirm-other` and a failed one
  `?email=link-failed`; every other failure `/login?error=link`. The links use PKCE, so they work in the browser where
  they were asked for.
- **Set a new password** (`setNewPassword`, `src/server/commands/account.ts`): only a session that a reset link
  opened may set a password without the current one. Supabase Auth records that in the token's `amr` as `recovery`
  (PKCE; checked 15 Nov 2026 on GoTrue 2.197), read by `openedByResetLink` (`src/lib/passwords.ts`) into
  `getSignIn().resetLink`. Supabase Auth refuses a password or email change from an `aal1` session when the person
  has a verified factor ("AAL2 session is required to update email or password when MFA is enabled",
  `insufficient_aal`, checked), so a person with an authenticator app is sent to
  `/login/two-step?next=/login/new-password` first. New passwords: `MIN_PASSWORD` (12) to 200 characters, typed twice
  (`newPasswordTwice`). Afterwards `signOut({ scope: 'others' })` ends every other session; the page says whether that
  worked.
- **Change password** (`changePassword`): the current password is checked by `signInWithPassword` on a client that
  keeps no session and no cookies (`createPasswordCheckClient`, anon key); the session it opens is signed out at once.
  `secure_password_change` (Supabase's emailed reauthentication code) stays off: asking for the current password is
  the check. Then `updateUser({ password })` on the person's session and `signOut({ scope: 'others' })`. Supabase's
  refusals in words: same password, too short, and on the hosted project leaked passwords (`passwordRefusal`).
- **Change email** (`changeEmail`): `updateUser({ email }, { emailRedirectTo: /auth/callback?next=/account })` with
  `double_confirm_changes` (secure email change): Supabase emails a link to the current and to the new address. The
  page shows the pending address from the user's `new_email`. Supabase asks for **both** links only while email
  confirmation is on (`enable_confirmations`, hosted "Confirm email"); with it off, as on the local stack, one link
  completes the change (checked 15 Nov 2026 on GoTrue 2.197). An address another account uses is refused with "That
  address cannot be used. Choose another."
- **Auth emails** (`supabase/templates/*.html`, subjects in `supabase/config.toml` `[auth.email.template.*]`):
  confirm sign-up, sign-in link, reset password and change of email. One column, real text, `lang="en"`, the link
  linked and written out, what it does, that it works once for 1 hour (`otp_expiry`, `EMAIL_LINK_EXPIRY`), and "If you
  did not ask for this, you can ignore this email." No images, no remote resources, no tracking. Supabase Auth makes
  the plain-text part from the HTML. Invites are our own email (§11); reauthentication is not used. The hosted project
  gets the same through `scripts/hosted/auth-config.py` (`--dry-run` prints the keys that differ) and sends through
  Brevo SMTP, which the owner sets up (`scripts/hosted/README.md` › Auth emails), sender "Compliance OS".
- **Security alerts** (owner decision 16 Nov 2026): Supabase Auth's notification emails for a changed password and a
  changed email address are on (`[auth.email.notification.password_changed]` and `.email_changed]` in
  `supabase/config.toml`; hosted `mailer_notifications_*_enabled`, set by `auth-config.py`). Templates
  `supabase/templates/password_changed_notification.html` and `email_changed_notification.html`, in the plain style of
  the others: what changed, for which address (the email alert goes to the old address and names both), that it was
  sent at the moment of the change (Supabase passes no time to the template; the email's own date is the time),
  "If this was not you, reset your password now" with the Forgot password link (`{{ .SiteURL }}/login/forgot-password`),
  "If this was not you, contact support@klarert.com straight away." (owner decision 16 Nov 2026, the address as plain
  text) and to tell the owner of their workspace. `auth-config.py` refuses a notification template without the Forgot
  password link or the support address. Supabase Auth sends them after a change through Your account and after Set
  a new password.
- **Delete my account** (owner decision 16 Nov 2026: option a, a nameless profile as tombstone; migration 0071,
  `deleteMyAccount` in `src/server/commands/account.ts`, the card in `src/components/account/delete-account.tsx`).
  `profiles_id_fkey` is dropped, so a profile outlives its auth user, and `profiles.deleted_at` marks it.
  `delete_my_account()` (SECURITY DEFINER, `search_path` set, granted to `authenticated` only) acts on `auth.uid()`
  alone, in one transaction under a per-person advisory lock:
  1. refuses the only owner of any workspace: `account: You are the only owner of A, B. …`, with the names as a JSON
     array in the error's detail; the app says "Make someone else owner of A or delete it first.";
  2. refuses a session that is not `aal2` when the person has a verified factor (as `_aal_ok`, 0063); the app sends
     them to the two-step page and back to the open dialog;
  3. removes every membership (the clean-up is `_account_close`, shared with the dashboard path below; internal, not
     executable by any API role); `memberships_audit` logs each as `member.removed` on the workspace chain with
     `new_value = {"how": "account deleted"}` (the log reads "A member deleted their account"). The note keeps their
     name as every `member.*` note does (owner decision 15 Nov 2026, docs/02 §18). `memberships_guard` lets the
     person remove their own owner membership in this one operation (`app.member_op = 'account_deleted'`), still
     keeping at least one owner, so a workspace that requires two-step sign-in does not block a co-owner without an
     app;
  4. anonymises the profile as the app shows a person who left: `display_name` "Former member" and `initials` "?"
     (the people cells' fallback); there is no avatar column; `color` stays;
  5. deletes the `auth.users` row; identities, sessions, refresh tokens, factors and one-time tokens go by Supabase
     Auth's own cascades.
  It is idempotent: a retry (an access token lives up to an hour after its user is gone) finds nothing to do and
  succeeds. Such a token cannot bring the profile back: `memberships_join_guard` refuses a deleted profile and the
  `profiles_self` policy no longer matches it. `automations.acts_as` now references `profiles(id)` (it was
  `auth.users(id) on delete set null`, whose update would have run `automations_targets_guard` as the leaving person);
  the runner already stops an automation whose person is no longer a member (0052), naming them "Former member".
  Every "created by", "author" and "uploaded by" still resolves to the profile; the activity log is not touched (no
  foreign key on `actor_id`). Nothing joins `auth.users` except `member_emails` (members only, so the person is no
  longer listed) and `accept_invite` (the caller's own row). The command checks that the typed address is the
  account's, calls the RPC on the person's own session and signs out (`scope: 'local'`; Supabase Auth answers "user
  not found" and the client still clears the cookies), then redirects to `/account-deleted`. Meta "Created by" /
  "Updated by" cells now use the people cell, so they read "Former member" like people fields.
- **A user deleted in the Supabase dashboard** (owner decision 16 Nov 2026, migration 0072). Authentication › Users ›
  Delete user (or the Admin API's `DELETE /admin/users/{id}`) deletes the `auth.users` row as Supabase Auth's own
  database role. A BEFORE DELETE trigger on `auth.users` (`auth_users_account_closed`, function
  `auth_users_close_account()` in `public`, SECURITY DEFINER, `search_path` set, not executable by any API role) runs
  the same clean-up as Delete my account, `_account_close(user, by_support => true)`, under the same per-person
  advisory lock: every membership goes, each logged `member.removed` with `new_value = {"how": "account deleted by
  support"}` (actor `system`; the log reads "Support deleted a member's account"), the profile becomes "Former member"
  / "?" and `deleted_at` is set. It does nothing when the profile is already marked deleted, which is how Delete my
  account's own deletion of the auth user passes through it, or when the user has no profile.
  **The only owner is not refused on this path:** support cannot be asked to pick a new owner first, so the workspace
  is left without an owner. Its `member.removed` entry carries `"ownerless": true` (the log reads "… The workspace now
  has no owner"). `memberships_guard` lets this one operation through without the owner check and the
  at-least-one-owner check: only while `app.member_op = 'account_deleted_by_support'` and `app.member_op_user` names
  the membership's person, both transaction-local and set only by `_account_close`. A workspace without an owner keeps
  working for its admins, editors and viewers; what only an owner may do (make someone owner, invite an owner,
  restrict a sheet, folder or field, require two-step sign-in) waits until support makes a member owner again as the
  service role (`scripts/hosted/README.md` › Deleting a user). Delete my account still refuses the only owner.
- **Risk:** deleting a user in the Supabase dashboard is now safe (as above), but still prefer Delete my account: it
  asks the only owner to hand over first, asks for a two-step session when the person has an authenticator app, and
  logs the person as the actor. Support deletes in the dashboard only when the person cannot (lost access, a request
  by email), and then makes sure every workspace they owned alone gets a new owner. "Soft delete" in the Admin API
  only marks the auth user and does not run the trigger; use a hard delete.
- Tests: `src/lib/passwords.test.ts`, `src/lib/auth-links.test.ts`, `src/lib/delete-account.test.ts`; pgTAP
  `supabase/tests/0071_delete_account.sql` and `0072_account_deleted_by_support.sql` (a dashboard deletion as
  `postgres`: memberships gone and logged, profile anonymised, created by still resolves, the log unchanged, the only
  owner's deletion logged as ownerless, the guard flag covers only the person it names, Delete my account still works
  and the trigger then adds nothing, the functions not executable by `anon`, `authenticated` or `service_role`); e2e `tests/e2e/delete-account.spec.ts` (desktop and 390 px: the only owner
  refused with the workspace named; a member deletes their account, cannot sign in with the password again, and their
  item's "Created by" reads "Former member") and `tests/e2e/account-auth.spec.ts` (desktop and
  390 px) through Mailpit: a reset for a known and an unknown address (the same answer), the link, the rules, the new
  password signs in and the old one does not, another browser signed out; the same with two-step sign-in (code
  first); Your account changes the password (a wrong current one refused) and the email address (both addresses
  emailed).

### 12.1 Decided (owner)

1. ~~**Delete my account is not built**~~: built as option (a), a nameless profile as tombstone (0071, above).
2. **A session opened by a reset link — accepted (owner decision 16 Nov 2026):** it may set a password without the
   current one for as long as it lasts (12 hours at most, §8.3), also after the first change. No change.
3. ~~**Supabase's "password changed" and "email changed" notices are off**~~: on, with our templates (above).
4. **A user deleted in the Supabase dashboard (owner decision 16 Nov 2026):** handled as Delete my account, by a
   trigger (0072, above). The only owner is not refused there: the workspace is left without an owner and the removal
   is logged with `ownerless`. Delete my account keeps refusing the only owner.
5. **What else a deleted person leaves behind (owner decision 16 Nov 2026): left as it is.** Delete my account (and a
   dashboard deletion) removes memberships only, as removing a member does. Rows keyed to the person stay under the
   tombstone profile: team memberships, sheet and folder access grants, their private saved views, their
   notifications, edit holds and open invites they sent (the invite page then reads "Former member invited you").
   None is reachable by anyone without a membership.

### 12.2 Open (for the owner)

1. ~~**What else a deleted person leaves behind**~~: decided, left as it is (§12.1 item 5).
2. **The name in `member.*` notes** stays in clear in the append-only log (decided 15 Nov 2026 for access evidence);
   a person who deletes their account may expect it gone. Erasing it would need a personal-data slot for member notes
   (as 0065 did for value notes) from now on; entries already written cannot change.
3. **The email change alert** links to Forgot password, whose link goes to the new address, which the person may no
   longer control. Supabase offers no way to undo an email change from the old address; the alert now names
   support@klarert.com (and still the workspace owner) as the way back.

## 13. Your own frameworks (16 Nov 2026, branch `claude/p8-own-frameworks`)

A workspace's own frameworks, its mappings to the catalogue and its drafts (docs/12 Your own frameworks, docs/02 §17,
migration 0074). The catalogue tables were global and readable by everyone; they now hold one workspace's rows too.
What keeps them inside the workspace:

- **RLS.** `frameworks`, `requirements` and `crosswalks`: `org_id is null or is_member(org_id)`; `packs`:
  `owner_org_id is null or is_member(owner_org_id)`; `framework_drafts`: owners and admins (`is_admin`). No write
  grants on any of them. pgTAP 0074 reads each table as an admin of another workspace and gets nothing; the e2e spec
  does the same through the API as a person outside the workspace.
- **Definer functions read past RLS, so each checks visibility itself** (board risk 2): `adopt_framework` refuses a
  framework of another workspace, `install_pack` a pack of another workspace, `upgrade_pack` (now a wrapper of
  `_upgrade_pack_rows`, also behind `apply_pack_upgrade`) a version of another workspace, and `move_framework_edition`
  reads only frameworks of the catalogue or its own workspace and only live cross-walks of either. All four are
  tested with a forged install and forged library sheets in pgTAP 0074. The messages say "not found", never whose.
- **Writes only through the RPCs.** `publish_framework`, `set_crosswalk`, `retire_crosswalk`, `save_framework_draft`,
  `delete_framework_draft`: owners and admins of the workspace named in the call, the key's prefix tied to that
  workspace's id; `own_framework_guard` refuses an own row written any other way (also by the service role). Granted
  to `authenticated` only; `_own_key_prefix` and `_upgrade_pack_rows` to nobody. No new service-role place.
- **What the server sends is checked again.** The server builds the framework and its library pack with the engine,
  but `publish_framework` checks the licence note and publisher against the workspace's own name, the limits, refs,
  parents and depth, and that the pack is only this framework's library sheet (no automations, dashboards, requires,
  extends or apps), so a crafted call cannot install anything else through the pack path.
- **Licensing.** Customer text only in own rows (`requirements.text` and `titles = 'customer'` refused on catalogue
  rows); publishing records `rights_confirmed` and the source line in `framework.published`.
- **Audit.** `framework.published` (revision, hash), `crosswalk.added`, `crosswalk.retired`, `framework.draft_saved`
  and `framework.draft_deleted` on the workspace chain; cross-walks are retired, never changed or deleted.
- **The 8 hex digits** of the key prefix are not a secret and not unique: two workspaces may share them (about one in
  four billion per pair). A key taken by another workspace is refused at publish ("the key is not this workspace's")
  and rows of another workspace are never readable or writable whatever their key.

Commands (`pnpm security:commands`):

| Command | File | Zod schema | Role check | Also |
|---|---|---|---|---|
| `ownFrameworkEditor` | `own-frameworks.ts` | `ownFrameworkEditorInput` | admin |  |
| `createOwnFramework` | `own-frameworks.ts` | `createOwnFrameworkInput` | admin |  |
| `saveOwnFrameworkDraft` | `own-frameworks.ts` | `saveOwnDraftInput` | admin |  |
| `deleteOwnFrameworkDraft` | `own-frameworks.ts` | `deleteOwnDraftInput` | admin |  |
| `publishOwnFramework` | `own-frameworks.ts` | `publishOwnFrameworkInput` | admin |  |
| `ownMappingOptions` | `own-frameworks.ts` | `ownMappingOptionsInput` | admin |  |
| `mapOwnRequirement` | `own-frameworks.ts` | `mapOwnRequirementInput` | admin |  |
| `retireOwnMapping` | `own-frameworks.ts` | `retireOwnMappingInput` | admin |  |

### 13.1 Open (for the owner)

- A workspace's own framework and its library pack stay readable by every member, as the catalogue is. A restricted
  library sheet stays restricted (docs/02 §16); the requirement rows themselves are not.
- Hosted rollout of 0074: see the P8 report (locks while the constraints are added, the renamed `upgrade_pack`).
