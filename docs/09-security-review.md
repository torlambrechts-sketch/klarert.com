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
2. **Pending uploads never confirmed** (closed tab during upload) stay in the bucket, readable only by their
   uploader. A daily cleanup by the scheduler (service role) would remove those older than an hour.
3. **Personal data still in clear in the log:** display names in `member.*` notes (access-provisioning evidence),
   free-text notes on value changes and approval comments. They need an owner decision on what counts as personal.
4. **Restricted `ack` / `signature` fields:** clearing such a value goes to `restricted_values` by delete, which the
   attestation guard does not see (clearing a signature is allowed anyway; clearing others' acknowledgements of a
   restricted ack field is not stopped).
5. **Public form configs** are filtered by a deny-list of internal keys (`_public_field_config`); a new field type
   with an internal id in its config must add its key there.
6. ~~Two-step setting from the app~~: `setWorkspaceTwoStep` calls `set_require_two_step` (done when the branches
   merged).


## 11. Account essentials (15 Nov 2026, branch `claude/auth-essentials`)

Forgot password, Your account › Email address and Password, and the auth emails. Everything runs on the person's own
session through Supabase Auth; no table of ours changes, no migration, and no new service-role place (CLAUDE.md
rule 6). Screens in docs/05 §1.1.

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
  the plain-text part from the HTML. Invites are our own email (§10); reauthentication is not used. The hosted project
  gets the same through `scripts/hosted/auth-config.py` (`--dry-run` prints the keys that differ) and sends through
  Brevo SMTP, which the owner sets up (`scripts/hosted/README.md` › Auth emails), sender "Compliance OS".
- Tests: `src/lib/passwords.test.ts`, `src/lib/auth-links.test.ts`; e2e `tests/e2e/account-auth.spec.ts` (desktop and
  390 px) through Mailpit: a reset for a known and an unknown address (the same answer), the link, the rules, the new
  password signs in and the old one does not, another browser signed out; the same with two-step sign-in (code
  first); Your account changes the password (a wrong current one refused) and the email address (both addresses
  emailed).

### 11.1 Open (for the owner)

1. **Delete my account is not built.** `profiles.id` references `auth.users(id) on delete cascade`, and about twenty
   columns reference `profiles(id)` without a delete rule (`items.created_by`, `item_updates.author_id`,
   `files.uploaded_by`, `file_access_log.user_id` …). Deleting the auth user would either fail for anyone who ever
   created something, or delete the profile instead of anonymising it. The activity log itself is not affected (no
   foreign key on `actor_id`). The data model needs a decision first.
2. **A session opened by a reset link** may set a password without the current one for as long as it lasts (12 hours
   at most, §8.3), also after the first change.
3. **Supabase's "password changed" and "email changed" notices** (`[auth.email.notification.*]`) are off.
