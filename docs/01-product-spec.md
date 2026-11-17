# 01 · Product spec: Sheets MVP

## 1. Purpose

Prove the core before we build compliance packs on it: a flexible spreadsheet (any structure, 57 field types), items people can work in, and automations and triggers that keep the data moving with a full audit trail. If this core is right, a pack (ISO 27001, ISO 9001 …) is just sheets + fields + automations + views shipped as data.

## 2. In scope / out of scope

**In scope (MVP)**
- Workspaces (orgs), members, roles, teams, job roles, legal entities and sites
- Folders and sheets; new-sheet wizard (blank, register, tracker, log, inspection, import CSV, copy a sheet)
- Groups, items, item IDs with prefix, ordering, archive/restore
- Fields: all 57 types (docs/03), field settings, validation, status rules, conditional visibility, locked fields
- Views: Grid (spreadsheet), List (readable register, default), Kanban, Calendar, Form; filters, sort, search, hidden columns, saved views
- Item panel: Details, Updates (comments with @mentions), Activity log with Verify
- Files: evidence and attachments in Supabase Storage with SHA-256, versions and expiry
- Automations: 11 triggers, conditions, 11 actions, button fields, forms, scheduler, run log, per-item pause, loop guard (docs/04)
- Notifications inbox, My work, global search, page addresses for every sheet and item
- Realtime: other people's edits appear without refresh

**Out of scope (later)**
- Compliance packs and their libraries (we only make `requirement` and `controllink` point at sheets flagged as libraries)
- Dashboards, readiness scores, the app builder, AI proposals beyond storing a proposed value (the `ai` field stores and accepts/rejects a value; generation comes later)
- (Built after the MVP, owner-approved 14 Nov 2026: multi-step approval workflows, docs/04 §13)
- Speak-up/whistleblowing, partner console, billing, SSO/SCIM, mobile apps (the web app must work on phones)

## 3. Concepts (use these names in code and UI)

| Concept | Meaning |
|---|---|
| Workspace (`org`) | One customer. Everything has `org_id` |
| Member | A user in a workspace with a role: owner, admin, editor, viewer |
| Folder | Groups sheets in the side menu |
| Sheet | A table: fields + groups + items. Has an item label ("Risk", "Action") and an ID prefix ("R-") |
| Library sheet | A sheet flagged `is_library` that `requirement`/`controllink` fields can point at |
| Field | A column. Has a stable `key`, a `type` and a type `config` |
| Group | A coloured section of a sheet. Every item is in exactly one group |
| Item | A row. Has `display_id` (prefix + sequence), a name and `values` |
| View | A saved way to look at a sheet: grid, list, kanban, calendar, form |
| Automation | When *trigger*, if *conditions*, then *actions*. Belongs to one sheet |
| Run | One execution of one automation for one item, with each step's outcome |
| Activity log | Append-only, hash-chained history of every change |
| Update | A comment on an item (people or automations) |
| Notification | An inbox entry for one person, linked to an item |

## 4. Roles and permissions

| Action | Owner | Admin | Editor | Viewer |
|---|---|---|---|---|
| See sheets, items, activity | ✓ | ✓ | ✓ | ✓ |
| Create/edit/archive items, post updates, upload files | ✓ | ✓ | ✓ | — |
| Create sheets, groups, fields, views, automations | ✓ | ✓ | ✓ | — |
| Change or delete a **locked** field, edit a locked item, unlock | ✓ | ✓ | — | — |
| See `protected` field values | ✓ | ✓ | only if listed in the field's `allowed` | — |
| Members, roles, teams, entities, workspace settings | ✓ | ✓ | — | — |
| Delete the workspace, transfer ownership | ✓ | — | — | — |

Personal saved views are visible to their owner only; shared views to everyone.

**Access control (P2, docs/02 §16).** The table above is what a workspace role gives on an open sheet. An owner, or an admin who has access, can restrict a folder or a sheet to chosen people with a level: can edit, can comment (read, post updates, @mention; no value changes) or can view. A grant never gives more than the role (viewers and auditors only view). Owners always see everything (opening a restricted sheet they are not listed on is logged); admins see a restricted sheet's name, not its content, unless listed. A fifth role, **Auditor**, reads like a viewer (sheets, evidence and files with downloads logged, activity and run logs) until an end date set on the invite or the member, after which access ends by itself; auditors cannot edit, comment, post updates, submit internal forms, run buttons or change automations. Any field can be **restricted** to chosen people and roles (owners always see it): everyone else sees "Restricted", never the value, anywhere (Table, panel, lookups, summaries, Insights, dashboards, search, notifications, webhooks, the activity log).

## 5. Functional requirements

IDs are referenced from the build plan. "Must" = MVP.

### 5.1 Workspace and navigation
- **FR-1** Sign in with email magic link (Supabase Auth). After first sign-in a person creates a workspace or accepts an invite.
- **FR-2** Workspace settings: name, members (invite by email, change role, remove), teams, job roles, entities with sites, time zone default.
- **FR-3** Layout per docs/05: side menu (fixed Home/My work at top; folders with sheets; Automations/Settings at bottom; expand on hover, pin open), second panel (groups of the open sheet, or the pages of the current area), top bar (workspace switcher, search, inbox, user menu).
- **FR-4** Every page and item has its own URL. Back/forward work. "Copy link" on an item.
- **FR-5** Global search (press `/`): sheets by name, items by display id or name, items by person. Results grouped; arrows + Enter.

### 5.2 Sheets
- **FR-6** Create a sheet with the wizard: choose a start (blank, register, tracker, log, inspection — see `templates/starts.json`), name, item label, ID prefix, folder, first groups, columns (editable list, any type). Import CSV: first row → field names, type guessed (date, number, email, url, yes/no, dropdown when ≤ 12 distinct values, else text), user can change each type before creating; rows → items. Copy a sheet: same fields, groups, views and automations, no items.
- **FR-7** Sheet settings: name, description, item label, ID prefix (only while the sheet has no items), folder, library flag, default view, archive sheet.
- **FR-8** Groups: add, rename, recolour, reorder (drag), collapse, delete (only if empty, otherwise "move items to …" first).

### 5.3 Items
- **FR-9** Add an item from the "+ Add item" row of a group (name only, Enter to add the next), from "+ New" (opens the panel on a new item), or from a form.
- **FR-10** Display id = prefix + zero-padded sequence (3 digits minimum), assigned by the database, never reused.
- **FR-11** Reorder by drag inside and across groups (fractional index). Moving across groups is a change (logged, can trigger automations).
- **FR-12** Multi-select items (checkbox column, shift-click range): bulk set a field, move to group, archive. Bulk edits run automations per item.
- **FR-13** Archive and restore (soft delete). Archived items are hidden from views, search and automations, still in the activity log.
- **FR-14** Locked items: only owner/admin can change values; others see a lock and a reason.

### 5.4 Fields
- **FR-15** Add a field from the "+" at the end of the header: quick list of 12 essentials (text, long text, number, status, dropdown, people, date, timeline, yes/no, link, file (evidence), formula) + search + "All field types" grouped by family.
- **FR-16** Field settings (side sheet): name, description (help text shown in the panel and form), type-specific config (docs/03), required, default value, validation (min/max/pattern/unique per type), status rules, comment-on-value, visibility rule, width, locked (admin).
- **FR-17** Change a field's type only between compatible types (docs/03 §5); otherwise "create a new field and copy values" with a preview of how many values convert.
- **FR-18** Reorder, resize, hide (per view), rename, duplicate, delete (soft; restorable for 30 days; locked fields cannot be deleted).
- **FR-19** Status rules: "When this field becomes *X*, require field *Y* to be filled" (blocks the change with a clear message) and "…require a comment" (opens a comment box; the comment is stored as an update and in the activity entry).
- **FR-20** Visibility rule: show this field in the panel and form only when another field matches a condition. Hidden fields keep their value.

### 5.5 Views
- **FR-21** Grid: spreadsheet editing. Sticky name column, groups with colour bar and per-group summaries row, inline editors for every type, keyboard (arrows, Enter/F2 edit, Esc cancel, Tab next, Shift+Tab, Ctrl/Cmd+C/V copy-paste values between cells and from Excel/Sheets as TSV), column header menu (sort, filter, hide, settings, insert left/right, duplicate, delete), "+ Add item" per group, virtualised to 10,000 items.
- **FR-22** List (default view): readable register. Name column 360 px with two-line wrap and the display id + first person underneath; status first after the name; every cell editable by click; "+" header adds a column; locked columns show a lock; right-edge fade + "More columns →" when columns overflow; pagination 25/50/100. On screens < 760 px List renders cards (name, status, id, first person, first due date).
- **FR-23** Kanban: lanes = options of a chosen label field (status/dropdown/severity/…); drag to change value (runs rules and automations); card shows name, id, first person, first date.
- **FR-24** Calendar: month grid by a chosen date field (date, datetime, timeline start, recurrence next, evidence expiry); click a day to add an item with that date.
- **FR-25** Form view: pick fields, order, labels, help text; public link with token (no login) and internal form; submit creates an item in the chosen group and fires the `form` trigger. Shows only fields allowed on forms (not computed types).
- **FR-26** Filters (AND of conditions using the operators in docs/03 §4), sort (multi-level), search inside the sheet, group-by is the sheet's groups. Saved as a view (personal or shared). The view tab bar shows List, Grid, then "More ▾" (Kanban, Calendar, Form, + New view).

### 5.6 Item panel
- **FR-27** Opens from the right (470 px; Expand to full width; full screen on phones). URL `?item=<display_id>`.
- **FR-28** Tabs in this order: **Details** (summary strip: status, first person, first due date with "in 5 days / 3 days overdue", group; then Linked items in both directions; then all fields editable, respecting visibility rules), **Updates** (comments, @mention people or roles → notification; automation posts appear here), **Activity log** (newest first; who, what, old → new, time, hash; "Verify audit trail" recomputes the chain and shows the result).
- **FR-29** Header: breadcrumb (sheet › group), name (inline rename), display id, Lock badge, Expand, Copy link, Close. Previous/next item arrows (J/K).

### 5.7 Files
- **FR-30** Upload to Supabase Storage bucket `files` at `org/<org_id>/item/<item_id>/<file_id>/<filename>`. Compute SHA-256 in the browser before upload and again in an Edge Function after upload; store both; mismatch = upload fails.
- **FR-31** Evidence: source (upload, form, connector name), collected at, valid until (default from field config `validDays`), freshness (current / expiring ≤ 30 days / expired). Replacing a file keeps the old version (`replaced_by`). Attachments: same without expiry.

### 5.8 Automations (detail in docs/04)
- **FR-32** Automations page per workspace and per sheet: list (on/off toggle, name, trigger summary, runs, last run, source), "New automation" builder, run log with filters (sheet, automation, outcome), "Run date checks now" (admin).
- **FR-33** Builder: sentence form "When **[trigger]** · if **[conditions]** · then **[actions]**", every slot a picker filtered to compatible fields. Live preview: "Would have run on 3 items in the last 30 days". Save as on or off.
- **FR-34** Per item: the panel shows automations that apply; each can be paused for this item.
- **FR-35** Button field: clicking runs automations whose trigger is that button; disabled while running; result toast.

### 5.9 Notifications, My work, Inbox
- **FR-36** Notifications from `notify`, `request`, @mentions and failures of automations you own. Inbox popover in the top bar (count of unread), mark read, open item.
- **FR-37** My work page: Overdue, Due in 14 days, Assigned to me (items where any people field contains me and the status field is not done), Requests to me (open `request` notifications). Sorted by date; filters in the second panel.
- **FR-38** Email digest is out of scope; in-app only.

### 5.10 Activity log
- **FR-39** Every create, value change (old → new), move, archive/restore, lock/unlock, field/schema change, automation action and form submission is logged by the database in the same transaction as the change (docs/02 §6).
- **FR-40** Per-item hash chain; Verify recomputes and reports "intact" or the first broken entry.

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Grid of 10,000 items × 30 fields scrolls at 60 fps (virtualised rows and columns). Cell edit → saved and visible to other users < 500 ms p95 in EU. Automation chain of depth 3 completes < 2 s p95 |
| Data | EU region only (Supabase Frankfurt, Vercel fra1). No third-party requests from the browser (fonts self-hosted, no analytics in MVP) |
| Security | RLS on every table; all writes through commands; Zod on every input; storage paths scoped by org; public form tokens are 32-byte random, revocable, rate-limited (10 submissions/min/IP) |
| Audit | `activity_log` insert-only (DB trigger blocks update/delete); hash chain per item |
| Accessibility | WCAG 2.1 AA: keyboard for every action incl. grid editing; visible focus; status never colour-only; 4.5:1 contrast |
| Phones | Everything works at 390 px: cards instead of tables, bottom bar, full-screen panel |
| Reliability | Optimistic UI with rollback + toast on failure; realtime reconnect; idempotent commands (client sends `mutation_id`) |
| Observability | Every command and automation run logs a structured line (org, user, command, ms, outcome) to Vercel logs |

## 7. Decisions to confirm with Tor (do not decide alone)

1. Product and domain name: decided 16 Nov 2026, **Keptrow** on www.keptrow.com ("Keptrow — the compliance spreadsheet"; formerly the placeholder "Compliance OS" on klarert.com). The owner decided on 17 Nov 2026 to switch now; the trademark search runs in parallel. Go-live steps in docs/14.
2. Sign-in methods beyond magic link (Microsoft / Google) for the MVP.
3. Max items per sheet we promise (spec targets 10,000).
4. Whether editors may create automations or only admins (spec: editors may; admins can lock).
5. File size limit: 25 MB per file (decided; enforced by the bucket and the upload commands).
