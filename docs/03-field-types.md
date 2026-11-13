# 03 · Field types (58)

Every column is a field of one of these types. A type is defined **once** in `src/engine/fields/<type>.ts` (pure logic) and once in `src/components/fields/<type>.tsx` (cell, editor, config form). Nothing else in the code base may branch on a field type.

Reference behaviour: `reference/sheets-mvp.html` implements the first 57 (search its source for `case "<type>"`). This document wins where they differ.

## 1. The contracts

```ts
// src/engine/fields/types.ts  (pure)
export type ValueKind =
  | 'text' | 'number' | 'date' | 'daterange' | 'option' | 'ordered' | 'multi' | 'people'
  | 'boolean' | 'link' | 'file' | 'signature' | 'none';

export interface FieldTypeDef<V = unknown, C = unknown> {
  id: FieldTypeId;                     // 'text' | 'status' | …  (58 ids, same list as field_types() in SQL)
  label: string;                       // UI name, e.g. "Risk matrix"
  family: 'basic' | 'choice' | 'compliance' | 'computed';
  description: string;                 // one line, shown in the add-field picker
  storage: 'values' | 'links' | 'files' | 'protected' | 'computed' | 'none';
  kind: ValueKind;                     // drives filters, conditions, summaries, sort
  valueSchema: z.ZodType<V>;
  configSchema: z.ZodType<C>;
  defaultConfig(): C;
  defaultWidth: number;
  formAllowed: boolean;                // can appear on a form
  kanbanCapable: boolean;              // can be the lane field
  calendarCapable: boolean;            // can drive the calendar
  triggers: TriggerId[];               // which automation triggers may use this field (docs/04 §3)

  normalize(input: unknown, cfg: C, ctx: Ctx): V | null;     // from editor, paste, CSV, automation; null = empty
  parseText(text: string, cfg: C, ctx: Ctx): V | null;       // paste from Excel/Sheets and CSV import
  validate(v: V | null, field: Field<C>, item: Item, ctx: Ctx): Issue[];   // type-specific rules only
  compute?(item: Item, field: Field<C>, ctx: Ctx): V | null; // computed types
  isEmpty(v: V | null): boolean;
  isDone?(v: V | null, cfg: C): boolean;                     // label types: option.done
  toText(v: V | null, cfg: C, ctx: Ctx): string;             // display, search, templates, CSV export
  toNumber(v: V | null, cfg: C, ctx: Ctx): number | null;    // sums, conditions, formulas
  toDate(v: V | null, cfg: C, ctx: Ctx): string | null;      // ISO date: calendar, "date is" triggers, My work
  compare(a: V | null, b: V | null, cfg: C, ctx: Ctx): number;   // sort; empty last
}

export interface Ctx {                 // injected; never read globals
  today: string; now: Date; timeZone: string; userId: string;
  people: Map<string, Person>; teams: Map<string, Team>; jobRoles: Map<string, JobRole>; sites: Map<string, Site>;
  sheet: Sheet; fieldsByKey: Map<string, Field>;
  links(itemId: string, fieldId: string): string[];           // target item ids, ordered
  item(id: string): Item | undefined;                         // any item in the workspace cache
  files(itemId: string, fieldId: string): FileRow[];          // current versions
  sheetOf(itemId: string): Sheet | undefined;
}

// src/components/fields/registry.tsx (UI)
export interface FieldTypeUI<V, C> {
  Cell: React.FC<{ value: V | null; field: Field<C>; item: Item; ctx: Ctx; density: 'grid' | 'list' }>;
  Editor: React.FC<{ value: V | null; field: Field<C>; item: Item; ctx: Ctx; onCommit(v: V | null): void; onCancel(): void }>;
  ConfigForm: React.FC<{ config: C; onChange(c: C): void; sheet: Sheet }>;
  icon: LucideIcon;
}
```

Generic validation (not per type) runs first: `required`, `validation.min/max` (number kinds: value; text kinds: length; multi/people/link/file: count), `validation.pattern` (text kinds, JS regex, max 200 chars), `validation.unique` (text, number, email, url, phone: unique among non-archived items of the sheet; checked in the command with a SQL query). Then `def.validate`. Then status rules and comment-on-value (§6).

## 2. Common field properties

| Property | Column | Notes |
|---|---|---|
| name, key | `name`, `key` | key generated once from the name |
| description | `description` | help text in panel and form |
| required | `required` | blocks save of a new item from a form (a form may override it per question); public forms never ask file fields (`evidence`, `attachment`) or directory fields (`people`, `team`, `role`, `entity`): `publicFormEligible` in `src/engine/fields/view-support.ts`; in grid shows a red corner on empty cells and the item is listed under "Missing required" |
| default value | `config.default` | applied on create (any value type); `today`, `me`, `in N days` tokens allowed |
| validation | `validation` | `{ min?, max?, pattern?, unique?, maxLength? }` |
| status rules | `rules` | §6 |
| comment on value | `rules` with `requireComment` | §6 |
| visibility | `visibility` | `{ fieldKey, op, value }`; hides in panel/form only |
| width | `width` | grid px |
| locked | `locked` | packs set it; only admins edit or delete; editors can hide it in a view |

Option model for label types (`status`, `dropdown`, `multiselect`, `severity`, `classification`, `workflowstep`):
```json
{ "options": [ { "id": "opt_7k2", "label": "Done", "color": "green", "done": true } ] }
```
`id` is generated (`opt_` + 3–6 chars) and never changes; order of the array = order in pickers and kanban; `done: true` marks completion (My work, overdue, progress). Colours: `grey, blue, navy, teal, green, yellow, orange, red, pink, purple, dark` (tokens in docs/05).

## 3. Catalogue

`V` = stored JSON value in `items.values[field_id]` (or elsewhere when noted). Config shows defaults. Kind drives filters (§4).

### 3.1 Basic input (18)

| id | Label | V (JSON) | Config (defaults) | Kind | Notes |
|---|---|---|---|---|---|
| `text` | Text | `"string"` ≤ 500, trimmed | `{}` | text | single-line editor |
| `longtext` | Long text | `"string"` ≤ 20 000, keeps line breaks | `{}` | text | grid shows first line + "…"; editor popover with textarea; conflict check on save |
| `comment` | Comment | `{"text":"…","by":"<userId>","at":"<ISO>"}` | `{}` | text | editor stamps `by`/`at`; display "text — Maria, 11 Nov" |
| `number` | Number | `12.5` | `{"unit":"","decimals":2}` (optional `"bands":[5,10,15]`) | number | display with unit, `en-GB` grouping; with `bands` (three ascending thresholds) the Table shows a four-bar meter after the number (`meterStep`: step 1 ≤ b0 < 2 ≤ b1 < 3 ≤ b2 < 4) |
| `value` | Value | `{"amount":1200,"currency":"EUR"}` | `{"currency":"EUR","allowOther":false}` | number | ISO 4217; `toNumber` = amount |
| `percent` | Percentage | `0`–`100` | `{"bar":true}` | number | bar in cell when `bar` |
| `yesno` | Yes / No | `"yes" \| "no" \| "na"` | `{"allowNA":true}` | option | fixed options Yes (green, done), No (red), N/A (grey, done) |
| `check` | Checkbox | `true \| false` | `{}` | boolean | space toggles in grid |
| `date` | Date | `"2026-11-11"` | `{"relative":true}` | date | cell shows "11 Nov · in 3 days"/"2 days overdue" when the item's status is not done; `parseText` accepts ISO, `dd/mm/yyyy` (en-GB workspace locale), `11 Nov 2026` and Excel serial numbers |
| `datetime` | Date and time | `"2026-11-11T14:20:00Z"` (UTC) | `{}` | date | shown in user time zone |
| `duration` | Duration | `{"n":3,"unit":"days"}` | `{"unit":"days"}` | number | units `hours, days, weeks, months, years`; `toNumber` = days (month = 30.4, year = 365) |
| `timeline` | Timeline | `{"start":"2026-11-01","end":"2026-11-20"}` | `{}` | daterange | end ≥ start; `toDate` = end; calendar spans |
| `recurrence` | Recurrence | `{"every":1,"unit":"months","start":"2026-01-15"}` | `{}` | date | `toDate` = next occurrence ≥ today; text "Every month · next 15 Dec" |
| `rating` | Rating | integer `1`–`scale` | `{"scale":5}` (3–10) | number | stars; click same star clears |
| `email` | Email | `"name@example.com"` (lower-case) | `{}` | text | mailto link |
| `phone` | Phone | `"+447700900123"` (E.164) | `{"defaultCountry":"GB"}` | text | `libphonenumber-js`; display national format |
| `url` | URL | `"https://…"` | `{}` | text | show host; `http` upgraded to `https` on normalise |
| `location` | Location | `{"siteId":"<uuid>","note":"Press shop line 3"}` | `{}` | option | site from workspace sites; note free text |

### 3.2 Choice and people (10)

| id | Label | V | Config | Kind | Notes |
|---|---|---|---|---|---|
| `status` | Status | `"opt_…"` | options: Not started (grey), Working on it (orange), Stuck (red), Done (green, done) | option | lane field for Kanban; status rules; cell = filled colour block in Grid, pill in List (docs/05 §6) |
| `dropdown` | Dropdown | `"opt_…"` | options: Option 1–3 | option | chip |
| `multiselect` | Multi-select | `["opt_…"]` | options | multi | chips, max 3 shown + "+2" |
| `people` | People | `["<userId>"]` | `{"multiple":true}` | people | avatars; "me" token; assignment notifies (docs/04 `assign`) |
| `role` | Role | `"<jobRoleId>"` | `{}` | option | from workspace job roles |
| `team` | Team | `"<teamId>"` | `{}` | option | from workspace teams |
| `entity` | Entity and site | `{"entityId":"<uuid>","siteId":"<uuid>\|null"}` | `{}` | option | "Meridian Components Ltd · Leeds" |
| `country` | Country | `"GB"` (ISO 3166-1 alpha-2) | `{}` | option | English short names |
| `classification` | Classification | `"opt_…"` | ordered: Public (green), Internal (blue), Confidential (orange), Restricted (red) | ordered | supports "at least" |
| `severity` | Severity | `"opt_…"` | ordered: Low (green), Medium (yellow), High (orange), Critical (red) | ordered | supports "at least"; High/Critical shown solid with "!" |

### 3.3 Compliance (19)

| id | Label | V / storage | Config | Kind | Notes |
|---|---|---|---|---|---|
| `requirement` | Requirement | `item_links` | `{"targetSheetId":"<library sheet>","multiple":true,"inverseFieldId":null}` | link | target must be `is_library`; chips show display id |
| `controllink` | Control link | `item_links` | same as requirement | link | same, labelled "Controls" |
| `evidence` | Evidence | `files` | `{"validDays":365,"multiple":true,"accept":[]}` | file | freshness: current / expiring (≤ 30 days) / expired; `toDate` = earliest `valid_until`; text "2 files · expiring" |
| `attachment` | Attachment | `files` | `{"multiple":true,"accept":[]}` | file | no expiry |
| `signature` | Signature | `{"by":"<userId>","at":"<ISO>","meaning":"Approved","hash":"<sha256>"}` | `{"meaning":"Approved","clearOnChange":true}` | signature | "Sign" button: confirm dialog with the meaning; `hash` = SHA-256 of the item's values at signing; when `clearOnChange`, any later value change clears the signature (logged) |
| `ack` | Acknowledgement | `[{"userId":"…","at":"<ISO>","version":"v1.2"}]` | `{"audience":{"userIds":[],"teamIds":[],"jobRoleIds":[]},"versionFieldKey":null}` | number | panel shows "I have read this" to people in the audience; `toNumber` = % acknowledged of audience; a new version (version field changes) resets |
| `justification` | Justification | `"string"` ≤ 2 000 | `{"whenFieldKey":"applicability","whenValues":["not_applicable"]}` | text | required (blocking) when the referenced field has one of the values |
| `applicability` | Applicability | `{"applicable":false,"reason":"…"}` | `{"reasonRequiredWhenNot":true}` | option | options Applicable / Not applicable (both done) |
| `finding` | Finding | `"opt_…"` | ordered fixed: Conformity (green, done), Observation (blue), Opportunity for improvement (teal), Minor nonconformity (orange), Major nonconformity (red) | ordered | audit verdict |
| `checklist` | Checklist | `{"answers":{"<lineId>":{"a":"yes\|no\|na","note":"…","by":"<userId>","at":"<ISO>"}}}` | `{"lines":[{"id":"l1","text":"First check","noteOnNo":true}]}` | number | `toNumber` = score % = yes / (yes + no); progress = answered / lines; trigger "an answer becomes No" |
| `question` | Question | `"opt_…"` | `{"question":"How well is this in place?","options":[{"id":"q0","label":"Not in place","score":0},{"id":"q1","label":"Partly","score":1},{"id":"q2","label":"Fully","score":2}],"weight":1}` | option | `toNumber` = score × weight |
| `riskmatrix` | Risk matrix | `{"l":4,"i":5}` | `{"size":5,"bands":[4,9,15],"likelihoodLabels":[],"impactLabels":[]}` | number | `toNumber` = l × i; level Low ≤ 4 < Medium ≤ 9 < High ≤ 15 < Critical; editor = size×size grid; Table cell = score and a four-bar meter by level (`riskStep`) |
| `maturity` | Maturity | integer `0`–`5` | labels None, Initial, Repeatable, Defined, Managed, Optimised | ordered | ≥ 3 counts as done |
| `measurement` | Measurement | `[{"at":"2026-11-01","v":12.5,"by":"<userId>","note":""}]` | `{"unit":"","target":null,"direction":"down"}` | number | `toNumber` = latest reading; cell = latest + sparkline of **real** readings + on/off target |
| `clock` | Statutory clock | computed | `{"startFieldKey":null,"hours":72,"stopFieldKey":null}` | date | states: not started, running (time left), warning (< ⅓ left), overdue, met, missed; `toDate` = deadline; trigger "clock has less than N hours" |
| `protected` | Protected text | `protected_values` | `{"allowedUserIds":[]}` | none | others see "Restricted"; excluded from search, templates, CSV export and activity values (log stores the action only) |
| `pdmarker` | Personal data marker | `["identity","health"]` | fixed categories: identity, contact, financial, location, images, employment, health*, biometric*, beliefs*, union*, allegations, criminal* | multi | * = special category (red chip) |
| `retention` | Retention | `{"hold":false,"holdReason":""}` | `{"years":6,"fromFieldKey":null}` | date | `toDate` = from + years unless on hold; text "Delete after 3 Jan 2032" / "Legal hold" |
| `version` | Version | `"v1.2"` (`^v\d+\.\d+$`) | `{}` | text | compare numerically; action "raise version" (docs/04) |

### 3.4 Linked, computed and system (11)

| id | Label | V / storage | Config | Kind | Notes |
|---|---|---|---|---|---|
| `link` | Link to items | `item_links` | `{"targetSheetId":"<uuid>","multiple":true,"inverseFieldId":null}` | link | two-way when `inverseFieldId` set (the wizard creates the inverse field on the target sheet) |
| `lookup` | Lookup | computed | `{"linkFieldKey":"…","targetFieldKey":"…"}` | (target's kind) | array of target values; text joins with ", " |
| `rollup` | Rollup | computed | `{"linkFieldKey":"…","targetFieldKey":null,"fn":"count"}` | number (`worst`: text, `earliest`: date) | fn: `count, sum, avg, min, max, pctDone, countEmpty, countWhere` (+ `where: {op,value}`), `worst` (least finished option: not done beats done, then higher rank or later option), `earliest` (minimum date, "20 Nov 2026"), `countExpired` (targets with expired evidence). Works over link fields and the sub-items column |
| `formula` | Formula | computed | `{"expr":"","result":"auto"}` | by result | §7 |
| `progress` | Progress | computed | `{"sourceFieldKey":"…"}` | number | checklist → answered %; link types → % of targets whose status is done |
| `autoid` | Auto ID | `items.display_id` | `{}` | text | read-only |
| `meta` | Created and updated | `items` columns | `{"which":"created_at"}` (`created_at, created_by, updated_at, updated_by`) | date / people | read-only |
| `workflowstep` | Workflow step | `"opt_…"` | options: Draft, Review, Approval, Done (done) | option | only automations may set it (enforced in SQL) |
| `button` | Button | none | `{"label":"Run","confirm":null}` | none | click emits `button` event (docs/04) |
| `subitems` | Sub-items | computed (the child sheet's rows, docs/02 §12) | `{}` | link | "3/5" done; read-only; `relatedIds` = live sub-items, so rollup, lookup and progress read them like link targets. Created by "Turn on sub-items" (`addable: false`, not in the add-field picker); not on forms |
| `ai` | AI proposal | `{"proposal":<any>,"source":"…","model":"…","status":"proposed\|accepted\|rejected","by":"<userId>","at":"<ISO>"}` | `{"targetFieldKey":"…"}` | option | Accept copies the proposal into the target field through the normal command (validated, logged); generation is out of scope |

Counts: basic 18 · choice 10 · compliance 19 · computed 11 = **58**. Unit test: the registry has exactly the 58 ids of `field_types()` (latest definition, 0020).

Default widths (px): text 180, longtext 220, comment 200, number 96, value 120, percent 96, yesno 90, check 76, date 120, datetime 150, duration 100, timeline 170, recurrence 170, rating 110, email 180, phone 140, url 170, location 170, status 140, dropdown 130, multiselect 180, people 110, role 140, team 120, entity 200, country 140, classification 130, severity 110, requirement 180, controllink 160, evidence 150, attachment 120, signature 170, ack 130, justification 200, applicability 150, finding 170, checklist 150, question 160, riskmatrix 130, maturity 130, measurement 150, clock 150, protected 130, pdmarker 180, retention 160, version 90, link 180, lookup 160, rollup 110, formula 130, progress 130, autoid 100, meta 150, workflowstep 140, button 140, ai 180, subitems 110.

Form-allowed: all except `lookup, rollup, formula, progress, autoid, meta, workflowstep, button, ai, clock, signature, ack, subitems`.
Kanban-capable: `status, dropdown, severity, classification, finding, workflowstep, yesno, maturity, people (single)`.
Calendar-capable: `date, datetime, timeline, recurrence, evidence (expiry), clock (deadline), retention`.

Files can also belong to an item without a field (its Files tab, docs/02 §8); they are not a field value and never pass through the registry. Evidence expiry automations can watch them (`evidence_expiring` with `source: 'item_files'`, docs/04).

## 4. Filters and conditions (one operator set per kind)

Filters (views) and automation conditions (docs/04 §4) use the same operators, implemented once in `src/engine/conditions/`.

| Kind | Operators |
|---|---|
| text | `is`, `is_not`, `contains`, `not_contains`, `starts_with`, `is_empty`, `is_not_empty` |
| number | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `is_empty`, `is_not_empty` |
| date / daterange | `is`, `before`, `after`, `on_or_before`, `on_or_after`, `between`, `is_today`, `next_days` (N), `last_days` (N), `overdue` (date < today and item not done), `is_empty`, `is_not_empty` (daterange compares end unless the operator says start) |
| option | `is_any_of`, `is_none_of`, `is_done`, `is_not_done`, `is_empty`, `is_not_empty` |
| ordered | option operators + `at_least`, `at_most` |
| multi | `has_any_of`, `has_all_of`, `has_none_of`, `is_empty`, `is_not_empty` |
| people | `includes_any_of`, `includes_me`, `excludes`, `is_empty`, `is_not_empty` |
| boolean | `is_checked`, `is_not_checked` |
| link | `has_any`, `has_none`, `includes_item`, `count_gt`, `count_lt` |
| file | `has_files`, `has_none`, `freshness_is` (current/expiring/expired), `expires_within` (N days) |
| signature | `is_signed`, `is_not_signed`, `signed_by` |

Condition JSON: `{ "fieldKey": "status", "op": "is_any_of", "value": ["opt_7k2"] }`. Special keys: `__name` (text), `__group` (option of group ids), `__id` (text).

Server-side filtering (sheets > 2 000 items): `src/server/query/filters.ts` turns conditions into SQL on `items.values`, e.g. option `is_any_of` → `values->>'<fid>' = any($1)`; number `gt` → `(values->>'<fid>')::numeric > $1`; date `before` → `values->>'<fid>' < $1`; people `includes_me` → `values->'<fid>' ? $uid`; link → `exists (select 1 from item_links …)`. Computed fields (formula, rollup, lookup, progress, clock) filter on the client only; the UI says "Filters on calculated columns apply to loaded items".

## 5. Changing a field's type

Allowed in place (values converted by `parseText(toText(v))`, preview first: "38 of 40 values convert, 2 become empty"):
- text ↔ longtext ↔ email ↔ url ↔ phone ↔ justification
- number ↔ percent ↔ rating (clamped) ↔ value (amount)
- status ↔ dropdown ↔ severity ↔ classification ↔ finding ↔ workflowstep (options matched by label, missing labels added)
- dropdown ↔ multiselect
- date ↔ datetime; date → timeline (start = end = date)
- check ↔ yesno
- link ↔ requirement ↔ controllink (only if the target is a library)
- any value type → text

Everything else: "Create a new field and copy values" (same preview). Computed types cannot be converted to or from.

## 6. Status rules, comment on value, visibility, justification

```json
"rules": [
  { "id": "r1", "whenFieldKey": "status", "whenValues": ["opt_done"], "require": ["root_cause", "evidence"],
    "message": "Add the root cause and evidence before closing." },
  { "id": "r2", "whenFieldKey": "status", "whenValues": ["opt_stuck"], "requireComment": true }
]
```
- `fromDone: true`: the rule applies only when the field leaves a done value (the sub-item sets ask for a comment when a done sub-item is reopened; N/A asks for a reason).
- Rules live on the field that changes (`whenFieldKey` = this field's key) and are checked in the command before the RPC.
- `require`: listed fields must be non-empty (per `isEmpty`); otherwise the change is **blocked** and the message is shown (toast in grid, inline in panel). Automations hitting a rule get outcome `blocked` in the run log.
- `requireComment`: the editor opens a comment box; the comment is posted as an update and copied into the activity entry's `note`. Automations skip `requireComment` and post "Set by automation …" as the note.
- Visibility: `{ "fieldKey": "type", "op": "is_any_of", "value": ["opt_injury"] }` — hides the field in panel and form; required + hidden = not required.
- `justification` fields are required while their trigger condition holds (blocking, like a rule).

## 7. Formula language

- References: `{field_key}`, plus `{name}`, `{id}` (display id), `{group}` (group name).
- Literals: numbers `12.5`, strings `"text"`, `TRUE`, `FALSE`.
- Operators: `+ - * / %`, `&` (concatenate), `= <> < > <= >=`, parentheses. `+` adds numbers, concatenates if either side is text.
- Functions: `IF(cond, a, b)`, `AND(…)`, `OR(…)`, `NOT(x)`, `ROUND(x, d)`, `ABS(x)`, `MIN(…)`, `MAX(…)`, `TODAY()`, `DAYS(a, b)` (a − b in days), `ADDDAYS(date, n)`, `CONCAT(…)`, `LEN(x)`, `EMPTY(x)`.
- A reference becomes: `toNumber` for number kinds, `toDate` (ISO) for date kinds, nested formula result for formulas, `toText` for everything else. Empty → `""`.
- Result type `auto`: number if numeric, date if `^\d{4}-\d\d-\d\d$`, boolean if boolean, else text. Can be pinned in config.
- Errors (shown in grey italics with a tooltip): `#REF` unknown field, `#LOOP` cycle or depth > 4, `#ERR` syntax or runtime, `#DIV0`.
- Parser: hand-written tokenizer + recursive descent (port `fxTok`/`fxEval` from the prototype). **Never** `eval` or `new Function`.
- Editor: monospace input with autocomplete for `{` (field keys) and function names; live preview on the first item.

## 8. Summaries (grid group footer and List footer)

| Kind | Default | Options in the column menu |
|---|---|---|
| number | sum (percent, rating, riskmatrix: average) | sum, average, median, min, max, count filled |
| option / ordered | distribution bar coloured by option, hover shows counts | — |
| multi / people | count filled | distinct count |
| date / daterange | earliest – latest | count overdue |
| boolean | % checked | count checked |
| file | freshness distribution | count with files |
| link | total links | items with links |
| text / other | count filled | — |

## 9. Tests (per type, in `src/engine/fields/<type>.test.ts`)

At least: normalise valid input, reject invalid input, `parseText` three samples (including an Excel-style value), `toText`, `toNumber`, `toDate`, `compare` with empties, `isEmpty`, `isDone` where defined, config schema defaults, and one type-specific rule (e.g. riskmatrix level bands, checklist score, clock states with an injected `now`, retention with hold, signature cleared on change).
