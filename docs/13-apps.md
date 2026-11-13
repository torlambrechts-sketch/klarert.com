# 13 · Apps

An **app** is navigation over a pack's sheets, forms and dashboards: named screens in sections, for the people who do one job (report a problem, work on my actions, verify). It is data like the rest of a pack (CLAUDE.md: data, not code). An app adds no tables and no access: every screen renders an existing part of the product with the person's own session. Milestone P7 in docs/06.

## Where apps come from

| Source | Becomes |
|---|---|
| A pack manifest's `apps` (docs/11) | Installed with the pack, e.g. `templates/packs/iso-27001.json` → ISMS CAPA |
| `templates/apps/*.json` | `{ requires: { pack, range }, app }`: added to the `apps` of the pack it requires by `withApps` (`src/lib/packs/catalogue.ts`) before the manifest is checked. A missing pack or a version out of range is an error. `capa.json` → the CAPA app in `start-capa` |

So at run time an app is always part of a pack version in the `packs` catalogue; changing an app means a new pack version (docs/11: a version is written once). A workspace sees an app once a live install (`pack_installs.status = 'installed'`) of that version exists. No migration: the install's `ref_map` already names every sheet, sub-item sheet, view, form and dashboard it made.

## The manifest

Validated by `appManifestSchema` (`src/lib/apps/manifest.ts`, Zod; the engine types are `src/engine/apps/types.ts`). `appProblems(app, pack)` checks every ref against the pack and runs inside the pack schema.

| Key | Meaning |
|---|---|
| `key` | `^[a-z0-9][a-z0-9-]{0,39}$`, in the URL. Unique in a workspace: the oldest install wins |
| `title`, `description` | Shown in the side menu and the app's header |
| `icon` | One of `APP_ICONS` (lucide names: `shield-alert`, `clipboard-check`, `wrench`, `triangle-alert`, `list-checks`, `folder-kanban`, `shield-check`, `file-text`) |
| `roles` | Who sees the app: `owner`, `admin`, `member` (an editor or a viewer), `auditor`. None = everyone |
| `sections` | 1–6 `{ title, screens }`, 1–12 screens each. Screen keys are unique in the app |

Every screen has `key` (`^[a-z][a-z0-9-]{0,39}$`), `title`, an optional `description` and optional `roles` (narrows the app's roles). By `kind`:

| Kind | Keys | Renders |
|---|---|---|
| `view` | `sheet` (a sheet ref of the pack), `view?` (a saved view of that sheet by name) | The sheet page itself (`SheetView`: Table and its other views, the item panel), opened on the view |
| `item` | `sheet`, `subitems?` (`true`: its sub-items), `filters` (0–10), `sort?` (0–3), `show?` (0–6 field keys), `empty?` | A list of the items to act on: those that match every filter, sorted, each with the fields it shows; a row opens the item panel on its sheet (`?item=<display id>`, sub-items open on their parent sheet) |
| `form` | `sheet`, `form` (a form ref of that sheet) | The form, filled in as on the Forms tab (`submitInternalForm`). A pack installs forms as drafts; owners and admins see "Open the form" here |
| `dashboard` | `dashboard` (a dashboard ref of the pack) | The dashboard's widgets, read only, with "Open in Dashboards" |
| `workflow` | `sheet`, `fieldKey?` | Workflow opened on the sheet's lifecycle by that field |

**Filters** are the condition operators (`src/engine/conditions`) by field key, the same as automations and widgets: `{ "fieldKey": "status", "op": "is_not_done" }`. The value `{me}` (alone or in a list) is the person reading the screen: "assigned to me" is `{ "fieldKey": "owner", "op": "includes_any_of", "value": ["{me}"] }`; "signed by me" is `signed_by` with `["{me}"]`. Option values are option ids (`opt_verify`), never labels. Field keys must exist on the sheet (or its sub-items); `__name`, `__group` and `__id` are allowed.

## Resolution and access

`getApps(orgId, role)` (`src/server/apps/read.ts`) reads the live installs and the installed versions' manifests (parsed once per version) with the person's client, then the pure `resolveApps` (`src/engine/apps/resolve.ts`) maps every screen through the install's ref map: `sheet:<ref>`, `sheet:<ref>.subitems`, `view:<sheet>.view.<n>` (a saved view by its position in the manifest), `view:<sheet>.form.<ref>`, `dashboard:<ref>`.

- A screen whose objects the install does not have (a lower level, e.g. Starter without a Full sheet) is left out; a section with no screens and an app with no screens are not shown.
- Roles only hide. What a screen shows is read under RLS and sheet access (docs/02 §16): a restricted sheet the person cannot open shows "No access", an item list holds only items they can read and restricted fields read "Restricted", a form sends only for editors with edit access, a viewer reads the form's state and is told to ask an editor. An auditor sees only what their role allows.
- `/[org]/apps/[app]` opens the first screen the person may see; the side menu's **Apps** section (between Insights and the sheets) links each app there. Unknown apps and screens are 404.

## Screens at 390 px

The app header is the app's name and its screens as underline tabs that scroll sideways. Item lists are rows (display id, name, "For <parent>", the shown fields), with overdue dates in words and a symbol. Forms are one column. Empty states use the screen's `empty` text; a failed load shows the segment's error state with Retry.

## The CAPA apps

**CAPA** (`templates/apps/capa.json`, requires `start-capa` ^1.1.0). `start-capa` 1.1.0 (the CAPA wizard start as a pack, `templates/starts.json` → `pack`) adds the status "Awaiting verification" (`opt_verify`), the automation "Problem reported → add the CAPA steps" (form submitted → `create_subitems` from the sheet's template; the template gives Containment to `$actor`, the person reporting) and the "CAPA overview" dashboard.

| Section | Screen | Kind | Over |
|---|---|---|---|
| Work | Report a problem | form | "Raise a nonconformity" (owners, admins, members) |
| Work | My actions | item | Sub-items with Owner = `{me}` and Status not done, by Due date |
| Work | Needs my approval | item | Nonconformities with Owner = `{me}` and Status Awaiting verification |
| Overview | All nonconformities | view | The CAPA sheet |
| Overview | Overview | dashboard | CAPA overview |
| Overview | Workflow | workflow | The sheet by Status (owners and admins) |

**ISMS CAPA** (`iso-27001` 1.2.0, `apps`): the same screens over Nonconformities and CAPA. The pack adds the internal form "Report a problem" (Starter) and the "Nonconformities overview" dashboard; Needs my approval lists nonconformities you own in "Checking effectiveness". Reported problems do not get actions automatically here (the sheet's "From template" adds them).

## Catalogue

New pack versions (`start-capa` 1.1.0, `iso-27001` 1.2.0) are written by the seed's catalogue step locally; a hosted catalogue needs them loaded (`pnpm exec tsx scripts/packs-sql.ts`). Workspaces on older versions keep them and show no app until upgraded (P6).

## Later

App screens over packs this one requires (`pack:sheet` refs), customer-built apps (the app builder), per-screen saved filters chosen by the person, notifications per app.
