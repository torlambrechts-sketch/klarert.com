# 11 · Packs

A **pack** is an installable bundle of the core as data (CLAUDE.md: data, not code): folders, sheets with fields, groups, views, forms, tab sets and column groups, sub-items, example items, documents and library items, links, automations and dashboards. Installing a pack writes ordinary rows; nothing in the app knows a pack's content. Milestones P1–P7 in docs/06; tables and RPCs in docs/02 §15.

## Where packs come from

| Source | Becomes |
|---|---|
| `templates/packs/*.json` | Native pack files (the manifest below), e.g. `supplier-management.json` |
| `templates/first-sheet.json` | Wrapped by `templateToPack` (`src/lib/packs/wrap.ts`): key = the template id, refs made from names |
| Wizard starts (`templates/starts.json`) listed in `START_PACKS` | Wrapped by `startToPack`: one sheet, key `start-<id>` (CAPA, Documents and policies) |

`repoPacks()` (`src/lib/packs/catalogue.ts`) parses all of them. The seed (`pnpm seed`, `scripts/seed.ts`) writes them into the global `packs` table; the app reads only that table. A version is written once: change a pack, raise its version. In a hosted environment run the seed's catalogue step (or an equivalent service-role job) after a deploy that adds a pack version.

The wizard keeps creating a start's sheet its own way (editors may use it, the person picks name, prefix and columns); the same starts are also offered as packs to owners and admins. The template importer (`src/server/templates/importer.ts`, used by the seeds) installs through `install_pack`.

For a hosted project, `pnpm exec tsx scripts/packs-sql.ts > packs-catalogue.sql` writes the repository's packs as idempotent inserts (`on conflict do nothing`); run it as the database owner after the migrations and after `scripts/frameworks-sql.ts`.

## The manifest

Validated by `packManifestSchema` (`src/lib/packs/manifest.ts`), which extends the sheet template schema and then runs the template's own checks on every sheet.

| Key | Meaning |
|---|---|
| `key` | `^[a-z0-9][a-z0-9-]{0,79}$`, the pack's identity |
| `version` | Semver `1.2.3` |
| `title`, `description` | Shown in Workspace admin › Packs |
| `requires` | `[{ pack, range }]`; ranges `1.2.3`, `^1.2.0`, `~1.2.0`, `>=1.2.0`, `*`. Checked, not installed for you |
| `people` | Example people by `ref` and `email`; values `$person:<ref>` match the workspace's members by email. Missing people are left out (a warning, never a blocker) |
| `folders` | `[{ ref, name, restricted? }]`. An active folder with the same name is used; otherwise the pack makes one. `restricted: true` (P2) makes a new folder restricted: the installer is listed as an editor (owners always see it) |
| `sheets` | A template sheet (docs/07 Part B: `ref`, `name`, `itemLabel`, `idPrefix`, `groups`, `fields`, `views`, `forms`, `tabs`, `defaultView`, `columnGroups`, `subitems`) plus `folder` (a folder ref), `isLibrary`, `register: "documents"`, `restricted` (P2: created restricted, the installer listed as an editor) and `items` |
| `sheets[].fields[].config.targetSheetRef` | A link: a sheet ref of this pack, or `<pack key>:<sheet ref>` of a pack in `requires` (checked; resolving another pack's sheets comes later, the planner reports it as a conflict) |
| `sheets[].items` | `[{ ref, group, name, values, links: { <link field key>: [<item ref>] }, requirements? }]`: example items, documents of a register, library items. Links name items by ref, never by name. Tokens `$today`, `$in:N`, `$option:<label>`, `$person:<ref>` |
| `sheets[].items[].requirements` | `{ <requirement or control link field key>: ["iso-27001@2022#A.6.3", …] }`: example links into the library of a framework in `frameworks` (requirement keys, docs/12), resolved at install (Frameworks below) |
| `automations` | Template automations plus a `ref`. `sheetRef`, `groupRef` and a form's `ref` resolve to ids; `jobRole:<name>` / `team:<name>` recipients the workspace lacks are left out and said; an automation that then has nobody to tell is installed off |
| `automations[].subitems` | `true`: the automation belongs to the sheet's sub-items (docs/02 §12), i.e. the hidden child sheet of `sheet` (ref map `sheet:<ref>.subitems`). Its trigger and conditions name the sub-items' field keys; the sheet must have `subitems`, and a form trigger is not allowed. Date triggers fire per sub-item; `{sheet}` in a message is "<sheet> · <sub-items label>" |
| `dashboards` | `[{ ref, name, widgets: [{ ref, type, title, sheetRef?, library?, fieldKey?, conditions?, days? }] }]`, checked against the widget registry. `library: "<framework>@<version>"` (one of `frameworks`) reads the workspace's library sheet of that framework instead of a sheet of the pack |
| `levels` | Optional, 2–5, lowest first: `[{ key, name, description }]` (Levels below) |
| `level` on folders, sheets, forms, automations, dashboards | The lowest level that installs the object; none = every level |
| `frameworks` | `[{ key, version }]`: framework libraries the pack builds on, adopted at install when missing (Frameworks below) |
| `setup` | `{ title, description, steps }`: the guided setup checklist (Setup below) |

ID prefixes are unique inside a pack. When the workspace already uses one, the planner renames it with a number (`SUP-` → `SUP2-`, cutting the stem to stay within 6 characters) and the preview says so.

### Example

```json
{
  "key": "supplier-management",
  "version": "1.0.0",
  "title": "Supplier management",
  "description": "Suppliers with reviews.",
  "folders": [{ "ref": "suppliers", "name": "Suppliers" }],
  "sheets": [
    {
      "ref": "supplier", "name": "Supplier register", "itemLabel": "Supplier", "idPrefix": "SUP-", "folder": "suppliers",
      "groups": [{ "ref": "active", "name": "Active", "color": "green" }],
      "fields": [
        { "key": "owner", "name": "Owner", "type": "people", "config": { "multiple": false } },
        { "key": "next_review", "name": "Next review", "type": "date" },
        { "key": "reviews", "name": "Reviews", "type": "link",
          "config": { "targetSheetRef": "review", "multiple": true, "inverseKey": "supplier" } }
      ],
      "items": [{ "ref": "acme", "group": "active", "name": "Acme Ltd",
                  "values": { "next_review": "$in:30" }, "links": { "reviews": ["acme_2026"] } }]
    },
    {
      "ref": "review", "name": "Supplier reviews", "itemLabel": "Review", "idPrefix": "SRV-", "folder": "suppliers",
      "groups": [{ "ref": "done", "name": "Done", "color": "green" }],
      "fields": [{ "key": "supplier", "name": "Supplier", "type": "link",
                   "config": { "targetSheetRef": "supplier", "multiple": false, "inverseKey": "reviews" } }],
      "items": [{ "ref": "acme_2026", "group": "done", "name": "Annual review 2026", "values": {} }]
    }
  ],
  "automations": [{
    "ref": "review_due", "sheet": "supplier", "name": "Review due → ask the owner",
    "trigger": { "type": "date_arrives", "fieldKey": "next_review", "offsetDays": -14 },
    "actions": [{ "type": "request_update", "fieldKey": "owner", "message": "{name} is due for review." }]
  }],
  "dashboards": [{ "ref": "overview", "name": "Supplier overview",
    "widgets": [{ "ref": "w_overdue", "type": "overdue", "title": "Overdue reviews", "sheetRef": "supplier", "fieldKey": "next_review" }] }]
}
```

The full version is `templates/packs/supplier-management.json` (a library sheet, a documents register, a form and three widgets).

## Install

1. **Preview** (`previewPack`, owners and admins): the server reads the manifest from the catalogue, takes a snapshot of the workspace (prefixes, folders, installs, members with emails, job roles, teams, last positions) and runs the pure planner `planPackInstall` (`src/engine/packs/plan.ts`). The planner reuses the template planner (`src/engine/templates/plan.ts`) for everything sheet-level and returns operations per object (`create`, `reuse`, `skip`, `conflict`), the preview (counts, folders, sheets, links, renamed prefixes, automation sentences, forms, dashboards, warnings, conflicts) and the rows.
2. **States:** `ready`; `installed` (the same version is installed: every operation is `skip`); `blocked` (another version is installed, a requirement is missing or at the wrong version, a link into another pack, a widget that does not fit, a document that would start approved, a value the template planner refuses).
3. **Install** (`installPack`): plans again from the catalogue and the workspace as they are now (the browser sends only the key and the hash it previewed; a changed manifest is refused) and calls `install_pack`, which writes everything with provenance and the ref map in one transaction and logs `pack.installed`.

## Levels

A pack may offer levels (`levels`, lowest first, e.g. Starter and Full), chosen in the install dialog, which shows what each level creates and what it adds to the one before (`levelSummaries`). Every folder, sheet, form, automation and dashboard may name the lowest level that installs it; without one it installs at every level. `manifestAtLevel` (`src/engine/packs/levels.ts`) is the manifest as installed at a level.

- The manifest is checked so that nothing needs a higher level than its own: a sheet's folder and link targets, an automation's sheets (its own and `sheetRef` in actions), a dashboard's widgets, a form after its sheet. A two-way link joins sheets of one level only (a higher level never adds a field to a sheet already installed), so links from a higher level to a lower one are one way.
- `pack_installs.level` (0032) keeps the level installed. Installing a higher level of the same version later is not a new install: the planner plans the level whole, leaves out every row whose ref is already in the install's `ref_map` and points the new rows at the existing ids (`extend_install` in the plan). `install_pack` then adds the rows to the same install, refuses a level already installed or a ref the install already has, merges the ref map and logs `pack.extended` with what the level added. Picking a level at or below the installed one is `installed` (nothing to do).
- Workspace admin › Packs shows the installed level and an "Add Full" button that opens the dialog on the next level.

## Frameworks a pack builds on

`frameworks: [{ key, version }]` names framework libraries (docs/12) the pack needs. The preview says which are not adopted yet ("Adopts the ISO/IEC 27001:2022 requirement library first"); `installPack` adopts them first with `adopt_framework` (each its own transaction, no controls sheet) and then plans the pack again so it finds the library. The pack's sheets link to library items through `requirement` fields with no target sheet (any library); its widgets read the library with `library`.

Example items may link into a required library by requirement key: `"requirements": { "controls": ["iso-27001@2022#A.6.3", "iso-27001@2022#A.8.7"] }` on a risk (the field a `requirement` or `controllink` field of the sheet; the key's framework one of `frameworks`, checked by the manifest schema). `planInstall` reads the adopted library's live items with those `requirement_ref`s (`PackSnapshot.requirementItems`) and the planner writes the links with the install, so the requirement (and the SoA) shows the linked risks at once. Before the library is adopted (the preview) the links are left for the install, which adopts first and plans again; a key the library does not have is left out with a warning, never a blocker. `install_pack` (0033) accepts a link whose target is outside the plan only through a requirement or control link field and only to a live item of a live library sheet of the same workspace. A higher level never writes such a link again (its item and field are already installed).

## Setup

`setup` is a checklist shown after install on Workspace admin › Packs (all steps) and as a dismissible card on Home (the next step; dismissing is kept per browser). Each step has a `ref`, a title, a short own-words body, a `target` (a pack sheet by `sheetRef` or a required library by `library`, optionally a saved view or a form of that sheet by name: the link opens it, a form in the Forms tab) and `rules`. A step may reword itself at a level (`levels: { starter: { title, body, target, rules } }`), e.g. "List your processes" when Starter has no asset register.

Progress is computed from data by the pure `setupProgress` (`src/engine/packs/setup.ts`): for each rule, of the items matching `where` (all items when empty), the share that also match `all`, counted against at least `min` items (`matched / max(counted, min)`); conditions use the condition operators by field key. A step's progress is the average of its rules; the checklist's percent is the average of its steps (100 only when every step is done). Sheets the person cannot read count as not started and link nowhere. The checklist is checked at every level: each step names sheets, fields and views that level installs.

## The ISO/IEC 27001:2022 pack

`templates/packs/iso-27001.json` (key `iso-27001`, version 1.1.0): Starter has Scope and context, Risk register (likelihood and impact 1–5, inherent and residual scores as formulas, treatment option, Annex A controls from the library, review date), Risk treatment plan, ISMS documents (a documents register with the documented information an ISMS keeps) and Nonconformities and CAPA (actions as sub-items, the close gate); Full adds Asset register, Internal audit programme, Audit findings, Management review (inputs as checkboxes), Security incidents and Training and awareness. Nine automations (risk review due, residual score above 12, overdue nonconformity, overdue corrective action on the CAPA actions (sub-items, tells the action's owner), overdue treatment action, document review due, and in Full: a nonconformity finding or a closed incident that needs a root cause raises a linked nonconformity, training due), the "ISMS overview" dashboard (risks by level, by status, treatment progress, Annex A implementation from the library, open nonconformities, documents due for review) and an 8-step setup. Example items start with "Example:"; no text of the standard is shipped (docs/12 Licensing).

- **Annex A links.** The example risks link to Annex A controls of the adopted library (phishing → A.6.3, A.8.7; lost laptop → A.8.1, A.7.9; supplier outage → A.5.19, A.5.30) and the example treatments to the control they put in place (multi-factor sign-in → A.8.5, disk encryption → A.8.24), so the requirements show linked risks straight after install.
- **Report a security incident** (Full, on Security incidents): what happened (one line and the detail), when it was noticed, systems and data affected, a severity guess and the reporter's name and email; answers go to Open with the status New. It installs as an **internal** draft (signed-in members of the workspace), with a privacy notice to review. To take reports from people without an account (staff without a seat, contractors), an owner or admin switches it to public in the form's settings and opens it: the reporter's name and email are then the only way to reach them, and the notice must be reviewed first (docs/05 §3.3). The sheet shows its Forms tab and the setup step "Make incidents easy to report" opens the form (Starter: "Record incidents" as nonconformities with the source Incident).
- **1.0.0 → 1.1.0.** A workspace on 1.0.0 keeps it (upgrades are P6); new installs get 1.1.0. Hosted catalogues need the new version loaded (`scripts/packs-sql.ts`) after migration 0033.

## Audit outputs (P5)

Exports for an auditor or a management review, made from the workspace as it is now. Insights › **Audit outputs** (`/[org]/audit`) has all three; every member may use them, auditors too (exports change nothing). Shortcuts: **Export SoA** on a library sheet's header and on Workspace admin › Frameworks (with the audit pack dialog), and "Compile the review inputs" on the setup step whose sheet is the pack's management review sheet.

- **Statement of applicability** (`/[org]/audit/soa/[sheetId]`, a server-rendered page that prints to PDF from the browser; the shell is hidden in print; CSV by a form POST to `./csv`). Rows: the library's SoA view (the view the framework file names, with its filters as the workspace keeps them; "Show every requirement" drops them). Columns Ref, Title, Applicable, Justification, Implementation status, Owner, Evidence (file names with a link to the item), Linked controls and risks (items linked either way, not other libraries' requirements), Last reviewed. Header: workspace, framework, scope, the framework's licence note, generated at and by. Only the shipped titles; never a standard's text. Pure: `buildSoa`, `soaCsv`, `soaHtml` (`src/engine/audit/soa.ts`).
- **Audit pack** (POST `/[org]/audit/pack`, `buildAuditPack`): scope the whole workspace, a folder or a pack install, a period, and optionally the evidence files. The zip holds `README.txt` (what is in it, what was left out, the method), `soa/<framework>.csv` and `.html` for each library in scope (for a pack: also the libraries it builds on), `registers/<sheet>.csv` for every sheet in scope (sub-item sheets too), `evidence/index.csv` (file, sheet, item, field, uploaded by and at, valid until, size, SHA-256 as checked at upload, whether the file is in the zip) and `evidence/files/<item>/<file>` when asked: each file up to 10 MB and 100 MB in all (`AUDIT_FILE_LIMITS`, smallest first), each through `download_file` (blocked files never, each counts as a download), `activity/log.csv` (the entries of the scope's sheets and items whose day in the workspace time zone is in the period; restricted values read "Restricted") and `activity/chains.csv` with `method.txt`: `verify_activity_chain` on every chain in scope (each live item, each sheet, and every chain with an entry in the period), ok, broken (with the first bad entry) or not checked. The whole chain is checked, not only the period. The zip is built in memory with `fflate` (no zip library was in the dependencies; it is small and has none of its own); the file cap bounds it.
- **Management review inputs** (`/[org]/audit/review?from&to`, `managementReviewInputs`): the pure `compileManagementReview` (`src/engine/audit/management-review.ts`) words eight inputs for the period from rows the server projects with the field registry: actions from earlier reviews (reviews dated before the period, nonconformities and treatment actions still open from before it), changes in issues and in interested parties (context items added or changed), nonconformities (raised, closed, open, overdue), monitoring (each library's coverage as Frameworks shows it, incidents, training), audits and findings, risks (open by level, past review, treatment progress) and opportunities (overdue items, closed nonconformities). Where the inputs come from is data: `REVIEW_PACK_SOURCES` (`src/lib/packs/management-review.ts`) names the ISO 27001 pack's sheets, date and level fields and group refs by pack ref. With the pack's Management review sheet, editors can **Add to Management review**: `createItem` (the inputs that have data ticked) and the report posted as the item's first update (`postUpdate`), so validation, the log and automations run as usual. "Closed in the period" is a done item last changed in the period.

**Access.** Everything is read with the person's own client: restricted sheets they cannot open are left out (the read me counts them without naming them), restricted fields they are not listed on are dropped from registers and read "Restricted" in the SoA and the log, and their files are not listed.

**Logged.** Every export writes `audit.exported` on the workspace chain through `log_audit_export(org, kind, scope)` (0033): kind `soa.print`, `soa.csv`, `audit_pack`, `management_review` or `management_review.item`, and the scope (framework, sheet, folder or install, period, counts, chains ok and broken). Members only (an auditor's access ends at its end date); the scope is a flat object of known keys with scalar values. Downloads are POST only and refused from another site.

## Archive

`archivePack` → `archive_pack`: automations off, sheets archived (restorable one by one from Workspace admin › Archived), folders archived when nothing else is in them, dashboards archived, the install marked archived, `pack.archived` logged. Items, links and the activity log are never deleted. An archived pack can be installed again (its prefixes are then renamed, as the archived sheets keep theirs).

## Frameworks

A framework's requirement library is a generated pack (docs/12): `frameworkToPack` (`src/engine/frameworks/pack.ts`) turns a framework file into a manifest with one library sheet (key `framework-<key>`, version `<edition>.<revision>.0`). The sheet carries `framework: { key, version, refFieldKey }` and each item a `requirementRef` (`<framework>@<version>#<ref>`). The seed writes these packs with the others and then the requirement catalogue (`syncFrameworks`). They are not listed under Packs and `previewPack` / `installPack` refuse them: a framework is adopted from Workspace admin › Frameworks, through `adopt_framework`, which calls `install_pack` and stamps the requirement keys in the same transaction. An adopted library is archived like any pack (Installed packs › Archive).

## Later

Upgrades with a three-way diff from `pack_hash` and `ref_map` (P6), resolving `pack:sheet` links across installs, recipes in manifests, installing requirements for you, apps (P7).
