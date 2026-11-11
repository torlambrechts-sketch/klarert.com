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

Header row: sheet name (26 px, 800) · view tabs (**List**, **Grid**, More ▾: Kanban, Calendar, Form, + New view) · right: **+ New** (black), sheet search, Filter ▾ (count badge when active), Columns (· n hidden), ⚡ n (automations on this sheet → side sheet), ⋯ (sheet settings, export CSV, archive).

### 3.1 List view (default)
- Hint line (dismissible, remembered): "**Click any cell to edit.** Click a name to open the item. **+** adds a column. 🔒 kept by the app."
- Table: sticky first column 360 px: checkbox · name (two-line wrap, 600) · small line "CA-014 · Maria Pereira". Status (first label field) is the first column after the name. Then the visible fields in order. Last header cell "+" adds a field.
- Group header rows: chevron, colour dot, name, (count).
- Cells: click opens the type's editor in a popover anchored to the cell; hover outline 1.5 px #9AA3B5.
- Status pill (List and cards): tinted background (`color-mix(var(--c) 13 %, white)`), coloured border, dark text. Action-needed options (red/orange colours, not done): solid colour, white text, "!" in a circle. Done options: "✓" prefix. Colour is never the only signal.
- Overflow: when columns overflow the right edge, a 130 px white fade with a "More columns →" pill (scrolls 60 % of the width).
- Footer: items per page (25/50/100), "1–25 of 132", Prev/Next.
- Locked fields show a small lock after the header name; tooltip "Kept by the app. You can hide it, not delete it."

### 3.2 Grid view (spreadsheet)
- monday-style: each group is a block with a 4 px left border in the group colour and a header (chevron, name in group colour, "n items"); column headers repeat per group; "+ Add item" row; summary row.
- Status cells are solid colour blocks with white text (full cell); people cells show avatars; dates show date + small bar for relative time when the field has `relative`.
- Selection model: single cell focus ring 2 px #2C4FD0; shift-arrows/shift-click range; copy/paste TSV; Delete clears (respecting required/locked); Enter edits; Esc cancels.
- Column header menu: Sort A→Z / Z→A, Filter by this column, Hide, Settings…, Insert left/right, Duplicate, Delete (not for locked).
- Resizing by dragging the header edge; reordering by dragging the header.
- Virtualise rows and columns (`@tanstack/react-virtual`); keep the name column sticky.

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
- **New sheet wizard:** step 1 choose a start (cards: Blank, Register, Tracker, Log, Inspection, Import a spreadsheet, Copy a sheet); step 2 name, item label, ID prefix (suggested from the name), folder, groups (comma list), columns table (name + type select, add/remove/reorder; CSV: detected types to confirm); Create → opens the sheet in List view with the panel closed and a toast "Sheet created. Add your first item."

## 5. Phones (< 760 px)

- Rail becomes a bottom bar (64 px, yellow): Home, My work, Menu, Search, Inbox. **Menu** opens the full side menu as a left sheet (expanded style, 300 px) over a dark scrim.
- Second panel hidden; group filter available as a select above the list.
- Top bar: menu button, workspace logo, search (expands to full width on focus), inbox, avatar.
- List view renders **cards**: name (14.5 px, 700), status pill + display id, first person left, first due date right (red when overdue); group headers between.
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
