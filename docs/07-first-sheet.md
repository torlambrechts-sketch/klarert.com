# 07 · The first spreadsheet (end-to-end acceptance)

The MVP is ready when this walkthrough works by hand **and** as the Playwright test `tests/e2e/first-sheet.spec.ts`. Part A builds the first sheet through the UI exactly like a new customer would. Part B loads the reference template (`templates/first-sheet.json`) and tests the automations against it.

Clock: tests inject "today" = 2026-11-11 (Europe/London) through a test-only header the server reads in non-production builds.

## Part A · Build "Corrective actions" by hand

Signed in as Maria (owner) in an empty workspace.

1. Rail → "+ New sheet" → start **Tracker** → name "Corrective actions", item label "Corrective action", prefix suggested `CA-` (keep), folder "Your sheets", groups "Open, Closed". Columns shown: Owner (People), Status, Priority (Severity), Due date, Progress (Percentage). Remove Progress. Create.
   - ✓ Sheet opens in **List**; rail shows code **CA** under "Your sheets"; toast "Sheet created. Add your first item."
2. "+ Add item" in Open → type "Burrs on bracket 44-210", Enter, "Guard bypassed on press 3", Enter, Esc.
   - ✓ Items get `CA-001`, `CA-002`; activity log of CA-001 has `item.created` by Maria.
3. Header "+" → **Dropdown** "Source" with options Internal audit, Customer complaint, Incident, Supplier. → **Long text** "Root cause". → **Risk matrix** "Risk" (5×5). → **Formula** "Priority score" with `ROUND({risk} + MAX(0, 30 - DAYS({due_date}, TODAY())) / 3, 0)`. → **Checklist** "Effectiveness check" with three lines. → **Evidence** "Evidence" (valid 365 days). → **Button** "Raise action". → **Link to items** … (create the Actions sheet first in step 4, then come back).
   - ✓ Each field appears as a column; locked fields none; key generated (`root_cause`, `priority_score` …); the formula shows a live preview in its editor.
4. "+ New sheet" → **Blank** → "Actions", prefix `ACT-`, groups "To do, Done". Back in Corrective actions add **Link to items** "Actions" → target "Actions", two-way → the wizard creates "Corrective action" on Actions.
   - ✓ Both link fields exist; linking from either side shows on both.
5. Status field settings → Rules → "When Status becomes Done, require Root cause, Evidence, Effectiveness check"; "When Status becomes Stuck, require a comment".
6. CA-001: Owner Tom, Source Customer complaint, Priority Medium, Due date 16 Nov, Risk 3×3.
   - ✓ Priority score shows `17` (9 + (30 − 5)/3 = 17.33 → 17); due date cell says "in 5 days".
7. CA-001 Status → Done.
   - ✓ Blocked with "Add the root cause, evidence and the effectiveness check before closing." Value unchanged. No activity entry.
8. CA-002 Status → Stuck → comment box → "Waiting for the safety engineer" → Save.
   - ✓ Status Stuck; the comment appears in Updates and as the activity entry's note.
9. Grid view: select Due date cells of CA-001..002, paste from the clipboard `20/11/2026\nnot a date`.
   - ✓ "1 cell pasted, 1 skipped: not a date".
10. Item panel CA-001 → Activity log → **Verify audit trail**.
   - ✓ "✓ Audit trail intact. n entries recomputed …".
11. Resize to 390 px.
   - ✓ Cards instead of the table; bottom bar; panel full screen.

## Part B · Automations on the reference template

`pnpm seed` (or the importer from the UI: Settings → Import template) loads `templates/first-sheet.json` into a fresh workspace. Then, signed in as Maria:

| # | Do | Expect |
|---|---|---|
| B1 | Open CA "Guard bypassed on press 3" (Stuck already). Set Severity to High, then Critical | "Critical severity → alert the HSE manager" runs once (on Critical). Tom (HSE manager) has a notification. Run log: done, 1 step |
| B2 | On "Shared admin account on firewall" (Severity High, Risk 3×4, score 15) set Risk to 4×5 | Score crosses 15 (now 23) but the condition `Severity at most Medium` is false → **no run stored**. Set Risk back to 3×4, Severity to Low, then Risk to 4×5 again → run `done`: Severity High + an automation update "Severity raised to High: priority score is 23" |
| B3 | Click **Raise action** on "Burrs on bracket 44-210" (CA-001) | New `ACT-003` "Action for CA-001: Burrs on bracket 44-210" in To do, due in 14 days, owner Tom (copied), linked both ways; CA-001 status → Action set; "Actions done" shows 0 % (0 of 2 linked actions done, ACT-001 is still in progress) |
| B4 | Set ACT-003 Status → Done | Actions automation: Done on = today, moved to Done, Tom (lookup of the CA owner) notified. "Actions done" on CA-001 shows 50 % — in a second browser tab without refresh (realtime) |
| B5 | Effectiveness check on "Supplier evaluations overdue" (CA-005, Verifying): answer line 2 "No" with a note | Status → Investigating, owner notified, run `done` with 2 steps |
| B6 | On CA-005: upload a PDF as Evidence (hash shown), answer all three lines Yes, set Status Done | Rule passes. "Done → move to Closed and lock" runs: item in Closed, locked. Signed in as James (editor), editing it is refused with "Locked: Closed". The activity log shows the automation as actor for the move and the lock |
| B7 | Set a CA's Due date to 13 Nov (2 days from today) and run **Run date checks now** | "Due in 3 days → ask the owner" fires once: request notification to the owner, appears in their My work under Requests. Run it again: nothing new. Change Due date to 14 Nov and run: fires again |
| B8 | Create three automations that ping-pong a status between CA and Actions via `update_linked` | The chain stops at depth 3; a run with status `stopped` "Loop guard: chain deeper than 3"; the toast says so |
| B9 | Add a webhook action to an automation pointing at `https://httpstat.us/500` and trigger it | Webhook row retries on the backoff schedule (time-travel the worker in the test) and ends `dead_letter`; Maria gets a system notification |
| B10 | Pause "Stuck → notify…" on one item from the panel, set that item to Stuck | No run for that item; another item set to Stuck does run |
| B11 | Public form for Corrective actions: open `/f/<token>` logged out, submit "Oil on the floor near press 2" | Item created in Open with actor `form`; `form_submitted` automations run |
| B12 | Archive "Shared admin account on firewall", then search for it | Not in views or search; restore brings it back; the activity log shows archive and restore |

When every row passes: the core is ready for the first pack.
