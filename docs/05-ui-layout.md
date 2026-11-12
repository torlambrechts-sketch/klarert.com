# 05 · UI layout and screens

Visual reference: open `reference/compliance-os-sun-v2.html` in a browser (it is a self-contained mockup; click around, resize to 390 px). Build the real app to look and behave like it. Where the mockup shows things outside the MVP scope (dashboards with readiness, Speak-up, partner console, app builder), keep the slot in the menu out of the MVP unless docs/01 lists it.

## 1. Routes (Next.js App Router)

| Route | Screen |
|---|---|
| `/login` | magic link sign-in |
| `/onboarding` | create a workspace or accept an invite |
| `/[org]` | redirects to `/[org]/home` |
| `/[org]/home` | Home: Needs you, recent activity, next 30 days, getting-started checklist |
| `/[org]/my-work` | My work |
| `/[org]/dashboards` | Opens the first dashboard; seeds "Compliance overview" on an editor's first visit |
| `/[org]/dashboards/[dashboardId]` | One dashboard: tabs for every dashboard, widget cards |
| `/[org]/evidence` | Evidence library. Query: `?q=<search>&sheet=<id>&status=valid\|expiring\|expired\|none` |
| `/[org]/workflow` | Workflow: every sheet's lifecycle by a status or label field, as an expandable list. Query: `?sheet=<id>&field=<key>` opens that sheet |
| `/[org]/s/new` | New sheet wizard |
| `/[org]/s/[sheetId]` | Sheet, default view. Query: `?view=<viewId>&item=<displayId>&q=<search>` |
| `/[org]/s/[sheetId]/settings` | Sheet settings, fields list, forms |
| `/[org]/automations` | Automations (all sheets) as an expandable list with the builder in place (`?new=1`, `?edit=<id>`, recipes `?recipes=1`) and the latest runs; full run log at `?tab=runs` |
| `/[org]/settings` | Workspace settings: members, teams, job roles, entities and sites |
| `/f/[token]` | Public form (no login, no app chrome) |
| `/api/cron/scheduler`, `/api/cron/webhooks` | Cron endpoints (secret) |

Every state that matters is in the URL: open item, view, search. Back/forward work. "Copy link" copies the absolute URL.

## 2. App shell

Visual reference for the shell and pages since the shadcn suite restyle: `21 Shadcn Suite` (Vercel-style side menu, zinc neutrals, Geist).

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ side menu    │ top bar: [search……………… /]                   [Inbox 3] [MP] │
│ 256px        ├──────────────────────────────────────────────────────────┤
│ #FAFAFA      │ page: crumb · h1 · description · actions, underline tabs  │
└──────────────┴──────────────────────────────────────────────────────────┘
```

### 2.1 Side menu
- 256 px, background `--subtle` (#FAFAFA), right border `--line`, full height, sticky. A `nav` landmark "Side menu".
- **Top:** workspace switcher (initials on a black circle, name, ⇅: the user's workspaces, New workspace), then **Find** (filters the menu as you type; `F` focuses it, Esc clears).
- **Items:** Home, My work (count badge = overdue + requests to me, worded "n waiting" for screen readers). Then "Insights": Dashboards, Evidence library. Then "Sheets": one collapsible folder per folder (folder icon, name, chevron; closed folders remembered per browser; the folder of the open sheet always opens), its sheets indented with their two-letter code in a small mono box, "+ New sheet" at the end of the last folder. Then "Platform": Workflow, Automations, Workspace admin (owners and admins).
- Active item: background #EBEBED, ink text, medium weight; hover #F0F0F1.

### 2.2 Page sub-navigation
- No second panel. Pages with sections show underline tabs under the header (Workspace admin: Members, Teams and roles, Entities and sites).
- On a sheet: the toolbar's **Show one group** menu (All groups and each group with its item count, "+ New group" for editors) filters the view to one group (`?group=`).
- My work: filter chips with counts (Everything, Overdue, Due in 14 days, Assigned to me, Requests to me, then By sheet) under the KPI tiles.

### 2.3 Top bar
- White, 48 px, sticky inside the main column, bottom border.
- Search (max 520 px, placeholder "Search sheets, items and people", `/`): results dropdown grouped "Sheets" and "Items" (display id + name + sheet), arrows + Enter, Esc closes.
- Inbox button with unread count → popover (latest 10, "Mark all read", "Open My work").
- Avatar → menu (Workspace admin, Sign out).

## 3. Sheet page

Header: crumb (folder / sheet), sheet name (26 px, 600), "<view> · n items"; right: ⋯ view menu, sheet settings, **+ New** (black). Under it underline view tabs (**Table**, saved views, More ▾: Kanban, Calendar, Form, + New view). Toolbar: sheet search (grows), Show one group, Filter ▾ (count badge when active), Sort, Columns (· n hidden), ⚡ n (automations on this sheet → side sheet).

### 3.1 Table view (default)
One view for working through items as rows; it replaced the former List and Grid views. `?view=list` and `?view=grid` (old links, saved defaults) open the Table, and saved views stored with type `list` or `grid` load as Table views (mapped when read; `views.type` stores a Table view as `list` until a migration adds `table`).
- Hint line (dismissible, remembered): "**Click a cell, then click again or press Enter to edit.** Click a name to open the item. **+** adds a column. 🔒 kept by the app."
- **One sticky column header** for the whole sheet, never repeated per group, set in `text-label` like the view tabs. Sticky name column (checkbox · drag handle · name); the header's checkbox selects every shown item; last header cell "+" adds a field. Locked fields show a lock after the name with the tooltip "Kept by the app. You can hide it, not delete it."
- Groups are collapsible sections: a title row tinted with the group colour and a 4 px bar, chevron button (`aria-expanded`), name in the group colour, "n items", a checkbox selecting the group. Collapsed state is UI state.
- Rows: name (600) on the first line, "CA-014 · avatar Maria Pereira" (display id, then the owner = first people-kind field, if any) in `text-meta` under it. Option fields render as rounded blocks, people cells show names. "+ Add item" row at the end of each group.
- Group summaries are **off** by default. The column menu's "Show summary" turns one on (default function of the type), "Summary" chooses the function, "Hide summary" turns it off; kept per view in `views.config.summaries` (field key → function). A summary row appears under each open group when any visible column has one.
- Interaction (spreadsheet model): click selects a cell, a second click, double-click, Enter, F2 or typing a character edits it in the type's editor popover; arrows, Tab, Esc; shift-arrows/shift-click range; copy/paste TSV; Delete clears (respecting required/locked) with Undo in the toast; space toggles checkboxes and opens the item from the name.
- Column header menu: Sort A→Z / Z→A (saved in the view's sort), Hide, Show/Hide summary, Settings…, Insert left/right, Duplicate, Move, Delete (not for locked). Resize by dragging the header edge (or arrow keys on it); reorder by dragging the header. Drag rows within and between groups (off while sorted); bulk bar for selected rows.
- Groups, items, add rows and summary rows are flattened into one row model and virtualised with `@tanstack/react-virtual` (rows and columns), so 10,000 rows stay fast. When columns overflow the right edge, a fade with a "More columns →" pill.

### 3.3 Kanban, Calendar, Form
- Kanban: lanes per option of the chosen label field (first status field by default), lane header colour bar + count; cards (name, display id · first person, colour dot + group, first date right-aligned); drag to change; "+ Add" at the bottom of each lane.
- Calendar: month grid, Monday first, today highlighted, items as chips coloured by status, "Previous / Next / Today".
- Form view: left = form builder (fields on/off, order, label, help, required), right = live preview at phone width; "Copy public link", "Disable link", QR code (generate client-side, `qrcode` package).

### 3.4 Item panel
- Right drawer 470 px (Expand → `min(1080px, 100vw − 100px)`), overlay on phones. Esc closes. J/K previous/next.
- Header: breadcrumb "Sheet › Group", name (editable, 18 px 800), display id (mono), Lock badge, buttons: Expand, Copy link, Close.
- Tabs: **Details** · **Updates · n** · **Activity log · n**.
- Details: summary strip (cards: Status, first person, first due date with relative text red when overdue, Group); "Linked items n" list (both directions: chip with the link field or source sheet name, name, display id · sheet, status pill; click opens that item); "Automations on this item" (name + pause toggle); "All fields" as a label/value list (two columns when expanded), each value editable in place.
- Updates: textarea with @mention autocomplete (people, job roles), Post; feed newest first; automation posts with a lightning avatar.
- Activity log: entries newest first (actor avatar or "Automation", action text "Status: Working on it → Done", time, short hash); **Verify audit trail** button → "✓ Audit trail intact. 14 entries recomputed …" or "✗ Entry #812 does not match".

### 3.5 Field picker and settings
- "+" in the header → popover: search box, 12 essentials as a 3×4 grid (icon + label), "All field types" expands families with one-line descriptions (from the registry).
- Field settings: right side sheet with sections General (name, description, required, default), Type settings (the type's `ConfigForm`), Validation, Rules (status rules / comment / visibility), Danger zone (delete; disabled when locked).

## 4. Other pages

- **Home:** greeting + one-line summary ("3 items need you · next due 14 Nov"), Getting started checklist (computed: create a sheet, add 5 items, add a status field, invite a colleague, create an automation, open the activity log; hide when done), Needs you (overdue + requests + due ≤ 14 days, max 6), Next 30 days (dated items), Recent activity (latest activity entries across sheets).
- **My work:** KPI tiles (Overdue, Due in 14 days, Requests to me, Assigned to me) acting as filters; sections with rows (status pill · name + "CA-014 · Corrective actions · Due date" · due label right, red when overdue).
- **Evidence library:** a read-only list of the current version of every file (`files.replaced_by is null`) on items and fields that are not archived, across the sheets the person can read. Columns: file (download through the item panel's signed-URL command), item (display id + name, opens the item), sheet · field, source, collected, valid until (date + "in 12 days" / "3 days ago"), status, uploaded by. Status is worked out by the engine (`src/engine/evidence-library.ts`, today injected): Valid, Expiring within 30 days (today included), Expired, No expiry; shown as text with a symbol. Four status tiles with counts filter the list (counts follow search and sheet); a GET form filters by search, sheet and status. Upload and replace stay in the item panel. Shows at most 500 rows; the rest are reached by narrowing the filters.
- **Workflow:** the lifecycle of any sheet, read from one of its single-choice option fields (status, dropdown …): no stages are hard-coded. Laid out like the board design's Workflows list: crumb "Build / Workflow" with a "n lifecycles · m running" badge, a search, then one row per sheet (caret, name with field key and item count, "Stages from" field picker, stages, items, running = not done, overdue). The last opened sheet and field are remembered per browser. A row opens in place to its numbered steps (the field's options in order, plus "No stage"): option chip, requirement pill (the field's status rules), "Comment required", item count and overdue, the automations that run on entering (`field_becomes` on that option; `field_changed` shows in the footer) and an Items toggle listing its items. Below the list, "Running now" lists every item that is not done with its sheet and stage, a "Move … to stage" picker for editors and Open. Moving calls `setValues`, so rules, the comment dialog, the activity log and automations apply.
- **Dashboards:** dashboards are data (`dashboards.config = { widgets: [...] }`, docs/02). Widget types are a registry in `src/engine/dashboards` keyed by string id: `count` (items of a sheet matching conditions), `by_option` (items per option of a label field, bars), `overdue` (items whose chosen date is before today and not done), `evidence_status` (current files by validity), `automation_runs` (runs by outcome in the last N days). Each is a pure function over data the repository fetches for that dashboard only. Cards sit in a grid of columns at least 320 px wide; a stat shows the number and caption (plus "Needs action" when overdue), bars show the option chip or label, a bar and the count. Editors: Add widget (kind, sheet, field, conditions with the view filter's condition rows, period, title), per card Edit / Move earlier / Move later / Remove, and a menu with Rename, New dashboard, Delete. With several dashboards, underline tabs switch between them. When a workspace has none, an editor's first visit seeds "Compliance overview" from the sheets that exist (per sheet up to four: items by the field that decides done, overdue by the first deadline date; then evidence status and automation runs).
- **Automations:** see docs/04 §10. Laid out like the board design's list: crumb with "n of m on · runs logged", Run date checks now (admins), Start from a recipe, New automation; a toolbar with search, sheet filter and All / On / Off; one row per automation (caret to edit in place, name and its sentence, sheet, source, version, runs linking to the run log, on/off switch with the state word, duplicate, delete). The builder opens inside the row as one bordered box of rows (Sheet, When, and only if, then, Reads as, Name, Test on, Turn on automation or Save as vN) with Cancel under it. Recipes are cards; the run log is a table (time, automation, sheet, item, outcome, what it did, steps in place), its latest runs also under the list.
- **Settings:** tabs Members (invite, role select, remove), Teams and job roles, Entities and sites.
- **New sheet wizard:** step 1 choose a start (cards: Blank, Register, Tracker, Log, Inspection, Import a spreadsheet, Copy a sheet); step 2 name, item label, ID prefix (suggested from the name), folder, groups (comma list), columns table (name + type select, add/remove/reorder; CSV: detected types to confirm); Create → opens the sheet in the Table view with the panel closed and a toast "Sheet created. Add your first item."

## 5. Phones (< 760 px)

- Side menu becomes a bottom bar (64 px, #FAFAFA): Home, My work, Menu, Search, Inbox. **Menu** opens the full side menu as a left sheet over a dark scrim.
- Top bar: menu button, search (expands to full width on focus), inbox, avatar.
- Below 640 px the Table renders **cards** under the same collapsible group titles: name (700), display id · owner, then up to three filled values as blocks (status first by field order), the first due date when it is not among them (red when overdue); tap opens the item panel; "+ Add" per group.
- Item panel full screen (above the bottom bar); summary strip two columns; Expand hidden.
- Tables on other pages scroll horizontally inside their card.

## 6. Tokens

```
--ink #09090B   --ink-2 #3F3F46   --muted #71717A   --faint #A1A1AA   --line #E4E4E7   --line-2 #EAEAEC
--soft #F4F4F5 (fills, selected row)   --subtle #FAFAFA (side menu, header rows)   --brand #18181B (primary)
--focus #71717A   links: --info #2C4FD0
--good #1E8449  --warn #8A5A00  --crit #DC2626 (text on soft fill #B91C1C), each with a soft fill (--good-soft …)
heat h1–h4: #DDF1E4/#165E35 · #FBEFC9/#7A5308 · #FCDCC3/#8A3D0A · #F6C9C4/#8E1F18 (fill/text)
label colours: grey #B4BCC4 · blue #2F6FD6 · navy #2F4F8F · teal #0B8389 · green #188A50 · yellow #E5B526
               orange #C46A0A · red #C93A46 · pink #C24E88 · purple #7E52C6 · dark #55606B
Font: Geist 400/500/600/700 and Geist Mono 400/500 for ids, codes and counts (self-hosted)
Base size 14 px; h1 26 px/600, −0.03em; cards 12 px radius with a 1 px border and shadow-xs; tables and inputs 6–8 px
```
Use shadcn/ui primitives (Popover, Dialog, Sheet, DropdownMenu, Command, Tooltip, Tabs, Toast via `sonner`) restyled with these tokens. Primary buttons are `--brand` with near-white text; secondary buttons are white with a border. Option values show a colour dot with the label (plus "!" for action needed and a check for done).

## 7. States

Every list, table and panel needs: skeleton loading (no layout shift), empty state with one action ("No items yet. Add the first one." + button), error state with Retry, and offline banner ("You are offline. Changes will fail until you reconnect."). Toasts: bottom centre, dark, 4 s, with "Undo" for archive and bulk edits.
