// Management review inputs (docs/11 Audit outputs): what a management review has to consider, compiled for a period
// from rows the workspace already holds. The server reads the sheets (by pack ref) under the person's session and
// projects each item to a ReviewRow with the field registry; this file only counts, sorts and words. Pure: the period
// and the time zone come in, nothing reads the clock.
import { formatDate, isoDateInZone } from '../fields/helpers';

export interface ReviewRow {
  id: string;
  sheetId: string;
  displayId: string;
  name: string;
  /** The group's name. */
  group: string;
  /** The group's pack ref ("scope.parties") when a pack made it. */
  groupRef?: string | null;
  /** The status in words ('' without a status field). */
  status: string;
  done: boolean;
  /** A deadline has passed and the item is not done. */
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
  /** The item's main date (meeting, audit, found on), YYYY-MM-DD. */
  date?: string | null;
  /** One short fact worth grouping by (a risk's level). */
  detail?: string;
}

export interface ReviewSource {
  sheetId: string;
  sheetName: string;
  rows: ReviewRow[];
}

export const REVIEW_SOURCE_KEYS = [
  'reviews',
  'context',
  'nonconformities',
  'risks',
  'treatments',
  'audits',
  'findings',
  'incidents',
  'training',
] as const;
export type ReviewSourceKey = (typeof REVIEW_SOURCE_KEYS)[number];

export interface ReviewInput {
  /** The period, inclusive, YYYY-MM-DD in the workspace time zone. */
  from: string;
  to: string;
  timeZone: string;
  sources: Partial<Record<ReviewSourceKey, ReviewSource | null>>;
  /** Group refs of the context sheet that hold interested parties (the rest are issues). */
  partyGroupRefs?: string[];
  /** Group refs of the context sheet that hold internal and external issues (absent: every group but the parties). */
  issueGroupRefs?: string[];
  /** Numbers the workspace already shows (framework coverage, dashboards), in words. */
  monitoring?: { label: string; value: string }[];
}

export const REVIEW_SECTION_KEYS = [
  'previous_actions',
  'issues',
  'parties',
  'nonconformities',
  'monitoring',
  'audits',
  'risks',
  'opportunities',
] as const;
export type ReviewSectionKey = (typeof REVIEW_SECTION_KEYS)[number];

export interface ReviewItemRef {
  id: string;
  sheetId: string;
  displayId: string;
  name: string;
  note: string;
}

export interface ReviewSection {
  key: ReviewSectionKey;
  title: string;
  /** A sheet (or a number) feeds this section. */
  available: boolean;
  facts: string[];
  items: ReviewItemRef[];
  /** Items left out of `items` (the list is capped). */
  more: number;
}

export interface ManagementReview {
  from: string;
  to: string;
  periodLabel: string;
  sections: ReviewSection[];
  /** Plain text of the whole report (the update posted on a management review item). */
  summary: string;
}

/** Items listed per section at most; the counts always cover all of them. */
export const REVIEW_ITEMS_MAX = 25;

const TITLES: Record<ReviewSectionKey, string> = {
  previous_actions: 'Status of actions from previous reviews',
  issues: 'Changes in internal and external issues',
  parties: 'Needs and feedback of interested parties',
  nonconformities: 'Nonconformities and corrective actions',
  monitoring: 'Monitoring and measurement results',
  audits: 'Audit results',
  risks: 'Risk assessment and risk treatment',
  opportunities: 'Opportunities for continual improvement',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function compileManagementReview(input: ReviewInput): ManagementReview {
  const { from, to, timeZone } = input;
  const dayOf = (instant: string) => isoDateInZone(instant, timeZone);
  const inPeriod = (day: string | null | undefined) => !!day && day >= from && day <= to;
  const created = (r: ReviewRow) => inPeriod(dayOf(r.createdAt));
  const changed = (r: ReviewRow) => inPeriod(dayOf(r.updatedAt));
  const src = (k: ReviewSourceKey) => input.sources[k] ?? null;
  const rows = (k: ReviewSourceKey) => src(k)?.rows ?? [];
  const ref = (r: ReviewRow, note: string): ReviewItemRef => ({
    id: r.id,
    sheetId: r.sheetId,
    displayId: r.displayId,
    name: r.name,
    note,
  });
  const statusNote = (r: ReviewRow) =>
    [r.status || (r.done ? 'Done' : 'Open'), r.overdue ? 'overdue' : '', r.detail ?? '']
      .filter(Boolean)
      .join(' · ');
  const section = (
    key: ReviewSectionKey,
    available: boolean,
    facts: string[],
    items: ReviewItemRef[],
  ): ReviewSection => ({
    key,
    title: TITLES[key],
    available,
    facts,
    items: items.slice(0, REVIEW_ITEMS_MAX),
    more: Math.max(0, items.length - REVIEW_ITEMS_MAX),
  });
  const parties = new Set(input.partyGroupRefs ?? []);
  const isParty = (r: ReviewRow) => !!r.groupRef && parties.has(r.groupRef);

  // 1. earlier reviews and the actions still open from before the period
  const earlier = rows('reviews').filter((r) =>
    r.date ? r.date < from : dayOf(r.createdAt) < from,
  );
  const carried = [...rows('nonconformities'), ...rows('treatments')].filter(
    (r) => !r.done && dayOf(r.createdAt) < from,
  );
  const previous = section(
    'previous_actions',
    !!src('reviews') || !!src('nonconformities') || !!src('treatments'),
    [
      ...(src('reviews')
        ? [
            earlier.length
              ? `${plural(earlier.length, 'earlier review')}, ${earlier.filter((r) => r.done).length} held`
              : 'No earlier management review is recorded.',
          ]
        : []),
      ...(src('nonconformities') || src('treatments')
        ? [
            `${plural(carried.length, 'action')} from before the period still open, ${carried.filter((r) => r.overdue).length} overdue`,
          ]
        : []),
    ],
    [...earlier.map((r) => ref(r, statusNote(r))), ...carried.map((r) => ref(r, statusNote(r)))],
  );

  // 2. and 3. the context sheet: issues and interested parties changed in the period
  const contextFacts = (list: ReviewRow[], what: string, whats?: string) => {
    const added = list.filter(created);
    const edited = list.filter((r) => !created(r) && changed(r));
    return [
      `${plural(added.length, what, whats)} added and ${edited.length} changed in the period, ${list.length} in all`,
    ];
  };
  const contextRows = rows('context');
  const issueGroups = input.issueGroupRefs?.length ? new Set(input.issueGroupRefs) : null;
  const issueRows = contextRows.filter((r) =>
    issueGroups ? !!r.groupRef && issueGroups.has(r.groupRef) : !isParty(r),
  );
  const partyRows = contextRows.filter(isParty);
  const issues = section(
    'issues',
    !!src('context'),
    src('context') ? contextFacts(issueRows, 'issue') : [],
    issueRows
      .filter((r) => created(r) || changed(r))
      .map((r) => ref(r, `${r.group} · ${created(r) ? 'added' : 'changed'}`)),
  );
  const partySection = section(
    'parties',
    !!src('context'),
    src('context') ? contextFacts(partyRows, 'interested party', 'interested parties') : [],
    partyRows
      .filter((r) => created(r) || changed(r))
      .map((r) => ref(r, created(r) ? 'added' : 'changed')),
  );

  // 4. nonconformities and corrective actions
  const nc = rows('nonconformities');
  const ncOpened = nc.filter(created);
  const ncClosed = nc.filter((r) => r.done && changed(r));
  const ncOpen = nc.filter((r) => !r.done);
  const nonconformities = section(
    'nonconformities',
    !!src('nonconformities'),
    src('nonconformities')
      ? [
          `${plural(ncOpened.length, 'nonconformity', 'nonconformities')} raised in the period`,
          `${ncClosed.length} closed in the period`,
          `${ncOpen.length} open now, ${ncOpen.filter((r) => r.overdue).length} overdue`,
        ]
      : [],
    [...new Map([...ncOpened, ...ncOpen].map((r) => [r.id, r])).values()].map((r) =>
      ref(r, statusNote(r)),
    ),
  );

  // 5. monitoring: numbers the workspace shows, incidents and training
  const incidents = rows('incidents');
  const training = rows('training');
  const monitoring = section(
    'monitoring',
    !!(input.monitoring?.length || src('incidents') || src('training')),
    [
      ...(input.monitoring ?? []).map((m) => `${m.label}: ${m.value}`),
      ...(src('incidents')
        ? [
            `${plural(incidents.filter(created).length, 'security incident')} reported in the period, ${incidents.filter((r) => !r.done).length} open now`,
          ]
        : []),
      ...(src('training')
        ? [
            `Training: ${training.filter((r) => r.done).length} of ${training.length} completed, ${training.filter((r) => r.overdue).length} overdue`,
          ]
        : []),
    ],
    incidents.filter(created).map((r) => ref(r, statusNote(r))),
  );

  // 6. audits and their findings
  const audits = rows('audits').filter((r) => inPeriod(r.date ?? null) || changed(r));
  const findings = rows('findings');
  const auditSection = section(
    'audits',
    !!src('audits') || !!src('findings'),
    [
      ...(src('audits')
        ? [
            `${plural(audits.length, 'audit')} in the period, ${audits.filter((r) => r.done).length} done`,
          ]
        : []),
      ...(src('findings')
        ? [
            `${plural(findings.filter(created).length, 'finding')} raised in the period, ${findings.filter((r) => !r.done).length} open now`,
          ]
        : []),
    ],
    [
      ...audits.map((r) => ref(r, statusNote(r))),
      ...findings.filter((r) => created(r) || !r.done).map((r) => ref(r, statusNote(r))),
    ],
  );

  // 7. risks and treatment
  const risks = rows('risks');
  const openRisks = risks.filter((r) => !r.done);
  const levels = new Map<string, number>();
  for (const r of openRisks) if (r.detail) levels.set(r.detail, (levels.get(r.detail) ?? 0) + 1);
  const treatments = rows('treatments');
  const riskSection = section(
    'risks',
    !!src('risks') || !!src('treatments'),
    [
      ...(src('risks')
        ? [
            `${plural(risks.length, 'risk')}, ${openRisks.length} open, ${risks.filter(created).length} identified in the period`,
            ...(levels.size
              ? [
                  `Open risks by level: ${[...levels]
                    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                    .map(([l, n]) => `${l} ${n}`)
                    .join(', ')}`,
                ]
              : []),
            `${plural(risks.filter((r) => r.overdue).length, 'risk')} past the review date`,
          ]
        : []),
      ...(src('treatments')
        ? [
            `Treatment actions: ${treatments.filter((r) => r.done).length} done, ${treatments.filter((r) => !r.done).length} open, ${treatments.filter((r) => r.overdue).length} overdue`,
          ]
        : []),
    ],
    [
      ...risks.filter((r) => created(r) || r.overdue).map((r) => ref(r, statusNote(r))),
      ...treatments.filter((r) => r.overdue).map((r) => ref(r, statusNote(r))),
    ],
  );

  // 8. opportunities: what the inputs above say to follow up
  const overdue = [...nc, ...treatments, ...findings, ...training, ...risks].filter(
    (r) => r.overdue,
  );
  const lessons = ncClosed;
  const opportunities = section(
    'opportunities',
    previous.available || nonconformities.available || riskSection.available,
    [
      `${plural(overdue.length, 'overdue item')} to follow up`,
      `${plural(lessons.length, 'closed nonconformity', 'closed nonconformities')} to learn from`,
    ],
    [
      ...overdue.map((r) => ref(r, `Overdue · ${r.status || 'Open'}`)),
      ...lessons.map((r) => ref(r, 'Closed in the period')),
    ],
  );

  const sections = [
    previous,
    issues,
    partySection,
    nonconformities,
    monitoring,
    auditSection,
    riskSection,
    opportunities,
  ];
  const periodLabel = `${formatDate(from)} to ${formatDate(to)}`;
  return { from, to, periodLabel, sections, summary: reviewSummary(periodLabel, sections) };
}

/** The report as plain text, at most `max` characters (an item update holds 10,000). */
export function reviewSummary(periodLabel: string, sections: ReviewSection[], max = 9_500): string {
  const lines = [`Management review inputs, ${periodLabel}`, ''];
  sections.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}`);
    if (!s.available) lines.push('- No sheet holds this yet.');
    for (const f of s.facts) lines.push(`- ${f}`);
    for (const it of s.items.slice(0, 10))
      lines.push(`  · ${it.displayId} ${it.name} (${it.note})`);
    const left = s.items.length - Math.min(10, s.items.length) + s.more;
    if (left > 0) lines.push(`  · and ${left} more`);
    lines.push('');
  });
  const text = lines.join('\n').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
