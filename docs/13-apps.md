# 13 · Apps

An **app** is navigation over a pack's sheets, forms and dashboards: named screens in sections, for the people who do one job (report a problem, work on my actions, verify). It is data like the rest of a pack (CLAUDE.md: data, not code). An app adds no tables and no access: every screen renders an existing part of the product with the person's own session. Milestone P7 in docs/06.

## Where apps come from

| Source | Becomes |
|---|---|
| A pack manifest's `apps` (docs/11) | Installed with the pack, e.g. `templates/packs/iso-27001.json` → ISMS CAPA |
| `templates/apps/*.json` | `{ requires: { pack, range }, app }`: added to the `apps` of the pack it requires by `withApps` (`src/lib/packs/catalogue.ts`) before the manifest is checked. A missing pack or a version out of range is an error. `capa.json` → the CAPA app in `start-capa` |

**Starting an app from Create** (owner decision, 14 Nov 2026; docs/05 §4 Create › App): Create lists the apps of the catalogue's packs and of the live installs (`appStarts`, `src/engine/create/apps.ts`) and gives each the shortest valid path: open it when a live install carries it, create the set that carries it (the same preview, `createBundle` and `create_bundle` as Solve a problem, Core installed first when the app reads Core's registers, the registers the workspace already has named in the preview), or Workspace admin › Packs when its pack is live without it (an update, or parts left out). Owners and admins create; others preview and ask. Goal matching (`templates/intents.json`) finds apps as apps.

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
| `view` | `sheet` (a sheet ref of the pack, or `<pack>:<sheet>` of a pack it requires, below), `view?` (a saved view of that sheet by name) | The sheet page itself (`SheetView`: Table and its other views, the item panel), opened on the view |
| `item` | `sheet`, `subitems?` (`true`: its sub-items), `filters` (0–10), `sort?` (0–3), `show?` (0–6 field keys), `empty?` | A list of the items to act on: those that match every filter, sorted, each with the fields it shows; a row opens the item panel on its sheet (`?item=<display id>`, sub-items open on their parent sheet) |
| `form` | `sheet`, `form` (a form ref of that sheet) | The form, filled in as on the Forms tab (`submitInternalForm`). A pack installs forms as drafts; owners and admins see "Open the form" here |
| `dashboard` | `dashboard` (a dashboard ref of the pack) | The dashboard's widgets, read only, with "Open in Dashboards" |
| `workflow` | `sheet`, `fieldKey?` | Workflow opened on the sheet's lifecycle by that field |

**Screens over a pack it requires.** `sheet` may be `<pack>:<sheet>` of a pack in the manifest's `requires` (`core:nc`): the sheet comes from the live install of that pack (its ref map), the forms and saved views from what this pack's `extends` adds to that sheet (in this install's ref map). `appProblems` checks the pack is required and the form or view is one the extends adds; field keys are checked against the required pack's manifest by the catalogue tests (`appProblems(app, pack, [core])`). Sub-items of another pack's sheet are not available. Without that install the screen is left out.

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

**ISMS CAPA in the 27001 add-on** (`iso-27001` 2.0.0): the screens read the Core registers (`core:nc`, `core:actions`): Report a problem (the add-on's form on Nonconformities and CAPA), My actions (Core Actions assigned to you, not done, by Due), Needs my check (nonconformities you own at the stage Verification), All nonconformities, Overview (the add-on's headline dashboard "ISMS overview") and Workflow (by Stage, owners and admins).

## Catalogue

New pack versions (`start-capa` 1.1.0, `iso-27001` 1.2.0) are written by the seed's catalogue step locally; a hosted catalogue needs them loaded (`pnpm exec tsx scripts/packs-sql.ts`). Workspaces on older versions keep them and show no app until upgraded (P6).

## Later

Customer-built apps (the app builder), per-screen saved filters chosen by the person, notifications per app.
