# 05 · UI layout and screens

Behaviour reference: open `reference/compliance-os-sun-v2.html` in a browser (it is a self-contained mockup; click around, resize to 390 px) for screens and flows. The look is Vercel's Geist design system as set out in §6; where the mockup's styling differs, §6 wins. Where the mockup shows things outside the MVP scope (dashboards with readiness, Speak-up, partner console, app builder), keep the slot in the menu out of the MVP unless docs/01 lists it.

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

The shell and pages use the Geist design system (§6): a Vercel-style side menu, Geist grays, flat bordered cards.

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ side menu    │ top bar: [search……………… /]                   [Inbox 3] [MP] │
│ 256px        ├──────────────────────────────────────────────────────────┤
│ bg-200       │ page: crumb · h1 · description · actions, underline tabs  │
└──────────────┴──────────────────────────────────────────────────────────┘
```

### 2.1 Side menu
- 256 px, background `--subtle` (Geist background-200), right border `--line`, full height, sticky. A `nav` landmark "Side menu".
- **Top:** workspace switcher (initials on a black circle, name, ⇅: the user's workspaces, New workspace), then **Find** (filters the menu as you type; `F` focuses it, Esc clears).
- **Items:** Home, My work (count badge = overdue + requests to me, worded "n waiting" for screen readers). Then "Insights": Dashboards, Evidence library. Then "Sheets": one collapsible folder per folder (folder icon, name, chevron; closed folders remembered per browser; the folder of the open sheet always opens), its sheets indented with their two-letter code in a small mono box, "+ New sheet" at the end of the last folder. Then "Platform": Workflow, Automations, Workspace admin (owners and admins).
- Active item: background `--nav-active` (gray-alpha-200), ink text, medium weight; hover `--nav-hover` (gray-alpha-100).
- Measures (the board design): 256 px wide, 8 px side padding; workspace switcher 38 px (22 px avatar, 9 px gap); Find 34 px; items 34 px (10 px padding, 16 px icons, 10 px gap), 1 px apart; sheets 32 px in `text-label-13.5` with a 9 px gap; section labels 12 px medium with 2 px above and 6 px below; separators 1 px with 10 px above and below. Counts are neutral pills (`text-label-11-mono`, muted, 1 px border).

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

Header: crumb (folder / sheet) in the top bar, sheet name (`h1`: `text-heading-26`), the description (14 px on 21 px lines, at most 780 px); right: Share and **+ New** (black), 36 px buttons with 13.5 px words and 15 px icons. Under it underline view tabs (**Table**, **Insights**, Board, Calendar, Form, saved views, More ▾: + New view; 40 px tabs, 15 px icons, 22 px apart) with the ⋯ view menu and sheet settings as 32 px buttons at the right, so the tab bar stays 41 px. Toolbar (16 px under the tabs, 14 px above the first card, 8 px gaps): sheet search (grows from 240 px, placeholder "Search items…"), Actions, Show one group, status and owner filters, Sort, Filter (count badge when active), then Columns (+n hidden), row density and ⚡ n (automations on this sheet → side sheet). Every control is 38 px (`src/components/table/toolbar-styles.ts`): select-like triggers 14 px words, muted while they show everything; buttons 13.5 px medium words; counts in `text-label-11-mono` on `--soft`. The first row is 39 px (1 px under the group select), as in the design.

### 3.1 Table view (default)
One view for working through items as rows; it replaced the former List and Grid views. `?view=list` and `?view=grid` (old links, saved defaults) open the Table, and saved views stored with type `list` or `grid` load as Table views (mapped when read; `views.type` stores a Table view as `list` until a migration adds `table`).
- Hint line (dismissible, remembered): "**Click a cell, then click again or press Enter to edit.** Click a name to open the item. **+** adds a column. 🔒 kept by the app."
- **One sticky column header** per group card, muted `text-label-12` names. Sticky name column (checkbox · drag handle · name); the header's checkbox selects every shown item; last header cell "+" adds a field. Locked fields show a lock after the name with the tooltip "Kept by the app. You can hide it, not delete it."
- Groups are collapsible sections: a title row tinted with the group colour and a 4 px bar, chevron button (`aria-expanded`), name in the group colour, "n items", a checkbox selecting the group. Collapsed state is UI state.
- Group cards: 1 px `--line` border, 10 px radius, 24 px apart. Title row 48 px (16 px side padding): a 24 px chevron button, the dot and name (14 px semibold), "n items" (mono 12 px semibold, muted on `--soft`), "% done". Column header 34 px: the group checkbox 24 px from the card edge, the item label (the design shows "Name"), then the field names 12 px from their column's left edge.
- Rows: 52 px (compact 40 px). The sticky name column is 380 px: 16 px (drag handle), a 28 px round icon with a 1 px border (the checkbox, 16 px, 24 px from the edge, takes its place on hover or selection), 14 px, then the name in `text-label-14` on the first line and "CA-014 · Maria Pereira" (display id, then the owner = first people-kind field, if any) in `text-label-12-mono` under it, and the update count as a 28 × 22 px pill (mono 11 px semibold, `--line-strong` border) at the end of the name column; rows without updates keep its room so names line up. "…" row menu (32 px) 8 px from the card's right edge. "+ Add item" row (44 px) at the end of each group; summary row 38 px. Checkboxes are drawn (`.row-check`): 16 px, 1 px ink border, 4 px radius, ink with a white tick when ticked.
- Columns keep their widths (no stretching): the trailing column takes the room left in the card, so "+" follows the last column and "…" sits at the card's right edge; wider tables scroll. Default widths come from the field registry (people 84, status 140, number 84, date 160 …); in comfortable density a column with a trend line is at least 150 px.
- Cells (all from the field UI registry, 14 px side padding, vertically centred): a one-option value (status, dropdown, severity …) is a box that hugs its words (28 px tall, 4 px × 10 px padding, at most the cell's width less its padding, words truncated), centred in the cell (8 px side padding in that cell), 6 px radius, the option's tint (`--tint-<colour>-bg`), a 1 px border in the same hue (`-line`) and centred `text-label-13.5` medium words in its dark step (`-ink`, ≥ 4.5:1), with "!" for action needed and a check for done; several options are tinted chips; people are 24 px round avatars with a soft tint and 9.5 px initials; a date is `text-label-12.5` medium over a 4 px track (`--soft`) with "in 65d" / "late 3d" / "done" in `text-label-10.5-mono` (grey `--bar-far` far off, amber `--bar-warn` within 14 days, red late, green done); a number field with meter bands and a risk score show the number (`text-label-12.5-mono` medium, at least 22 px) then a four-bar meter of equal 6 × 14 px bars (`--meter-1…4`, as many filled as the step, the rest `--meter-off`) named by its step or level, then (comfortable density, not on phone cards) a 60 × 20 px trend line of the value's last 12 changes in the past 12 months from the activity log, ending in a dot at the current value: green when it moves the good way, red the bad way, grey when level or neither (risk scores: higher is worse; numbers: the field's "A rising value is" setting, neither by default), named "Trend: 12 → 20, rising"; the history loads after the sheet in one read and its width is reserved; checkboxes are black when ticked; link values are mono-id chips; progress is a thin bar and the percentage. Averages in the summary row read with one decimal ("12.3 average").
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
- Header: breadcrumb "Sheet › Group", name (editable, `text-heading-20`), display id (mono), Lock badge, buttons: Expand, Copy link, Close.
- Tabs: **Details** · **Updates · n** · **Activity log · n**.
- Details: summary strip (cards: Status, first person, first due date with relative text red when overdue, Group); "Linked items n" list (both directions: chip with the link field or source sheet name, name, display id · sheet, status pill; click opens that item); "Automations on this item" (name + pause toggle); "All fields" as a label/value list (two columns when expanded), each value editable in place.
- Updates: textarea with @mention autocomplete (people, job roles), Post; feed newest first; automation posts with a lightning avatar.
- Activity log: entries newest first (actor avatar or "Automation", action text "Status: Working on it → Done", time, short hash); **Verify audit trail** button → "✓ Audit trail intact. 14 entries recomputed …" or "✗ Entry #812 does not match".

### 3.5 Field picker and settings
- "+" in the header → popover: search box, 12 essentials as a 3×4 grid (icon + label), "All field types" expands families with one-line descriptions (from the registry).
- Field settings: right side sheet with sections General (name, description, required, default), Type settings (the type's `ConfigForm`), Validation, Rules (status rules / comment / visibility), Danger zone (delete; disabled when locked).

### 3.6 Insights view
A built-in view tab after the Table (`?view=insights`, a saved view of type `insights` once someone saves it). Its layout is `views.config.insights` (docs/02): rows of widget cards on a 12-column grid (16 px gaps, rows 16 px apart). Widget types are a registry in `src/engine/insights` keyed by string id, each a pure function from the sheet's data to a render model: **Number** (`kpi`: count, or sum/average of a number field, of the items its filter keeps), **Bar list** (`bars`: items per value of an option, people or checkbox field), **Column chart** (`cols`: items per month of a date field), **Donut** (`donut`), **Progress** (`progress`: share done, split by the status field), **Item list** (`list`: the first items by a date field with up to three fields; opens the item) and **Note** (`note`, plain text). Filters: All items, Open items, Completed, Overdue, Due in 30 days. A widget reads this sheet (the view's search, filters and group apply) or another sheet the person can read.
- Cards: white, 1 px `--line` border, 12 px radius; title `text-label-14` semibold, the source line ("This sheet · Open items" or the other sheet's name, a link) in muted 12.5 px; the widget menu (…) at the right. Row heights S / M / L (128 / 300 / 430 px minimum).
- Colour: monochrome greys, except option colours (status, dropdown) which keep their option colour; every bar and segment has its label and number in words, and charts have a text alternative.
- Clicking a bar, segment or legend entry of a widget that reads this sheet opens the Table filtered to that value (the status and owner quick filters, or a removable "Field: value" filter chip for other fields).
- When nobody has changed it, the view shows a default layout worked out from the fields (`defaultLayout`): Total items, Completed, Overdue, Due in 30 days; by status and by month; by owner and the overdue items.
- **Customize** turns on edit mode: an edit bar (Reset to default, Add row with a layout picker, Done), each row in a dashed frame with its column layout ([12], [6 6], [4 4 4], [3 3 3 3], [8 4], [4 8]), row height, move up/down and delete; each widget gets − / + width steps; empty places show "Add widget". The widget menu: Configure…, Duplicate, Move left/right, Move to row above/below, Width, Remove widget. Widgets also move by drag and drop (dnd-kit, keyboard too). The widget editor is a side sheet with a live preview: type, data source, filter, value (count, sum, average), group by, date field, top N / months / rows, list columns, note text, title and width.
- Saving: a saved view the person may change saves as it changes; on the built-in tab, Done saves the layout as the shared "Insights" view (editors) or a personal one (viewers) through the view commands.

## 4. Other pages

- **Home:** greeting + one-line summary ("3 items need you · next due 14 Nov"), Getting started checklist (computed: create a sheet, add 5 items, add a status field, invite a colleague, create an automation, open the activity log; hide when done), Needs you (overdue + requests + due ≤ 14 days, max 6), Next 30 days (dated items), Recent activity (latest activity entries across sheets).
- **My work:** KPI tiles (Overdue, Due in 14 days, Requests to me, Assigned to me) acting as filters; sections with rows (status pill · name + "CA-014 · Corrective actions · Due date" · due label right, red when overdue).
- **Evidence library:** a read-only list of the current version of every file (`files.replaced_by is null`) on items and fields that are not archived, across the sheets the person can read. Columns: file (download through the item panel's signed-URL command), item (display id + name, opens the item), sheet · field, source, collected, valid until (date + "in 12 days" / "3 days ago"), status, uploaded by. Status is worked out by the engine (`src/engine/evidence-library.ts`, today injected): Valid, Expiring within 30 days (today included), Expired, No expiry; shown as text with a symbol. Four status tiles with counts filter the list (counts follow search and sheet); a GET form filters by search, sheet and status. Upload and replace stay in the item panel. Shows at most 500 rows; the rest are reached by narrowing the filters.
- **Workflow:** the lifecycle of any sheet, read from one of its single-choice option fields (status, dropdown …): no stages are hard-coded. Laid out like the board design's Workflows list: crumb "Build / Workflow" with a "n lifecycles · m running" badge, a search, then one row per sheet (caret, name with field key and item count, "Stages from" field picker, stages, items, running = not done, overdue). The last opened sheet and field are remembered per browser. A row opens in place to its numbered steps (the field's options in order, plus "No stage"): option chip, requirement pill (the field's status rules), "Comment required", item count and overdue, the automations that run on entering (`field_becomes` on that option; `field_changed` shows in the footer) and an Items toggle listing its items. Below the list, "Running now" lists every item that is not done with its sheet and stage, a "Move … to stage" picker for editors and Open. Moving calls `setValues`, so rules, the comment dialog, the activity log and automations apply.
- **Dashboards:** dashboards are data (`dashboards.config = { widgets: [...] }`, docs/02). Widget types are a registry in `src/engine/dashboards` keyed by string id: `key_figures` (share of items done and open items per month over the period, rebuilt from the activity log's earlier values of the field that decides done; tabs over one line chart, the whole row wide), `done_by_sheet` (the first six sheets with a status field and the share of their items done, a bar behind each row), `risk_heatmap` (items on the grid of a risk matrix field, counts per cell, levels Low to Critical in words), `follow_up` (overdue items per sheet with a deadline, evidence expiring and expired, automation runs failed in the last 30 days), `count` (items of a sheet matching conditions), `by_option` (items per option of a label field, bars), `overdue` (items whose chosen date is before today and not done), `evidence_status` (current files by validity), `automation_runs` (runs by outcome in the last N days). Each is a pure function over data the repository fetches for that dashboard only. The top bar shows "Insights / name [Dashboard]"; under the header a 3, 6 or 12 months switch (`?months=`, a view setting, default 12) when a widget follows the period. Cards sit in a grid of columns at least 320 px wide with a 52 px heading row (title, a quiet line on the right, the card menu); charts are plain SVG with their values in words or a table for screen readers. Editors: Add widget (kind, sheet, field, conditions with the view filter's condition rows, period, title), per card Edit / Move earlier / Move later / Remove, and a menu with Rename, New dashboard, Delete. With several dashboards, underline tabs switch between them. When a workspace has none, an editor's first visit seeds "Compliance overview" from the sheets that exist: key figures, done by sheet (when a sheet has a status field), a risk heatmap of the first sheet with a risk matrix field (else that sheet's items by the field that decides done) and follow-up health. Not built (no data yet): readiness per standard or clause, entity filter, AI insights.
- **Automations:** see docs/04 §10. Laid out like the board design's list: crumb with "n of m on · runs logged", Run date checks now (admins), Start from a recipe, New automation; a toolbar with search, sheet filter and All / On / Off; one row per automation (caret to edit in place, name and its sentence, sheet, source, version, runs linking to the run log, on/off switch with the state word, duplicate, delete). The builder opens inside the row as one bordered box of rows (Sheet, When, and only if, then, Reads as, Name, Test on, Turn on automation or Save as vN) with Cancel under it. Recipes are cards; the run log is a table (time, automation, sheet, item, outcome, what it did, steps in place), its latest runs also under the list.
- **Settings:** tabs Members (invite, role select, remove), Teams and job roles, Entities and sites.
- **New sheet wizard:** step 1 choose a start (cards: Blank, Register, Tracker, Log, Inspection, Import a spreadsheet, Copy a sheet); step 2 name, item label, ID prefix (suggested from the name), folder, groups (comma list), columns table (name + type select, add/remove/reorder; CSV: detected types to confirm); Create → opens the sheet in the Table view with the panel closed and a toast "Sheet created. Add your first item."

## 5. Phones (< 760 px)

- Side menu becomes a bottom bar (64 px, `--subtle`): Home, My work, Menu, Search, Inbox. **Menu** opens the full side menu as a left sheet over a dark scrim.
- Top bar: menu button, search (expands to full width on focus), inbox, avatar.
- Below 640 px the Table renders **cards** under the same collapsible group titles: name (700), display id · owner, then up to three filled values as blocks (status first by field order), the first due date when it is not among them (red when overdue); tap opens the item panel; "+ Add" per group.
- Item panel full screen (above the bottom bar); summary strip two columns; Expand hidden.
- Tables on other pages scroll horizontally inside their card.

## 6. Design system: Geist

The whole app follows Vercel's Geist design system with the stack we already have (Geist Sans and Mono self-hosted, Tailwind v4, shadcn/ui on Radix, lucide-react). No other UI library. Everything below lives in `src/app/globals.css`; components use the tokens and type styles, never hex colours or ad-hoc px font sizes.

**Light only for now.** Every colour is a step on a Geist scale defined on `:root`; the semantic tokens point at those steps. A dark theme later redefines the scales (for example under `[data-theme='dark']`) and nothing else.

### 6.1 Colour

- Scales (light values): `--background-100` (white), `--background-200`; `--gray-100…1000` and `--gray-alpha-100…1000`; `--blue`, `--red`, `--amber`, `--green`, `--teal`, `--purple`, `--pink` each `100…1000`. Tailwind classes exist for every step (`bg-gray-100`, `text-blue-900`, `border-gray-alpha-400` …).
- Semantic tokens (what components use): `--ink` gray-1000 (primary text), `--muted` gray-900 (secondary text: 5.7:1 on white, 5.1:1 on gray-100), `--faint` gray-700 (icons and marks only, never text), `--line` gray-alpha-400 (1 px borders), `--line-strong` gray-alpha-500 (hover borders), `--soft` gray-100 (fills, skeletons), `--subtle` background-200 (side menu, header rows, row hover), `--sel` gray-100 (selected rows), `--brand` gray-1000 (primary buttons), `--focus` blue-700, `--nav-hover` / `--nav-active` gray-alpha-100 / 200.
- States: `--good` green-900, `--warn` amber-900, `--crit` red-900, `--info` blue-900 (links), each with a `-soft` fill (100/200 step); text is ≥ 4.5:1 on white and on its soft fill. `--bar-good` / `--bar-crit` are the bright 700 steps for thin bars beside words.
- Option colours (`--label-<colour>`, stored by name on each option) stay for dots, group bars, Kanban and Calendar; `--solid-<colour>` where white text sits on them. In the Table, options use the tint triplets `--tint-<colour>-bg / -line / -ink` (Geist 100 / 400 / 900 steps; orange, navy and the neutrals use the nearest steps).
- Meters: `--meter-1…4` (green-700, amber-700, amber-800, red-700) and `--meter-off` (gray-100). Date tracks: `--bar-good` / `--bar-crit`, `--bar-warn` (amber-700, due within 14 days) and `--bar-far` (gray-600). Heat scale `--h1…h4` (fill) / `--h1i…h4i` (text) for the risk heatmap.
- **When colour is allowed:** option and status values, focus, links and the semantic states (good, warn, crit, info), always next to text or a symbol that says the same. Everything else is monochrome.

### 6.2 Type

Tailwind utilities with Geist's sizes, line heights and tracking (px, independent of the 14 px root). Spacing utilities follow Geist's 4 px grid whatever the root size (`--spacing: 4px`: `p-2.5` is 10 px, `size-4` 16 px). The fonts are the Geist and Geist Mono versions Google Fonts serves (`@fontsource/geist`, `@fontsource/geist-mono`), self-hosted, so text measures the same as in the design.

| Style | Classes | Use |
|---|---|---|
| Heading (600, negative tracking) | `text-heading-72/64/56/48/40/32/26/24/20/16/14` | page `h1` = heading-26 (26 px on 31.2 px, −0.78 px, the board design's page title), card and dialog titles heading-16, KPI numbers heading-32 |
| Label (single line) | `text-label-20/18/16/14/13/12`, `text-label-14-mono/13-mono/12-mono` | controls, cells, menus, meta; ids, codes and counts in mono |
| Label half steps (the board design) | `text-label-13.5/12.5/11/9.5`, `text-label-12.5-mono/11.5-mono/11-mono/10.5-mono` | 13.5: buttons, sheets in the side menu, option boxes; 12.5: Table dates and scores; 11 / 11.5 mono: counts on controls, update pills, key hints; 10.5 mono: "in 65d"; 9.5: initials in 22–24 px avatars |
| Copy (running text) | `text-copy-24/20/18/16/14/13`, `text-copy-14-mono/13-mono` | descriptions, help, empty states |

Label and copy set no weight: add `font-medium` (500) or `font-semibold` (600, the heaviest Geist weight we use). `cn()` knows these are font sizes (`src/lib/utils.ts`).

### 6.3 Materials and radius

- Cards and sections: white, a 1 px `--line` border, **no shadow**. Shadows only on floating surfaces: `shadow-tooltip`, `shadow-menu` (popovers, menus, cell editors, search results), `shadow-modal` (dialogs), `shadow-fullscreen` (side sheets, the item panel).
- Radius: `rounded-md` 6 px controls and option boxes, `rounded-lg` 8 px cards, `rounded-xl` 12 px large surfaces (dialogs, the public form), `rounded-full` pills and avatars.

### 6.4 Controls

- Buttons (`src/components/ui/button.tsx`): `default` primary (black, near-white text), `outline` / `secondary` (white, 1 px border), `ghost` / `tertiary` (no border, gray-alpha hover), `destructive` (red), `link`. Sizes: `sm` 32 px, default 40 px, `lg` 48 px; icon buttons the same squares. 150 ms transitions on colour, background and border; `active:scale-[0.98]`. The sheet page follows the board design: header actions 36 px, toolbar controls 38 px (`toolbar-styles.ts`).
- Focus: a 2 px `--focus` (blue) outline 2 px clear of the control, everywhere (`globals.css`); text inputs show a blue border and a soft blue ring instead.
- Inputs and selects: 40 px (32 px inside editors and dense rows), white, 1 px `--line` border, `--line-strong` on hover, 6 px radius. Menus and popovers: 8 px radius, border, `shadow-menu`, 14 px items with a gray-alpha highlight. Switch: black when on, gray-700 when off, always with its state word. Toasts: dark, bottom centre.
- Option values outside the Table show a colour dot with the label (plus "!" for action needed and a check for done).

## 7. States

Every list, table and panel needs: skeleton loading (no layout shift), empty state with one action ("No items yet. Add the first one." + button), error state with Retry, and offline banner ("You are offline. Changes will fail until you reconnect."). Toasts: bottom centre, dark, 4 s, with "Undo" for archive and bulk edits.
