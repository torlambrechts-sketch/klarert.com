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
| `createAutomation` | `automations.ts` | `createAutomationInput` | editor |  |
| `updateAutomation` | `automations.ts` | `updateAutomationInput` | editor | admin-only branch, locks |
| `toggleAutomation` | `automations.ts` | `toggleAutomationInput` | editor | admin-only branch, locks |
| `duplicateAutomation` | `automations.ts` | `automationRefInput` | editor |  |
| `deleteAutomation` | `automations.ts` | `automationRefInput` | editor | admin-only branch, locks |
| `setAutomationPause` | `automations.ts` | `pauseAutomationInput` | editor |  |
| `addField` | `fields.ts` | `addFieldInput` | editor |  |
| `updateField` | `fields.ts` | `updateFieldInput` | editor | admin-only branch, locks |
| `addFieldOption` | `fields.ts` | `addFieldOptionInput` | editor | locks |
| `moveField` | `fields.ts` | `moveFieldInput` | editor | admin-only branch, locks |
| `duplicateField` | `fields.ts` | `fieldRefInput` | editor |  |
| `deleteField` | `fields.ts` | `fieldRefInput` | editor | locks |
| `restoreField` | `fields.ts` | `fieldRefInput` | editor |  |
| `listDeletedFields` | `fields.ts` | `deletedFieldsInput` | member |  |
| `changeFieldType` | `fields.ts` | `changeTypeInput` | editor | admin-only branch, locks |
| `prepareUpload` | `files.ts` | `prepareUploadInput` | editor |  |
| `confirmUpload` | `files.ts` | `confirmUploadInput` | editor |  |
| `downloadFile` | `files.ts` | `downloadFileInput` | member |  |
| `createFolder` | `folders.ts` | `folderInput` | editor |  |
| `renameFolder` | `folders.ts` | `renameFolderInput` | editor |  |
| `deleteFolder` | `folders.ts` | `folderRef` | editor |  |
| `submitPublicForm` | `forms.ts` | `publicSubmitInput` | public (token) |  |
| `createGroup` | `groups.ts` | `createGroupInput` | editor |  |
| `updateGroup` | `groups.ts` | `updateGroupInput` | editor |  |
| `moveGroup` | `groups.ts` | `moveGroupInput` | editor |  |
| `deleteGroup` | `groups.ts` | `deleteGroupInput` | editor |  |
| `createItem` | `items.ts` | `createItemInput` | editor | locks |
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
| `verifyActivity` | `panel.ts` | `verifyActivityInput` | member |  |
| `searchItems` | `panel.ts` | `searchItemsInput` | member |  |
| `runDateChecksNow` | `scheduler.ts` | `input` | admin |  |
| `search` | `search.ts` | `input` | member |  |
| `createSheet` | `sheets.ts` | `createSheetInput` | editor |  |
| `importCsv` | `sheets.ts` | `importCsvInput` | editor |  |
| `copySheet` | `sheets.ts` | `copySheetInput` | editor | locks, own rows |
| `updateSheet` | `sheets.ts` | `updateSheetInput` | editor |  |
| `archiveSheet` | `sheets.ts` | `archiveSheetInput` | editor |  |
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
| `postUpdate` | `updates.ts` | `postUpdateInput` | editor | own rows |
| `editUpdate` | `updates.ts` | `editUpdateInput` | editor |  |
| `deleteUpdate` | `updates.ts` | `deleteUpdateInput` | editor |  |
| `createView` | `views.ts` | `createViewInput` | member | own rows |
| `updateView` | `views.ts` | `updateViewInput` | member | own rows |
| `duplicateView` | `views.ts` | `duplicateViewInput` | member | own rows |
| `deleteView` | `views.ts` | `deleteViewInput` | member | own rows |
| `setDefaultView` | `views.ts` | `setDefaultViewInput` | editor | own rows |
| `filterItemIds` | `views.ts` | `filterItemsInput` | member |  |
| `createFormLink` | `views.ts` | `formLinkInput` | editor | own rows |
| `disableFormLink` | `views.ts` | `disableFormLinkInput` | editor |  |

72 commands, 72 with a Zod schema parsed first, 72 with a role check. Helpers in the same folder that are not commands
(`withOrg`, `createInverseField`, `detachInverse`, `confirmWith`, `loadPublicForm`) are called only by commands.

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
