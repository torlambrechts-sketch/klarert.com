# 08 · Accessibility (M10)

Target: WCAG 2.1 AA (docs/01 §6). Two automated checks guard it, and both run in CI with the rest of the e2e suite.

## Automated checks

`tests/e2e/accessibility.spec.ts` runs axe (`@axe-core/playwright`, tags `wcag2a wcag2aa wcag21a wcag21aa`) on a
workspace seeded with the first-sheet template, so every page has real content:

| Page | State checked |
|---|---|
| Home | summary, checklist, recent activity |
| Sheet · List | Corrective actions with five items, status pills |
| Sheet · Grid | groups, column headers, cells, add rows, summaries |
| Item panel | Details (summary, linked items, automations on the item, all fields) and Activity log |
| Automation builder | a new automation on Corrective actions |
| Automations | the list with the nine template automations |

The test fails on any **serious** or **critical** violation and prints the rule, the element and the reason.

### What the first run found and how it was fixed

| Rule | Where | Fix |
|---|---|---|
| color-contrast | white text on orange, green and pink fills (status blocks, action-needed pills, avatars); group names in their colour | `--solid-<colour>` tokens: the label colour darkened just enough for 4.5:1 (`solidVar()`), used wherever text sits on or is drawn in a label colour |
| label-content-name-mismatch | List cells ("Status of …" hid the shown value), the account button (initials not in its name), avatars | the shown value is part of the cell's name ("Status of CA-001: Investigating"); the account button's name starts with the initials; avatar initials are decoration (generated content), the name is read |
| aria-required-children | Grid rows owned a heading, checkboxes, the drag handle and the add-row input directly | every part of a row is a cell: the group header and add row are cells, the name cell holds the row's checkbox and drag handle, the header's sticky part is a column header |
| aria-prohibited-attr | the lock after a locked field's name, the required mark in the panel | the lock is `role="img"` with its label; the required mark is a hidden "*" plus "required" for screen readers |

The risk matrix editor's buttons sat in a `role="grid"` without rows; it is now a labelled group.

## Keyboard pass

`tests/e2e/keyboard.spec.ts` completes a core flow with the keyboard only (no clicks after the page loads), on the
seeded Corrective actions sheet:

1. **Tab** to "+ New corrective action", **Enter**: the focus moves to the "+ Add corrective action" row of Open. Type
   the name, **Enter** creates CA-006. **Esc** leaves the row.
2. **Shift+Tab** into the grid, **↓** to the new item, **→ →** to Status, **Enter** opens the status list, **↓**
   chooses Investigating, **Enter** saves.
3. **← ←** back to the name, **Space** opens the item panel.
4. **Tab** to the Details tab, **→** selects Updates (tabs move with the arrows), **Tab** to "Write an update", type,
   **Tab** to "Post update", **Enter** posts.
5. **Esc** closes the panel; the focus is back in the grid on the item it was opened from.

How the keys work in the grid (docs/05 §3.2): arrows move between cells, **Tab/Shift+Tab** move cell by cell like a
spreadsheet, **Enter/F2** edit, **Esc** cancels, **Space** toggles a check or opens the item from its name,
**Delete** clears, **Ctrl/Cmd+C/V** copy and paste. Because Tab moves within the grid, the toolbar's "+ New" button is
the keyboard route to the add row.

## Other states

- Status is never colour only: pills and blocks carry the label, a "!" for action-needed options and "✓" for done ones,
  with "(needs action)" / "(done)" for screen readers.
- Focus is visible everywhere (`--focus` outline); dialogs and popovers return the focus to where they were opened.
- The offline banner is a polite live region; error states use `role="alert"` with a Retry button; skeletons are
  `aria-busy` (docs/05 §7).
- Phones: everything works at 390 px (cards, bottom bar, full-screen panel), checked by the phone project of the e2e
  suite and step 11 of docs/07.

## Not covered by automation

Screen-reader announcements were not tested with a real screen reader, and axe does not judge whether names and
instructions make sense. A manual pass with VoiceOver or NVDA before the first customer is recommended.
