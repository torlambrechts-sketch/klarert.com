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
| `/[org]/s/new` | New sheet wizard |
| `/[org]/s/[sheetId]` | Sheet, default view. Query: `?view=<viewId>&item=<displayId>&q=<search>` |
| `/[org]/s/[sheetId]/settings` | Sheet settings, fields list, forms |
| `/[org]/automations` | Automations (all sheets) + Run log tab (`?tab=runs`) |
| `/[org]/settings` | Workspace settings: members, teams, job roles, entities and sites |
| `/f/[token]` | Public form (no login, no app chrome) |
| `/api/cron/scheduler`, `/api/cron/webhooks` | Cron endpoints (secret) |

Every state that matters is in the URL: open item, view, search. Back/forward work. "Copy link" copies the absolute URL.

## 2. App shell

```
┌──────┬──────────────┬──────────────────────────────────────────────────────────┐
│ rail │ second panel │ top bar: [workspace ▾] [search……………… /]   [Inbox 3] [MP] │
│ 76px │ 240px        ├──────────────────────────────────────────────────────────┤
│      │ (collapsible │ page                                                     │
│      │  to 36px)    │                                                          │
└──────┴──────────────┴──────────────────────────────────────────────────────────┘
```

### 2.1 Side menu ("rail")
- Background `--yel` (#F7C948). 76 px wide, full height, sticky.
- **Top block (fixed):** workspace logo (initials on #111), Home (icon), My work (icon + red count badge = overdue + requests to me).
- **Middle (scrolls):** one section per folder; each sheet is a 40 px rounded square with a two-letter code on white 45 % (active: #111 square, yellow text). Codes: initials of the first two words, letters and digits only ("Hazards (HIRA)" → "HH"), unique within the workspace (if taken: first letter + next consonant). Sections separated by a thin line when collapsed. "+ New sheet" at the end of the last section.
- **Bottom block (fixed):** Automations (icon), Settings (icon), "Keep menu open" (chevron).
- **Expand:** hovering the rail for 150 ms overlays it at 236 px with names and section headings (uppercase 10.5 px, #6B5B26); leaving collapses it. **Pin:** "Keep menu open" makes it a 236 px column (remembered per user in localStorage). Tooltips show names when collapsed.
- Keyboard: the rail is a `nav` landmark; items are links; focus shows names (expanded state on focus-within).

### 2.2 Second panel
- Background `--yel-2` (#FFF6D6), 240 px, collapsible to 36 px (toggle top right, remembered).
- On a sheet: small caps folder name, sheet name (17 px, 800), "All items n", one row per group (colour square, name, count of items matching the current filters), "+ New group". Clicking a group filters the view to it.
- On other pages: the area's pages (Home: Overview, My work; Automations: All automations, Run log; Settings: Members, Teams and roles, Entities and sites). My work: filters with counts (Everything, Overdue, Due in 14 days, Assigned to me, Requests to me, then By sheet).
- Active row: background `--yel`.

### 2.3 Top bar
- White, 58 px, sticky inside the main column, bottom border.
- Workspace switcher (logo + name + "▾": list of the user's workspaces).
- Search (max 520 px, placeholder "Search sheets, items and people   /"): results dropdown grouped "Sheets" and "Items" (display id + name + sheet), arrows + Enter, Esc closes.
- Inbox button with unread count → popover (latest 10, "Mark all read", "Open My work").
- Avatar → menu (Profile, Workspace settings, Sign out).

## 3. Sheet page

Header row: sheet name (26 px, 800) · view tabs (**Table**, saved views, More ▾: Kanban, Calendar, Form, + New view) · right: **+ New** (black), sheet search, Filter ▾ (count badge when active), Columns (· n hidden), ⚡ n (automations on this sheet → side sheet), ⋯ (sheet settings, export CSV, archive).

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
- **Automations:** see docs/04 §10.
- **Settings:** tabs Members (invite, role select, remove), Teams and job roles, Entities and sites.
- **New sheet wizard:** step 1 choose a start (cards: Blank, Register, Tracker, Log, Inspection, Import a spreadsheet, Copy a sheet); step 2 name, item label, ID prefix (suggested from the name), folder, groups (comma list), columns table (name + type select, add/remove/reorder; CSV: detected types to confirm); Create → opens the sheet in the Table view with the panel closed and a toast "Sheet created. Add your first item."

## 5. Phones (< 760 px)

- Rail becomes a bottom bar (64 px, yellow): Home, My work, Menu, Search, Inbox. **Menu** opens the full side menu as a left sheet (expanded style, 300 px) over a dark scrim.
- Second panel hidden; group filter available as a select above the list.
- Top bar: menu button, workspace logo, search (expands to full width on focus), inbox, avatar.
- Below 640 px the Table renders **cards** under the same collapsible group titles: name (700), display id · owner, then up to three filled values as blocks (status first by field order), the first due date when it is not among them (red when overdue); tap opens the item panel; "+ Add" per group.
- Item panel full screen (above the bottom bar); summary strip two columns; Expand hidden.
- Tables on other pages scroll horizontally inside their card.

## 6. Tokens

```
--yel #F7C948   --yel-2 #FFF6D6   --ink #111111   --muted #5E5C57   --line #E3E0D8   --soft #F7F6F2
--brand (primary buttons, focus-dark) #16181D   --focus #2C4FD0   --sel (selected row) #EEF1F6
--good #188A50  --warn #8A5A00  --crit #B4232B
label colours: grey #B4BCC4 · blue #2F6FD6 · navy #2F4F8F · teal #0B8389 · green #188A50 · yellow #E5B526
               orange #C46A0A · red #C93A46 · pink #C24E88 · purple #7E52C6 · dark #55606B
Font: Plus Jakarta Sans 400/500/600/700/800 (self-hosted), IBM Plex Mono 400/500 for ids and hashes
Base size 13.5 px; h1 26 px/800; radius cards 4 px, controls 8–10 px; borders 1 px var(--line)
```
Use shadcn/ui primitives (Popover, Dialog, Sheet, DropdownMenu, Command, Tooltip, Tabs, Toast via `sonner`) restyled with these tokens. No yellow on buttons (yellow is navigation only); primary buttons are `--brand` with white text.

## 7. States

Every list, table and panel needs: skeleton loading (no layout shift), empty state with one action ("No items yet. Add the first one." + button), error state with Retry, and offline banner ("You are offline. Changes will fail until you reconnect."). Toasts: bottom centre, dark, 4 s, with "Undo" for archive and bulk edits.
