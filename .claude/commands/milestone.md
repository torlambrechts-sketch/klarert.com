---
description: Plan and build the next unfinished milestone from docs/06-build-plan.md
argument-hint: "[milestone id, e.g. M4] (optional)"
---
1. Read CLAUDE.md and docs/06-build-plan.md. If an argument was given ($ARGUMENTS), take that milestone; otherwise take the first milestone with unticked boxes.
2. Read every doc the milestone touches (CLAUDE.md lists which doc covers what). Read the relevant parts of reference/sheets-mvp.html, reference/compliance-os-sun-v2.html or, for the Table and its menus, reference/keptrow-table-prototype.html when behaviour or layout is unclear.
3. Write a short plan in the chat: files to add or change, tests to add, open questions. If anything is undecided in the docs, ask me before building.
4. Create a branch `m<N>-<slug>`. Build in small commits. Write tests alongside the code.
5. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`. Fix until green. Never weaken a test.
6. Tick the boxes that are now true in docs/06-build-plan.md, commit, push and open a PR titled "M<N>: <name>" with a checklist of what was done and anything left open.
