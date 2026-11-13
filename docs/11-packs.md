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

## The manifest

Validated by `packManifestSchema` (`src/lib/packs/manifest.ts`), which extends the sheet template schema and then runs the template's own checks on every sheet.

| Key | Meaning |
|---|---|
| `key` | `^[a-z0-9][a-z0-9-]{0,79}$`, the pack's identity |
| `version` | Semver `1.2.3` |
| `title`, `description` | Shown in Workspace admin › Packs |
| `requires` | `[{ pack, range }]`; ranges `1.2.3`, `^1.2.0`, `~1.2.0`, `>=1.2.0`, `*`. Checked, not installed for you |
| `people` | Example people by `ref` and `email`; values `$person:<ref>` match the workspace's members by email. Missing people are left out (a warning, never a blocker) |
| `folders` | `[{ ref, name }]`. An active folder with the same name is used; otherwise the pack makes one |
| `sheets` | A template sheet (docs/07 Part B: `ref`, `name`, `itemLabel`, `idPrefix`, `groups`, `fields`, `views`, `forms`, `tabs`, `defaultView`, `columnGroups`, `subitems`) plus `folder` (a folder ref), `isLibrary`, `register: "documents"` and `items` |
| `sheets[].fields[].config.targetSheetRef` | A link: a sheet ref of this pack, or `<pack key>:<sheet ref>` of a pack in `requires` (checked; resolving another pack's sheets comes later, the planner reports it as a conflict) |
| `sheets[].items` | `[{ ref, group, name, values, links: { <link field key>: [<item ref>] } }]`: example items, documents of a register, library items. Links name items by ref, never by name. Tokens `$today`, `$in:N`, `$option:<label>`, `$person:<ref>` |
| `automations` | Template automations plus a `ref`. `sheetRef`, `groupRef` and a form's `ref` resolve to ids; `jobRole:<name>` / `team:<name>` recipients the workspace lacks are left out and said; an automation that then has nobody to tell is installed off |
| `dashboards` | `[{ ref, name, widgets: [{ ref, type, title, sheetRef?, fieldKey?, conditions?, days? }] }]`, checked against the widget registry |

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

## Archive

`archivePack` → `archive_pack`: automations off, sheets archived (restorable one by one from Workspace admin › Archived), folders archived when nothing else is in them, dashboards archived, the install marked archived, `pack.archived` logged. Items, links and the activity log are never deleted. An archived pack can be installed again (its prefixes are then renamed, as the archived sheets keep theirs).

## Later

Upgrades with a three-way diff from `pack_hash` and `ref_map` (P6), resolving `pack:sheet` links across installs, recipes in manifests, installing requirements for you, apps (P7).
