import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  planPackInstall,
  planPackUpgrade,
  previewLines,
  type InstallPayload,
  type InstalledState,
  type PackSnapshot,
} from '@/engine/packs';
import { extendsAgainst, neededLevel } from '@/engine/packs/extend';
import { afterInstall, refMapOf } from '@/engine/packs/installed.fixture';
import { startsInTestMode } from '@/engine/packs/safety';
import type { Json } from '@/engine/types';
import { repoPacks } from './catalogue';
import { packManifestSchema } from './manifest';
import { packQualityProblems } from './quality';

// Supplier management (docs/11): 2.0.0 is an add-on to the Core registers that keeps the per-supplier requirement
// checks, the library's Applies-to rules, the sync and the soft links to the 27001, 9001 and GDPR libraries; the
// 1.0.0 → 1.1.0 upgrade (P6) is kept as a test of the upgrade planner on the fixtures.
type Row = Record<string, Json>;
const packs = repoPacks();
const pack = packs.find((p) => p.key === 'supplier-management')!;
const core = packs.find((p) => p.key === 'core')!;
const fixture = (version: string) =>
  packManifestSchema.parse(
    JSON.parse(
      readFileSync(join(__dirname, 'fixtures', `supplier-management-${version}.json`), 'utf8'),
    ),
  );
const v1 = fixture('1.0.0');
const v11 = fixture('1.1.0');
const LIB27 = '00000000-0000-4000-8000-00000000f027';

const snapshot = (over: Partial<PackSnapshot> = {}): PackSnapshot => ({
  orgId: 'org-1',
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
  now: new Date('2026-11-14T10:00:00Z'),
  timeZone: 'Europe/London',
  newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  hash: 'h',
  userId: 'u-1',
};

/** Core installed at the level the add-on needs. */
function withCore(over: Partial<PackSnapshot> = {}) {
  const corePlan = planPackInstall(core, snapshot(), env, {
    level: neededLevel(pack, core) ?? 'starter',
  });
  return {
    snap: afterInstall(snapshot(over), corePlan.payload!, 'inst-core'),
    coreRefs: refMapOf(corePlan.payload!),
  };
}

describe('Supplier management add-on 2.0.0', () => {
  const m = pack;
  const sheet = (ref: string) => m.sheets.find((s) => s.ref === ref)!;

  it('requires Core, meets the quality bar and puts its sheets in the Suppliers domain', () => {
    expect(m.version).toBe('2.0.0');
    expect(m.requires).toEqual([{ pack: 'core', range: '^1.0.0' }]);
    expect(packQualityProblems(m)).toEqual([]);
    expect(extendsAgainst(m, core)).toEqual([]);
    // only Starter sheets of Core: Documents and policies, Risk register, Nonconformities and CAPA
    expect(neededLevel(m, core)).toBe('starter');
    expect(
      m.sheets.map((s) => [s.name, s.folder, s.kind ?? (s.isLibrary ? 'library' : null)]),
    ).toEqual([
      ['Supplier register', 'core:suppliers', 'register'],
      ['Supplier reviews', 'core:suppliers', 'log'],
      ['Supplier requirements', 'core:suppliers', 'library'],
      ['Supplier requirement checks', 'core:suppliers', 'register'],
    ]);
    // supplier documents are Core documents now
    expect(m.sheets.some((s) => s.register === 'documents')).toBe(false);
    expect(m.extends!.map((e) => e.sheet)).toEqual(['documents', 'risk', 'nc']);
  });

  it('ships the checks sheet with one check per supplier and requirement', () => {
    const check = sheet('check');
    expect(check.uniqueLinks).toEqual(['supplier', 'requirement']);
    expect(check.folder).toBe(sheet('supplier').folder);
    const status = check.fields.find((f) => f.key === 'status')!;
    expect((status.config as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(
      ['Not checked', 'Met', 'Not met', 'Not applicable', 'No longer applies'],
    );
    expect(status.rules?.[0]?.require).toEqual(['na_reason', 'na_approver']);
    expect(check.views.map((v) => v.name)).toEqual(
      expect.arrayContaining(['All checks', 'Not met', 'Expired evidence', 'Not checked']),
    );
    // four tabs show; the other saved views stay as hidden tabs
    expect(check.tabs!.filter((t) => !t.hidden).map((t) => t.ref)).toEqual([
      'All checks',
      'Not met',
      'By status',
      'calendar',
    ]);
    expect(check.fields.find((f) => f.key === 'evidence_documents')!.config).toMatchObject({
      targetSheetRef: 'core:documents',
    });
  });

  it('ships 13 library requirements in our own words, each with an Applies-to rule', () => {
    const lib = sheet('requirement').items;
    expect(lib.length).toBeGreaterThanOrEqual(12);
    for (const r of lib) expect(r.values.applies_when).toMatch(/^opt_/);
    expect(lib.filter((r) => r.values.applies_when === 'opt_processors').map((r) => r.ref)).toEqual(
      ['dpa', 'subprocessors', 'transfers', 'exit_return'],
    );
  });

  it('links to the 27001, 9001 and GDPR libraries only where adopted (optional frameworks)', () => {
    expect(m.frameworks?.every((f) => f.optional)).toBe(true);
    const none = planPackInstall(m, withCore().snap, env);
    expect(none.state).toBe('ready');
    expect(none.preview.frameworks.every((f) => !f.adopted && f.optional)).toBe(true);
    expect(none.payload!.links.some((l) => l.to_item === 'req-a519')).toBe(false);
    const with27 = planPackInstall(
      m,
      withCore({
        libraries: [{ library: 'iso-27001@2022', sheetId: LIB27 }],
        requirementItems: { 'iso-27001@2022#A.5.19': 'req-a519' },
      }).snap,
      env,
    );
    expect(with27.state).toBe('ready');
    expect(with27.payload!.links.filter((l) => l.to_item === 'req-a519').length).toBe(2);
    // keys of A.5.20–A.5.22 the snapshot lacks are said, never blockers
    expect(with27.preview.warnings.join(' ')).toMatch(/A\.5\.20/);
  });

  it('installs the sync automations, the button and the roll-ups on the supplier register', () => {
    const p = planPackInstall(m, withCore().snap, env);
    expect(p.preview.conflicts).toEqual([]);
    const autos = p.payload!.automations;
    const sync = autos.filter((a) =>
      (a.actions as Row[]).some((x) => x.type === 'sync_requirement_checks'),
    );
    expect(sync.length).toBe(10);
    const checksSheet = p.payload!.sheets.find((s) => s.ref === 'check')!;
    for (const a of sync) expect((a.actions as Row[])[0]!.sheetId).toBe(checksSheet.id);
    expect((checksSheet.settings as Row).uniqueLinkPair).toEqual(['supplier', 'requirement']);
    const supplierFields = p.payload!.fields.filter((f) => String(f.ref).startsWith('supplier.'));
    const byKey = (k: string) => supplierFields.find((f) => f.key === k)!;
    expect((byKey('checks').config as Row).panel).toBe('checklist');
    expect((byKey('requirements_met').config as Row).fn).toBe('doneOf');
    expect(byKey('sync_requirements').type).toBe('button');
    expect(previewLines(p.preview).join(' ')).toMatch(/Supplier requirement checks/);
  });

  it('puts supplier documents, risks and problems on the Core registers, linked both ways', () => {
    const { snap, coreRefs } = withCore();
    const p = planPackInstall(m, snap, env).payload!;
    for (const s of p.sheets.filter((x) => !x.parent_sheet_id))
      expect(s.folder_id).toBe(coreRefs['folder:suppliers']);
    const docs = p.items.filter((i) => i.sheet_id === coreRefs['sheet:documents']);
    expect(docs.map((d) => d.name)).toEqual([
      'Supplier code of conduct',
      'Supplier onboarding procedure',
    ]);
    const cloud = p.items.find((i) => i.ref === 'supplier.cloudhost')!;
    const supplierDocs = p.fields.find((f) => f.ref === 'supplier.documents')!;
    expect(p.links).toContainEqual({
      field_id: supplierDocs.id,
      from_item: cloud.id,
      to_item: docs[0]!.id,
    });
    expect(p.views.find((v) => v.sheet_id === coreRefs['sheet:documents'])?.name).toBe(
      'Supplier documents',
    );
    expect(p.fields.filter((f) => f.sheet_id === coreRefs['sheet:nc']).map((f) => f.key)).toEqual([
      'suppliermanagement_supplier',
      'suppliermanagement_review',
      'suppliermanagement_details',
    ]);
    // the headline dashboard reads the supplier nonconformities in Core
    const widgets = (p.dashboards[0]!.config as { widgets: { id: string; sheetId?: string }[] })
      .widgets;
    expect(widgets.find((w) => w.id === 'w_nc')!.sheetId).toBe(coreRefs['sheet:nc']);
  });

  it('approves suppliers with a workflow, ships internal forms and quiet notifying automations', () => {
    expect(
      sheet('supplier').workflows!.map((w) => [w.id, w.steps.map((s) => s.approvers)]),
    ).toEqual([
      [
        'supplier-approval',
        [
          { kind: 'field', fieldKey: 'owner' },
          { kind: 'jobRole', roleName: 'Top management' },
        ],
      ],
    ]);
    const forms = [
      ...m.sheets.flatMap((s) => s.forms.map((f) => [f.name, f.access])),
      ...m.extends!.flatMap((e) => (e.forms ?? []).map((f) => [f.name, f.access])),
    ];
    expect(forms).toEqual([
      ['Supplier self-assessment', 'internal'],
      ['Suggest a new supplier', 'internal'],
      ['Report a supplier problem', 'internal'],
    ]);
    const all = [...m.automations, ...m.extends!.flatMap((e) => e.automations ?? [])];
    expect(all.filter((a) => a.advanced).map((a) => a.ref)).toEqual([
      'sync_on_create',
      'resync_on_new_requirement',
      'review_overdue_escalate',
      'review_failed_nc',
      'review_next_cycle',
    ]);
    for (const a of all.filter((x) => x.actions.some((y) => y.type === 'notify')))
      expect(startsInTestMode(a), a.ref).toBe(true);
    // example items are marked as examples (the library and Core documents are not examples)
    for (const s of m.sheets.filter((x) => !x.isLibrary))
      for (const i of s.items) expect(i.name).toMatch(/^Example: /);
  });
});

/** Install 1.0.0 and read it back the way the server does (upgrade.test.ts does the same for a test pack). */
function installV1() {
  const plan = planPackInstall(v1, snapshot(), { ...env, today: '2026-10-01' });
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
    version: v1.version,
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
    dashboards: p.dashboards.map((d) => ({
      id: String(d.id),
      ref: String(d.ref),
      name: String(d.name),
      config: d.config!,
      archived: false,
    })),
    lastPosition: { fields: {}, groups: {}, views: {}, items: {} },
  };
  return state;
}

describe('upgrading a 1.0.0 workspace to 1.1.0 (P6, on the fixtures)', () => {
  it('adds the checks sheet, the new fields, library requirements and automations', () => {
    const state = installV1();
    const up = planPackUpgrade({
      from: { manifest: v1, hash: 'h1' },
      to: { manifest: v11, hash: 'h2' },
      state,
      snapshot: snapshot({ prefixes: ['SUP-', 'SRV-', 'SRQ-', 'SDOC-'] }),
      env: { ...env, today: '2026-11-14' },
    });
    expect(up.preview.conflicts).toEqual([]);
    const u = up.payload!;
    expect(u.add.sheets.map((s) => s.ref)).toEqual(['check']);
    expect((u.add.sheets[0]!.settings as Row).uniqueLinkPair).toEqual(['supplier', 'requirement']);
    // the checks sheet joins the folder the install already has
    expect(u.add.sheets[0]!.folder_id).toBe(state.refMap['folder:suppliers']);
    const added = new Set(u.add.fields.map((f) => String(f.ref)));
    for (const ref of [
      'supplier.processes_personal_data',
      'supplier.checks',
      'supplier.requirements_met',
      'supplier.pct_met',
      'supplier.worst_check',
      'supplier.expired_evidence',
      'supplier.sync_requirements',
      'requirement.applies_when',
      'requirement.applies_categories',
      'requirement.min_criticality',
      'requirement.framework_links',
      'requirement.version',
      'requirement.checks',
      'check.supplier',
      'check.requirement',
      'check.status',
    ])
      expect(added, ref).toContain(ref);
    // the two-way link between an existing sheet and the new one is wired both ways
    const supChecks = u.add.fields.find((f) => f.ref === 'supplier.checks')!;
    const checkSupplier = u.add.fields.find((f) => f.ref === 'check.supplier')!;
    expect((supChecks.config as Row).inverseFieldId).toBe(checkSupplier.id);
    expect((checkSupplier.config as Row).inverseFieldId).toBe(supChecks.id);
    expect((checkSupplier.config as Row).targetSheetId).toBe(state.refMap['sheet:supplier']);
    // new library requirements are added; the ones the install has take the new wording and rules
    expect(u.add.items.filter((i) => String(i.ref).startsWith('requirement.')).length).toBe(10);
    expect(u.add.items.filter((i) => String(i.ref).startsWith('check.')).length).toBe(4);
    expect(u.add.automations.map((a) => a.ref)).toEqual(
      expect.arrayContaining(['sync_button', 'resync_on_applies', 'check_answered']),
    );
    expect(up.preview.changed.map((c) => c.ref)).toEqual(
      expect.arrayContaining(['supplier.requirements', 'requirement.security_clause']),
    );
    // example checks link to example suppliers and requirements the install already has
    const contract = u.add.items.find((i) => i.ref === 'check.cloudhost_contract')!;
    expect(u.add.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from_item: contract.id,
          to_item: state.refMap['item:supplier.cloudhost'],
        }),
        expect.objectContaining({
          from_item: contract.id,
          to_item: state.refMap['item:requirement.security_clause'],
        }),
      ]),
    );
  });
});
