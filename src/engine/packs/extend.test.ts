import { describe, expect, it } from 'vitest';
import type { Json } from '../types';
import {
  augmentManifest,
  extendsProblems,
  extensionUses,
  inNamespace,
  namespaceOf,
  neededLevel,
} from './extend';
import { afterInstall, refMapOf } from './installed.fixture';
import { planPackInstall, previewLines, type InstallPayload, type PackSnapshot } from './plan';
import type { PackManifest } from './types';
import { planPackUpgrade, type InstalledState } from './upgrade';

type Row = Record<string, Json>;

// docs/11 Extends: a small Core and an add-on that extends it.
const core = (): PackManifest => ({
  key: 'core',
  version: '1.0.0',
  title: 'Core registers',
  description: '',
  requires: [],
  people: [],
  system: true,
  levels: [
    { key: 'starter', name: 'Starter', description: 'Risks.' },
    { key: 'full', name: 'Full', description: 'And controls.' },
  ],
  folders: [
    { ref: 'risk', name: 'Risk and controls', domain: 'risk' },
    { ref: 'operations', name: 'Operations', domain: 'operations' },
  ],
  sheets: [
    {
      ref: 'risk',
      name: 'Risk register',
      itemLabel: 'Risk',
      idPrefix: 'R-',
      folder: 'risk',
      isLibrary: false,
      groups: [{ ref: 'open', name: 'Open', color: 'blue' }],
      fields: [
        {
          key: 'category',
          name: 'Category',
          type: 'link',
          config: { targetSheetRef: 'cat', multiple: false, inverseKey: 'risks' },
        },
        { key: 'score', name: 'Score', type: 'number' },
        {
          key: 'kind',
          name: 'Kind',
          type: 'dropdown',
          config: { options: [{ id: 'opt_a', label: 'Strategic', color: 'blue' }] },
        },
        {
          key: 'standards',
          name: 'Standards',
          type: 'multiselect',
          config: { options: [{ id: 'all', label: 'All standards', color: 'grey' }] },
        },
      ],
      views: [],
      items: [],
      forms: [],
      columnGroups: [],
    },
    {
      ref: 'cat',
      name: 'Risk categories',
      itemLabel: 'Category',
      idPrefix: 'RC-',
      folder: 'risk',
      isLibrary: false,
      groups: [{ ref: 'in_use', name: 'In use', color: 'green' }],
      fields: [
        { key: 'appetite', name: 'Appetite', type: 'number' },
        {
          key: 'risks',
          name: 'Risks',
          type: 'link',
          config: { targetSheetRef: 'risk', multiple: true, inverseKey: 'category' },
        },
      ],
      views: [],
      items: [{ ref: 'general', group: 'in_use', name: 'General', values: { appetite: 8 } }],
      forms: [],
      columnGroups: [],
    },
    {
      ref: 'controls',
      name: 'Controls',
      itemLabel: 'Control',
      idPrefix: 'CTL-',
      folder: 'risk',
      level: 'full',
      isLibrary: false,
      groups: [{ ref: 'all', name: 'All', color: 'blue' }],
      fields: [{ key: 'owner', name: 'Owner', type: 'text' }],
      views: [],
      items: [],
      forms: [],
      columnGroups: [],
    },
  ],
  automations: [],
  dashboards: [],
});

const addon = (): PackManifest => ({
  key: 'iso-14001',
  version: '1.0.0',
  title: 'ISO 14001',
  description: '',
  requires: [{ pack: 'core', range: '^1.0.0' }],
  people: [],
  standard: { id: 'iso14001', label: 'ISO 14001', color: 'green' },
  folders: [],
  sheets: [
    {
      ref: 'aspects',
      name: 'Environmental aspects',
      itemLabel: 'Aspect',
      idPrefix: 'ASP-',
      folder: 'core:operations',
      isLibrary: false,
      groups: [{ ref: 'all', name: 'All', color: 'green' }],
      fields: [
        {
          key: 'risks',
          name: 'Risks',
          type: 'link',
          config: { targetSheetRef: 'core:risk', multiple: true, inverseKey: 'iso14001_aspect' },
        },
      ],
      views: [],
      items: [{ ref: 'coolant', group: 'all', name: 'Example: coolant', values: {} }],
      forms: [],
      columnGroups: [],
    },
  ],
  extends: [
    {
      pack: 'core',
      sheet: 'cat',
      items: [
        { ref: 'iso14001_env', group: 'in_use', name: 'Environmental', values: { appetite: 6 } },
      ],
    },
    {
      pack: 'core',
      sheet: 'risk',
      fields: [
        {
          key: 'iso14001_aspect',
          name: 'Environmental aspect',
          type: 'link',
          config: { targetSheetRef: 'aspects', multiple: true, inverseKey: 'risks' },
        },
        { key: 'iso14001_permit', name: 'Permit', type: 'text' },
      ],
      groups: [{ ref: 'iso14001_env', name: 'Environment', color: 'green' }],
      views: [{ name: 'Spills', type: 'table', config: { filters: [] } }],
      options: { kind: [{ id: 'iso14001_env', label: 'Environmental', color: 'green' }] },
      items: [
        {
          ref: 'iso14001_spill',
          group: 'open',
          name: 'Example: spill',
          values: { score: 12, kind: '$option:Environmental', standards: ['iso14001'] },
          links: { category: ['iso14001_env'], iso14001_aspect: ['coolant'] },
        },
      ],
      automations: [
        {
          ref: 'iso14001_high',
          name: 'High environmental risk → post',
          enabled: true,
          trigger: { type: 'number_above', fieldKey: 'score', threshold: 11 },
          conditions: [{ fieldKey: 'standards', op: 'has_any_of', value: ['iso14001'] }],
          actions: [{ type: 'post_update', message: 'Look at {name}.' }],
        },
      ],
    },
  ],
  automations: [],
  dashboards: [],
});

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
const env = {
  today: '2026-11-14',
  now: new Date('2026-11-14T09:00:00Z'),
  timeZone: 'Europe/Oslo',
  newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  hash: 'h',
  userId: 'u1',
};

function withCore(level = 'starter') {
  const plan = planPackInstall(core(), snapshot(), env, { level });
  return { payload: plan.payload!, snap: afterInstall(snapshot(), plan.payload!, 'inst-core') };
}

describe('namespaces and manifest checks', () => {
  it('namespaces a pack by its key', () => {
    expect(namespaceOf('iso-14001')).toBe('iso14001');
    expect(inNamespace('iso14001', 'iso14001')).toBe(true);
    expect(inNamespace('iso14001', 'iso14001_env')).toBe(true);
    expect(inNamespace('iso14001', 'iso14001x')).toBe(false);
  });

  it('accepts the add-on', () => {
    expect(extendsProblems(addon())).toEqual([]);
  });

  it('extends only packs in requires, in the namespace, once per sheet', () => {
    const m = addon();
    m.requires = [];
    m.extends![1]!.fields![1]!.key = 'permit';
    m.extends!.push({ pack: 'core', sheet: 'cat' });
    const problems = extendsProblems(m).map((p) => p.message);
    expect(problems).toEqual(
      expect.arrayContaining([
        'The pack "core" is not in requires: a pack extends only what it requires.',
        'The field key "permit" is not in the pack\'s namespace: use "iso14001" or start it with "iso14001_".',
        '"core:cat" is extended twice: use one entry.',
      ]),
    );
  });

  it('lets its own automations write into a required pack’s sheet, counted as uses', () => {
    const m = addon();
    m.automations = [
      {
        ref: 'raise',
        sheet: 'aspects',
        name: 'Aspect added → add a risk',
        enabled: true,
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [
          {
            type: 'create_item',
            sheetRef: 'core:risk',
            name: '{name}',
            values: { score: 1, iso14001_permit: 'x' },
          },
        ],
      },
    ];
    expect(extendsProblems(m)).toEqual([]);
    // its own column is not a use of Core
    expect([...extensionUses(m, 'core').get('risk')!]).not.toContain('iso14001_permit');
    expect([...extensionUses(m, 'core').get('risk')!]).toContain('score');
    m.automations[0]!.actions[0]!.sheetRef = 'gdpr:breach';
    expect(extendsProblems(m).map((p) => p.message)).toEqual([
      '"gdpr:breach" names the pack "gdpr", which is not in requires.',
    ]);
  });

  it('needs the inverse of a two-way link into another pack in that sheet’s extends', () => {
    const m = addon();
    m.extends![1]!.fields = m.extends![1]!.fields!.filter((f) => f.key !== 'iso14001_aspect');
    m.extends![1]!.items![0]!.links = { category: ['iso14001_env'] };
    expect(extendsProblems(m).map((p) => p.message)).toContain(
      '"risks" links both ways to "core:risk": add "iso14001_aspect" there in extends, linking back.',
    );
  });

  it('knows the lowest level of Core it needs and the keys it uses', () => {
    expect(neededLevel(addon(), core())).toBe('starter');
    const m = addon();
    m.extends!.push({ pack: 'core', sheet: 'controls' });
    expect(neededLevel(m, core())).toBe('full');
    const uses = extensionUses(addon(), 'core');
    expect([...uses.get('risk')!].sort()).toEqual(['category', 'kind', 'score', 'standards']);
    expect([...uses.get('cat')!]).toEqual(['appetite']);
  });
});

describe('planning an add-on on top of Core', () => {
  it('waits for Core: blocked without it, ready to install it first when the command will', () => {
    expect(planPackInstall(addon(), snapshot(), env).preview.conflicts).toContain(
      'Install the pack "core" (^1.0.0) first.',
    );
    const plan = planPackInstall(addon(), snapshot(), env, {
      installFirst: [
        {
          key: 'core',
          title: 'Core registers',
          version: '1.0.0',
          level: 'starter',
          levelName: 'Starter',
          raise: false,
          sheets: {
            risk: { name: 'Risk register', standards: true },
            cat: { name: 'Risk categories', standards: false },
          },
        },
      ],
    });
    expect(plan.state).toBe('ready');
    expect(plan.payload).toBeNull();
    expect(previewLines(plan.preview)).toEqual(
      expect.arrayContaining([
        'Installs Core registers 1.0.0 (Starter) first.',
        // said from the manifest until Core is there
        'Adds to Risk register: 2 columns, 1 group, 1 example item, 1 automation, the view Spills, the view ISO 14001 view, the option Environmental and the option ISO 14001 in Standards.',
        'Environmental aspects links to Risk register through Risks, both ways.',
      ]),
    );
  });

  it('marks Core sheets and fields as system and its domain folders as domains', () => {
    const { payload } = withCore();
    expect(payload.folders.map((f) => f.domain)).toEqual(['risk', 'operations']);
    expect(payload.fields.every((f) => f.system === true)).toBe(true);
    expect(payload.sheets.every((s) => (s.settings as Row).system === true)).toBe(true);
  });

  it('adds its rows to the Core sheets with the real ids, in its own refs', () => {
    const { payload: corePayload, snap } = withCore();
    const coreRefs = refMapOf(corePayload);
    const plan = planPackInstall(addon(), snap, env);
    expect(plan.preview.conflicts).toEqual([]);
    const p = plan.payload!;
    const riskId = coreRefs['sheet:risk']!;
    // only the new columns, after Core's, as system columns
    const added = p.fields.filter((f) => f.sheet_id === riskId);
    expect(added.map((f) => [f.ref, f.system])).toEqual([
      ['core:risk.iso14001_aspect', true],
      ['core:risk.iso14001_permit', true],
    ]);
    expect(p.sheets.map((s) => s.ref)).toEqual(['aspects']);
    // the own sheet sits in Core's Operations domain and links both ways to the risk register
    expect(p.sheets[0]!.folder_id).toBe(coreRefs['folder:operations']);
    const risks = p.fields.find((f) => f.ref === 'aspects.risks')!;
    expect(risks.config).toMatchObject({
      targetSheetId: riskId,
      inverseFieldId: added[0]!.id,
    });
    expect(added[0]!.config).toMatchObject({ inverseFieldId: risks.id });
    // a group, a view, the standard view filtering Standards
    expect(p.groups.find((g) => g.sheet_id === riskId)?.ref).toBe('core:risk.iso14001_env');
    const views = p.views.filter((v) => v.sheet_id === riskId);
    expect(views.map((v) => [v.ref, v.name])).toEqual([
      ['core:risk.view.1', 'Spills'],
      ['core:risk.view.standard', 'ISO 14001 view'],
    ]);
    expect(views[1]!.config).toMatchObject({
      filters: [{ fieldKey: 'standards', op: 'has_any_of', value: ['iso14001'] }],
    });
    // options merged into Core's fields by id
    expect(p.options).toEqual([
      {
        ref: 'core:risk.kind.iso14001_env',
        field_id: coreRefs['field:risk.kind'],
        option: { id: 'iso14001_env', label: 'Environmental', color: 'green' },
      },
      {
        ref: 'core:risk.standards.iso14001',
        field_id: coreRefs['field:risk.standards'],
        option: { id: 'iso14001', label: 'ISO 14001', color: 'green' },
      },
    ]);
  });

  it('adds example items to Core sheets, with values and links by the real field ids', () => {
    const { payload: corePayload, snap } = withCore();
    const refs = refMapOf(corePayload);
    const p = planPackInstall(addon(), snap, env).payload!;
    const env14001 = p.items.find((i) => i.ref === 'core:cat.iso14001_env')!;
    expect(env14001).toMatchObject({
      sheet_id: refs['sheet:cat'],
      group_id: refs['group:cat.in_use'],
    });
    const spill = p.items.find((i) => i.ref === 'core:risk.iso14001_spill')!;
    expect(spill.group_id).toBe(refs['group:risk.open']);
    expect(spill.values).toEqual({
      [refs['field:risk.score']!]: 12,
      [refs['field:risk.kind']!]: 'iso14001_env',
      [refs['field:risk.standards']!]: ['iso14001'],
    });
    const linkPairs = p.links.map((l) => [l.field_id, l.from_item, l.to_item]);
    // the spill → Environmental through Core's own Category field, and back through Risks
    expect(linkPairs).toContainEqual([refs['field:risk.category'], spill.id, env14001.id]);
    expect(linkPairs).toContainEqual([refs['field:cat.risks'], env14001.id, spill.id]);
    // and to the aspect through the field the add-on adds
    const coolant = p.items.find((i) => i.ref === 'aspects.coolant')!;
    const aspectField = p.fields.find((f) => f.ref === 'core:risk.iso14001_aspect')!;
    expect(linkPairs).toContainEqual([aspectField.id, spill.id, coolant.id]);
  });

  it('plans the automation on the Core sheet and says what it adds', () => {
    const { payload: corePayload, snap } = withCore();
    const refs = refMapOf(corePayload);
    const plan = planPackInstall(addon(), snap, env);
    expect(plan.payload!.automations).toMatchObject([
      { ref: 'iso14001_high', sheet_id: refs['sheet:risk'], enabled: true },
    ]);
    expect(previewLines(plan.preview)).toEqual(
      expect.arrayContaining([
        'Adds to Risk categories: 1 example item.',
        'Adds to Risk register: 2 columns, 1 group, 1 example item, 1 automation, the view Spills, the view ISO 14001 view, the option Environmental in Kind and the option ISO 14001 in Standards.',
        'Environmental aspects links to Risk register through Risks, both ways.',
      ]),
    );
  });

  it('reads a Core sheet from a dashboard widget, with the real sheet id', () => {
    const { payload: corePayload, snap } = withCore();
    const refs = refMapOf(corePayload);
    const m = addon();
    m.dashboards = [
      {
        ref: 'env',
        name: 'Environment overview',
        headline: true,
        widgets: [
          {
            ref: 'w_risks',
            type: 'count',
            title: 'ISO 14001 risks',
            sheetRef: 'core:risk',
            conditions: [{ fieldKey: 'standards', op: 'has_any_of', value: ['iso14001'] }],
          },
          { ref: 'w_aspects', type: 'count', title: 'Aspects', sheetRef: 'aspects' },
        ],
      },
    ];
    expect(extendsProblems(m)).toEqual([]);
    expect([...extensionUses(m, 'core').get('risk')!]).toContain('standards');
    const plan = planPackInstall(m, snap, env);
    expect(plan.preview.conflicts).toEqual([]);
    const widgets = (plan.payload!.dashboards[0]!.config as { widgets: Row[] }).widgets;
    expect(widgets.map((w) => w.sheetId)).toEqual([
      refs['sheet:risk'],
      plan.payload!.sheets.find((s) => s.ref === 'aspects')!.id,
    ]);
    // a field the Core sheet lacks is a conflict, as for the pack's own sheets
    m.dashboards[0]!.widgets[0]!.type = 'by_option';
    m.dashboards[0]!.widgets[0]!.fieldKey = 'missing';
    expect(planPackInstall(m, snap, env).preview.conflicts.join(' ')).toMatch(
      /Environment overview › ISO 14001 risks/,
    );
  });

  it('links an example item on a Core sheet to a required library through a requirement column it adds', () => {
    const { snap } = withCore();
    const m = addon();
    m.frameworks = [{ key: 'iso-14001', version: '2026' }];
    m.extends![1]!.fields!.push({
      key: 'iso14001_clauses',
      name: 'ISO 14001 clauses',
      type: 'requirement',
      config: { multiple: true },
    });
    m.extends![1]!.items![0]!.requirements = {
      iso14001_clauses: ['iso-14001@2026#6.1.4', 'iso-14001@2026#9.9'],
    };
    const p = planPackInstall(
      m,
      {
        ...snap,
        libraries: [{ library: 'iso-14001@2026', sheetId: 'lib' }],
        requirementItems: { 'iso-14001@2026#6.1.4': 'req-614' },
      },
      env,
    );
    const field = p.payload!.fields.find((f) => f.ref === 'core:risk.iso14001_clauses')!;
    const spill = p.payload!.items.find((i) => i.ref === 'core:risk.iso14001_spill')!;
    expect(p.payload!.links).toContainEqual({
      field_id: field.id,
      from_item: spill.id,
      to_item: 'req-614',
    });
    expect(p.preview.warnings).toContain(
      'Risk register › Example: spill: the library has no requirement 9.9, so it is not linked.',
    );
  });

  it('merges options by id: an option already there is left as it is', () => {
    const { payload, snap } = withCore();
    const refs = refMapOf(payload);
    const risk = snap.foreign!['core:risk']!;
    const standards = risk.fields.find((f) => f.id === refs['field:risk.standards'])!;
    standards.config = {
      options: [
        { id: 'all', label: 'All standards', color: 'grey' },
        { id: 'iso14001', label: 'ISO 14001 (renamed)', color: 'teal' },
      ],
    };
    const p = planPackInstall(addon(), snap, env).payload!;
    expect(p.options!.map((o) => o.ref)).toEqual(['core:risk.kind.iso14001_env']);
  });

  it('refuses a column key the Core sheet already has', () => {
    const { snap } = withCore();
    snap.foreign!['core:risk']!.fields.push({
      id: 'f-x',
      key: 'iso14001_permit',
      name: 'Permit',
      type: 'text',
      config: {},
      required: false,
      locked: false,
      description: null,
      installId: null,
    });
    expect(planPackInstall(addon(), snap, env).preview.conflicts).toContain(
      'Risk register already has a column "iso14001_permit".',
    );
  });

  it('treats its own earlier rows as its own (upgrades and higher levels plan them again)', () => {
    const { snap } = withCore();
    const first = planPackInstall(addon(), snap, env).payload!;
    const after = afterInstall(snap, first, 'inst-addon');
    // the add-on's columns are now on the Core sheet, made by its install
    for (const f of after.foreign!['core:risk']!.fields)
      if (f.key.startsWith('iso14001_')) f.installId = 'inst-addon';
    const aug = augmentManifest(addon(), after.foreign!, { selfInstall: 'inst-addon' });
    expect(aug.problems).toEqual([]);
  });
});

// ───────────────────────── upgrades ─────────────────────────

function stateOf(p: InstallPayload, installId: string, version: string): InstalledState {
  return {
    installId,
    version,
    level: p.pack.level ?? null,
    refMap: refMapOf(p),
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
      description: null,
      itemLabel: String(s.item_label),
      folderId: (s.folder_id as string | null) ?? null,
      parentSheetId: null,
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
      requirementRef: null,
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
    dashboards: [],
    lastPosition: { fields: {}, groups: {}, views: {}, items: {} },
  };
}

describe('upgrades with extends', () => {
  it('blocks a Core update that removes or retypes a field an add-on uses', () => {
    const { payload } = withCore();
    const next = core();
    next.version = '1.1.0';
    const risk = next.sheets[0]!;
    risk.fields = risk.fields
      .filter((f) => f.key !== 'kind')
      .map((f) => (f.key === 'score' ? { ...f, type: 'text' as const } : f));
    const plan = planPackUpgrade({
      from: { manifest: core(), hash: 'h' },
      to: { manifest: next, hash: 'h2' },
      state: stateOf(payload, 'inst-core', '1.0.0'),
      snapshot: snapshot(),
      env,
      extenders: [{ title: 'ISO 14001', manifest: addon() }],
    });
    expect(plan.state).toBe('blocked');
    expect(plan.preview.blockers).toEqual([
      'ISO 14001 uses Risk register › Score, which this version changes to another type. It cannot be updated while ISO 14001 is installed.',
      'ISO 14001 uses Risk register › Kind, which this version removes. It cannot be updated while ISO 14001 is installed.',
    ]);
    // without the add-on the same update goes ahead (the field is kept and said, as for any upgrade)
    expect(
      planPackUpgrade({
        from: { manifest: core(), hash: 'h' },
        to: { manifest: next, hash: 'h2' },
        state: stateOf(payload, 'inst-core', '1.0.0'),
        snapshot: snapshot(),
        env,
      }).state,
    ).toBe('ready');
  });

  it('adds new columns and options of a newer add-on to the Core sheet, nothing twice', () => {
    const { snap } = withCore();
    const first = planPackInstall(addon(), snap, env).payload!;
    const after = afterInstall(snap, first, 'inst-addon');
    for (const f of after.foreign!['core:risk']!.fields)
      if (f.key.startsWith('iso14001_')) f.installId = 'inst-addon';
    for (const g of after.foreign!['core:risk']!.groups)
      if (first.groups.some((x) => x.id === g.id)) g.installId = 'inst-addon';
    const next = addon();
    next.version = '1.1.0';
    next.extends![1]!.fields!.push({ key: 'iso14001_volume', name: 'Volume', type: 'number' });
    next.extends![1]!.options!.kind!.push({ id: 'iso14001_air', label: 'Air', color: 'teal' });
    const plan = planPackUpgrade({
      from: { manifest: addon(), hash: 'h' },
      to: { manifest: next, hash: 'h2' },
      state: stateOf(first, 'inst-addon', '1.0.0'),
      snapshot: { ...after, installs: after.installs.filter((i) => i.id !== 'inst-addon') },
      env,
    });
    expect(plan.preview.blockers).toEqual([]);
    expect(plan.state).toBe('ready');
    const p = plan.payload!;
    expect(p.add.fields.map((f) => f.ref)).toEqual(['core:risk.iso14001_volume']);
    expect(p.add.options!.map((o) => o.ref)).toEqual(['core:risk.kind.iso14001_air']);
    expect(p.add.items).toEqual([]);
    expect(p.add.views).toEqual([]);
    expect(p.archive.sheets).toEqual([]);
  });
});
