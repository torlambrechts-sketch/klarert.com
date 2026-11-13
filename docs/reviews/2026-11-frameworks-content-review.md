# Framework content review · November 2026

Compliance specialist review of the revision 2 catalogue content (titles, correctness, copyright, quality). Corrections shipped as revision 3. Open points for a human are listed at the end of each section.

# ISO/IEC 27001:2022 review, part 1 (clauses 4 to 10, A.5)

Scope: `templates/frameworks/iso-27001-2022.json`, all 79 refs not starting with A.6, A.7 or A.8 (7 clause themes, 34 clause refs, the A.5 theme and A.5.1 to A.5.37). Every ref was read in full.

Corrections: `/tmp/claude-0/-home-user-klarert-com/6731f747-ab47-5fe2-aedb-9c9c86223b1c/scratchpad/enrich/review/iso-27001-2022.part1.json` (27 refs, full entries, parses, all limits checked by script: title <= 80, purpose one sentence <= 300, guidance <= 1200, 3 to 5 questions <= 200, 3 to 6 evidence <= 160, no exclamation marks).

## Findings

| Ref | Issue category | What was wrong | What I changed |
|---|---|---|---|
| 4.1 | Correctness (missing obligation) | No mention of ISO/IEC 27001:2022/Amd 1:2024, which requires deciding whether climate change is a relevant issue; certification bodies audit it. Also stated "at least yearly" review as if it were the rule | Added the climate change decision to guidance, a question and an evidence item; reframed review frequency as "planned intervals, most organisations yearly" |
| 4.2 | Correctness (missing obligation) | No mention of the Amd 1:2024 note that interested parties may have climate-related requirements | Added to guidance and a question |
| 4.3 | Title; Copyright | Title used the abbreviation "ISMS" instead of the official wording. Guidance sentence tracked clause 4.3 a) to c) closely | Title set to "Determining the scope of the information security management system"; sentence rewritten in fresh wording |
| 5.2 | Copyright | Guidance listed the policy elements in the standard's order and near its wording | Rewrote in fresh wording, same substance |
| 6.1 | Quality (duplicate) | Question 4 and evidence 4 duplicated 6.1.1 ("how do you check actions worked", "effectiveness review notes") | Replaced with a question and evidence on how risk work changed objectives or plans |
| 6.1.1 | Correctness; Quality (duplicate) | Content repeated 6.1 and missed the point auditors test here: risks and opportunities to the management system itself (key-person dependency, budget, mergers), distinct from information security risks in 6.1.2 | Rewrote purpose, guidance, questions and evidence around system-level risks and opportunities |
| 6.1.2 | Correctness (outdated) | "Run it against assets, threats and vulnerabilities" implies the 2005-era asset-based method is required; the current edition allows any approach that identifies confidentiality, integrity and availability risks. "Comparable results" phrase close to the clause | Rewrote guidance: asset, scenario or process-based approaches; CIA framing; repeatability explained in own words |
| 6.1.3 | Correctness (missing obligation) | Statement of Applicability content incomplete: omitted justification for inclusion and implementation status; did not say controls can come from any source with Annex A as a cross-check | Rewrote guidance to cover all four SoA elements and other control sources; question 2 now tests inclusion reason, status and exclusion |
| 7.3 | Quality (duplicate); Correctness | Near duplicate of A.6.3 (onboarding, completion records, phishing tests, "measure awareness") and A.6.8 (how to report). Clause 7.3 is about the awareness outcome, including each person's contribution | Refocused on verifying what people know (policy, own contribution, consequences), with new questions and evidence; pointed training mechanics to A.6.3 |
| 7.5.1 | Correctness (incomplete list); Wrong clause | Mandatory documented information list missed the risk treatment process, treatment plan, operational records (8.1) and treatment results (8.3). Question 4 on supplier documents belongs to 7.5.3 (external origin) | Completed the list in own words; replaced question 4 with one on when written instructions are needed |
| 8.1 | Correctness (outdated 2013 wording); Copyright | Spoke of "outsourced processes" (2013); 2022 covers externally provided processes, products and services. Missed that clause 6 plans are implemented here and that planned changes are controlled. Unplanned change sentence close to the clause | Rewrote guidance; updated question 2 and evidence 3 |
| 9.2 | Quality (duplicate) | Questions repeated 9.2.2 (independence, objectivity, reporting) | New questions on cycle coverage, closure of findings, value to management, use in review; evidence 1 now a multi-year coverage plan |
| 9.2.1 | Wrong clause; Correctness | Content (criteria and scope per audit, external consultant for independence) belongs to 9.2.2. Stated "at least once per year" as a rule. Missed the two aims: conformity (standard and own rules) and effectiveness | Rewrote around conformity and effectiveness, planned intervals with typical practice stated as practice |
| 9.2.2 | Copyright | Guidance tracked the clause wording ("frequency, methods, responsibilities ... importance of the processes ... results of previous audits") | Rewrote in fresh wording; added criteria, scope and sampling question and evidence |
| 9.3 | Correctness (invented rule); Quality (duplicate) | "At least yearly and often twice" stated as a requirement; question 1 and evidence 4 duplicated 9.3.1 | Framed frequency as common practice; new question 1 on the end-to-end process; evidence 4 on action follow-up |
| 9.3.1 | Quality (duplicate); Correctness | Near copy of 9.3 (schedule, attendance, minutes). Missed that top management itself must review and reach a conclusion on suitability, adequacy and effectiveness | Rewrote purpose, guidance, questions and evidence on top management participation, extra reviews after major change and the recorded conclusion |
| 9.3.2 | Correctness (missing 2022 input); Copyright | Omitted the 2022 input on changes in interested parties' needs and the objectives fulfilment trend; list followed the clause closely | Rewrote guidance in own words with all inputs; added a question and an objectives progress evidence item |
| 10.2 | Correctness (missing obligation) | Did not mention changing the management system (or risk assessment) where corrective action shows it is needed | Added a sentence and an evidence item |
| A.5.1 | Quality (duplicate) | Questions and evidence nearly identical to clause 5.2 (approval, review, communication of the top-level policy) | Refocused on topic-specific policies: risk-driven set, management level of approval, review after significant change, consistency, audience acknowledgement |
| A.5.2 | Quality (duplicate) | Near copy of 5.3 (RACI, deputies, small teams combine roles, interview named people) | Refocused on asset, risk and control owners and specific security activities; new questions and evidence |
| A.5.4 | Wrong control | Question 2 and "Disciplinary process" evidence belong to A.6.4. Missed resources and confidential reporting route | Rewrote guidance, question 2 and evidence 3 |
| A.5.17 | Wrong control | MFA coverage (question 1, evidence) belongs to A.8.5 secure authentication and duplicated its questions | Refocused on allocation, handling, quality, password manager, machine secrets and exposure; MFA pointed to A.8.5 |
| A.5.18 | Wrong control | Evidence "Privileged access list" belongs to A.8.2 | Replaced with mover records showing rights adjusted |
| A.5.28 | Wrong control | Log retention (guidance, question 4, evidence) belongs to A.8.15 and duplicated its question | Replaced with evidence held by cloud providers and suppliers and admissibility across countries |
| A.5.30 | Wrong control; Quality (duplicate) | Centred on backups and restore tests, which is A.8.13 (duplicated its question) | Refocused on BIA, agreed RTO/RPO, ICT continuity design and plans, service-level recovery exercises |
| A.5.33 | Copyright | Purpose closely paraphrased the control statement ("loss, ... falsification and unauthorised access") | Rewrote purpose |
| A.5.35 | Correctness | Purpose said "outside view", but internal people independent of the area qualify. Overlap with 9.2 not explained | Rewrote purpose, guidance and questions: independence, scope (approach, people, process, technology), when internal audit can satisfy it |

Refs checked and left unchanged (52): themes 4, 5, 6, 7, 8, 9, 10, A.5; clauses 4.4, 5.1, 5.3, 6.2, 6.3, 7.1, 7.2, 7.4, 7.5, 7.5.2, 7.5.3, 8.2, 8.3, 9.1, 9.3.3, 10.1; controls A.5.3, A.5.5 to A.5.16, A.5.19 to A.5.27, A.5.29, A.5.31, A.5.32, A.5.34, A.5.36, A.5.37. Titles of all of these match the 2022 edition (descriptive own titles kept for the "General" sub-clauses 6.1.1, 7.5.1, 9.2.1, 9.3.1). No US spellings in our own text, no exclamation marks, all limits respected in the source.

## Summary

- Refs reviewed: 79. Refs changed: 27 (1 title, 26 content).
- By category (some refs have more than one): title 1, correctness 16, wrong clause or control 7, copyright 6, duplicate text 10.

## Needs a human

1. **A.5.21 title.** The official 2022 title is "Managing information security in the information and communication technology (ICT) supply chain" (98 characters), over the 80-character limit. The file uses the shortened "Managing information security in the ICT supply chain". Left as is; confirm the shortening is acceptable or raise the limit.
2. **A.5.34 title.** Kept "Privacy and protection of PII". Some published lists expand it to "personal identifiable information (PII)". Check against the purchased standard's Table A.1.
3. **A.5 theme title** uses "Organisational controls" while other titles in the file keep the published US spelling ("Context of the organization", "Organizational roles ..."). Allowed by the spelling rule; decide whether to make it consistent.
4. **Amendment 1:2024 (climate).** Added to 4.1 and 4.2. Confirm the product wants amendment content in the 2022 framework file (rather than a revision note), and whether the same amendment should be reflected in the 9001, 14001 and 45001 files, which received the same amendment.
5. **A.5.35.** The statement that most certification bodies do not accept their own audit as the independent review reflects common practice, not a rule in the standard; confirm with the certification body you work with.
6. Frequencies such as yearly context review, three-year audit coverage, "review critical suppliers at least yearly" (A.5.22), "at least yearly" register review (A.5.31) and "normally at least annually" reassessment (8.2) are not requirements of the standard. In the refs I rewrote they are now framed as common practice; A.5.22, A.5.31 and 8.2 were left as recommendations because they read as guidance, not as claims about the standard. Confirm this style is acceptable.
# ISO/IEC 27001:2022 review, part 2 (A.6, A.7, A.8)

Scope: `templates/frameworks/iso-27001-2022.json`, refs starting A.6, A.7, A.8. That is 59 refs: 3 themes and 56 controls (A.6.1–A.6.8, A.7.1–A.7.14, A.8.1–A.8.34). I checked every ref.

Corrections: `/tmp/claude-0/-home-user-klarert-com/6731f747-ab47-5fe2-aedb-9c9c86223b1c/scratchpad/enrich/review/iso-27001-2022.part2.json` (17 refs, each a full entry; the file parses, every entry is within the limits and none contains an exclamation mark).

## Findings

| Ref | Issue category | What was wrong | What I changed |
|---|---|---|---|
| A.6.1 | Correctness (missing obligation) | The text covered only checks before joining. The 2022 control also requires screening on an ongoing basis, which was missing. It also did not say how agency or contractor screening is confirmed, or what happens when a check is unfinished at the start date. | Purpose and guidance now cover re-screening when someone moves into a more sensitive role and at a set interval for high-trust roles. Added supplier confirmation and the case of a check unfinished at the start date. New questions and evidence for re-screening and agency confirmations. |
| A.6.3 | Correctness (invented limit), missing scope | "A refresher at least yearly" stated a frequency the control does not set. The control's "regular updates" on policy changes and its coverage of relevant interested parties (contractors) were missing. | The frequency is now one the organisation sets ("commonly yearly"), plus a refresh when a policy changes materially. Contractors are included. Added a question and evidence on communicating policy changes. |
| A.6.4 | Correctness (missing key point), copyright (close paraphrase) | Nothing required the facts to be established before action. Contractors were not covered. "Deliberate, a mistake or a first offence" followed the ISO 27002 list of factors closely. | Added fact-finding before sanctions, reach to contractors through their contracts and HR/legal involvement. Rewrote the proportionality sentence in our own words. New question on confirming a breach; added contractor clause and case-file evidence. |
| A.6.5 | Correctness (content belongs to other refs) | Most of the guidance, questions and evidence were about removing access and returning assets. Those are A.5.18 and A.5.11. The core of A.6.5 was underweighted: defining, communicating and enforcing duties that survive termination, and handing over security responsibilities on a change of role. | Rewrote purpose, guidance, questions and evidence around continuing duties, how leavers are reminded of them and handover on role change. Added a cross-reference to A.5.11 and A.5.18 instead of repeating them. |
| A.6.6 | Quality (wording), copyright (list paraphrase), missing element | "Reviewed by legal advice" was awkward. The list of agreement contents followed ISO 27002 closely. Consequences of breach and how to identify which relationships need an agreement were missing (the control says the need is "identified"). | Rewrote in fresh wording, adding consequences of breach and the triggers that require an agreement. Questions now ask how the need is decided and what triggers a template review. |
| A.7.2 | Correctness (missing 2022 scope) | Delivery and loading areas were not mentioned. They were 2013 A.11.1.6 and are now part of A.7.2. | Added a guidance sentence, a question and an evidence item (goods-in procedure) on delivery, loading and post areas. |
| A.7.6 | Copyright (close paraphrase) | The guidance followed the ISO 27002 guidance points item by item (need-to-know awareness, recording devices, vacant areas locked and periodically checked). | Rewrote the guidance as practical house rules in our own words. Questions and evidence unchanged. |
| A.7.10 | Correctness (wrong scope), missing obligation | The purpose included "paper". The control concerns storage media, and paper belongs to A.5.10/A.5.13 and A.7.7. The control's link to the classification scheme across the media life cycle was missing. | Purpose now names removable media types. Guidance and a question now tie handling to classification from issue to destruction, with courier and packaging measures for transport. |
| A.7.11 | Quality | The question "How do you rely on the provider for hosted services?" was unclear and did not ask for evidence. | Replaced it with a question on the assurance held from hosting providers about their power, cooling and connectivity. |
| A.7.14 | Correctness (missing obligation) | The control requires licensed software to be removed as well as data. That was missing, and so was the decision on damaged devices (destroy or repair). | Added licensed software, damaged devices and serial-numbered certificates. New question and licence-register evidence. |
| A.8.2 | Correctness (invented limit), quality (duplicate) | "At least quarterly in a smaller team" was an invented review frequency. Time-limited or just-in-time elevation was not mentioned. The question "How often are they reviewed?" duplicated A.5.18, and the evidence "Access review records" duplicated A.8.3. | The review interval is now planned and more frequent than for ordinary access. Added time-limited elevation and an independent check of the logs. Made the question and evidence specific to privileged access. |
| A.8.4 | Correctness (missing scope), quality (duplicate) | The control covers development tools and software libraries as well as source code, and they were missing. "How are secrets kept out of code?" duplicated A.8.28 and belongs there. "Secret scanning results" also belongs to A.8.28. | Added build pipelines, development tools and package libraries. Replaced the secrets question and evidence with ones on pipeline and registry access and the repository audit log. |
| A.8.13 | Quality (duplicate), missing scope | "When did you last test a restore?" and "Restore test records" were word-for-word duplicates of A.5.30. Backups of software and systems (the control's scope) and of SaaS data were not mentioned. | Added system images, configuration, software, encryption and ownership of cloud backups. Made the restore test question and evidence specific (which systems, timings, issues). Added provider backup terms. |
| A.8.15 | Quality (duplicate), missing obligation | "How long are logs kept?" and "Log retention settings" duplicated A.5.28. The control requires logs to be analysed, which only "make sure people can search them" touched. Logs were not protected from the privileged users they record. | Added log analysis, protection from administrators, a basis for the retention period and limits on personal data in logs. Made the questions and evidence specific. |
| A.8.17 | Quality (near-duplicate evidence) | "Time synchronisation configuration" and "Evidence of source settings on servers" were the same record. | Replaced the evidence list with distinct records: device configuration, endpoint and cloud settings, drift checks and a correlated log extract. |
| A.8.18 | Quality (vague evidence) | "Review records" was a generic item shared with A.5.9, A.5.31 and A.5.37. | Made the evidence specific: a periodic review of the utility list and authorised users, and access restriction settings for the utilities. |
| A.8.26 | Correctness (missing 2022 scope) | Requirements for application services that handle transactions were missing. They were 2013 A.14.1.2/A.14.1.3 and are now part of A.8.26. | Added transaction integrity, protection of payment data and accountability. Added a question on transaction and payment requirements and extended purchased software to cloud services. |

### Checked and left unchanged

- **Titles.** All 56 control titles match the official ISO/IEC 27001:2022 Annex A titles. This includes "Networks security" (A.8.20), which is the official wording. "Clock synchronisation" (A.8.17) differs from the published title only in spelling, which the review rules allow. Theme titles "A.6 · People controls", "A.7 · Physical controls" and "A.8 · Technological controls" match the official theme names.
- **Content judged correct and specific enough:** A.6.2, A.6.7, A.6.8, A.7.1, A.7.3, A.7.4, A.7.5, A.7.7, A.7.8, A.7.9, A.7.12, A.7.13, A.8.1, A.8.3, A.8.5–A.8.12, A.8.14, A.8.16, A.8.19–A.8.25 and A.8.27–A.8.34.
- **Other checks.** No 2013 control names or numbers appear in scope. Spelling is UK throughout. No limits are exceeded in the shipped file.

## Summary

- Refs checked: 59 (3 themes and 56 controls). Refs changed: 17.
- By category:
  - Correctness: 11 (A.6.1, A.6.3, A.6.4, A.6.5, A.6.6, A.7.2, A.7.10, A.7.14, A.8.2, A.8.4, A.8.26). Two of these are invented frequency limits: A.6.3 and A.8.2.
  - Copyright, close paraphrase of ISO 27002: 3 (A.6.4, A.6.6, A.7.6).
  - Quality, duplicates or vague items: 8 (A.6.6, A.7.11, A.8.2, A.8.4, A.8.13, A.8.15, A.8.17, A.8.18; some refs fall in more than one category).
  - Titles: 0.
- The A.8.2 and A.8.4 changes also clear duplicates with A.8.3 and A.8.28.

### For a human to confirm

1. **A.6.1 background checks.** Rules on criminal record and credit checks differ by country: in the UK, DBS eligibility; elsewhere in the EU, national rules and GDPR Art. 10 on criminal offence data. The guidance stays generic ("only where local law allows"). A country-specific note may be wanted later.
2. **Overlaps outside this scope.** Fixing those refs is part 1's job:
   - A.5.30 still asks "When did you last test a restore?" and A.5.28 still asks "How long are logs kept?". I made the A.8 side specific.
   - "Retention schedule" appears in both 7.5.3 and A.8.10. It is legitimate evidence for both, so I left it.
3. **A.6.5 cross-links.** A.6.5 now names A.5.11 and A.5.18 by ref. Please confirm that the in-app guidance may show Annex A refs; no other control text in this scope cites another ref.
# ISO 9001:2015 framework content review

Scope: `templates/frameworks/iso-9001-2015.json`, all 52 refs (7 themes, 45 clauses). Reviewed against the enriched content committed at HEAD (`a10de61`). The working-tree copy of the file was changing while I worked, apparently because other sessions were writing to it, so I reviewed a snapshot of HEAD. The snapshot is saved as `review/_head-9001.json`.

Corrections file: `review/iso-9001-2015.json` (23 refs, full entries). It parses as JSON. Every entry stays within the length limits. No exclamation marks. A sentence and item check across the whole file found no duplicate guidance sentences, questions or evidence items left after the corrections.

## Findings

| Ref | Issue category | What was wrong | What I changed |
|---|---|---|---|
| 4.1 | Correctness / quality | The purpose left out "purpose and strategic direction", which is the test the clause applies to issues. Two evidence items were vague ("Evidence of the latest review") and overlapped each other. | Added strategic direction to the purpose. Replaced the vague evidence with a register change history and horizon-scanning sources. |
| 4.2 | Invented rule | "Review it at least yearly" read as a requirement. The standard sets no review frequency. | Reworded to a review rhythm the organisation chooses, with yearly as an example. |
| 4.3 | Copyright | "Make the scope available as documented information" followed the clause wording closely. So did the non-applicability sentence. | Rewrote both sentences in fresh wording. The meaning is unchanged. |
| 5.1 | Quality / duplication | "Interview readiness of top management" is not a record an auditor can sample. The entry overlapped 5.1.1 and did not mention customer focus (5.1.2), which it also covers. | Made 5.1 the umbrella for 5.1.1 and 5.1.2. Added a customer question. Replaced the non-record with attendance records and leader follow-up logs. |
| 5.3 | Missing obligation | Two assigned responsibilities were missing: making sure the system conforms to the standard, and making sure processes deliver their intended outputs. | Added both to the guidance. |
| 6.2 | Missing obligation | The guidance did not say objectives must be communicated. | Added communication to the people who influence each objective, plus the matching pitfall. |
| 6.3 | Correctness | The purpose was about "consistency of results". The core concern of the clause is keeping the system intact while changes are made. | Reworded the purpose. Added system integrity to the guidance. |
| 7.1 | Near-duplicate | The purpose, guidance, question 3 and evidence nearly repeated 7.1.1. Examples: "Resource plan or budget" and "Resource planning or budget records"; the same constraints question. | Rewrote 7.1 as the umbrella across 7.1.1 to 7.1.6, with an overall resource review, distinct questions and distinct evidence. |
| 7.1.5 | Missing obligation | Three things were missing: recording the basis for calibration when no traceable standard exists; protecting devices from adjustments that would invalidate results; and calibration "before use" as an alternative to set intervals. "Label status, protect from damage, assess…" also tracked the clause list closely. | Rewrote the guidance to add all three in fresh wording. Added a question on protection against adjustment. |
| 7.5 | Near-duplicate | Questions 2 and 3 and two evidence items (retention schedule, current versions) repeated 7.5.3. | Made 7.5 the umbrella for 7.5.1 to 7.5.3. It now focuses on the structure of the document system and on proving one order end to end. |
| 7.5.1 | Quality | A question contained the placeholder "requirement X". | Replaced it with a concrete order-handling question. Added a question on the records the standard requires. |
| 7.5.3 | Missing obligation | The guidance did not cover protecting records from unintended alteration or loss of confidentiality. | Added both, plus the matching pitfall about editable records with no change trail. |
| 8.2 | Missing obligation | Three things were missing: communicating contingency actions; being able to back up claims about the offer; and requirements needed for the intended use. The complaint log evidence duplicated 9.1.2. | Added all three. Replaced the complaint log with order acknowledgements, amended order documents and contingency communications. |
| 8.4 | Missing scope | The guidance did not say the clause applies to outsourced processes and to services suppliers deliver directly to customers. It also did not cover what must be communicated to suppliers (approvals, competence, monitoring, checks at their premises). | Added the three cases the clause covers and the content of supplier communications. Added an outsourced-process question. |
| 8.5 | Missing obligation | Actions to prevent human error, a key addition in the 2015 edition, were missing. So were the property of external providers, reporting loss or damage of customer property to its owner, and periodic revalidation of special processes. Only four evidence items were given for six sub-clauses. | Added all of these. Added a human-error question. Added evidence for process validation and production change records. |
| 8.6 | Factual error | "Any exception needs customer or authorised agreement" makes the two approvals alternatives. In fact an early release needs a relevant authority and also, where applicable, the customer. | Corrected to "an authorised person and, where applicable, the customer". Added traceability to the person who released. |
| 8.7 | Missing obligation | Nonconformities found after delivery or during a service were not covered. The options for dealing with them left out containment, return and suspension. | Added both, and a question on problems found after delivery. |
| 9.1 | Near-duplicate | The purpose and evidence almost repeated 9.1.1 ("indicator list with methods" and "measurement plan"; "dashboards" and "trend reports"). | Rewrote 9.1 as the umbrella for 9.1.1 to 9.1.3, centred on tracing an indicator from data to decision. |
| 9.2 | Missing obligation | Two things were missing: changes affecting the organisation as a factor in planning the programme, and correction and corrective action "without undue delay". "All processes and clauses" went beyond the clause. | Added both. Reduced the coverage statement to all processes. |
| 9.3 | Near-duplicate | The questions and evidence repeated 9.3.1 to 9.3.3 (minutes with decisions, action tracker). The purpose left out alignment with strategic direction. | Rewrote 9.3 as the umbrella, centred on the review cycle across two meetings. Completed the purpose. |
| 9.3.1 | Correctness | The purpose gave only alignment with direction and left out suitability, adequacy and effectiveness. "Annual review calendar" assumed a frequency the standard does not set. | Completed the purpose. Changed the evidence to "Review calendar or schedule". |
| 9.3.2 | Factual error | It listed "changes to … interested parties" as an input. ISO 9001:2015 9.3.2 b) covers changes in internal and external issues only; interested parties appear only as a feedback source. The guidance also did not say performance data must show trends, or include product conformity. | Corrected the input list and added trends and product conformity. |
| 10.1 | Near-duplicate | The guidance repeated 10.3 ("use the outputs of analysis … management review"). It also did not cover the three areas the clause names, including future customer needs. | Rewrote it around the three directions of improvement and the forms improvement can take. 10.3 is unchanged. |

Refs checked and left unchanged: themes 4, 5, 6, 7, 8, 9 and 10, and clauses 4.4, 5.1.1, 5.1.2, 5.2, 6.1, 7.1.1, 7.1.2, 7.1.3, 7.1.4, 7.1.6, 7.2, 7.3, 7.4, 7.5.2, 8.1, 8.3, 9.1.1, 9.1.2, 9.1.3, 9.3.3, 10.2 and 10.3.

## Titles

All 38 clause titles that are not "General" match the official ISO 9001:2015 short clause titles. The 6 "General" clauses keep their descriptive own titles, as the brief requires: 5.1.1, 7.1.1, 7.5.1, 9.1.1, 9.3.1 and 10.1. No title changes were needed.

## Summary

- Refs reviewed: 52. Refs changed: 23 (all clauses; no themes).
- By category (one ref can have more than one):
  - Missing key obligations: 11
  - Near-duplicate parent and child content: 6 (7.1, 7.5, 9.1, 9.3, 10.1 and 5.1)
  - Correctness or factual errors: 4 (8.6, 9.3.2, 9.3.1, 6.3)
  - Copyright paraphrase: 2 (4.3, 7.1.5)
  - Invented rules or frequencies: 3 (4.2, 9.2, 9.3.1)
  - Quality: 3
- No limit violations. The original file was also within limits.

## Needs a human

1. **Theme 4 spelling.** The title is "Clause 4 · Context of the organisation", in UK spelling. The clause titles 4.1, 5.3 and 7.1.6 keep the published US "organization". The brief allows either spelling, so I left it. Pick one convention for themes across all ISO files: the 14001 and 45001 working copies currently show "Organisation and its context" for their themes.
2. **Granularity.** The library stops at second level for 5.2, 8.2 to 8.5, 8.7, 9.2 and 10.2. It also omits 7.1.5.1 and 7.1.5.2. Their sub-clauses, for example 8.2.3 and 8.5.1 to 8.5.6, are folded into the parent guidance. That is a design choice, not a content defect. Confirm it is intended for the SoA and for the cross-walk granularity.
3. **ISO 9001:2015/Amd 1:2024.** The climate change amendment adds text to 4.1 and a note to 4.2. Our content does not mention it. Decide whether 4.1 and 4.2 should prompt users to consider whether climate change is a relevant issue.
4. **8.6 approval wording.** Please confirm the corrected meaning with a lead auditor: early release needs a relevant authority *and*, where applicable, the customer.
# Review: ISO 14001:2015 and ISO 45001:2018 requirement content

Scope: every ref in `templates/frameworks/iso-14001-2015.json` (45 refs) and `templates/frameworks/iso-45001-2018.json` (50 refs), as merged at revision 2.
Corrections: `review/iso-14001-2015.json` (44 refs) and `review/iso-45001-2018.json` (46 refs). Each entry is the full corrected entry. Both files parse and meet every length limit (title <= 80, one-sentence purpose <= 300, guidance <= 1200, 3-5 questions <= 200, 3-6 evidence <= 160, themes title and purpose only).

The main problem: the generator wrote one generic text for "management system" clauses and reused it in both files, swapping only "environmental" for "health and safety". Before review, 24 clause pairs had identical or near-identical guidance, questions and evidence across the two standards (4.3, 4.4, 5.1, 5.3, 6.1, 6.2, 6.2.2, 7.1-7.5.3, 9.1, 9.1.1, 9.1.2, 9.2-9.2.2, 10.1, 10.3, and the 8.2 purpose). On top of that, all seven theme purposes were the same in both files. The swap also left a grammar error in 14001 4.1 ("matters to environmental"). Because of this, the shared text missed the obligations that make each standard different. I rewrote these clauses for each standard on its own terms.

## ISO 14001:2015

| Ref | Issue category | What was wrong | What I changed |
|---|---|---|---|
| 4 (theme) | Title; quality | Title "Organisation and its context" is not the official clause title. Purpose was generic and the same as in 45001 | Title "Clause 4 · Context of the organisation" (the same form 9001 uses). Purpose now environment-specific |
| 5-10 (themes) | Quality | Purposes generic and identical to 45001 | Purposes now name aspects, compliance obligations, life cycle and environmental emergencies |
| 4.1 | Correctness; quality | Missed the 14001-specific point: environmental conditions that affect the organisation or are affected by it (climate, flooding, water). Grammar error "matters to environmental". Text the same as 45001 | Rewrote around environmental conditions in both directions and the local setting. New questions and evidence |
| 4.2 | Quality | Did not show adopted commitments going into the compliance obligations register | Added the binding vs adopted decision and the link to 6.1.3, with examples (customer codes, net zero pledges) |
| 4.3 | Correctness; quality | Generic scope text shared with 45001. Did not cover control and influence, the rule that everything inside the boundary is in scope, or making the scope available to interested parties | Rewritten with control and influence, carving out sites with significant aspects, and public availability |
| 4.4 | Title; correctness | Title "Environmental management system and its processes" is the 9001 pattern. The 14001 heading is "Environmental management system". Text was generic | Title fixed. Guidance names the EMS processes and how 4.1/4.2 feed them |
| 5.1 | Quality; correctness | Generic leadership text shared with 45001. Nothing on significant aspects, compliance status or fit with strategy | Rewritten so leaders know the significant aspects and permit status, and environmental issues show up in investment and strategy decisions |
| 5.2 | Copyright; correctness | Guidance paraphrased the policy requirement list closely. Missed the "other specific commitments relevant to context" (e.g. climate, biodiversity, resource use) | Reworded in fresh language and added context-specific commitments |
| 5.3 | Quality | Generic text shared with 45001 | Environmental owners (permit holder, waste, chemicals, reporting) and the authority to stop a discharge |
| 6.1 | Quality | Generic parent text shared with 45001 | Joined-up planning across the aspects, obligations and risk registers |
| 6.1.1 | Correctness | Did not cover two-way environmental risk (the environment's effect on the organisation) | Added that, emergencies with environmental impact, and recording the planning process |
| 6.1.2 | Correctness | No control vs influence distinction, indirect aspects, planned or new developments, or telling staff about significant aspects | Added life cycle detail (purchased goods, transport, use, end of life), planned changes and communication of significant aspects |
| 6.1.3 | Quality | Thin. Did not say "how they apply". No examples | Added how each obligation applies, owners, permit and planning conditions, adopted commitments and examples of EU topics |
| 6.1.4 | Quality; copyright | Short, with a close paraphrase of "technological options and financial, operational and business requirements" | Reworded with a practical example and the link to the process that carries each action |
| 6.2 | Quality | Generic parent shared with 45001 | Objectives traced to significant aspects and obligations |
| 6.2.2 | Quality | Generic text shared with 45001 | Normalised environmental indicators (kWh per unit, tonnes to landfill) and budget integration |
| 7.1 | Quality | Generic text shared with 45001 | Environmental resources (bunds, spill kits, abatement, meters, laboratories, legal updates) |
| 7.2 | Quality | Generic text shared with 45001 | Roles that affect significant aspects and compliance, and training needs tied to aspects |
| 7.3 | Correctness | Missed a core awareness element: the significant aspects and impacts linked to each person's work, and the consequence of not meeting compliance obligations | Added both. Questions now test workstation-level awareness |
| 7.4 | Quality | Generic parent shared with 45001 | Reliable data, compliance obligations and responding to complaints |
| 7.4.1 | Correctness | Did not require communication to take compliance obligations into account or to be consistent with EMS data and reliable | Added statutory reporting, data checks and receiving outside communications |
| 7.4.2 | Quality | Near-identical to 45001 | Environment-specific (sharing waste and energy data, spill reporting route) |
| 7.4.3 | Quality | Near-identical to 45001 | Permit returns, producer responsibility data, neighbour complaints and substantiating green claims |
| 7.5, 7.5.1, 7.5.2, 7.5.3 | Quality | Identical text in both standards | 7.5.1 now maps the documented information 14001 requires (significance criteria, compliance evaluation and so on). 7.5.2 and 7.5.3 now cover permits, monitoring data integrity and waste record retention |
| 8.1 | Correctness | Missed control or influence over outsourced processes in proportion to your leverage, and giving users information on use and end of life | Added both, plus waste contractor checks |
| 8.2 | Quality | Purpose identical to 45001 | Purpose is environment-specific. Added fire-water run-off, drain covers and training for contractors |
| 9.1, 9.1.1 | Quality | Generic text shared with 45001 | Monitoring of significant aspect characteristics and permit parameters, laboratory and meter reliability, external reporting |
| 9.1.2 | Quality | Generic text shared with 45001 | Frequency based on risk, with permit limit and registration examples |
| 9.2, 9.2.1, 9.2.2 | Correctness; quality | Generic text shared with 45001. 9.2.2 did not weight by environmental importance | Programme weighted by environmental importance. Field checks of controls |
| 9.3 | Copyright; quality | The input list followed the clause enumeration closely | Reworded as a review pack. Added significant aspects, compliance status and strategy implications |
| 10.1 | Quality | Generic text shared with 45001 | Environmental improvement examples and measured benefit |
| 10.2 | Correctness | Weak on mitigating the adverse environmental impact | Added clean-up, mitigation, regulator escalation and an aspects register update |
| 10.3 | Quality | Generic text shared with 45001 | Normalised environmental trends. Output changes are not counted as improvement |

Unchanged: 6.2.1.

## ISO 45001:2018

| Ref | Issue category | What was wrong | What I changed |
|---|---|---|---|
| 4 (theme) | Title; quality | Title "Organisation and its context" is not official. Generic purpose | "Clause 4 · Context of the organisation". OH&S-specific purpose |
| 5-10 (themes) | Quality | Purposes generic and identical to 14001 | Purposes now name worker participation, the hierarchy of controls, contractors and incidents |
| 4.1 | Quality | Text the same as 14001 with the subject word swapped | Workforce context (agency labour, shifts, lone and home work, representation) |
| 4.3 | Title; correctness | Title "...health and safety management system" does not match the official wording "OH&S management system". Generic text | Title fixed. Off-site work, contractors on premises and higher-risk work left out of scope |
| 4.4 | Title; quality | Title "Health and safety management system and its processes" is not the 45001 heading ("OH&S management system"). Generic text | Title fixed. OH&S process set, including participation and contractor control |
| 5.1 | Correctness (serious) | Missed the 45001-specific leadership duties: overall accountability for preventing injury and ill health, protecting workers from reprisal when they report, making sure consultation and participation happen, supporting safety committees, and culture | Rewritten around these duties. Evidence includes a non-reprisal procedure and worker interviews |
| 5.2 | Copyright; correctness | List paraphrased the clause closely. Did not say "appropriate to the nature of OH&S risks" or mention worker representatives | Reworded. Added fit to specific risks, representatives, and communication for different languages and literacy levels |
| 5.3 | Correctness | Generic. Missed that workers at each level take responsibility for the parts of the system they control | Added that, plus supervisors, appointed roles and stop-work authority |
| 5.4 | Correctness | Mixed up consultation and participation (for example, it listed policy as a participation topic). Weak on time, training and resources | Separated consultation topics from participation topics, emphasised non-managerial workers, listed barriers, and noted that national law may add duties |
| 6.1 | Quality | Generic parent shared with 14001 | OH&S registers and planned changes |
| 6.1.1 | Correctness | Missed risks and opportunities to the OH&S system itself, and planned permanent or temporary changes | Added both |
| 6.1.2 | Correctness (serious) | Missed the core of 6.1.2.1: social and organisational factors (workload, hours, harassment, bullying), leadership and culture, human factors, design, people away from the site. Missed 6.1.2.2 (risks to the system) and 6.1.2.3 (OH&S opportunities, adapting work to workers) | Rewritten to cover all three sub-clauses, with psychosocial and non-routine questions and evidence |
| 6.1.3 | Quality | Thin and generic | EU framework and individual directives as transposed, statutory examinations, collective agreements, telling workers about changes |
| 6.2 | Quality | Generic parent, near-identical to 14001 | Worker input and sharing progress with workers |
| 6.2.2 | Quality | Generic text shared with 14001 | Leading and lagging indicators. Warning that injury-rate-only targets discourage reporting |
| 7.1 | Quality | Generic text shared with 14001 | OH&S resources (representatives' time, occupational health, first aid, statutory inspections) |
| 7.2 | Correctness | Generic. Missed competence to identify hazards | Added hazard recognition, appointed roles, expiring licences, agency workers |
| 7.3 | Correctness (serious) | Missed 45001-specific awareness items: incidents and investigation outcomes relevant to the worker, the hazards and risks of their own work, and the right to remove themselves from imminent and serious danger without penalty | Added all three. Questions now test the right to stop work |
| 7.4, 7.4.1 | Correctness | Missed taking diversity into account (gender, language, culture, literacy, disability) and considering the views of outside parties | Added both, with translated and pictorial information |
| 7.4.2 | Quality | Near-identical to 14001. Did not include contractors and visitors | Shifts, contractors and visitors, near-miss feedback |
| 7.4.3 | Quality | Near-identical to 14001 | Notifying accidents, dangerous occurrences and occupational diseases to authorities; shared sites; inspector visits |
| 7.5, 7.5.1, 7.5.2, 7.5.3 | Quality; correctness | Identical text in both standards. Did not cover statutory OH&S records, worker access, or the confidentiality of health records | 7.5.1 maps the 45001 required items and statutory records. 7.5.2 covers usability for workers. 7.5.3 covers worker access (via 5.4), health records as GDPR special category data and long retention |
| 8.1 | Quality | Very short parent | Hierarchy, change, procurement and contractors; evidence comes from observation |
| 8.1.1 | Correctness | Missed coordination with other employers in multi-employer workplaces | Added that, plus permits for high-risk tasks and adapting work to workers |
| 8.1.2 | Quality | Correct but thin. Generic question ("How do workers contribute ideas?") | Fuller hierarchy wording, "reasonably practicable" justification, fit testing, worker involvement in choosing controls |
| 8.1.4 | Correctness | Did not cover the three contractor risk directions or the outsourcing control expectation | Restructured as purchasing, contractors and outsourcing, with five questions and evidence |
| 8.2 | Quality | Purpose identical to 14001. Did not consider the needs of people who need help to evacuate or sharing information with emergency services | OH&S-specific purpose; personal evacuation plans; information for emergency services |
| 9.1 | Title | Title "Monitoring, measurement, analysis and evaluation" is the 14001/9001 heading. The 45001 heading is "Monitoring, measurement, analysis and performance evaluation" | Title fixed. Parent text now OH&S-specific |
| 9.1.1 | Title (consistency); quality | Own descriptive title repeated the wrong parent wording. Generic text | Title aligned to the corrected parent. Monitoring scope in 45001 terms, leading and lagging indicators, exposure monitoring |
| 9.1.2 | Quality | Same as 14001 (permit and licence expiry is an environmental framing) | Statutory examinations, fire safety, exposure limits, health surveillance |
| 9.2, 9.2.1 | Quality | Generic text shared with 14001 | Field observation, worker interviews, reporting to workers |
| 9.2.2 | Correctness | Missed consulting workers on the programme and reporting results to workers and their representatives | Added both |
| 9.3 | Copyright; quality | The input list followed the clause closely | Reworded as a review pack, with consultation outcomes and sharing the results with workers |
| 10.1 | Quality | Generic text shared with 14001 | OH&S improvement sources and effect on risk |
| 10.2 | Correctness | Missed reviewing risk assessments, assessing new hazards before acting, using the hierarchy for corrective actions, and sharing lessons with workers | Added all of these |
| 10.3 | Correctness | Missed promoting a supportive culture, worker participation in improvement and telling workers about results | Added these, plus the under-reporting caveat |

Unchanged: 4.2, 6.1.4, 6.2.1, 8.1.3.

## Summary

- Refs reviewed: 95 (45 + 50). Refs changed: 90 (14001: 44 of 45; 45001: 46 of 50).
- By category (a ref can have more than one): title 6 (14001 theme 4 and 4.4; 45001 theme 4, 4.3, 4.4, 9.1, plus 9.1.1 changed for consistency); correctness 28 (12 in 14001, 16 in 45001); copyright 5 (14001 5.2, 6.1.4, 9.3; 45001 5.2, 9.3); quality and duplication across standards: almost every shared management system clause, plus all 14 theme purposes.
- After the fix, no purpose is identical across the two files. The only guidance similarity left (ratio 0.5-0.7) is in short parent clauses (6.1, 6.2, 9.2), which share the "this parent asks whether..." structure but have different content.

### Needs a human

1. **45001 sub-clause refs are missing from the library.** 6.1.2.1 (Hazard identification), 6.1.2.2 (Assessment of OH&S risks and other risks to the OH&S management system), 6.1.2.3 (Assessment of OH&S opportunities and other opportunities for the OH&S management system), and 8.1.4.1-8.1.4.3 (General, Contractors, Outsourcing) are not in the library. I put their content into 6.1.2 and 8.1.4. Adding them would change the requirement set, cross-walks and SoA, so it is a product decision.
2. **Title of 9.1.1 in 45001.** The rule says to keep own titles where the official heading is "General". I updated this one only to match the corrected parent ("...performance evaluation: general"). Revert it if you want own titles left untouched.
3. **Theme 4 spelling.** I used "Context of the organisation" (UK spelling) to match the 9001 file. The published title spells it "organization".
4. **Legal points to confirm:**
   - 45001 7.5.3 treats health surveillance records as GDPR special category data. This is correct for health data, but national retention periods for exposure and health records vary and are not stated.
   - 45001 7.4.3 says accident and occupational disease notification deadlines are "set by national law". No period is given on purpose.
   - 14001 7.4.3 calls unsupported green claims a growing legal risk. This refers to EU consumer protection rules on environmental claims; no specific instrument is cited.
5. **Title sources.** I checked all official titles against my knowledge of the published standards. I could not check them against a purchased copy in this session. The six title changes are well established (the 14001 and 45001 4.4 headings, the 45001 4.3 "OH&S" wording, the 45001 9.1 "performance evaluation" wording).
# Review: GDPR (gdpr-2016.json) and NIS2 (nis2-2022.json)

Scope: all 36 GDPR refs and all 24 NIS2 refs in the scratchpad enrichment files, checked against the repo ref lists in `templates/frameworks/`. Every ref in the repo lists is present in the enrichment, with no extras. Corrections are in `review/gdpr-2016.json` (16 refs) and `review/nis2-2022.json` (12 refs). Each entry is the full corrected entry, and every entry was checked against the length limits.

## Findings

| Ref | Issue category | What was wrong | What I changed |
|---|---|---|---|
| NIS2 Art. 20(1) | Correctness (legal) | It said "senior management" instead of the management body. The liability point was vague ("answer for failures"). It did not say that liability details are set by national law, and it did not mention the temporary bar from managerial functions that applies only to essential entities (Art. 32(5)(b)). Its "sign off at least yearly" read like a legal requirement. | Rewrote purpose, guidance, questions and evidence. The duty now sits with the management body, which cannot hand the approval to IT. Liability is tied to breaches of Art. 21. The entry now has a caveat on national law, the bar for essential entities, a review cycle presented as good practice, and evidence on the national liability position. |
| NIS2 Art. 20(2) | Correctness (legal) | It treated training for management and for staff as equally mandatory. In fact training is compulsory for members of the management body, and the directive only encourages regular training for employees. The purpose closely paraphrased the article. | Rewrote everything to separate the mandatory management training from the encouraged staff training, with a cross-link to Art. 21(2)(g). New wording, and evidence for each member. |
| NIS2 Art. 21(1) | Correctness / missing key obligations | There was nothing on essential vs important entities: same measures, different supervision (ex ante vs ex post) and different maximum fines. It did not mention Implementing Regulation (EU) 2024/2690 for digital providers, the full set of proportionality factors (state of the art, standards, cost) or the national transposition caveat. Its "review at least annually" was not in the law. | Rewrote guidance, questions and evidence. Added classification and registration evidence, and a mapping to national law and the implementing regulation. |
| NIS2 Art. 21(2)(d) | Quality | Typo: "missing contracts terms". | Fixed the typo. |
| NIS2 Art. 21(2)(e) | Quality | "No asset-based scanning" was unclear. Coordinated disclosure was not linked to national arrangements. | Reworded the guidance. |
| NIS2 Art. 21(2)(j) | Correctness | It left out continuous authentication as an alternative to MFA, and the "where appropriate" qualifier. | Updated purpose and guidance. Decisions not to use these measures are now recorded. |
| NIS2 Art. 21(3) | Correctness / copyright | It left out the overall quality of suppliers' products and their secure development procedures. It said coordinated EU risk assessments must be considered only "where relevant", although the law requires them to be taken into account. The purpose closely paraphrased the article. | Rewrote purpose, guidance and questions. |
| NIS2 Art. 23(1) | Missing obligations | It did not mention the duty to tell service recipients about significant cyber threats and possible remedies (Art. 23(2)), the national single entry point, the separate GDPR Art. 33 assessment, or that DORA applies instead for financial entities. | Rewrote guidance, questions and evidence. |
| NIS2 Art. 23(3) | Correctness | It did not say that potential impact ("capable of causing") counts, not only actual impact. It did not say that the thresholds in Implementing Regulation 2024/2690 are binding for digital providers. | Updated purpose and guidance. |
| NIS2 Art. 23(4)(a) | Correctness | It presented 24 h as the deadline without saying that the main duty is "without undue delay". It did not mention that the CSIRT replies within 24 h where possible. | Updated purpose and guidance. |
| NIS2 Art. 23(4)(b) | Missing obligation | It did not mention the shorter 24-hour notification limit for trust service providers. It did not say that "without undue delay" applies here too, or that indicators of compromise are needed only "where available". | Updated purpose and guidance. |
| NIS2 Art. 23(4)(d) | Correctness (deadline) | It said "one month of the notification". The month actually runs from the 72-hour incident notification, not from the early warning. For an incident still ongoing, the final report is due within one month of finishing handling the incident, not "after closure". Its wording closely followed the article's list of contents. | Rewrote purpose, guidance and one question. |
| GDPR Art. 5 | Missing key obligations | The purpose left out purpose limitation and accountability (Art. 5(2)). Question 4 was circular ("show that you can demonstrate"). | New purpose. Questions now cover purpose limitation and evidence of compliance. |
| GDPR Art. 6 | Correctness | It said "one valid legal basis" (the law says at least one). It did not list the six bases, and did not say that public authorities cannot use legitimate interests for their tasks. The compatibility test for a change of purpose was only mentioned in a question. | Rewrote purpose and guidance. |
| GDPR Art. 9 | Correctness / national caveat | It described biometrics without the qualifier "used for identification". It did not say that the article is a prohibition with exceptions. It did not mention that several exceptions (employment, social security) need a national law basis and that Member States may add conditions (Art. 9(4)). | Rewrote purpose, guidance and questions. |
| GDPR Art. 12 | Correctness (deadline) | Extensions were described as "only in genuine complex cases". The law allows up to two further months for complex or numerous requests, and the person must be told within the first month with reasons. It also left out the duty to explain a refusal and mention the right to complain, and the rule that charging or refusing applies only to manifestly unfounded or excessive requests. | Rewrote guidance. |
| GDPR Art. 13 | Missing key obligations | The list of notice contents left out DPO contact details, the legitimate interests pursued, whether providing the data is required and the consequences of not providing it, automated decision-making, withdrawal of consent, and notice before further processing. | Rewrote guidance. |
| GDPR Art. 14 | Correctness (deadline / exemptions) | It said "normally within a month". The law sets one month as the maximum, earlier at first contact or first disclosure. The exceptions were incomplete: information already held, collection set by law, and professional secrecy were missing, as was the publication safeguard. | Rewrote guidance and two questions. |
| GDPR Art. 20 | Correctness | It treated all data about others as something to exclude, which over-states the rule (the test is adverse effect on others). It did not say that observed data is included and derived or inferred data is excluded, or that processing for a public task is excluded. | Rewrote guidance and question 4. |
| GDPR Art. 22 | Correctness | The purpose framed the article as a safeguards rule. It is a restriction that applies unless a narrow ground (contract, law, explicit consent) is met. | New purpose. |
| GDPR Art. 28 | Missing scope | It did not cover the processor's own duties (relevant to SaaS users who are processors) or the required contract particulars (subject, duration, nature). | Rewrote guidance. |
| GDPR Art. 30 | Correctness (exemption) | The fewer-than-250 exemption was described loosely ("partly exempt in theory"). It did not mention the processor's own record. | Gave the exact exemption conditions, added the processor record and the right of the authority to ask for the record, and added a question. |
| GDPR Art. 33 | Correctness (legal test) | The purpose reversed the test ("breaches likely to cause risk"). The law is to notify unless the breach is unlikely to result in risk. It did not mention phased notification, reasons for a late notification, or the overlap with a NIS2 24-hour early warning. | Rewrote purpose and guidance. |
| GDPR Art. 34 | Missing exemptions | Only encryption was given as an exemption. Subsequent measures and disproportionate effort (public announcement) were missing, as was the authority's power to order notification and the contact point in the notice. | Rewrote guidance. |
| GDPR Art. 35 | Missing key obligations | It did not mention the national supervisory authority lists or the EDPB rule of thumb (two or more high-risk criteria). It did not mention necessity and proportionality, or that the authority must be consulted before processing starts. | Rewrote guidance and questions. |
| GDPR Art. 37 | Correctness (who is obligated) | The criteria were inaccurate ("large-scale monitoring or sensitive data"). The test is core activities with regular and systematic monitoring on a large scale, or large-scale special-category or criminal data. It had no national-law caveat (for example the German threshold). Its conflict-of-interest point duplicated Art. 38. | Rewrote purpose, guidance and questions. Added group DPO and national law. |
| GDPR Art. 45 | Quality / specificity | The guidance was generic. | Added the EU-US Data Privacy Framework certification condition as a concrete example, and monitoring of reviews and court challenges. |
| GDPR Art. 49 | Missing obligation | It left out the compelling legitimate interests fallback and its conditions: rare, limited people, inform the authority and the data subjects. Its "annual" review was invented. | Rewrote guidance, questions and evidence. |

### Refs reviewed and left unchanged

GDPR: Ch. II, Art. 7, Ch. III, Art. 15, Art. 16, Art. 17, Art. 18, Art. 19, Art. 21, Ch. IV, Art. 24, Art. 25, Art. 32, Art. 38, Art. 39, Ch. V, Art. 44, Art. 46, Art. 47, Art. 48 (20 refs). These are accurate and specific enough.

NIS2: Art. 20, Art. 21, Art. 23 (themes), Art. 21(2)(a), (b), (c), (f), (g), (h), Art. 21(4), Art. 23(4)(c) (12 refs).

Titles: all GDPR article and chapter titles match the official headings, or are permitted shortenings of them under 80 characters: Art. 12, 13, 14, 19 and Ch. V. The NIS2 theme titles match the official headings (Governance; Cybersecurity risk-management measures; Reporting obligations), and the paragraph titles are descriptive own titles as the rules allow. No title changes were needed. US spelling: none found. Duplicates: only generic evidence labels repeat ("Request log entries" and "Exception register"), which is acceptable.

## Summary

- Refs checked: 60 (GDPR 36, NIS2 24). Refs changed: 28 (GDPR 16, NIS2 12).
- By category (approximate; an entry can have more than one): legal correctness 20, missing key obligations 11, national transposition or national law caveats 5, copyright (close paraphrase) 3, quality and typos 4.

## Needs a human

1. **NIS2 national transposition.** Several entries now tell users to check their national transposing law. If the product targets specific Member States first (for example Germany or the Netherlands), consider adding country notes. Transposition status and national extras (management liability, registration deadlines, sector additions) differ.
2. **Coverage gap in the NIS2 library.** There are no refs for the following:
   - Art. 3 (essential vs important classification) and Art. 2 (size-cap scope)
   - Art. 27 (registration with the authority)
   - Art. 23(2) (telling recipients about significant cyber threats)
   - Art. 24 (use of certified products, if required nationally)
   - Art. 32 and 33 (supervision)

   I mentioned classification and Art. 23(2) inside Art. 21(1) and Art. 23(1). Consider adding refs for scoping and registration, since being in or out of scope is the first question customers ask.
3. **Implementing Regulation (EU) 2024/2690.** This is now referenced for digital providers (cloud, data centre, MSP, MSSP, DNS, TLD, CDN, marketplaces, search engines, social networks, trust services). Please confirm you want this regulation named in the content.
4. **DORA statement in Art. 23(1).** The entry says financial entities in scope of DORA report under DORA rather than NIS2. This is correct as lex specialis, but legal may want to word it more cautiously, because some national laws keep parallel registration duties.
5. **German DPO threshold (Art. 37).** The entry points to German law as an example of a wider DPO duty (BDSG §38, 20 or more people regularly processing personal data by automated means), without giving the number. Confirm you are happy to name a country.
6. **GDPR Art. 46 and the 2021 SCCs.** Art. 46 was left unchanged, but the European Commission's planned additional standard clauses for importers already subject to GDPR (Art. 3(2)) may later need a note under Art. 46.
