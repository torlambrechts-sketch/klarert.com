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
  | { type: 'workflow.event'; sheetId; itemId; kind: 'decided' | 'approved' | 'rejected'; workflowId; instanceId; stepIndex; stepId; decision; actor }
  | { type: 'subitem.event';  sheetId; itemId; subitemId; event /* the sub-item's item.created | value.changed */ };
// actor = { kind: 'user' | 'automation' | 'form' | 'system', id }
```
A command emits one `value.changed` per changed field. For computed number fields (formula, rollup, riskmatrix score, progress) the runner computes before/after projections for every number trigger on that sheet, so "Residual score goes above 12" works even though the score is not stored.

A sub-item's `item.created` and `value.changed` are also **projected** onto its parent as `subitem.event` (parent sheet, parent item) at the **same depth**; only actions go one level deeper, so the loop guard covers child → parent → children chains. The parent's world is read again after a sub-item changes.

## 3. Triggers (18)

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
| `workflow_step_decided` | — | `{ "type": "workflow_step_decided", "workflowId": null, "decision": null }` | a person approves or rejects a step of an approval workflow (§13). `workflowId` null = any workflow of the sheet; `decision` `approved` / `rejected` narrows it | — (sheet with an approval workflow) |
| `workflow_approved` | — | `{ "type": "workflow_approved", "workflowId": "document-approval" }` | the last step is approved: the workflow ends approved | — |
| `workflow_rejected` | — | `{ "type": "workflow_rejected", "workflowId": null }` | a rejection ends the workflow (back to draft or closed; a rejection that sends the item back to a step does not) | — |
| `approval_overdue` | — | `{ "type": "approval_overdue", "workflowId": null }` | scheduled: the step an item waits at passed its time limit (SLA). Once per instance, round and step (§8) | — |

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

## 5. Actions (16)

Actions run in array order. Each produces a step with outcome `done`, `no_change`, `blocked`, `failed` or `skipped`.

| id | Prototype id | JSON | Does |
|---|---|---|---|
| `set_field` | `set` | `{ "type": "set_field", "fieldKey": "status", "value": "opt_stuck" }` | sets a stored field through `set_item_values` (validation + status rules apply; a blocked rule = `blocked`). Value tokens: `"$today"`, `"$in:14"` (days), `"$actor"` (person who caused the chain; people fields), `"$empty"`, or a literal valid for the type (option id, number, ISO date …). `"template": true` renders a text value as a message template (§6) first, e.g. `"{requirement} {name}: {requirement_guidance}"` to keep the wording a check was answered against (packs set it; the builder writes literals) |
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
| `sync_requirement_checks` | — | `{ "type": "sync_requirement_checks", "sheetId": "<checks sheet>", "notifyFieldKey": "owner" }` | keeps one check item per subject (a supplier) and library requirement (see below). On a subject: adds the missing checks, flags the ones that no longer apply. On a library requirement: re-syncs that requirement across every subject, batched. Message "Added 4, flagged 1" |

| `start_workflow` | — | `{ "type": "start_workflow", "workflowId": "document-approval" }` | submits the item to one of its sheet's approval workflows (§13) through `workflow_submit` as the automation. The person who started the chain is the submitter (they cannot approve it). Already waiting, turned off, a required field empty or a step without approvers = `blocked` with the reason; a workflow that no longer exists = `failed` |

**`sync_requirement_checks`** (`src/engine/automations/requirement-sync.ts`, docs/11 Supplier management). The checks sheet has two link fields, to the subjects and to a library, and `settings.uniqueLinkPair` on them (0037). Field keys and option ids are settings with the supplier pack's names as defaults (`subjectLinkKey`, `requirementLinkKey`, `statusKey`, `sourceKey`, `noteKey`, `status`, `source`, `categoryKey`, `criticalityKey`, `personalDataKey`, `manualKey`, `appliesKey`, `categoriesKey`, `minCriticalityKey`, `applies`, `limit`). The planner makes one effect; the runner reads the library, the subjects and their checks and asks the pure `planRequirementSync`:
- A requirement applies by its **Applies to**: every subject, by category (any of the listed, matched by option or by name; none = all) and minimum criticality (rank), the Art. 28 set (subjects that process personal data, whatever their category), or only when added by hand. Without a mode it is rule-based when it names a category or criticality, else by hand (requirements a workspace added before 1.1.0 never apply to everyone). Category and criticality rules wait until the subject has both; the Art. 28 set does not.
- Requirements in the subject's own requirement field (`manualKey`) are added with the source *Added manually*.
- **Creates** the missing checks (status *Not checked*, the source *Rule*, *Art. 28* or *Added manually*, named after the requirement) through `create_link_pair_items` in batches of 50: the database skips a pair that already has a check, so a sync is idempotent. At most `limit` (200) per run; the rest are said ("37 more on the next sync").
- **Flags** checks of source Rule or Art. 28 that no longer apply: status *No longer applies* and the reason in the sync note ("The category or criticality no longer matches the requirement.", "The supplier no longer processes personal data."). Never deleted; evidence and dates are never touched. A check a person added by hand is never flagged; *Not applicable* (a person's decision, with reason and approver) is never touched or reopened. A check the sync flagged that applies again goes back to *Not checked* ("Applies again.").
- When added checks lower the share met (Met out of the checks that are not Not applicable or No longer applies) of a subject that had one, the people in `notifyFieldKey` are told and the notice is posted on the subject.
- Created checks emit `item.created` and the subject's side of the two-way link `links.changed` (depth + 1), so roll-ups and number triggers follow.

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
  - `evidence_expiring`: earliest `valid_until` − days; occurrence = that date.
  - `approval_overdue`: the current step's due moment (`workflow_instances.step_due_at`, §13); occurrence = `approval:<instance>:<round>:<step>`, so the same step fires once and again only when a rejection sends the item back to it (`planApprovalFirings`, `src/engine/approvals/schedule.ts`). With `source: 'item_files'` (no field) it watches the files of the item's Files tab instead of an evidence field; the builder offers it as "Item files (Files tab)" on every sheet.
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

## 13. Approval workflows

Owner-approved (14 Nov 2026), built after the MVP. An approval workflow is **data per sheet** (`sheets.settings.workflows`, at most 10 per sheet, 10 steps each; shape and checks in `src/engine/approvals/definition.ts`). Nothing in the code knows a document, a CAPA or a pack: packs ship workflows in their manifests (docs/11).

```json
{ "id": "document-approval", "name": "Document approval", "enabled": true,
  "requiredFields": ["document_id", "owner"], "allowSelfApproval": false, "lockOnApproval": true,
  "stepField":   { "fieldKey": "approval_step", "draft": "opt_step_draft", "approved": "opt_step_approved", "rejected": "opt_step_rejected" },
  "statusField": { "fieldKey": "status", "onSubmit": "opt_review", "onApproved": "opt_approved", "onRejected": "opt_draft" },
  "steps": [
    { "id": "owner-review", "name": "Owner review", "approvers": { "kind": "field", "fieldKey": "owner" },
      "mode": "any", "sla": { "amount": 5, "unit": "days" }, "onReject": { "to": "draft" }, "optionId": "opt_step_review" },
    { "id": "management-approval", "name": "Management approval",
      "approvers": { "kind": "jobRole", "roleId": null, "roleName": "Top management" },
      "mode": "any", "sla": { "amount": 10, "unit": "days" }, "onReject": { "to": "step", "stepId": "owner-review" } } ] }
```

- **Approvers** per step: named people (`people`, user ids), the people in a people field of the item (`field`), everyone whose job title is a job role (`jobRole`, by id with the name kept, as `notify` resolves job roles), or anyone in a team (`team`, by id with the name kept). The item owner's manager is not modelled, so it is not a rule. **Mode**: any one approves, or all must. **SLA**: hours or days (calendar). **On reject**: back to this or an earlier step (a new round there), back to draft, or close as rejected.
- **Required fields** must be filled before submitting (stored values, links, current files). **Step field**: a `workflowstep` field shows where the item is (read-only to people: only automations and the approval RPCs write it); the editor maps each step to an option by name and adds missing ones. **Status field**: an option field the workflow sets when submitted, approved and rejected, as the person acting: the field's status rules apply (checked by the command; the decision's or the submission's comment gives a required comment), the documents register's approval rules apply (a version note, a current file, never the author: `_document_transition`), and the sub-item close gate applies. **Lock on approval** locks the item (`item.locked`, reason "Approved: <workflow>").
- **Self-approval block**: unless `allowSelfApproval`, the person who submitted is never an approver of their own submission: they are left out of every step's approvers, and a step left with nobody is refused at submit ("Step 1, Review: you are the only approver and cannot approve your own submission."). The database checks it again on every decision.
- **Submit** (the item panel's Submit for approval, editors; owners and admins also on a locked item; or the `start_workflow` action): one instance in progress per item. The approvers of **every** step are resolved and fixed at submit (`workflow_instances.approvers`), so who decides cannot drift during an approval; withdraw and submit again to pick up changes. An approver who cannot read the item, or an auditor, is **reported** at submit and the submission refused ("Step 2, Approval: Vic Viewer cannot open this sheet. Give them access or change the approvers."), never skipped.
- **Decide** (people only, never automations): an approver of the current step with read access (view access is enough; approvers need not edit the sheet), once per step and round; rejecting needs a comment. Any one: the step completes. All: when every approver of the step has approved in this round. Then the next step starts (its approvers told, its SLA started) or the workflow ends approved. A rejection follows the step's `onReject`. **Withdraw**: the submitter, or an owner or admin.
- **Writes**: `workflow_submit`, `workflow_decide` and `workflow_withdraw` (docs/02 §19) write the instance, the decision, the item's own changes (step field, status, lock) and the activity log entries in **one transaction**, so every decision is in the item's hash chain: `workflow.submitted`, `workflow.decided` (who, step, round, decision, comment as the note), `workflow.approved`, `workflow.rejected`, `workflow.withdrawn`, plus `value.changed` and `item.locked` entries as the person.
- **Events and automations**: after the RPC commits, the command emits `workflow.event` (kind `decided` for every decision, then `approved` or `rejected` when it ended) and one `value.changed` per field the move changed, and runs the automations at depth 0 like any person's change; the loop guard and once-per-chain apply. `start_workflow`'s field changes are events one level deeper, as for every action. `approval_overdue` is fired by the scheduler.
- **Notifications** (kind `notify`, the notifications guard applies): the approvers of a step when it starts ("Approval needed: ISD-003 Information security policy · step 2, Management approval (Document approval)"), the submitter when it ends or is sent back.
- **The engine** (`src/engine/approvals`, pure, unit-tested) mirrors the database's rules for previews, the inbox and the timeline: `resolveApprovers`, `stepApprovers` (self-approval block), `submitCheck`, `decide`, `decisionProblem`, `slaDue`, `isApprovalOverdue`, `stepOption`, `approvalState`, `approvalTimeline`, `inboxRows`, `planApprovalFirings`. The database holds the truth.
