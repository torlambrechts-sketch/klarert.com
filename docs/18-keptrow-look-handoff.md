# 18 · Keptrow look: design handoff for the whole app

The look of every screen comes from the Keptrow prototype: the shell, colours, type, cards, pages, menus and the
Table. This document is the brief; the prototype is the reference.

**Owner decision (18 Nov 2026).** The whole app takes the Keptrow look: navy rail and side panel, white top bar,
navy hero band with cards that overlap it, Figtree type, pill buttons, white cards on a pale page, solid option
colours, and the rule that more than three related buttons become one menu. It replaces the Geist monochrome look
of `docs/05` §6.

**Which document wins.** This document wins on the **look** (layout, colours, type, spacing, components, states).
`docs/05` wins on **what is on each screen** (routes, menu groups and roles, features, copy, behaviour, keyboard
rules, phone navigation). When they disagree, keep `docs/05`'s content and give it this document's look.

## 1. The reference

| File | What it is |
|---|---|
| `reference/keptrow-prototype.html` | The working prototype. Open it in Chrome; demo data is kept in `localStorage` (key `keptrow-proto-v11`), "Reset demo data" at the foot of the side panel |
| `reference/keptrow-look/prototype.css` | Its whole stylesheet (about 400 rules), unchanged, for reading. Do not import it: rebuild it with the tokens in §3 and Tailwind |
| `reference/keptrow-look/desktop-*.jpg` | Every page at 1440 px: Home, Dashboards, the sheet's Table, Kanban, Dashboard and Insights, the item panel, Workflows, the flow editor, the relationship map, Frameworks, the Audit room, the Activity log, a filter menu, a dialog, the option picker with the bulk bar |
| `reference/keptrow-look/phone-*.jpg` | The same pages at 390 px |

Copy the look and the measurements. Do not copy the prototype's structure (one HTML file with string templates):
the product keeps its stack (Next.js, Tailwind v4, shadcn/Radix, TanStack Table), the field UI registry (no `switch`
on field types outside `src/engine/fields/`, CLAUDE.md rule 1) and commands for every write (rule 2).

## 2. Look at a glance

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [≡✓ keptrow]      [ Search items, sheets and files           ]   Workspace ▾  🔔  (TA Tor) │  top bar, white, 69 px
├──────┬────────────────┬──────────────────────────────────────────────────────────────┤
│ rail │ side panel     │ HERO (navy): Home / Sheets / Corrective actions                  │
│ navy │ pale blue      │ Corrective actions                         ◯ deco circles        │
│ 80px │ 288 px         │ one-line description                                             │
│ [▣]  │ Workspace   ‹  │ ┌──────────────────────── card overlaps the hero ────────────┐ │
│ [⌂]  │ ⌂ Home     !9  │ │ header card: select, figures, tabs, toolbar                   │ │
│ [▥]  │ SHEETS         │ └──────────────────────────────────────────────────────────────┘ │
│ [⚡]  │ ...            │ ┌ card ┐ ┌ card ┐ ┌ card ┐   white cards on #F2F4F8               │
└──────┴────────────────┴──────────────────────────────────────────────────────────────┘
```

## 3. Tokens (`src/app/globals.css`)

Replace the Geist colour and type tokens with these. Components use the semantic names, never hex. Keep Geist's
spacing scale only where a measure below is missing.

```css
:root {
  /* brand */
  --navy: #00005E;        /* rail, hero, headings, item panel header, toast */
  --brand: #0000A0;       /* primary buttons, links, active tab line, accents */
  --brand-2: #2A2AB5;     /* buttons on navy (take-action rows), hover #3535C2 */
  --brand-soft: #DCEDFF;  /* active rail button, avatars, tags, soft badges, hero sub-text */
  --sky: #9FC4EC;         /* step tops, secondary series, logo's third bar */
  /* surfaces */
  --page: #F2F4F8;        /* app background */
  --panel: #F4F8FD;       /* side panel, callouts, hover rows */
  --surface: #FFFFFF;     /* cards, dialogs, drawers */
  --kanban-col: #E8EDF5;
  /* text and lines */
  --ink: #000000; --muted: #474748; --faint: #8A8A8C;
  --line: #E3E3E3; --line-input: #8A8A8C; --line-soft: #DCE3EC;
  /* states (text on white ≥ 4.5:1) */
  --ok: #0B6B43; --bad: #B3261E; --warn: #E07B00; --warn-ink: #7A4100; --bad-ink: #9B1C14;
  --badge-orange-bg: #FFF1DC; --badge-red-bg: #FDE7E6; --badge-green-bg: #E3F4EE;
  /* option colours, solid with white words (Table cells, pickers) */
  --opt-green: #0B6B43; --opt-orange: #B35A00; --opt-red: #B3261E; --opt-blue: #2F5FC9;
  --opt-grey: #6B6B6C; --opt-purple: #5B37B0; --opt-teal: #00787A; --opt-high: #C8281E;
  /* shape */
  --radius-card: 8px; --radius-dialog: 12px; --radius-input: 4px; --radius-pill: 999px;
  --shadow-card: 0 1px 4px rgba(0,0,94,.08);
  --shadow-menu: 0 8px 28px rgba(0,0,94,.20);
  --shadow-drawer: -8px 0 30px rgba(0,0,40,.18);
  --scrim: rgba(0,0,40,.45);
  --focus: #3B6FE0;       /* 3 px outline, 2 px offset */
}
```

- **Type: Figtree**, self-hosted with `next/font/local` (OFL licence; 400, 500, 600, 700; no Google Fonts request).
  Geist Mono stays for ids, hashes and codes. Body 15 px / 1.4. Scale: hero title 40 px 600 −0.5 px (30 px on
  phones); big figure 28 px 600; KPI 22–24 px 600; card title 18 px 600; side panel title 20 px 600 navy; nav item
  16 px (700 when active); hero sub-text 17 px; body 15 px; `.sub` 14 px muted; tabs 14 px 600 uppercase 0.05 em;
  section labels 12 px 600 uppercase 0.06 em muted; badges and chips 12–13 px 600.
- **Focus:** 3 px `--focus` outline 2 px clear of every focusable control. **Motion:** 150 ms on colour and
  position; none with `prefers-reduced-motion`.

## 4. Shell

- **Top bar:** white, 1 px `--line` bottom, 12 px × 24 px padding (69 px tall). Left to right: the logo (the mark,
  then "keptrow" 28 px 600 `--brand`, −0.5 px, in a 288 px slot; the mark is a 30 px SVG of two navy bars, a short
  `--sky` bar and a green tick, `MARK` in the prototype); search (44 px pill, max 520 px, `--line-input` border,
  search icon 16 px from the left); at the right the workspace switcher (navy words, chevron), the bell (44 px, an
  orange dot when unread) and the user pill (44 px, 1 px `--brand` border, 32 px avatar, first name).
- **Rail:** 80 px, `--navy`, 20 px top padding, 10 px gaps. 48 px buttons with a 12 px radius and white icons; the
  active one `--brand-soft` with a navy icon. First a side-panel toggle (outlined white 35%), a 32 px separator, then
  one button per destination of the `docs/05` menu groups (Work, Registers, Reports, Build as icons), Help and
  Settings at the bottom.
- **Side panel:** about 288 px, `--panel`, 1 px right `--line`, 28 px × 16 px padding. Title = the workspace name
  (20 px 600 navy) with a collapse ‹ button. Section labels for the `docs/05` groups (12 px uppercase muted). Items
  44 px, 16 px navy words with an 18 px icon; active `--brand` and bold; hover underlines. Counts at the right
  (13 px muted; late counts `--bad-ink` bold with "!"). Collapsing leaves the rail; the page stretches.
- **Hero:** `--navy` band behind the page head: 32 px × 48 px padding with 120 px at the bottom; crumbs (14 px
  `--brand-soft`, underlined links, the current one white), title, one line of description (`--brand-soft`, max
  760 px). Decoration: three `--brand` circles at the top right (two 2 px outlines and one filled; `hero-deco`),
  hidden from screen readers.
- **Page:** `margin-top: -88px` so the first card overlaps the hero; 48 px side padding (16 px on phones); 24 px
  gaps; a main column and an optional 320–420 px side column (Home's assistant, the builders' inspector) that wrap
  under 1000 px.
- **Phones (< 640 px):** keep `docs/05` §5 navigation (one Menu in a bottom bar, Search and Inbox at the top) in this
  look: navy bottom bar with white icons, the active one on `--brand-soft`; the side panel as a full-height sheet in
  `--panel`. The hero uses 24 px × 20 px padding and a 30 px title; cards 16 px side padding. Nothing scrolls the
  page sideways at 390 px.

## 5. Components

- **Card:** white, 8 px radius, `--shadow-card`, 20 px × 24 px padding; head with an 18 px title and 14 px muted
  text on the left, actions on the right.
- **Summary card** (first card of a page): 24 px × 32 px padding; a big figure or sentence, a 6 px progress bar
  (`--brand` on `--brand-soft`), a muted line, and a facts list on the right (muted term, navy 500 value).
- **Buttons:** pills. Default 44 px, 20 px padding, 15 px 600, 2 px `--brand` border; primary filled `--brand` with
  white words; secondary white with `--brand` words; `sm` 40 px (1 px border, 14 px), `xs` 32 px (13 px); danger
  `--bad` border and words; link buttons `--brand` 600.
- **Pills and segments:** 40 px, 1 px `--brand`; on = filled. A segmented control is two or three joined pills
  (Flow canvas / Step list).
- **Tabs:** underline tabs, 14 px uppercase, 28 px apart, 44 px tall, 3 px `--brand` line on the active one with
  navy words. More than three → two tabs and **More ▾** (§7).
- **Inputs:** 44 px fields, 4 px radius, `--line-input` border; labels above in 14 px 500; selects in page headers
  17 px 600 navy; the sheet search a 40 px pill.
- **Badges:** 13 px 600 pill, 4 px × 12 px padding: blue `--brand-soft`/navy, orange `#FFF1DC`/`--warn-ink`, red
  `#FDE7E6`/`--bad-ink`, green `#E3F4EE`/`#0B5A42`, grey `--page`/`--muted`; done and action-needed carry ✓ and !.
- **Tags:** 12 px 600 navy on `--brand-soft`, pill.
- **Switch:** 40 px pill with a 44 × 26 knob track, `--brand` when on; the words say the state ("On after saving").
- **KPI tiles:** grid of tiles at least 170 px wide; 1 px `--line`, 8 px radius, 14 px × 16 px padding; 14 px muted
  label and 22–24 px figure (`--bad` with "!" when late). Figures, not buttons.
- **Date chip:** 48 px wide, `--brand-soft`, 8 px radius, 18 px day and 11 px month; late is red on `#FDE7E6`.
- **List rows:** 12 px vertical padding, 1 px `--line` between rows, date chip or avatar on the left.
- **Take-action banner (Home):** `--brand` card, 24 px × 32 px padding, white words; a chart on the left; action
  rows on the right (52 px, `--brand-2`, 6 px radius, 500 words, "VIEW" in 12 px tracked capitals).
- **Tiles (Home quick starts):** white cards at least 200 px wide, 118 px tall, 18 px × 20 px padding, an icon top
  left, a bold title, one muted line, a chevron top right.
- **Widgets:** grid of 420 px minimum columns, 24 px gaps (one column under 1000 px; a wide widget spans the row);
  head with an 18 px title and one ⋯ button for its tools (§7). Charts use `--brand`, `--sky` and the option
  colours; donuts with the total in the middle and a legend with counts; bars as 12 px pills on `--page`.
- **Assistant panel (Home side column):** white card, sticky, max 400 px; tabs at the top; a bubble in `#E5F0FD`
  with navy words; suggestion chips (36 px, `#D4DDE8`, 4 px radius, 13 px 600); an input pill at the bottom.
- **Kanban:** columns in `--kanban-col` (8 px radius, 14 px padding, 10 px gaps, min 240 px); cards white, 8 px
  radius, light shadow, 12 px × 14 px padding; WIP limit in the column head, red tint when over.
- **Item panel (drawer):** fixed right, `min(520px, 100%)`, `--shadow-drawer`, over a `--scrim` backdrop. Navy
  header (18 px × 20 px padding): id in mono, tools, an editable 22 px title, and tabs (white underline; two +
  More, §7). Body 20 px padding, 16 px gaps; fields on a 140 px label column (stacked on phones), rows at least
  44 px.
- **Dialog:** white, 12 px radius, 28 px padding, 580 px (wide 820 px) on `--scrim`; 22 px title, 14 px muted
  sub-line; actions at the bottom right, primary last.
- **Toast:** navy pill at the bottom centre, white 500 words, max 720 px; it says what happened and what
  automations did.
- **Callout:** `--panel`, 6 px radius, 14 px × 16 px padding.
- **Flow editor:** dotted canvas in a card; nodes 240 × 78 px, white, 1 px `--line-soft`, a 4 px top border in the
  step's colour (navy trigger, orange condition, `--sky` actions), a 22 px icon chip and 13 px words; edges 2 px
  `--sky` curves with Yes / No labels on green and red badges; insert points are 22 px dashed circles with "+"; the
  End pill is navy. Palette as `xs` pills above the canvas, zoom − % + and Fit. The inspector in the side column:
  Edit, Settings, Test run and Checks cards, then Save (primary), Cancel and Delete (danger).
- **Relationship map:** sheets as white rounded boxes on a pale canvas with a navy title, item counts and "! n late";
  link edges navy, workflow edges dashed orange; a "+" handle on each sheet draws a new connection; a side card
  shows the selected sheet's links, columns and workflows.
- **Option and people pickers, menus, bulk bar:** §7 and §8.

## 6. Pages

Each page uses the shell and keeps the content `docs/05` gives it. Reference images show the look:

| Page | Reference | Notes |
|---|---|---|
| Home | `*-01-home` | Greeting hero; the take-action banner overlapping it; quick-start tiles; Due soon and overdue, Open items by sheet, Automations, Most used; the assistant in the side column |
| Dashboards | `*-02-dashboards` | Header card (person filter, period, tabs, Add widget + More); widget grid |
| Sheet | `*-03` to `*-06` | Header card (sheet select, automations count, KPI tiles, tabs, toolbar); then the Table (§8), Kanban, the sheet's dashboard or Insights |
| Item panel | `*-07` | Drawer as §5 |
| Workflows, Automations | `*-08`, `*-09` | List of workflow cards (trigger sentence, steps, last runs); the builder with canvas and inspector |
| Design, relationship map | `*-10` | The map as §5 |
| Frameworks | `*-11` | Coverage cards per framework (stacked bar, %), tabs, requirement rows with status badges and control chips |
| Audit room | `*-12` | Summary card with progress and facts; requests, samples, evidence check, frozen evidence, log |
| Activity log | `*-13` | A table with the hash column in mono; chain status in words with ✓ or ! |
| Every other page (Workspace admin, My work, Evidence library, sign-in …) | none | Same shell, hero, cards, tabs and controls; no new patterns without asking |

## 7. The menu rule (everywhere)

Owner rule (18 Nov 2026): **more than three related buttons become one dropdown menu.** Related means they act on
the same thing or choose between options of one setting.

- **Action groups** of four or more: keep the main action visible, put the rest in **More ▾** (Radix
  `DropdownMenu`). Destructive items last, after a separator, in `--bad`, ending in "…" when they open a confirm.
- **Choice groups** (filters, show options) of four or more: one trigger that shows the current choice
  ("Show All · 15", "View Main table") and opens `menuitemradio` items with counts.
- **Toggle groups** of four or more: a menu of `menuitemcheckbox` items that stays open while toggling.
- **Tab bars** of four or more: two tabs, then **More ▾**; when the active tab is in the menu, the trigger shows
  its name and the active line.
- **Icon groups** on cards (widget tools, row actions): one **⋯** button with a menu.
- Menus: white, 8 px radius, `--shadow-menu`, 6 px padding (16 px for panels), items at least 38 px, 14.5 px words,
  an 18 px icon or tick column. Keyboard: Enter or Space opens and focuses the first item, ↑ / ↓ move, Escape
  closes and returns focus to the trigger. Close on an outside click and when the page scrolls. Portal inside
  scrolling areas so menus are never clipped.

## 8. The Table

- **Toolbar:** View ▾ (quick views with counts, saved views, "Save current view…"), Search (40 px pill), Filter ▾
  (one panel: columns of options with counts), Sort ▾, More ▾ (Group by, Show one group, Columns, density, Add
  field, sub-items, Actions, Export to CSV), ⚡ n. KPI tiles above the tabs: Items, Open, Overdue, the alert status,
  Missing evidence.
- **Group header:** 32 px chevron and the name in 18 px 600 in the group colour, "n items" (· "m shown" when
  filtered); a collapsed group shows a 160 px status bar. Grouping by the sheet's groups or any option or people
  field; "+ Add item" in such a group sets that value.
- **Grid:** `#E3E3E3` lines, rows 40 px (52 px comfortable), white. Checkbox column 44 px sticky with a 6 px bar in
  the group colour on its left; name column 340 px sticky with a 1 px edge and no shadow (id in mono, the name as a
  link, sub-item chip, checklist chip); field columns at the registry widths; actions 52 px sticky at the right with
  a ⋯ menu (Open item, Duplicate, Notify the owner, Delete…). Headers 38 px, 13.5 px 500 muted, each a sort button
  (▲ ▼) with a dot when filtered.
- **Option cells:** the whole cell in the option's solid colour with white 13.5 px 500 words, "!" for action needed
  and ✓ for done; empty cells `--page`. Click opens the picker under the cell (coloured options, the current one
  ringed, Clear for dropdowns). **People cells:** 28 px avatar and short name; the people picker.
- **Summary row** (on by default): status battery (segments in option colours, grey for empty; its accessible name
  lists the counts) for option fields, avatars for people, Σ for numbers and count rollups, the date range for
  dates, "n of m" for files, the average for scores.
- **Width:** when the card is wider than the table, field columns share the extra width in proportion to their
  default or resized width; checkbox and actions fixed; never below the defaults; narrower cards scroll sideways.
  The table ends in a clear right edge: a 1 px stronger line with a radius at the top and bottom right.
- **Bulk bar** with rows selected: bottom centre, 60 px, a navy count square, "n items selected", Status, the
  people field, More (Duplicate, Export to CSV, Delete…), ×. **Delete** confirms with the list; the activity log
  keeps the record.

## 9. Decisions (owner, 18 Nov 2026)

| # | Topic | Decision |
|---|---|---|
| C1 | One-option values in the Table | Solid full cell, white words, "!" and ✓ |
| C2 | Column widths | Proportional fill, never below the default or resized width |
| C3 | Brand and type | **The whole Keptrow look:** navy/blue tokens (§3), Figtree self-hosted, Geist Mono for codes; replaces the Geist look of `docs/05` §6 |
| C4 | Row height | 40 px; 52 px comfortable density |
| C5 | Sticky name column edge | 1 px line, no shadow |
| C6 | Group summaries | On by default |
| C7 | People cells | Avatar and short name |
| C8 | Table toolbar | View, Search, Filter, Sort, More, ⚡ |
| C9 | Shell | Navy rail, pale side panel, white top bar, navy hero with overlapping cards (§4); `docs/05` menu groups and roles inside it |
| C10 | Phones | `docs/05` §5 navigation (bottom bar Menu, Search, Inbox) in the Keptrow look |

## 10. Mapping to the code

| Prototype | Product |
|---|---|
| `:root`, body type | `src/app/globals.css` tokens (§3); `src/app/layout.tsx` loads Figtree with `next/font/local` (woff2 files under `src/fonts/`, beside Geist Mono) |
| `.topbar`, `.rail`, `.panel`, `.hero` | `src/components/shell/*` (top bar, side menu, a new rail, page header with the hero) |
| `.card`, `.summary`, `.kpis`, `.tile`, `.badge`, `.btn`, `.pill`, `.switch`, `.utabs` | `src/components/ui/*` (shadcn variants: button sizes and pill shape, badge tones, tabs, switch) and small page components |
| `.widget`, charts | the dashboard and widget components |
| `.drawer`, `.modal`, `.toast` | the item panel, `ui/dialog.tsx`, `ui/sonner.tsx` |
| `ddMenu`, `tabBar` | `ui/dropdown-menu.tsx` plus an `OverflowTabs` component |
| Table (`mGroup`, `gcell`, `sheetTools`, `lpHtml`, `bulkBar`, `fitTables`) | `src/components/table/*` through the field UI registry; widths in the TanStack column model |
| `.canvas`, `.fnode`, `.insp` | the automation builder and Design map components |

## 11. Acceptance checks

- [ ] Tokens and Figtree in place; no Geist Sans left; no hex in components.
- [ ] White words on `--brand`, `--navy` and every `--opt-*` colour at least 4.5:1 (tested on the token values).
- [ ] The shell matches `desktop-01-home.jpg` at 1440 px: top bar, rail, side panel, hero, overlapping first card.
- [ ] Every page in §6 matches its reference image at 1440 px (allowing for real content).
- [ ] At 390 px every page follows `docs/05` §5 navigation in the Keptrow look; nothing scrolls the page sideways.
- [ ] No button group on any screen has more than three related buttons (§7).
- [ ] Every menu: Enter opens, ↑ / ↓ move, Escape closes and focus returns to the trigger; menus in the Table are
      not clipped.
- [ ] Table: solid option cells with pickers, avatar and name, summary row, proportional width, clear right edge,
      bulk bar; every change through commands with one activity log entry per item.
- [ ] The UI definition of done in CLAUDE.md on every screen touched.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` pass; Playwright screenshots of Home, a sheet, the item
      panel and the flow editor at 1440 and 390 px for review.
