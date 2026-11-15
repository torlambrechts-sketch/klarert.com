# 12 · Frameworks: the requirement library and cross-walks

Frameworks (standards, laws, regulations, internal rule sets) and their requirements are shared, versioned reference **data**. A workspace adopts a framework and gets a library sheet: one item per requirement, with applicability, justification, implementation status, owner and evidence. Controls link to requirements; cross-walks say which requirements of different frameworks ask for the same thing. A statement of applicability (SoA) is a saved view of the library, not code. Milestone P3 in docs/06; tables in docs/02 §17.

## Licensing (board decision, DPO; non-negotiable)

- **What we ship for an ISO standard:** the standard's number and title, the clause numbers (4–10) with their official short headings, and the Annex A control IDs with their official short titles ("A.5.1 Policies for information security"). Titles only, at most 80 characters: `"titles": "official-short"`. This is common market practice (vendors publish all 93 Annex A IDs and titles), not a legal permission: short titles and numbers are weakly protected, but the EU database right adds some uncertainty when a whole catalogue is copied.
- **Everything else is our own words, written from scratch:** a one-sentence purpose, practical guidance, audit questions and typical evidence for every requirement, then mapped to the IDs. Never ISO's clause or control text, never ISO 27002 guidance, never another vendor's wording, and never a close paraphrase of any of them. Reproducing control text is a known copyright risk.
- Every framework file says what may be shipped: `licence` (shown in the catalogue, in the library sheet's description and in the item panel), `source`, and `titles`: `own-words` or `official-short` (the schema and the `frameworks.titles` column refuse any other value).
- EU law (GDPR, NIS2) is public: we use the official article headings as titles, with the EUR-Lex link; purpose, guidance, questions and evidence are our own words.
- A workspace may paste licensed text into its own items (an org-owned field such as Guidance notes); never into the global catalogue.

## Model

| Where | What |
|---|---|
| `templates/frameworks/<key>-<version>.json` | One framework: `key`, `version` (the edition, `2022`), `revision` (our content revision), `title`, `shortTitle` (chips: "27001 A.5.1"; a later edition says its year: "14001:2026"), `publisher`, `kind` (standard, law, regulation, internal), `source`, `licence`, `url`, `titles`, `library` (sheet name, item label, ID prefix, folder, optional `soa: { name, refStartsWith }`, and `packKey` for a later edition: `framework-<key>-<version>`), the **edition status** (`status`, `supersededBy`, `transitionEnds`, `revisionStage`, `revisionExpected`, `statusNote`, `statusCheckedOn`; see Edition status) and `requirements` (`ref`, `parent`, `kind` clause, control, article, paragraph or theme, `title`, and our own `purpose` (one sentence), `guidance`, `questions` (audit questions, 3–5) and `evidence` (typical evidence, 3–6), `tags`). Themes are top-level and become the library's groups; every other requirement has a parent and becomes a library item |
| `templates/frameworks/crosswalks.json` | Cross-walks by requirement key `<key>@<version>#<ref>`: `sets` (n-way, expanded into one cross-walk per pair; a member listed under `partial` makes its pairs partial) and `pairs`. `source` names the mapping and its version ("Klarert mapping v1"). Pairs between two editions of one framework are the **edition mapping** (`iso-14001@2015#6.1.4` → `iso-14001@2026#6.1.5`, equivalent): every requirement of the old edition maps to the new one and back |
| `src/lib/frameworks/` | Zod schema (`schema.ts`) and the repository's catalogue (`catalogue.ts`: `repoFrameworks`, `repoCrosswalks`, `frameworkPacks`) |
| `src/engine/frameworks/` | Pure: requirement keys, `frameworkToPack`, cross-walk index, `alsoSatisfies`, `suggestEquivalents`, coverage, the library roll-up, `withControlsLink` |
| `frameworks`, `requirements`, `crosswalks` (0030, edition status 0037) | The global catalogue, read by every signed-in person, written only by the seed path (service role) |
| A library sheet per adopted framework | `sheets.is_library`, `sheets.settings.framework = { key, version, refFieldKey }`; each item carries `items.requirement_ref` |

Relations: **equivalent** (asks for the same thing), **partial** (part of it, or the same in a discipline-specific way), **related** (worth looking at together; never suggested for linking). Be conservative: when in doubt, related.

## Edition status

Standards are revised and laws amended. Every framework version says where it stands, so nobody starts work on a withdrawn edition without knowing:

| `status` | Means | Badge |
|---|---|---|
| `current` | The edition to use | none |
| `withdrawn` | The publisher withdrew it; `supersededBy` names the new edition and `transitionEnds` the date certificates to it stop being valid | "Withdrawn · replaced by ISO 14001:2026 · transition ends Apr 2029" |
| `superseded-in-transition` | Replaced, still the edition most certificates use while the transition runs | "Superseded · replaced by … · transition ends …" |
| `revision-in-progress` | Current; a new edition is on the way (`revisionStage` DIS or FDIS, `revisionExpected`) | "Revision in progress (DIS) · expected 2027" |

`statusNote` says what it means for a workspace in our own words; `statusCheckedOn` is when someone last checked it (Standards watch below). Transition end dates come from the accreditation bodies (IAF, now GAC) and certification bodies; the catalogue says so next to the date and the workspace's certification body confirms its own.

The edition status is catalogue metadata, not library content: it is left out of the framework's content hash (`frameworkHash`), the seed (`syncFrameworks`, `scripts/frameworks-sql.ts`) writes it in place without a new revision, and it never offers a library update. Shown on Workspace admin › Frameworks: the badge, the note and "Edition status checked …" on every catalogue entry, the badge on every adopted library. Adopting a withdrawn or superseded edition shows the warning, recommends the new edition when the catalogue has it and needs a confirmation ("I need ISO 14001:2015 anyway, for example for an audit during the transition"). A replaced library whose successor is not adopted yet says "Adopt ISO 14001:2026 from the catalogue below, then move your work to it".

Status on 14 Nov 2026 (sources in docs/reviews/2026-11-frameworks-content-review.md, Edition currency): ISO 9001:2015 and ISO 14001:2015 withdrawn (ISO 9001:2026, ISO 14001:2026; transitions to Sep 2029 and Apr 2029), ISO 45001:2018 revision in progress (DIS, 2027), ISO/IEC 27001:2022 with Amd 1:2024, GDPR and NIS2 current (amendment proposals are not law and are watch items only).

## Standards watch

So that a new edition never again goes unnoticed:

- **Monthly, first working day.** The compliance lead (owner: Tor; deputy: whoever holds the DPO role) checks every framework in `templates/frameworks/`: the publisher's page (iso.org standard page and the committee's news; EUR-Lex for EU law, including "amended by" and corrigenda), and at least two certification bodies' news pages (DNV, BSI, TÜV SÜD, LRQA, SGS, DQS) for publication dates, stages and transition dates.
- **Record.** Update `status` and the other status fields and set `statusCheckedOn` to the day of the check, even when nothing changed. Note a change, with the sources, in the content review (`docs/reviews/`). A proposal (a Commission proposal, a DIS) is a watch item in `statusNote`, never a status of law.
- **A new edition is published.** Mark the old one `withdrawn` (or `superseded-in-transition`) with `supersededBy` and `transitionEnds`; write the new edition as a new file (Adding a framework or a version) with its edition mapping; check packs that build on the old edition (docs/11 Frameworks a pack builds on).
- **The guard.** `src/lib/frameworks/catalogue.test.ts` fails when any framework's `statusCheckedOn` is older than 120 days (`STATUS_MAX_AGE_DAYS`), so CI goes red if the watch is skipped for a quarter.

## Adopting a framework

Each framework's library is generated as a pack (`frameworkToPack`: key `framework-<key>`, or the edition's `library.packKey` for a later edition, version `<edition>.<revision>.0`) and written into the packs catalogue with the framework (docs/11). Adopting reuses the pack install path:

1. **Preview** (`previewAdoption`, owners and admins): the server reads the framework and its library pack from the catalogue, plans the install with the pack planner and, when a **controls sheet** is chosen, adds a **Controls** link field to the library (`withControlsLink`): it points at the controls sheet and mirrors that sheet's requirement field (`config.inverseFieldId`), so a link made on either side shows on both. A controls sheet is any sheet with a requirement (or control link) field that links to any library sheet (no target sheet).
2. **Adopt** (`adoptFramework`): planned again from the catalogue and the workspace as they are now (the browser sends the framework, the controls sheet and the hash it previewed), then `adopt_framework(org, framework, version, plan)` runs `install_pack` and stamps every library item with its requirement key in the same transaction, checks every key and Ref against the catalogue and that every requirement has its item, and logs `framework.adopted`. An edition is adopted once at a time (0037: by key and version); two editions of one framework are adopted side by side, each its own library and pack install. Archiving the install (Workspace admin › Packs) lets it be adopted again.

What the library holds: groups by theme; fields Ref (locked, the name's subline in the Table), Part of, Purpose, Guidance, Audit questions and Typical evidence (locked, when the framework has them), Applicable (applicability), Justification (required when not applicable), Implementation status (Not started, Planned, Partially, Implemented; an empty one reads and counts as Not started in the Table, the panel, widgets, coverage and the SoA, and nothing is written until someone sets it: `src/engine/frameworks/unset.ts`, owner decision 15 Nov 2026), Owner, Evidence, Last reviewed, and Controls when a controls sheet was chosen; the licence note in the sheet description; views All requirements (the Table), the statement of applicability (when the framework names one: refs starting with `A.` for 27001, columns Ref, Title, Applicable, Justification, Implementation status, Evidence, Controls) and an Insights layout "Applicability" (requirements, implemented, implemented %, applicable / not applicable, implementation status).

`items.requirement_ref` is written once (only by `adopt_framework`) and never changes; neither does the item's Ref value. Renaming an item, a field or an option never breaks the link to the catalogue. Library sheets are ordinary sheets: RLS and sheet access (docs/02 §16) apply unchanged, so a restricted library is hidden from people who are not listed, and coverage, "Also satisfies" and "Covers" only count what the person may read.

## Moving to a new edition

A new edition is not an upgrade (Upgrades below never cross editions: each edition has its own pack key). A workspace moves in two steps on Workspace admin › Frameworks:

1. **Adopt the new edition alongside** (the catalogue recommends it on the old edition). Both libraries live side by side; "Also satisfies" shows the edition mapping between them.
2. **Move to the new edition** (owners and admins, on the old library once the new one is adopted). `planEditionMove` (`src/engine/frameworks/edition.ts`, pure) plans from the edition mapping: where a new requirement is the same as exactly one old requirement (relation equivalent, one to one), the workspace's answers are copied (applicability, justification, implementation status, owner, last reviewed; never over an answer the new item already has; an option the new field does not offer is skipped) and the old requirement's control links are repeated on the new one (a control's requirement field, and the library's own Controls field by key). Every other new requirement is listed for review with why: new in this edition, changed (partial), only related, merging several old requirements (10.1 and 10.3 into 10.1) or part of a split one (9.3 into 9.3.1 to 9.3.3). The preview shows the counts and the review list; `move_framework_edition` (0037) checks every copy against the catalogue's equivalent cross-walks and writes it in one transaction: values through `set_item_values` (note "Copied from ISO 14001:2015 (move to ISO 14001:2026)"), links through `set_item_links`, every item of the old library locked ("Moved to ISO 14001:2026"), `sheets.settings.framework.movedTo` set and `framework.moved` on the workspace chain. A library is moved once.

The old library stays, read-only, with its history: its row on Frameworks and a note on the sheet say "Read-only: moved to ISO 14001:2026" with a link. Evidence files stay on the old items (a file is never duplicated: retention and erasure work per file); the preview lists the requirements that have them so they can be attached again where they still apply. Automations do not run on the copied values (library sheets have none by default).

## In the workspace

- **Coverage** (Workspace admin › Frameworks): of the requirements in scope (not marked Not applicable; undecided ones count as in scope), the share with at least one implemented control (a linked item whose status is done; a linked item on a sheet without a status counts) or current evidence. Shown with how many are applicable, not applicable and still to decide.
- **Requirement items** (item panel, Details): the controls covering it, whether it is covered, "Also satisfies" (requirements of the other adopted frameworks it maps to, with the relation) and the mapping source.
- **Control items**: "Covers" (the adopted requirements it is linked to, in any library) and "Suggested equivalents" (equivalent and partial requirements of other adopted frameworks it is not linked to yet) with a one-click Link that adds the requirement to the sheet's requirement field.
- Requirement and control link fields with no target sheet ("Any library sheet") link to items of every library sheet; the picker searches by name, ID or reference number and shows each item's library.

## Adding a framework or a version

1. Write `templates/frameworks/<key>-<version>.json` (own-words titles, the licence note, the edition status) and import it in `src/lib/frameworks/catalogue.ts`. A new edition of a standard is a new `version` (a new file) with its own `library.packKey` (`framework-<key>-<version>`), ID prefix and `shortTitle`; both stay in the catalogue. Clause numbers and titles of a new edition are taken from at least two independent public sources; any that could not be confirmed are listed in the content review as "to verify against the purchased standard".
2. Map it in `crosswalks.json` (or a new mapping version with its own `source`). Cross-walks are never changed in the database: a corrected mapping is a new source version. A new edition also gets its edition mapping from the previous one: every old requirement to the new one(s), `equivalent` only where it is the same requirement one to one (that is what moving copies), otherwise `partial` or `related`.
3. Changing titles or guidance, or adding requirements, of a version already in the catalogue: raise its `revision` (the library pack gets a new version). Refs are never removed or renumbered (the database refuses).
4. `pnpm test` runs the integrity tests (`src/lib/frameworks/catalogue.test.ts`); `pnpm seed` writes the catalogue locally. For a hosted project, load the framework packs and the catalogue rows after the deploy (the seed's catalogue step or the generated SQL), the same way as packs.
5. A new revision reaches a workspace that adopted an older one as an update (Workspace admin › Frameworks › Update available, docs/11 Upgrades): titles, purpose, guidance, audit questions and typical evidence are reworded, new requirements are added with their keys, no requirement is removed, and the workspace's applicability, justification, status, owner and evidence stay. Moving to a new edition (a new `version`) is not an upgrade: adopt the new edition and move (Moving to a new edition). Changing only the edition status is not a revision either.
