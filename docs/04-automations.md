# 04 · Automations and triggers

An automation belongs to one sheet: **When** *trigger* · **if** *conditions* · **then** *actions*. It runs on every matching event, logs every run, can cause other automations to run (up to depth 3), and writes through the same commands as people, so everything lands in the activity log.

Reference behaviour: `reference/sheets-mvp.html` (functions `fire`, `trigMatch`, `condsOk`, `doAct`, `runScheduler`). Ids below are the canonical ones; the prototype's short ids are listed for mapping.

## 1. Architecture

```
command (user/form/button) ──► RPC commits ──► events[] ──► runner (server)
                                                         │  for each event: automations of the sheet
                                                         │    enabled, not paused for the item, trigger matches
                                                         │    conditions true (on the item after the change)
                                                         │    plan actions (pure)  ──► execute effects (RPCs, notifications, queue)
                                                         │    effects emit new events (depth + 1) ──► loop until depth 3
                                                         └► automation_runs rows + messages for the toast
cron /api/cron/scheduler (every 15 min) ──► date / clock / evidence triggers ──► same runner (depth 0)
cron /api/cron/webhooks  (every 5 min)  ──► outbound_webhooks queue with retries
```

- `src/engine/automations/` (pure): `matchTrigger(trigger, event, ctx)`, `checkConditions(conditions, item, ctx)`, `planActions(actions, item, event, ctx) → Effect[]`, `renderTemplate(text, item, ctx)`. Unit-tested without a database.
- `src/server/automations/` : `runEvents(events, chainCtx)`, `executeEffect(effect)`, `scheduler.ts`, `webhooks.ts`, `effects.ts` (notifications and automation posts; the one server-only service-role use, see docs/02 §7).

## 2. Events

```ts
type AutomationEvent =
  | { type: 'item.created';   sheetId; itemId; actor }
  | { type: 'form.submitted'; sheetId; itemId; formId }
  | { type: 'value.changed';  sheetId; itemId; fieldId; before: unknown; after: unknown; actor }
  | { type: 'item.moved';     sheetId; itemId; fromGroupId; toGroupId; actor }
  | { type: 'links.changed';  sheetId; itemId; fieldId; before: string[]; after: string[]; actor }
  | { type: 'button.clicked'; sheetId; itemId; fieldId; actor }
  | { type: 'schedule';       sheetId; itemId; automationId; occurrence: string }
  | { type: 'subitem.event';  sheetId; itemId; subitemId; event /* the sub-item's item.created | value.changed */ };
// actor = { kind: 'user' | 'automation' | 'form' | 'system', id }
```
A command emits one `value.changed` per changed field. For computed number fields (formula, rollup, riskmatrix score, progress) the runner computes before/after projections for every number trigger on that sheet, so "Residual score goes above 12" works even though the score is not stored.

A sub-item's `item.created` and `value.changed` are also **projected** onto its parent as `subitem.event` (parent sheet, parent item) at the **same depth**; only actions go one level deeper, so the loop guard covers child → parent → children chains. The parent's world is read again after a sub-item changes.

## 3. Triggers (14)

| id | Prototype id | JSON | Fires when | Field types allowed |
|---|---|---|---|---|
| `item_created` | `created` | `{ "type": "item_created" }` | an item is created on this sheet (any source except form) | — |
| `form_submitted` | `form` | `{ "type": "form_submitted", "formId": null }` | a form on this sheet creates an item (`null` = any form; a form view id = that form only, chosen in the builder; templates may name a form by its `ref`) | — |
| `field_changed` | `changed` | `{ "type": "field_changed", "fieldKey": "owner" }` | the field's stored value changes (any → any, incl. cleared) | every stored type |
| `field_becomes` | `becomes` | `{ "type": "field_becomes", "fieldKey": "status", "value": "opt_done" }` | the new value matches and the old did not (transition). multi/people: the value was **added**. check: `true`/`false`. yesno: `yes/no/na`. applicability: `applicable/not_applicable` | label types, multiselect, people, check, yesno, applicability, finding, maturity, severity, classification |
| `number_above` | `above` | `{ "type": "number_above", "fieldKey": "residual", "threshold": 12 }` | `toNumber` crosses from ≤ threshold (or empty) to > threshold | number kinds incl. computed (formula, rollup, riskmatrix, progress, measurement, ack, checklist) |
| `number_below` | `below` | `{ "type": "number_below", "fieldKey": "score", "threshold": 50 }` | crosses from ≥ threshold (or empty) to < threshold | same |
| `date_arrives` | `dateis` | `{ "type": "date_arrives", "fieldKey": "review_date", "offsetDays": -30 }` | scheduled: today ≥ `toDate + offsetDays` (negative = before the date). Once per item per date value | calendar-capable types, and formulas whose result is a date (e.g. a deadline `ADDMONTHS({received_on}, 1)`) |
| `clock_warning` | `clock` | `{ "type": "clock_warning", "fieldKey": "notify_clock", "hoursLeft": 24 }` | scheduled: a running clock has fewer than N hours left. Once per item per deadline | clock |
| `evidence_expiring` | `evidence` | `{ "type": "evidence_expiring", "fieldKey": "evidence", "days": 30 }` | scheduled: the earliest `valid_until` is within N days. Once per item per expiry date | evidence |
| `button_clicked` | `button` | `{ "type": "button_clicked", "fieldKey": "send_for_approval" }` | someone clicks the button on an item | button |
| `checklist_no` | `checklistno` | `{ "type": "checklist_no", "fieldKey": "inspection" }` | the number of "No" answers increases | checklist |
| `subitem_created` | — | `{ "type": "subitem_created" }` | a sub-item is added under the item | — (sheet with sub-items) |
| `subitem_field_becomes` | — | `{ "type": "subitem_field_becomes", "fieldKey": "status", "value": "opt_stuck" }` | a sub-item's field (key of the child sheet) becomes the value | as `field_becomes`, on the sub-items' fields |
| `all_subitems_done` | — | `{ "type": "all_subitems_done" }` | fires once, on the change that makes every sub-item done | — |

Moving an item between groups emits `item.moved`. No MVP trigger listens to it; group logic uses the `__group` condition and the `move_to_group` action. An `item_moved` trigger can be added later as one registry entry, but only when asked.

Each field type lists the triggers it supports in its registry entry (`def.triggers`); the builder only offers compatible fields.

## 4. Conditions

Array, all must be true (AND). Same operators as view filters (docs/03 §4), evaluated on the item **after** the change.
```json
"conditions": [
  { "fieldKey": "severity", "op": "at_least", "value": "opt_high" },
  { "fieldKey": "__group",  "op": "is_any_of", "value": ["<groupId>"] }
]
```
Conditions referencing a deleted field make the automation invalid: it is switched off and its owner notified ("Field ‘Severity’ was deleted").

## 5. Actions (14)

Actions run in array order. Each produces a step with outcome `done`, `no_change`, `blocked`, `failed` or `skipped`.

| id | Prototype id | JSON | Does |
|---|---|---|---|
| `set_field` | `set` | `{ "type": "set_field", "fieldKey": "status", "value": "opt_stuck" }` | sets a stored field through `set_item_values` (validation + status rules apply; a blocked rule = `blocked`). Value tokens: `"$today"`, `"$in:14"` (days), `"$actor"` (person who caused the chain; people fields), `"$empty"`, or a literal valid for the type (option id, number, ISO date …) |
| `notify` | `notify` | `{ "type": "notify", "to": ["field:owner", "user:<id>", "team:<id>", "jobRole:<id>", "actor"], "message": "{id} {name} is now {status}" }` | creates `notifications` (kind `notify`) and posts an automation update on the item ("Notified Maria, James: …"). `field:` accepts a people field or a lookup of a people field. Empty recipient list = `skipped` |
| `request_update` | `request` | `{ "type": "request_update", "fieldKey": "owner", "message": "Please update {name} before {review_date}." }` | notification kind `request` to the people in the field; the request is marked done when that person next changes the item; appears under "Requests to me" in My work |
| `create_item` | `create` | `{ "type": "create_item", "sheetId": "<uuid>", "groupId": null, "name": "Follow-up: {name}", "values": { "due_date": "$in:14" }, "link": true }` | creates an item on the target sheet (first group if `groupId` null). `link: true`: if a link field between the two sheets exists (either direction), links them. Copies the first person of the source's first people field into the target's first empty people field. Emits `item.created` on the target (depth + 1) |
| `update_linked` | `updlinked` | `{ "type": "update_linked", "path": { "direction": "out", "linkFieldKey": "controls" }, "fieldKey": "status", "value": "opt_in_treatment" }` or `"path": { "direction": "in", "sheetId": "<uuid>", "linkFieldKey": "risks" }` | sets a field on every linked item (out = items this item links to; in = items on another sheet that link to this item). Each target's change emits events (depth + 1) |
| `move_to_group` | `move` | `{ "type": "move_to_group", "groupId": "<uuid>" }` | `move_item`, appended at the end of the group |
| `assign` | `assign` | `{ "type": "assign", "fieldKey": "owner", "who": "user:<id>" }` (`"actor"` allowed) | adds the person to the people field (keeps existing) and notifies them |
| `lock_item` | `lock` | `{ "type": "lock_item", "reason": "Approved" }` | `set_item_lock(true)`; people need admin to edit afterwards |
| `post_update` | `post` | `{ "type": "post_update", "message": "Checked by automation: {status}" }` | adds an item update with author "Automation" |
| `webhook` | `webhook` | `{ "type": "webhook", "url": "https://…", "preset": "teams" }` (`teams`, `slack`, `generic`) | queues an `outbound_webhooks` row; payload below; `done` means queued |
| `raise_version` | `version` | `{ "type": "raise_version", "fieldKey": "version", "kind": "minor" }` | `v1.2` → `v1.3` (minor) or `v2.0` (major); empty → `v1.0` |
| `create_subitems` | — | `{ "type": "create_subitems", "items": [{ "name": "Check {id}", "values": { "due_date": "$in:90" } }] }` or `{ "type": "create_subitems", "fromTemplate": true }` | adds sub-items under the item through `create_subitems` (≤ 50; values by child field key, tokens resolved, names templated); emits `item.created` per sub-item |
| `set_parent_field` | — | `{ "type": "set_parent_field", "fieldKey": "status", "value": "opt_done" }` | on a sub-item: sets a stored field of its parent (the gate and status rules apply) |
| `update_subitems` | — | `{ "type": "update_subitems", "fieldKey": "owner", "value": "$actor", "onlyOpen": false }` | sets a field on the item's sub-items (only those that change, open ones only on request, at most 100) |

Webhook payload (generic):
```json
{ "event": "automation", "automation": { "id": "…", "name": "…" }, "workspace": "meridian",
  "sheet": { "id": "…", "name": "Corrective actions" },
  "item": { "id": "…", "displayId": "CA-014", "name": "…", "url": "https://app…/meridian/s/<sheetId>?item=CA-014",
            "values": { "<field_key>": "<toText value>" } },
  "trigger": { "type": "field_becomes", "field": "status", "value": "Done" }, "at": "2026-11-11T14:20:00Z" }
```
`teams` and `slack` presets wrap the same content in the platform's message format (title, facts, link button). Protected fields are never included.

## 6. Templates in messages and names

`{name}`, `{id}` (display id), `{sheet}`, `{group}`, `{link}` (absolute item URL), `{actor}` (person's name), `{<field_key>}` (`toText` of the value). Unknown keys stay as written. Protected fields render as "Restricted". Rendering is pure (`renderTemplate`).

## 7. Execution rules

1. **Order:** events in emission order; for each event, automations of the sheet by `created_at`; actions in array order.
2. **Who:** writes use `p_automation = automation.id` (activity log actor = the automation). `$actor` = the person (or form/system) that started the chain.
3. **Isolation:** each effect is its own transaction. A failed or blocked action does not undo earlier actions; the run is `partial` and the step says why.
4. **Depth:** a chain starts at depth 0 (the user's change). Events caused by actions are depth + 1. At depth > 3 the runner stops, writes a run with status `stopped` ("Loop guard: chain deeper than 3"), and the toast says so.
5. **Once per chain:** the same automation never runs twice on the same item within one chain (`chain_id` + automation + item).
6. **Time budget:** 5 s per chain in a request. If exceeded, remaining events are dropped and a `stopped` run is written ("Time budget reached"). Tune later; do not move work to background in the MVP.
7. **Pauses:** `automation_pauses(automation, item)` skips that automation for that item.
8. **Archived items** emit no events and are skipped by the scheduler.
9. **Bulk edits** run the chain per item; the toast summarises ("Updated 12 items · 3 automations ran 15 times").
10. **Run log:** every executed run is stored (`done`, `partial`, `failed`, `stopped`) with its steps. Runs whose conditions were false are **not** stored (noise), except when started from the builder's Test.
11. **Counters:** `automations.run_count` and `last_run_at` updated per run (bookkeeping, not audited).
12. **Errors:** an exception in an effect = step `failed` with the message; the automation's creator gets a `system` notification at most once per hour per automation.

## 8. Scheduler (date, clock, evidence)

- Vercel Cron: `*/15 * * * *` → `GET /api/cron/scheduler` with header `Authorization: Bearer ${CRON_SECRET}`. Uses the service role.
- For each enabled automation with a scheduled trigger, load candidate items (not archived, not paused), compute the trigger moment:
  - `date_arrives`: `toDate(value) + offsetDays` (00:00 in the workspace time zone); occurrence = the date value.
  - `clock_warning`: deadline − hoursLeft; occurrence = deadline ISO.
  - `evidence_expiring`: earliest `valid_until` − days; occurrence = that date. With `source: 'item_files'` (no field) it watches the files of the item's Files tab instead of an evidence field; the builder offers it as "Item files (Files tab)" on every sheet.
- Fire when the moment has passed **and** is within the last 7 days (no flood of history when an automation is created), conditions are true, and `insert into scheduler_fired … on conflict do nothing` inserted a row (exactly once per occurrence).
- Admins can press **Run date checks now** on the Automations page (same code, as the user, only for their workspace).
- **Retention** (docs/02 §18): the same cron run checks each workspace with retention rules once a day (`retention_claim_day`) and queues due records (`retention_enqueue`); nothing is erased without a person's approval. Owners and admins have **Check now** on Workspace admin › Retention.

## 9. Webhook worker

`*/5 * * * *` → `GET /api/cron/webhooks`. Picks `queued`/`retrying` rows with `next_attempt_at ≤ now()` (limit 50, `for update skip locked`), POSTs with a 10 s timeout. 2xx → `sent`. Otherwise `attempts + 1`, backoff 1 min, 5 min, 30 min, 2 h, 6 h; after 5 failures → `dead_letter` and a `system` notification to the automation's creator. Only `https://` URLs; block private IP ranges (SSRF guard).

## 10. Builder (UI)

Sentence layout: **When** [trigger ▾] [field ▾] [value/threshold/offset] · **if** [+ condition] · **then** [+ action] (each action a row with its own pickers). Rules:
- Field pickers show only compatible fields (`def.triggers`, action requirements: `set_field` → stored types; `assign` → people; `raise_version` → version; `notify.to field:` → people fields).
- Value pickers use the field's own editor (status shows its options, dates show a date picker with tokens Today / In N days).
- Message inputs offer `{` autocomplete of template keys.
- **Test on an item**: pick an item → shows "Trigger matches? Conditions? Planned steps" from `planActions` without writing.
- Save → name auto-generated ("When Status becomes Done → notify Owner"), editable. New automations are on by default.
- Validation errors inline; cannot save an automation that would set the same field it triggers on with `field_changed` (instant loop) — show "This would trigger itself".

Automations page: list per sheet (toggle, name, trigger summary, runs, last run, source), search, sheet and on/off filters, the builder opening in place in the row, run log at `?tab=runs` and the latest runs under the list (time, automation, sheet, item link, outcome chip, detail, expandable steps), **Run date checks now** (admins). Item panel → Details shows "Automations on this item" with pause toggles.

## 11. Starter recipes

`templates/automation-recipes.json` holds recipes the builder offers under "Start from a recipe". Each recipe uses field **roles** (e.g. `{ "role": "status" }`) that the builder maps to the sheet's fields before saving.

Sub-item recipes (roles may be `sub:<type>`, a field of the sub-items): add the template set when an item is created, set the status when every sub-item is done (the optional "auto-close" rule), ask for a residual re-score when every treatment action is done, create a linked nonconformity when a clause becomes one, notify the owner when a sub-item is added.

## 12. Acceptance tests (Playwright + Vitest)

- Status → Done with a rule requiring Root cause blocks with the rule's message; after filling Root cause it saves and `field_becomes` fires.
- `number_above` on a formula (`{likelihood} * {impact}`) fires once when crossing 12, not again at 15, again after dropping to 10 and rising to 16.
- `create_item` on another sheet links back, copies the owner, and the target's `item_created` automation runs (depth 1). A three-sheet ping-pong stops at depth 3 with a `stopped` run.
- `date_arrives` with `offsetDays: -30` fires once from the scheduler; running it again does nothing; changing the date fires again for the new date.
- `button_clicked` runs; button shows a spinner and the toast lists the steps.
- Locked item: a person (editor) cannot edit; `set_field` by an automation can; both appear in the activity log with the right actor.
- Webhook to a failing URL retries with backoff and ends in `dead_letter`; the creator is notified.
- Paused automation does not run for that item but runs for others.
