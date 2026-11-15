// The pack quality bar (docs/11 Pack quality bar, owner-approved board rules): what every native pack in
// templates/packs ships with so that it is useful on day one and quiet in its first week. Pure: a parsed manifest in,
// the problems out (an empty list is a pass). Run over every pack by quality.test.ts; packs not upgraded yet are in
// quality-allowlist.json and each removes itself when it passes.
import { HIDDEN_BY_DEFAULT, VIEW_TYPES } from '@/engine/views/config';
import { manifestAtLevel } from '@/engine/packs/levels';
import type { PackManifest, PackSheet, SheetKind } from '@/engine/packs/types';

export interface QualityProblem {
  /** The rule's id (docs/11 Pack quality bar). */
  rule:
    | 'sheet-kind'
    | 'tabs'
    | 'views'
    | 'advanced-automations'
    | 'headline-dashboard'
    | 'intake-forms'
    | 'approvals'
    | 'starter-size'
    | 'standard-text';
  /** Where: `sheets.<ref>`, `dashboards`, `automations` … */
  path: string;
  message: string;
}

/** Visible tabs a sheet may have. */
export const MAX_VISIBLE_TABS = 4;
/** Advanced automations (escalation, cascade, gate, recurring work, SLA) a pack ships, at least. */
export const MIN_ADVANCED_AUTOMATIONS = 4;
/** Intake forms a pack ships, at least, unless it says why none apply (`formsNotApplicable`). */
export const MIN_FORMS = 2;
/** The lowest level (or a pack without levels) installs at most this many sheets and dashboards. */
export const STARTER_MAX_SHEETS = 5;
export const STARTER_MAX_DASHBOARDS = 1;

/** A plan sheet's time view: the Timeline once that view type exists, the Calendar until then. */
export const PLAN_VIEW: 'timeline' | 'calendar' = (VIEW_TYPES as readonly string[]).includes(
  'timeline',
)
  ? 'timeline'
  : 'calendar';

const REVIEW_DATE = /review|expir|valid|renew/i;
const DUE_DATE = /due|deadline/i;
const RISK = /risk/i;
const CAPA = /(^|_)(nc|capa)(_|$)|nonconformit|corrective/i;
/** The wording of a standard's requirements: never shipped (docs/12 Licensing). */
const STANDARD_WORDING = /\borgani[sz]ation shall\b/i;

type Tab = { type: string; config: Record<string, unknown> };

/** The tabs a sheet shows (not hidden), as view types with the saved view's config. */
function visibleTabs(s: PackSheet): Tab[] {
  if (!s.tabs)
    return VIEW_TYPES.filter((type) => !HIDDEN_BY_DEFAULT.includes(type)).map((type) => ({
      type,
      config: {},
    }));
  return s.tabs
    .filter((t) => !t.hidden)
    .map((t) => {
      if ((VIEW_TYPES as readonly string[]).includes(t.ref)) return { type: t.ref, config: {} };
      const v = s.views.find((x) => x.name === t.ref);
      return { type: v?.type ?? 'unknown', config: (v?.config ?? {}) as Record<string, unknown> };
    });
}

const fieldMatching = (s: PackSheet, re: RegExp) =>
  s.fields.filter((f) => f.type === 'date' && (re.test(f.key) || re.test(f.name)));

export const sheetKindOf = (s: PackSheet): SheetKind | null =>
  s.kind ?? (s.isLibrary ? 'library' : null);

function viewProblems(s: PackSheet, kind: SheetKind): string[] {
  const tabs = visibleTabs(s);
  const out: string[] = [];
  const has = (type: string) => tabs.some((t) => t.type === type);
  const status = s.fields.find((f) => f.type === 'status');
  const board = () => {
    if (!has('kanban')) return false;
    if (kind !== 'register' || !status) return true;
    // a register's board is by status: a saved Board view grouped by the status field
    return tabs.some((t) => t.type === 'kanban' && t.config.labelFieldKey === status.key);
  };
  if (!has('table')) out.push('Show the Table.');
  if (kind === 'register') {
    if (!board())
      out.push(
        'Show a Board by status (a saved kanban view with labelFieldKey = the status field).',
      );
    if (fieldMatching(s, REVIEW_DATE).length && !has('calendar'))
      out.push('Show a Calendar: the sheet has a review or expiry date.');
  }
  if (kind === 'actions') {
    if (!board()) out.push('Show a Board.');
    const due = fieldMatching(s, DUE_DATE);
    if (!due.length) out.push('Add a due date field (a date field named "Due …").');
    const calendars = tabs.filter((t) => t.type === 'calendar');
    const onDue = calendars.some(
      (t) => !t.config.dateFieldKey || due.some((f) => f.key === t.config.dateFieldKey),
    );
    if (!onDue) out.push('Show a Calendar on the due date.');
  }
  if (kind === 'log' && !has('calendar')) out.push('Show a Calendar.');
  if (kind === 'plan' && !has(PLAN_VIEW))
    out.push(`Show a ${PLAN_VIEW === 'timeline' ? 'Timeline' : 'Calendar'}.`);
  return out;
}

/** Every string anywhere in a JSON value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** The pack quality bar's problems for one manifest (docs/11 Pack quality bar). Empty: the pack passes. */
export function packQualityProblems(m: PackManifest): QualityProblem[] {
  const out: QualityProblem[] = [];
  const add = (rule: QualityProblem['rule'], path: string, message: string) =>
    out.push({ rule, path, message });

  // every sheet says what it is for, and ships the views that kind needs, in at most 4 tabs
  for (const s of m.sheets) {
    const at = `sheets.${s.ref}`;
    const kind = sheetKindOf(s);
    if (!kind) {
      add(
        'sheet-kind',
        at,
        'Say what the sheet is for: kind register, actions, log, library or plan.',
      );
      continue;
    }
    const visible = visibleTabs(s).length;
    if (visible > MAX_VISIBLE_TABS)
      add(
        'tabs',
        at,
        `${visible} tabs show. Give the sheet a tab set with at most ${MAX_VISIBLE_TABS} visible tabs (hide the rest).`,
      );
    for (const msg of viewProblems(s, kind)) add('views', at, `${kind}: ${msg}`);
  }

  // advanced automations, each with a plain-words description
  const automations = [...m.automations, ...(m.extends ?? []).flatMap((e) => e.automations ?? [])];
  const advanced = automations.filter((a) => a.advanced && a.description?.trim());
  if (advanced.length < MIN_ADVANCED_AUTOMATIONS)
    add(
      'advanced-automations',
      'automations',
      `${advanced.length} advanced automations: ship at least ${MIN_ADVANCED_AUTOMATIONS} (escalation, cascade, gate, recurring work, SLA) marked advanced with a description.`,
    );

  // exactly one headline dashboard
  const headlines = m.dashboards.filter((d) => d.headline).length;
  if (headlines !== 1)
    add(
      'headline-dashboard',
      'dashboards',
      `${headlines} headline dashboards: mark exactly one dashboard headline.`,
    );

  // intake forms, unless the pack says why none apply
  const forms =
    m.sheets.reduce((n, s) => n + s.forms.length, 0) +
    (m.extends ?? []).reduce((n, e) => n + (e.forms?.length ?? 0), 0);
  if (forms < MIN_FORMS && !m.formsNotApplicable?.trim())
    add(
      'intake-forms',
      'forms',
      `${forms} forms: ship at least ${MIN_FORMS} intake forms, or say why none apply (formsNotApplicable).`,
    );

  // approvals: document approval, risk acceptance, CAPA closure as approval workflows
  for (const s of m.sheets) {
    const kind = sheetKindOf(s);
    const what =
      s.register === 'documents'
        ? 'document approval'
        : kind === 'register' && (RISK.test(s.ref) || RISK.test(s.name))
          ? 'risk acceptance'
          : (kind === 'register' || kind === 'actions') && (CAPA.test(s.ref) || CAPA.test(s.name))
            ? 'CAPA closure'
            : null;
    if (what && !s.workflows?.length)
      add('approvals', `sheets.${s.ref}`, `Declare ${what} as an approval workflow (workflows).`);
  }

  // Starter is small: the lowest level (or the whole pack without levels)
  const lowest = m.levels?.[0]?.key ?? null;
  const starter = lowest ? manifestAtLevel(m, lowest) : m;
  const name = lowest ? (m.levels?.[0]?.name ?? lowest) : 'The pack';
  if (starter.sheets.length > STARTER_MAX_SHEETS)
    add(
      'starter-size',
      'levels',
      `${name} installs ${starter.sheets.length} sheets: at most ${STARTER_MAX_SHEETS}.`,
    );
  if (starter.dashboards.length > STARTER_MAX_DASHBOARDS)
    add(
      'starter-size',
      'levels',
      `${name} installs ${starter.dashboards.length} dashboards: at most ${STARTER_MAX_DASHBOARDS}.`,
    );

  // never a standard's text (docs/12 Licensing): example items of an ISO pack are marked as examples, and no string
  // uses the requirement wording of a standard
  if ((m.frameworks ?? []).some((f) => f.key.startsWith('iso')))
    for (const s of m.sheets)
      if (s.register !== 'documents' && sheetKindOf(s) !== 'library')
        for (const i of s.items)
          if (!/^Example: /.test(i.name))
            add(
              'standard-text',
              `sheets.${s.ref}.items.${i.ref}`,
              'Name example items "Example: …" (never a standard\'s text).',
            );
  if (strings(m).some((x) => STANDARD_WORDING.test(x)))
    add(
      'standard-text',
      'manifest',
      'Write requirements in your own words: "the organization shall" is the wording of a standard.',
    );

  return out;
}
