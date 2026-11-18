# 18 · Table design handoff (monday.com look)

The brief for rebuilding the sheet Table, its toolbar and its menus to match the Keptrow table prototype. Read it
with `docs/05-ui-layout.md` §3 and §6. Behaviour reference: `reference/keptrow-table-prototype.html` (open it in a
browser; the sheet page is the third icon in the left rail).

**Decided 18 Nov 2026.** The owner settled the conflicts in §2; `docs/05` now states the decisions. If this document and
`docs/05` still disagree anywhere, `docs/05` wins and the difference is a doc bug to fix.

## 1. How to use the prototype

- It is a single HTML file with plain JavaScript and no build. Open it in Chrome; state is kept in
  `localStorage` (key `keptrow-proto-v11`). Clear it to reset the demo data.
- The table code is in the block that starts `/* ---------- dropdown menus` and ends before
  `/* ---------- sub-items`. Functions: `ddMenu`, `tabBar`, `gcell`, `battery`, `sumCell`, `gridGroups`,
  `sortItems`, `mGroup`, `sheetTools`, the panels `filterPanel` / `sortPanel` / `groupPanel` / `hidePanel`, the
  overlays `lpHtml` (option picker) and `bulkBar`, and `fitTables` (width). Styles are in the CSS block that starts
  `.dd{`.
- Copy behaviour and measurements from it. Do not copy its structure: the product builds the Table with TanStack
  Table, `@tanstack/react-virtual`, Radix (shadcn) menus and popovers, and the field UI registry (rule 1 in
  CLAUDE.md: no `switch` on field types outside `src/engine/fields/`).

## 2. Decisions on the conflicts with docs/05 (owner, 18 Nov 2026)

Each row was a place where the prototype differed from `docs/05`. The last column is what the owner chose; `docs/05`
has been updated to match.

| # | Topic | docs/05 before | Prototype | Decision |
|---|---|---|---|---|
| C1 | One-option values (status, dropdown, severity) | A box that hugs its words, tinted `--tint-<colour>-bg/-line/-ink` (§3.1 Cells) | The whole cell is the option's solid colour with white words (`--solid-<colour>`), monday style | **Solid full cell**, using `--solid-<colour>` so white words stay ≥ 4.5:1 |
| C2 | Column widths | Columns keep their widths; the trailing column takes the room left (§3.1) | Every column grows in proportion to its default width until the table fills the card; never narrower than the default | **Proportional fill**, never below the default or resized width |
| C3 | Brand and type | Geist, monochrome, black primary buttons, Geist Sans (§6) | Navy `#0000A0` / `#00005E`, Figtree in the hand-off bundle | **Navy as `--brand`**; Geist fonts, scales and layout stay (no Figtree: fonts are self-hosted Geist) |
| C4 | Row height | 52 px, compact 40 px | 40 px | **40 px**; 52 px as the comfortable density |
| C5 | Sticky name column edge | 1 px `--line`, no shadow (§3.1 Wide tables) | Soft shadow `4px 0 8px -4px` on the name column and the "…" column | **Keep the 1 px line** (no shadows) |
| C6 | Group summaries | Off by default; per column from its menu (§3.1) | On for every column with a summary function | **On by default** |
| C7 | People cells | 24 px avatar | 28 px avatar and the short name | **Avatar and short name** |
| C8 | Toolbar | Search, Actions, Show one group, status and owner filters, Sort, Filter, Columns, density, ⚡ (§3) | New item, View ▾, Search, Filter ▾, Sort ▾, More ▾ (§4) | **Prototype toolbar** (View, Search, Filter, Sort, More, ⚡) |

## 3. The menu rule (applies everywhere)

Owner rule (18 Nov 2026): **more than three related buttons become one dropdown menu.** Related means they act on
the same thing or choose between options of one setting.

- **Action groups** of four or more: keep the main action visible, put the rest in **More ▾** (Radix
  `DropdownMenu`). Destructive items go last, after a separator, in red, and end in "…" when they open a confirm.
- **Choice groups** (filters, show options) of four or more: one trigger that shows the current choice
  ("Show All · 15", "View Main table") and opens a menu of `menuitemradio` items with counts.
- **Toggle groups** of four or more: a menu of `menuitemcheckbox` items that stays open while toggling.
- **Tab bars** of four or more: the first two tabs, then **More ▾** with the rest; when the active tab is in the
  menu, the trigger shows its name and the active underline.
- **Icon groups** on cards (widget tools, row actions): one **⋯** button with a menu.

Where this applies in the product (check each against the prototype):

| Place | Before | After |
|---|---|---|
| Sheet view tabs | Table, Insights, Board, Calendar, Form, views | `docs/05` already has More ▾ for views; apply the 2 + More rule to the fixed tabs too |
| Item panel tabs | up to 5 | 2 + More |
| Table toolbar | 9+ controls | §4 |
| Row actions, widget tools | icons | ⋯ menu |
| Dashboard header | Share, Email summary, New, Delete, Add widget | Add widget + More |
| Workflows page | New workflow, New rule, Run daily check, Skip ahead; filter pills | New workflow + More; "Show" menu |
| Relationship map | three toggles, Reset layout | "Show on the map" checkbox menu |
| Frameworks | framework tabs + Library; six filter pills | 2 + More; "Show" menu with counts |
| Document control readers | one pill per person | "Add a reader" menu |
| Multi-option fields in the item panel | more than three option pills | checkbox menu that stays open |

Menus: 8 px radius, `shadow-menu`, 6 px padding, items at least 38 px, 14.5 px words, an icon or tick column of
18 px. Keyboard: Enter or Space opens and focuses the first item, ↑/↓ move, Escape closes and returns focus to
the trigger, Tab leaves. Menus close on an outside click and when the page scrolls (not when the menu itself
scrolls). Inside a scrolling table use a portal (Radix does this) so the menu is never clipped.

## 4. Toolbar (prototype)

Left to right, 8 px gaps, 40 px controls, wraps on narrow screens:

1. **New item** (primary).
2. **View ▾**: the quick views (Main table, My items, Overdue, Due in 7 days, the sheet's alert status, Missing
   evidence) with counts, the saved views, then "Save current view…". A saved view stores the quick view, search,
   owner filter, column filters, sort, hidden columns and grouping.
3. **Search** (pill, grows from 180 px).
4. **Filter ▾** (count when active): a panel with columns of options: "Show" (the quick views), then one column per
   option field (status, severity, dropdown, people) with a colour dot or avatar, the label and the count. Options
   toggle; "Clear all" resets. The panel stays open while toggling.
5. **Sort ▾** (shows the sorted column): a list of sortable fields; click once ascending, again descending, a third
   time off. Clicking a column header does the same.
6. **More ▾**: Group by… and Hide columns… (each swaps the menu to its panel), Add column, Turn on / Show all
   sub-items, Export to CSV, Share view.

Above the tabs: up to five key figures (Items, Open, Overdue, the alert status, Missing evidence). They are figures,
not buttons.

## 5. The table

Measurements from the prototype (subject to C1–C7):

- **Group header**: 32 px chevron button in the group colour (`aria-expanded`), the name 18 px semibold in the
  group colour, "n items" and "· m shown" when filtered. A collapsed group shows a 160 px status battery.
- **Grouping**: by sheet groups (default) or by any option or people field; a group per option in option order,
  then "No <field>" for empty values. "+ Add item" in such a group sets that value.
- **Columns**: checkbox 44 px (sticky left, 6 px left bar in the group colour), name 340 px (sticky, ID in mono then
  the name as a link, sub-item chip, checklist chip), field columns at the registry width, actions 52 px (sticky
  right, ⋯ menu: Open item, Duplicate, Notify the owner, Delete…). Header cells are sort buttons; a dot marks a
  filtered column. Grid lines in `--row-line` and `--col-line`; the right edge is a 1 px `--surface-line` with an 8 px
  radius at the top and bottom right so the table has a clear end.
- **Rows** 40 px; hover and selected rows get a soft background.
- **Option cells**: click opens a picker under the cell (listbox, coloured options, the current one ringed;
  dropdown fields add "Clear"). "!" stays in front of action-needed values and "✓" in front of done, so colour is
  never the only signal.
- **People cells**: avatar and name; click opens a picker of people.
- **"+ Add item"** row at the end of each group (Enter adds and keeps focus).
- **Summary row** under each group: a status battery (segments in option colours, grey for empty; its accessible
  name lists the counts) for option fields, avatars of the people present, Σ for numbers and count rollups, the date
  range for dates, "n of m" for evidence, the average for scores.
- **Width (C2)**: when the card is wider than the table, columns share the extra width in proportion to their
  default width; checkbox and actions stay fixed. Recalculate on window resize, panel open or close and side menu
  collapse. Narrower cards scroll sideways.
- **Selection and bulk bar**: row and group checkboxes; with one or more rows selected a bar sits bottom centre
  (60 px): the count, "n items selected", Status, the people field, More (Duplicate, Export to CSV, Delete…), ×.
  Status and people open the same picker and change every selected row; the toast says how many changed and which
  automations ran.
- **Delete** opens a confirm listing the items; the activity log keeps the record (`docs/02` append-only audit).
- **CSV export** uses the shown items, or the selected ones from the bulk bar, with display values (labels, not ids).

## 6. Mapping to the code

| Prototype | Product |
|---|---|
| `mGroup`, `gcell` | `src/components/table/table.tsx`, `table-cells.tsx` (through the field UI registry) |
| header sort buttons | `column-header.tsx` |
| group header, battery | `group-title.tsx`, `group-summary.tsx` |
| `sheetTools`, panels | `table-actions.tsx`, `columns-menu.tsx`, `group-select.tsx`, `toolbar-styles.ts` |
| `ddMenu`, `tabBar` | `src/components/ui/dropdown-menu.tsx` plus a small `OverflowTabs` component |
| `lpHtml` | a Popover listbox in the option editors (`src/components/editors/`) |
| `bulkBar` | the existing bulk bar for selected rows |
| `fitTables` | column sizing in the TanStack Table model (`table-model.ts`), not DOM measurement |
| sub-item rows | `subitem-rows.tsx` (`docs/05` §3.2 wins) |

All writes go through commands (rule 2): picker changes, bulk changes, duplicate and delete call the same Server
Actions as cell edits.

## 7. Acceptance checks

- [x] The owner has decided C1–C8 and `docs/05` says what was decided.
- [ ] No button group on any screen has more than three related buttons (§3 table).
- [ ] Every menu opens with Enter, moves with ↑/↓, closes with Escape and returns focus to its trigger.
- [ ] Menus inside the table are not clipped by its scroll area.
- [ ] Option and people pickers change one cell, or every selected row from the bulk bar, through commands; the
      activity log has one entry per item.
- [ ] Group summaries show the battery, Σ, date range and evidence count as in the prototype.
- [ ] At 1920 px with the side menu collapsed the table fills the card and has a clear right edge.
- [ ] At 390 px nothing scrolls the page sideways; tables scroll inside their card (phones get cards, `docs/05` §5).
- [ ] Status shows text and a symbol for action-needed and done; contrast of white words on every solid option
      colour is at least 4.5:1.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` pass; Playwright covers the menu keyboard flow, the
      bulk bar and grouping by status.
