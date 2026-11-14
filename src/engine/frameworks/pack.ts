// A framework's library as a pack (docs/12, docs/11): adopting a framework installs this generated pack through the
// ordinary install path (install_pack: one transaction, provenance, a pack.installed entry). The pack is one library
// sheet in the framework's folder; its groups are the framework's themes, its items the requirements (each with its
// requirement key, written once into items.requirement_ref), its fields what a statement of applicability needs.
// Nothing here knows a framework: everything comes from the framework's data. Pure.
import { LABEL_COLORS } from '../labels';
import { fieldKeyFromName } from '../ordering';
import type { PackItem, PackManifest, PackSheet } from '../packs/types';
import type { Json } from '../types';
import { frameworkPackKey, frameworkPackVersion, requirementKey } from './refs';
import type { Framework, Requirement } from './types';

/** Implementation status of a requirement; Implemented is the done option. */
export const IMPLEMENTATION_OPTIONS = [
  { id: 'opt_not_started', label: 'Not started', color: 'grey' },
  { id: 'opt_planned', label: 'Planned', color: 'blue' },
  { id: 'opt_partial', label: 'Partially', color: 'orange' },
  { id: 'opt_implemented', label: 'Implemented', color: 'green', done: true },
] as const;

/** Field keys of a library sheet the app reads by key (the requirement panel, the coverage roll-up). */
export const LIBRARY_KEYS = {
  ref: 'ref',
  partOf: 'part_of',
  applicable: 'applicable',
  justification: 'justification',
  status: 'status',
  owner: 'owner',
  evidence: 'evidence',
  lastReviewed: 'last_reviewed',
  purpose: 'purpose',
  guidance: 'guidance',
  questions: 'audit_questions',
  typicalEvidence: 'typical_evidence',
  /** Added at adoption when a controls sheet is chosen (docs/12): links to its items, both ways. */
  controls: 'controls',
} as const;

/** A framework's library pack: adopted from Frameworks (adopt_framework), not installed from Packs. */
export const isFrameworkPack = (m: Pick<PackManifest, 'sheets'>) =>
  m.sheets.some((s) => s.framework !== undefined);

/** A list as one long-text value, one line per entry. */
const bullets = (list: string[]) => list.map((x) => `• ${x}`).join('\n');

/** The root theme of a requirement (the group it goes in). */
function rootOf(r: Requirement, byRef: Map<string, Requirement>): Requirement {
  let cur = r;
  const seen = new Set<string>();
  while (cur.parent && byRef.has(cur.parent) && !seen.has(cur.ref)) {
    seen.add(cur.ref);
    cur = byRef.get(cur.parent)!;
  }
  return cur;
}

/** "Part of": the parent's ref and title, or the theme's title. */
function partOf(r: Requirement, byRef: Map<string, Requirement>): string {
  const p = r.parent ? byRef.get(r.parent) : undefined;
  if (!p) return '';
  return p.kind === 'theme' ? p.title : `${p.ref} ${p.title}`;
}

/** The sheet's own description: what it is and the licence note (shown under the sheet name). */
export function libraryDescription(f: Framework): string {
  return `${f.title}. ${f.licence} Source: ${f.source}.`.slice(0, 2000);
}

/** The library pack of a framework. */
export function frameworkToPack(f: Framework): PackManifest {
  const byRef = new Map(f.requirements.map((r) => [r.ref, r]));
  const themes = f.requirements.filter((r) => r.kind === 'theme' && !r.parent);
  const groupRefs = new Map<string, string>();
  const takenGroups = new Set<string>();
  const groups = themes.map((t, i) => {
    const ref = fieldKeyFromName(t.ref, takenGroups);
    takenGroups.add(ref);
    groupRefs.set(t.ref, ref);
    return { ref, name: t.title.slice(0, 80), color: LABEL_COLORS[i % LABEL_COLORS.length]! };
  });
  const has = {
    purpose: f.requirements.some((r) => r.kind !== 'theme' && r.purpose),
    guidance: f.requirements.some((r) => r.guidance),
    questions: f.requirements.some((r) => r.questions.length > 0),
    evidence: f.requirements.some((r) => r.evidence.length > 0),
  };
  const takenItems = new Set<string>();
  const items: PackItem[] = f.requirements
    .filter((r) => r.kind !== 'theme')
    .map((r) => {
      const ref = fieldKeyFromName(r.ref, takenItems);
      takenItems.add(ref);
      const values: Record<string, Json> = { [LIBRARY_KEYS.ref]: r.ref };
      const part = partOf(r, byRef);
      if (part) values[LIBRARY_KEYS.partOf] = part;
      if (r.purpose) values[LIBRARY_KEYS.purpose] = r.purpose;
      if (r.guidance) values[LIBRARY_KEYS.guidance] = r.guidance;
      if (r.questions.length) values[LIBRARY_KEYS.questions] = bullets(r.questions);
      if (r.evidence.length) values[LIBRARY_KEYS.typicalEvidence] = bullets(r.evidence);
      return {
        ref,
        group: groupRefs.get(rootOf(r, byRef).ref)!,
        name: r.title,
        values,
        requirementRef: requirementKey({ framework: f.key, version: f.version, ref: r.ref }),
      };
    });

  const k = LIBRARY_KEYS;
  const sheet: PackSheet = {
    ref: 'library',
    name: f.library.name,
    description: libraryDescription(f),
    itemLabel: f.library.itemLabel,
    idPrefix: f.library.idPrefix,
    folder: 'frameworks',
    isLibrary: true,
    framework: { key: f.key, version: f.version, refFieldKey: k.ref },
    groups,
    fields: [
      {
        key: k.ref,
        name: 'Ref',
        type: 'text' as const,
        locked: true,
        description: `The reference number in ${f.title}. It never changes.`,
      },
      { key: k.partOf, name: 'Part of', type: 'text' as const, locked: true },
      ...(has.purpose
        ? [{ key: k.purpose, name: 'Purpose', type: 'longtext' as const, locked: true }]
        : []),
      ...(has.guidance
        ? [{ key: k.guidance, name: 'Guidance', type: 'longtext' as const, locked: true }]
        : []),
      ...(has.questions
        ? [{ key: k.questions, name: 'Audit questions', type: 'longtext' as const, locked: true }]
        : []),
      ...(has.evidence
        ? [
            {
              key: k.typicalEvidence,
              name: 'Typical evidence',
              type: 'longtext' as const,
              locked: true,
            },
          ]
        : []),
      {
        key: k.applicable,
        name: 'Applicable',
        type: 'applicability' as const,
        config: { reasonRequiredWhenNot: false },
      },
      {
        key: k.justification,
        name: 'Justification',
        type: 'justification' as const,
        description: 'Why the requirement is in or out of scope. Required when it does not apply.',
        config: { whenFieldKey: k.applicable, whenValues: ['not_applicable'] },
      },
      {
        key: k.status,
        name: 'Implementation status',
        type: 'status' as const,
        config: { options: IMPLEMENTATION_OPTIONS.map((o) => ({ ...o })) as unknown as Json },
      },
      { key: k.owner, name: 'Owner', type: 'people' as const, config: { multiple: false } },
      {
        key: k.evidence,
        name: 'Evidence',
        type: 'evidence' as const,
        config: { validDays: 365, multiple: true, accept: [] },
      },
      { key: k.lastReviewed, name: 'Last reviewed', type: 'date' as const },
    ],
    // the first table view backs the Table tab (src/components/views/tabs-model.ts): every column, all requirements
    views: [
      { name: 'All requirements', type: 'table' as const, config: {} },
      ...(f.library.soa
        ? [
            {
              name: f.library.soa.name,
              type: 'table' as const,
              config: {
                filters: [
                  { fieldKey: k.ref, op: 'starts_with', value: f.library.soa.refStartsWith },
                ],
                sort: [],
                hidden: [k.partOf, k.owner, k.lastReviewed],
              } as Record<string, Json>,
            },
          ]
        : []),
      {
        name: 'Applicability',
        type: 'insights' as const,
        config: {
          insights: {
            rows: [
              {
                id: 'r_figures',
                height: 's',
                widgets: [
                  { id: 'w_total', type: 'kpi', span: 3, title: 'Requirements', filter: 'all' },
                  { id: 'w_done', type: 'kpi', span: 3, title: 'Implemented', filter: 'done' },
                  {
                    id: 'w_progress',
                    type: 'progress',
                    span: 6,
                    title: 'Implemented %',
                    filter: 'all',
                  },
                ],
              },
              {
                id: 'r_split',
                widgets: [
                  {
                    id: 'w_applicable',
                    type: 'donut',
                    span: 6,
                    title: 'Applicable / Not applicable',
                    filter: 'all',
                    by: k.applicable,
                  },
                  {
                    id: 'w_status',
                    type: 'bars',
                    span: 6,
                    title: 'Implementation status',
                    filter: 'all',
                    by: k.status,
                  },
                ],
              },
            ],
          },
        } as unknown as Record<string, Json>,
      },
    ],
    // the Table opens first; the statement of applicability and the Insights layout are tabs next to it
    tabs: [
      { ref: 'table' },
      ...(f.library.soa ? [{ ref: f.library.soa.name }] : []),
      { ref: 'Applicability' },
    ],
    defaultView: 'table',
    forms: [],
    columnGroups: [],
    items,
  };

  return {
    key: frameworkPackKey(f),
    version: frameworkPackVersion(f),
    title: f.title,
    description:
      `The ${f.title} requirement library: ${items.length} ${f.library.itemLabel.toLowerCase()}s with applicability, justification, implementation status, owner and evidence. ${f.licence}`.slice(
        0,
        2000,
      ),
    requires: [],
    people: [],
    folders: [{ ref: 'frameworks', name: f.library.folder }],
    sheets: [sheet],
    automations: [],
    dashboards: [],
  };
}
