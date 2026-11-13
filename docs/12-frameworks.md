# 12 · Frameworks: the requirement library and cross-walks

Frameworks (standards, laws, regulations, internal rule sets) and their requirements are shared, versioned reference **data**. A workspace adopts a framework and gets a library sheet: one item per requirement, with applicability, justification, implementation status, owner and evidence. Controls link to requirements; cross-walks say which requirements of different frameworks ask for the same thing. A statement of applicability (SoA) is a saved view of the library, not code. Milestone P3 in docs/06; tables in docs/02 §17.

## Licensing (board decision, DPO; non-negotiable)

- **Never ship ISO/IEC text**: no clause or Annex A wording, no copied control titles where they are distinctive prose. Ship the **reference numbers** ("A.5.1", "6.1.2") with **our own short titles** (at most 80 characters) and, optionally, our own guidance.
- Every framework file says what may be shipped: `licence` (shown in the catalogue, in the library sheet's description and in the item panel), `source`, and `"titles": "own-words"` (the schema refuses any other value; the `frameworks.titles` column is checked the same way).
- EU law (GDPR, NIS2) may be quoted with citation, but we keep to short own-words titles and article references with the EUR-Lex link.
- A workspace may paste licensed text into its own items (an org-owned field such as Guidance notes); never into the global catalogue.

## Model

| Where | What |
|---|---|
| `templates/frameworks/<key>-<version>.json` | One framework: `key`, `version` (the edition, `2022`), `revision` (our content revision), `title`, `shortTitle` (chips: "27001 A.5.1"), `publisher`, `kind` (standard, law, regulation, internal), `source`, `licence`, `url`, `titles`, `library` (sheet name, item label, ID prefix, folder, optional `soa: { name, refStartsWith }`) and `requirements` (`ref`, `parent`, `kind` clause, control, article, paragraph or theme, `title`, `guidance`, `tags`). Themes are top-level and become the library's groups; every other requirement has a parent and becomes a library item |
| `templates/frameworks/crosswalks.json` | Cross-walks by requirement key `<key>@<version>#<ref>`: `sets` (n-way, expanded into one cross-walk per pair; a member listed under `partial` makes its pairs partial) and `pairs`. `source` names the mapping and its version ("Klarert mapping v1") |
| `src/lib/frameworks/` | Zod schema (`schema.ts`) and the repository's catalogue (`catalogue.ts`: `repoFrameworks`, `repoCrosswalks`, `frameworkPacks`) |
| `src/engine/frameworks/` | Pure: requirement keys, `frameworkToPack`, cross-walk index, `alsoSatisfies`, `suggestEquivalents`, coverage, the library roll-up, `withControlsLink` |
| `frameworks`, `requirements`, `crosswalks` (0030) | The global catalogue, read by every signed-in person, written only by the seed path (service role) |
| A library sheet per adopted framework | `sheets.is_library`, `sheets.settings.framework = { key, version, refFieldKey }`; each item carries `items.requirement_ref` |

Relations: **equivalent** (asks for the same thing), **partial** (part of it, or the same in a discipline-specific way), **related** (worth looking at together; never suggested for linking). Be conservative: when in doubt, related.

## Adopting a framework

Each framework's library is generated as a pack (`frameworkToPack`: key `framework-<key>`, version `<edition>.<revision>.0`) and written into the packs catalogue with the framework (docs/11). Adopting reuses the pack install path:

1. **Preview** (`previewAdoption`, owners and admins): the server reads the framework and its library pack from the catalogue, plans the install with the pack planner and, when a **controls sheet** is chosen, adds a **Controls** link field to the library (`withControlsLink`): it points at the controls sheet and mirrors that sheet's requirement field (`config.inverseFieldId`), so a link made on either side shows on both. A controls sheet is any sheet with a requirement (or control link) field that links to any library sheet (no target sheet).
2. **Adopt** (`adoptFramework`): planned again from the catalogue and the workspace as they are now (the browser sends the framework, the controls sheet and the hash it previewed), then `adopt_framework(org, framework, version, plan)` runs `install_pack` and stamps every library item with its requirement key in the same transaction, checks every key and Ref against the catalogue and that every requirement has its item, and logs `framework.adopted`. A framework is adopted once at a time; archiving the install (Workspace admin › Packs) lets it be adopted again.

What the library holds: groups by theme; fields Ref (locked, the name's subline in the Table), Part of, Guidance (when the framework has any), Applicable (applicability), Justification (required when not applicable), Implementation status (Not started, Planned, Partially, Implemented), Owner, Evidence, Last reviewed, and Controls when a controls sheet was chosen; the licence note in the sheet description; views All requirements (the Table), the statement of applicability (when the framework names one: refs starting with `A.` for 27001, columns Ref, Title, Applicable, Justification, Implementation status, Evidence, Controls) and an Insights layout "Applicability" (requirements, implemented, implemented %, applicable / not applicable, implementation status).

`items.requirement_ref` is written once (only by `adopt_framework`) and never changes; neither does the item's Ref value. Renaming an item, a field or an option never breaks the link to the catalogue. Library sheets are ordinary sheets: RLS and sheet access (docs/02 §16) apply unchanged, so a restricted library is hidden from people who are not listed, and coverage, "Also satisfies" and "Covers" only count what the person may read.

## In the workspace

- **Coverage** (Workspace admin › Frameworks): of the requirements in scope (not marked Not applicable; undecided ones count as in scope), the share with at least one implemented control (a linked item whose status is done; a linked item on a sheet without a status counts) or current evidence. Shown with how many are applicable, not applicable and still to decide.
- **Requirement items** (item panel, Details): the controls covering it, whether it is covered, "Also satisfies" (requirements of the other adopted frameworks it maps to, with the relation) and the mapping source.
- **Control items**: "Covers" (the adopted requirements it is linked to, in any library) and "Suggested equivalents" (equivalent and partial requirements of other adopted frameworks it is not linked to yet) with a one-click Link that adds the requirement to the sheet's requirement field.
- Requirement and control link fields with no target sheet ("Any library sheet") link to items of every library sheet; the picker searches by name, ID or reference number and shows each item's library.

## Adding a framework or a version

1. Write `templates/frameworks/<key>-<version>.json` (own-words titles, the licence note) and import it in `src/lib/frameworks/catalogue.ts`. A new edition of a standard is a new `version` (a new file); both stay in the catalogue.
2. Map it in `crosswalks.json` (or a new mapping version with its own `source`). Cross-walks are never changed in the database: a corrected mapping is a new source version.
3. Changing titles or guidance, or adding requirements, of a version already in the catalogue: raise its `revision` (the library pack gets a new version). Refs are never removed or renumbered (the database refuses).
4. `pnpm test` runs the integrity tests (`src/lib/frameworks/catalogue.test.ts`); `pnpm seed` writes the catalogue locally. For a hosted project, load the framework packs and the catalogue rows after the deploy (the seed's catalogue step or the generated SQL), the same way as packs.
5. Moving a workspace from one adopted version to the next is an upgrade (P6), not in P3.
