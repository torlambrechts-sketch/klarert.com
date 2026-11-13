import { describe, expect, it } from 'vitest';
import { planPackInstall, type InstallPayload, type PackSnapshot } from './plan';
import {
  mergeOptions,
  planPackUpgrade,
  sameJson,
  threeWay,
  upgradeLines,
  type InstalledState,
} from './upgrade';
import type { PackManifest } from './types';
import type { Json } from '../types';

type Row = Record<string, Json>;

const STATUS: Json[] = [
  { id: 'opt_open', label: 'Open', color: 'blue' },
  { id: 'opt_done', label: 'Done', color: 'green', done: true },
];

const v1 = (): PackManifest => ({
  key: 'risks',
  version: '1.0.0',
  title: 'Risks',
  description: '',
  requires: [],
  people: [],
  folders: [
    { ref: 'main', name: 'Risk management' },
    { ref: 'old', name: 'Old stuff' },
  ],
  sheets: [
    {
      ref: 'risk',
      name: 'Risk register',
      itemLabel: 'Risk',
      idPrefix: 'RSK-',
      folder: 'main',
      isLibrary: false,
      groups: [{ ref: 'open', name: 'Open', color: 'blue' }],
      fields: [
        { key: 'status', name: 'Status', type: 'status', config: { options: STATUS } },
        { key: 'score', name: 'Score', type: 'number', description: 'From 1 to 25.' },
        { key: 'notes', name: 'Notes', type: 'text' },
        { key: 'legacy', name: 'Legacy', type: 'text' },
      ],
      views: [{ name: 'Board', type: 'kanban', config: { labelFieldKey: 'status' } }],
      items: [
        { ref: 'phishing', group: 'open', name: 'Example: phishing', values: { score: 12 } },
        { ref: 'laptop', group: 'open', name: 'Example: lost laptop', values: { score: 6 } },
        { ref: 'flood', group: 'open', name: 'Example: flood', values: { score: 4 } },
        { ref: 'fire', group: 'open', name: 'Example: fire', values: { score: 8, notes: 'Smoke' } },
      ],
      forms: [],
      columnGroups: [],
    },
    {
      ref: 'retired',
      name: 'Retired sheet',
      itemLabel: 'Entry',
      idPrefix: 'RET-',
      folder: 'old',
      isLibrary: false,
      groups: [{ ref: 'all', name: 'All', color: 'grey' }],
      fields: [{ key: 'note', name: 'Note', type: 'text' }],
      views: [],
      items: [],
      forms: [],
      columnGroups: [],
    },
  ],
  automations: [
    {
      ref: 'high',
      sheet: 'risk',
      name: 'High score → post',
      enabled: true,
      trigger: { type: 'item_created' },
      conditions: [],
      actions: [{ type: 'post_update', message: 'New risk.' }],
    },
    {
      ref: 'gone',
      sheet: 'risk',
      name: 'Old automation',
      enabled: true,
      trigger: { type: 'item_created' },
      conditions: [],
      actions: [{ type: 'post_update', message: 'Old.' }],
    },
  ],
  dashboards: [],
});

/** v2: renames, new options, a new field, a new item, items and a sheet removed, a new automation. */
const v2 = (): PackManifest => {
  const m = v1();
  m.version = '1.1.0';
  m.folders = [{ ref: 'main', name: 'Risk management' }];
  const risk = m.sheets[0]!;
  risk.description = 'Risks to information.';
  risk.fields = [
    {
      key: 'status',
      name: 'Status',
      type: 'status',
      config: {
        options: [
          { id: 'opt_open', label: 'Open risk', color: 'blue' },
          { id: 'opt_done', label: 'Closed', color: 'green', done: true },
          { id: 'opt_accepted', label: 'Accepted', color: 'orange' },
        ],
      },
    },
    { key: 'score', name: 'Risk score', type: 'number', description: 'From 1 (low) to 25.' },
    { key: 'notes', name: 'Notes', type: 'longtext' },
    { key: 'owner', name: 'Owner', type: 'people', config: { multiple: false } },
  ];
  risk.items = [
    { ref: 'phishing', group: 'open', name: 'Example: phishing email', values: { score: 15 } },
    { ref: 'laptop', group: 'open', name: 'Example: lost laptop', values: { score: 9 } },
    { ref: 'ransom', group: 'open', name: 'Example: ransomware', values: { score: 20 } },
  ];
  m.sheets = [risk];
  m.automations = [
    { ...m.automations[0]!, name: 'High score → post an update' },
    {
      ref: 'fresh',
      sheet: 'risk',
      name: 'New automation',
      enabled: true,
      trigger: { type: 'item_created' },
      conditions: [],
      actions: [{ type: 'post_update', message: 'Fresh.' }],
    },
  ];
  return m;
};

const snapshot = (over: Partial<PackSnapshot> = {}): PackSnapshot => ({
  orgId: 'org',
  prefixes: [],
  folders: [],
  installs: [],
  members: [],
  jobRoles: [],
  teams: [],
  lastSheetPosition: null,
  lastFolderPosition: null,
  lastDashboardPosition: null,
  ...over,
});

let n = 0;
const env = (today = '2026-11-13') => ({
  today,
  now: new Date(`${today}T09:00:00Z`),
  timeZone: 'Europe/Oslo',
  newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  userId: 'u1',
});

/** Install v1 and read the install back the way the server does (the state install_pack leaves). */
function install(m: PackManifest = v1(), today = '2026-10-01') {
  const plan = planPackInstall(m, snapshot(), { ...env(today), hash: 'h1' });
  if (!plan.payload) throw new Error(plan.preview.conflicts.join('\n'));
  const p: InstallPayload = plan.payload;
  const refMap: Record<string, string> = {};
  const kinds: [keyof InstallPayload, string][] = [
    ['folders', 'folder'],
    ['sheets', 'sheet'],
    ['fields', 'field'],
    ['groups', 'group'],
    ['views', 'view'],
    ['items', 'item'],
    ['automations', 'automation'],
    ['dashboards', 'dashboard'],
  ];
  for (const [list, kind] of kinds)
    for (const r of p[list] as Row[]) refMap[`${kind}:${String(r.ref)}`] = String(r.id);
  const state: InstalledState = {
    installId: 'inst-1',
    version: m.version,
    level: null,
    refMap,
    folders: p.folders.map((f) => ({
      id: String(f.id),
      ref: String(f.ref),
      name: String(f.name),
      archived: false,
    })),
    sheets: p.sheets.map((s) => ({
      id: String(s.id),
      ref: String(s.ref),
      name: String(s.name),
      description: (s.description as string | null) ?? null,
      itemLabel: String(s.item_label),
      folderId: (s.folder_id as string | null) ?? null,
      parentSheetId: (s.parent_sheet_id as string | null) ?? null,
      archived: false,
      clientItems: 0,
    })),
    fields: p.fields.map((f) => ({
      id: String(f.id),
      ref: String(f.ref),
      sheetId: String(f.sheet_id),
      key: String(f.key),
      name: String(f.name),
      type: String(f.type),
      description: (f.description as string | null) ?? null,
      required: !!f.required,
      locked: !!f.locked,
      config: f.config ?? {},
      archived: false,
    })),
    groups: p.groups.map((g) => ({
      id: String(g.id),
      ref: String(g.ref),
      sheetId: String(g.sheet_id),
      name: String(g.name),
      color: String(g.color),
    })),
    views: p.views.map((v) => ({
      id: String(v.id),
      ref: String(v.ref),
      sheetId: String(v.sheet_id),
      name: String(v.name),
      type: String(v.type),
      config: v.config ?? {},
    })),
    items: p.items.map((i) => ({
      id: String(i.id),
      ref: String(i.ref),
      sheetId: String(i.sheet_id),
      groupId: String(i.group_id),
      name: String(i.name),
      values: (i.values ?? {}) as Record<string, Json>,
      archived: false,
      requirementRef: (i.requirement_ref as string | undefined) ?? null,
      installed: {
        name: String(i.name),
        groupId: String(i.group_id),
        values: (i.values ?? {}) as Record<string, Json>,
      },
    })),
    automations: p.automations.map((a) => ({
      id: String(a.id),
      ref: String(a.ref),
      sheetId: String(a.sheet_id),
      name: String(a.name),
      enabled: !!a.enabled,
      trigger: a.trigger!,
      conditions: a.conditions!,
      actions: a.actions!,
    })),
    dashboards: p.dashboards.map((d) => ({
      id: String(d.id),
      ref: String(d.ref),
      name: String(d.name),
      config: d.config!,
      archived: false,
    })),
    lastPosition: { fields: {}, groups: {}, views: {}, items: {} },
  };
  return { state, refMap };
}

const upgrade = (
  state: InstalledState,
  to: PackManifest = v2(),
  choices?: Record<string, 'mine' | 'theirs'>,
  from: PackManifest = v1(),
) =>
  planPackUpgrade({
    from: { manifest: from, hash: 'h1' },
    to: { manifest: to, hash: 'h2' },
    state,
    snapshot: snapshot({ prefixes: ['RSK-', 'RET-'] }),
    env: env(),
    choices,
  });

const field = (s: InstalledState, key: string) => s.fields.find((f) => f.key === key)!;
const item = (s: InstalledState, ref: string) => s.items.find((i) => i.ref === `risk.${ref}`)!;

describe('three-way helpers', () => {
  it('compares JSON whatever the key order', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson(undefined, null)).toBe(false);
  });

  it('applies what only the pack changed and flags what both changed', () => {
    const base = { name: 'A', color: 'blue', size: 1 };
    const r = threeWay(
      base,
      base,
      { name: 'A', color: 'red', size: 2 },
      { name: 'B', color: 'green', size: 2 },
    );
    expect(r.apply).toEqual({ name: 'B' });
    expect(r.conflicts).toEqual(['color']);
  });

  it('keeps the client options, their labels and colours, and adds new ones', () => {
    const base = [
      { id: 'a', label: 'A', color: 'blue' },
      { id: 'b', label: 'B', color: 'red' },
    ];
    const mine = [
      { id: 'b', label: 'Mine', color: 'red' },
      { id: 'a', label: 'A', color: 'blue' },
      { id: 'x', label: 'My own', color: 'grey' },
    ];
    const theirs = [
      { id: 'a', label: 'A2', color: 'green' },
      { id: 'b', label: 'B2', color: 'red' },
      { id: 'c', label: 'C', color: 'orange' },
    ];
    const r = mergeOptions(base, mine, theirs);
    expect(r.options).toEqual([
      { id: 'b', label: 'Mine', color: 'red' },
      { id: 'a', label: 'A2', color: 'green' },
      { id: 'x', label: 'My own', color: 'grey' },
      { id: 'c', label: 'C', color: 'orange' },
    ]);
    expect(r.added).toEqual(['C']);
    // an option the client removed does not come back, and nothing is removed
    const gone = mergeOptions(base, [{ id: 'x', label: 'Mine' }], base);
    expect(gone.options).toEqual([{ id: 'x', label: 'Mine' }]);
    expect(gone.changed).toBe(false);
  });
});

describe('planPackUpgrade', () => {
  it('says the installed version is current when there is nothing newer', () => {
    const { state } = install();
    const p = upgrade(state, v1());
    expect(p.state).toBe('current');
    expect(p.payload).toBeNull();
  });

  it('applies untouched changes, adds new objects and archives what the pack removed', () => {
    const { state } = install();
    const p = upgrade(state);
    expect(p.state).toBe('ready');
    const u = p.payload!;
    // sheet description, field rename and description, options, item rename and values
    expect(u.update.sheets).toEqual([
      { id: state.refMap['sheet:risk'], description: 'Risks to information.' },
    ]);
    const score = u.update.fields.find((f) => f.id === field(state, 'score').id)!;
    expect(score).toMatchObject({ name: 'Risk score', description: 'From 1 (low) to 25.' });
    const status = u.update.fields.find((f) => f.id === field(state, 'status').id)!;
    expect((status.config as Row).options).toEqual([
      { id: 'opt_open', label: 'Open risk', color: 'blue' },
      { id: 'opt_done', label: 'Closed', color: 'green', done: true },
      { id: 'opt_accepted', label: 'Accepted', color: 'orange' },
    ]);
    const phishing = u.update.items.find((i) => i.id === item(state, 'phishing').id)!;
    expect(phishing).toEqual({
      id: item(state, 'phishing').id,
      name: 'Example: phishing email',
      values: { [field(state, 'score').id]: 15 },
    });
    // the automation's name; the on/off state is never part of an update
    const auto = u.update.automations.find((a) => a.id === state.refMap['automation:high'])!;
    expect(auto).toEqual({ id: auto.id, name: 'High score → post an update' });
    // added: the Owner field after the sheet's last field, the ransomware item, the new automation
    expect(u.add.fields.map((f) => f.key)).toEqual(['owner']);
    expect(u.add.items.map((i) => i.name)).toEqual(['Example: ransomware']);
    expect(u.add.items[0]!.group_id).toBe(state.refMap['group:risk.open']);
    expect(u.add.automations.map((a) => a.ref)).toEqual(['fresh']);
    expect(u.add.sheets).toEqual([]);
    expect(u.add.folders).toEqual([]);
    // removed: untouched items archived, the retired sheet and its folder archived, the old automation off
    expect(u.archive.items.sort()).toEqual(
      [item(state, 'flood').id, item(state, 'fire').id].sort(),
    );
    expect(u.archive.sheets).toEqual([state.refMap['sheet:retired']]);
    expect(u.archive.folders).toEqual([state.refMap['folder:old']]);
    expect(u.disable.automations).toEqual([state.refMap['automation:gone']]);
    // fields are never removed, and a type change is never applied
    expect(p.preview.kept.map((k) => k.ref).sort()).toEqual(['risk.legacy', 'risk.notes']);
    expect(u.update.fields.some((f) => f.id === field(state, 'notes').id)).toBe(false);
    expect(p.preview.conflicts).toEqual([]);
    expect(upgradeLines(p.preview)[0]).toBe('Updates Risks from 1.0.0 to 1.1.0.');
  });

  it('flags conflicts and leaves them as they are unless the person takes the pack’s', () => {
    const { state } = install();
    // the client renamed the score field and the phishing example, and changed its score
    field(state, 'score').name = 'Our score';
    const ph = item(state, 'phishing');
    ph.name = 'Phishing (ours)';
    ph.values = { ...ph.values, [field(state, 'score').id]: 3 };
    const p = upgrade(state);
    const ids = p.preview.conflicts.map((c) => c.id).sort();
    expect(ids).toEqual(['field:risk.score', 'item:risk.phishing']);
    const fc = p.preview.conflicts.find((c) => c.id === 'field:risk.score')!;
    expect(fc.attributes).toEqual(['name']);
    expect(fc.choice).toBe('mine');
    // keep mine: the description (only the pack changed it) is applied, the name is not
    const f = p.payload!.update.fields.find((x) => x.id === field(state, 'score').id)!;
    expect(f).toEqual({ id: f.id, description: 'From 1 (low) to 25.' });
    expect(p.payload!.update.items.some((i) => i.id === ph.id)).toBe(false);
    // take theirs
    const t = upgrade(state, v2(), {
      'field:risk.score': 'theirs',
      'item:risk.phishing': 'theirs',
    });
    expect(t.payload!.update.fields.find((x) => x.id === f.id)).toMatchObject({
      name: 'Risk score',
    });
    expect(t.payload!.update.items.find((i) => i.id === ph.id)).toMatchObject({
      name: 'Example: phishing email',
      values: { [field(state, 'score').id]: 15 },
    });
    expect(t.payload!.summary.theirs).toBe(2);
  });

  it('keeps the client’s option labels and colours and never removes the client’s options', () => {
    const { state } = install();
    const status = field(state, 'status');
    status.config = {
      options: [
        { id: 'opt_open', label: 'Ours', color: 'red' },
        { id: 'opt_done', label: 'Done', color: 'green', done: true },
        { id: 'opt_mine', label: 'Mine only', color: 'grey' },
      ],
    };
    const p = upgrade(state);
    const f = p.payload!.update.fields.find((x) => x.id === status.id)!;
    expect((f.config as Row).options).toEqual([
      { id: 'opt_open', label: 'Ours', color: 'red' },
      { id: 'opt_done', label: 'Closed', color: 'green', done: true },
      { id: 'opt_mine', label: 'Mine only', color: 'grey' },
      { id: 'opt_accepted', label: 'Accepted', color: 'orange' },
    ]);
  });

  it('never touches what the client added or changed when the pack removes it', () => {
    const { state } = install();
    // the client wrote in the fire example, added an item to the retired sheet and turned the old automation off
    const fire = item(state, 'fire');
    fire.values = { ...fire.values, [field(state, 'notes').id]: 'Our own notes' };
    state.sheets.find((s) => s.ref === 'retired')!.clientItems = 1;
    state.automations.find((a) => a.ref === 'gone')!.enabled = false;
    const p = upgrade(state);
    expect(p.payload!.archive.items).toEqual([item(state, 'flood').id]);
    expect(p.payload!.archive.sheets).toEqual([]);
    expect(p.payload!.archive.folders).toEqual([]);
    expect(p.payload!.disable.automations).toEqual([]);
    expect(p.preview.kept.map((k) => k.ref)).toEqual(
      expect.arrayContaining(['retired', 'risk.fire', 'old']),
    );
  });

  it('keeps an automation off when the client turned it off', () => {
    const { state } = install();
    state.automations.find((a) => a.ref === 'high')!.enabled = false;
    const p = upgrade(state);
    const a = p.payload!.update.automations.find((x) => x.id === state.refMap['automation:high'])!;
    expect('enabled' in a).toBe(false);
  });

  it('reads $today and $in tokens as unchanged when the pack did not change them', () => {
    const m1 = v1();
    m1.sheets[0]!.fields.push({ key: 'due', name: 'Due', type: 'date' });
    m1.sheets[0]!.items[2]!.values = { score: 4, due: '$in:30' };
    const { state } = install(m1, '2026-10-01');
    const m2 = v2();
    m2.sheets[0]!.fields.push({ key: 'due', name: 'Due', type: 'date' });
    m2.sheets[0]!.items.push({
      ref: 'flood',
      group: 'open',
      name: 'Example: flood',
      values: { score: 4, due: '$in:30' },
    });
    const p = upgrade(state, m2, undefined, m1);
    expect(p.payload!.update.items.some((i) => i.id === item(state, 'flood').id)).toBe(false);
    expect(p.preview.conflicts).toEqual([]);
  });

  it('adds new sheets with their folder, fields, groups and links', () => {
    const { state } = install();
    const m2 = v2();
    m2.folders.push({ ref: 'treat', name: 'Treatment' });
    m2.sheets.push({
      ref: 'plan',
      name: 'Treatment plan',
      itemLabel: 'Action',
      idPrefix: 'RSK-',
      folder: 'treat',
      isLibrary: false,
      groups: [{ ref: 'todo', name: 'To do', color: 'blue' }],
      fields: [
        {
          key: 'risk',
          name: 'Risk',
          type: 'link',
          config: { targetSheetRef: 'risk', multiple: false },
        },
      ],
      views: [],
      items: [
        {
          ref: 'mfa',
          group: 'todo',
          name: 'Example: MFA',
          values: {},
          links: { risk: ['phishing'] },
        },
      ],
      forms: [],
      columnGroups: [],
    });
    const p = upgrade(state, m2);
    const u = p.payload!;
    expect(u.add.folders.map((f) => f.ref)).toEqual(['treat']);
    expect(u.add.sheets.map((s) => s.ref)).toEqual(['plan']);
    // RSK- is taken: the new sheet's prefix is renamed and the preview says so
    expect(u.add.sheets[0]!.id_prefix).not.toBe('RSK-');
    expect(p.preview.warnings.join(' ')).toMatch(/prefix/);
    const linkField = u.add.fields.find((f) => f.ref === 'plan.risk')!;
    expect((linkField.config as Row).targetSheetId).toBe(state.refMap['sheet:risk']);
    expect(u.add.links).toEqual([
      {
        field_id: linkField.id,
        from_item: u.add.items.find((i) => i.ref === 'plan.mfa')!.id,
        to_item: item(state, 'phishing').id,
      },
    ]);
  });

  it('upgrades a framework library: rewords, adds requirements, keeps the client’s answers', () => {
    const lib = (version: string, reqs: { ref: string; title: string; purpose: string }[]) =>
      ({
        key: 'framework-nis2',
        version,
        title: 'NIS2',
        description: '',
        requires: [],
        people: [],
        folders: [{ ref: 'frameworks', name: 'Frameworks' }],
        sheets: [
          {
            ref: 'library',
            name: 'NIS2 requirements',
            itemLabel: 'Requirement',
            idPrefix: 'NIS-',
            folder: 'frameworks',
            isLibrary: true,
            framework: { key: 'nis2', version: '2022', refFieldKey: 'ref' },
            groups: [{ ref: 'art', name: 'Articles', color: 'blue' }],
            fields: [
              { key: 'ref', name: 'Ref', type: 'text', locked: true },
              { key: 'purpose', name: 'Purpose', type: 'longtext', locked: true },
              { key: 'status', name: 'Status', type: 'status', config: { options: STATUS } },
            ],
            views: [],
            items: reqs.map((r) => ({
              ref: r.ref.replace('.', '_').toLowerCase(),
              group: 'art',
              name: r.title,
              values: { ref: r.ref, purpose: r.purpose },
              requirementRef: `nis2@2022#${r.ref}`,
            })),
            forms: [],
            columnGroups: [],
          },
        ],
        automations: [],
        dashboards: [],
      }) as PackManifest;
    const r3 = lib('2022.3.0', [
      { ref: 'Art.20', title: 'Governance', purpose: 'Old purpose.' },
      { ref: 'Art.21', title: 'Risk measures', purpose: 'Measures.' },
    ]);
    const r4 = lib('2022.4.0', [
      { ref: 'Art.20', title: 'Governance', purpose: 'New purpose.' },
      { ref: 'Art.21', title: 'Cybersecurity risk-management measures', purpose: 'Measures.' },
      { ref: 'Art.3', title: 'Essential and important entities', purpose: 'Scope.' },
    ]);
    const { state } = install(r3);
    for (const i of state.items)
      i.requirementRef = `nis2@2022#${String(i.values[state.fields[0]!.id])}`;
    // the client answered Art.20: status Done; and wrote their own title on Art.21
    const statusId = state.fields.find((f) => f.key === 'status')!.id;
    const art20 = state.items.find((i) => i.ref === 'library.art_20')!;
    art20.values = { ...art20.values, [statusId]: 'opt_done' };
    const art21 = state.items.find((i) => i.ref === 'library.art_21')!;
    art21.name = 'Risk measures (ours)';
    const p = planPackUpgrade({
      from: { manifest: r3, hash: 'h1' },
      to: { manifest: r4, hash: 'h2' },
      state,
      snapshot: snapshot(),
      env: env(),
    });
    const u = p.payload!;
    const purposeId = state.fields.find((f) => f.key === 'purpose')!.id;
    // reworded purpose; the client's status stays (the pack never sets it)
    expect(u.update.items.find((i) => i.id === art20.id)).toEqual({
      id: art20.id,
      values: { [purposeId]: 'New purpose.' },
    });
    expect(p.preview.conflicts.map((c) => c.id)).toEqual(['requirement:library.art_21']);
    expect(u.add.items).toHaveLength(1);
    expect(u.add.items[0]).toMatchObject({
      name: 'Essential and important entities',
      requirement_ref: 'nis2@2022#Art.3',
    });
    expect(p.preview.added[0]).toMatchObject({ kind: 'requirement' });
    // a requirement is never removed
    const r5 = lib('2022.5.0', [{ ref: 'Art.20', title: 'Governance', purpose: 'New purpose.' }]);
    const gone = planPackUpgrade({
      from: { manifest: r3, hash: 'h1' },
      to: { manifest: r5, hash: 'h3' },
      state,
      snapshot: snapshot(),
      env: env(),
    });
    expect(gone.payload!.archive.items).toEqual([]);
    expect(gone.preview.kept.some((k) => k.kind === 'requirement')).toBe(true);
  });

  it('is blocked when the new version cannot be planned', () => {
    const { state } = install();
    const m2 = v2();
    m2.requires = [{ pack: 'missing', range: '^1.0.0' }];
    const p = upgrade(state, m2);
    expect(p.state).toBe('blocked');
    expect(p.preview.blockers[0]).toMatch(/missing/);
  });
});
