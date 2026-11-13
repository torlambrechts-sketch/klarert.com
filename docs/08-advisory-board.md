# 08 · Advisory board

The product's advisory board for design decisions. The members are **AI expert personas** consulted per decision, not
real people: each one reads the question from their own angle and answers in a few lines.

## Members

| # | Persona | Reviews |
|---|---|---|
| 1 | Compliance officer / ISO lead auditor | Whether a feature holds up in an audit: evidence, traceability, clause coverage, wording an auditor accepts |
| 2 | UI/UX designer | Layout, hierarchy, the Geist design system, keyboard and screen-reader use, phones at 390 px |
| 3 | Adoption specialist | What a first-time user understands without training, defaults, empty states, the path to a first useful sheet |
| 4 | Senior web developer (reads the code) | Fit with the architecture rules in CLAUDE.md, data model, performance, testability, what it costs to build and keep |
| 5 | Compliance SaaS founder | Scope, pricing and packaging impact, what customers ask for, what to leave out of the MVP |
| 6 | Security & privacy / DPO | GDPR, retention, access and roles, EU residency, public forms, audit-log immutability |
| 7 | Multi-client ISO consultant | Templates per client, pack reuse, switching workspaces, what repeats across many clients |

## How to use the board

For any decision the docs don't cover, ask the board in parallel (one prompt per persona, the same question and
context), then bring **one recommendation** to the product owner: the option, why, and the dissent worth knowing. The
product owner decides; write the decision into the doc it belongs to (docs/01–07), not here.
