import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  planPackInstall,
  planPackUpgrade,
  previewLines,
  type InstallPayload,
  type InstalledState,
  type PackSnapshot,
} from '@/engine/packs';
import { extendsAgainst, neededLevel } from '@/engine/packs/extend';
import { computeWidget } from '@/engine/dashboards';
import { FIELD_TYPES } from '@/engine/fields/registry';
import { installFieldTypes } from '@/engine/fields/resolve';
import { afterInstall, installedStateOf, refMapOf } from '@/engine/packs/installed.fixture';
import { startsInTestMode } from '@/engine/packs/safety';
import { makeCtx, makeField, makeItem, sheet as fixtureSheet } from '@/engine/testing/fixtures';
import type { Condition, Json } from '@/engine/types';
import { repoPacks } from './catalogue';
import { packManifestSchema } from './manifest';
import { packQualityProblems } from './quality';

// Supplier management (docs/11): 3.0.0 is an add-on that extends the Core registers' shared Suppliers register instead
// of shipping its own, and keeps the per-supplier requirement checks, the library's Applies-to rules, the sync and the
// soft links to the 27001, 9001 and GDPR libraries. 2.0.0 (its own Supplier register in Core's Suppliers domain) stays
// in the catalogue for the workspaces that have it and is tested on its fixture; the 1.0.0 → 1.1.0 upgrade (P6) is
// kept as a test of the upgrade planner on the fixtures.
type Row = Record<string, Json>;
beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));
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
const v20 = fixture('2.0.0');
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

/** Core installed at the level the add-on needs (Starter for 2.0.0 and 3.0.0 alike). */
function withCore(over: Partial<PackSnapshot> = {}) {
  const corePlan = planPackInstall(core, snapshot(), env, {
    level: neededLevel(pack, core) ?? 'starter',
  });
  return {
    snap: afterInstall(snapshot(over), corePlan.payload!, 'inst-core'),
    coreRefs: refMapOf(corePlan.payload!),
  };
}

describe('Supplier management add-on 2.0.0 (catalogue only, on its fixture)', () => {
  const m = v20;
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

describe('Supplier management add-on 3.0.0 on the Core Suppliers register', () => {
  const m = pack;
  const onSuppliers = m.extends!.find((e) => e.sheet === 'suppliers')!;
  const plan = () => {
    const { snap, coreRefs } = withCore();
    const p = planPackInstall(m, snap, env);
    return { p, coreRefs, payload: p.payload! };
  };

  it('is a new major that extends Core Suppliers instead of shipping a supplier register', () => {
    expect(m.version).toBe('3.1.1');
    // Core's Suppliers register came with 1.1.0
    expect(m.requires).toEqual([{ pack: 'core', range: '^1.1.0' }]);
    expect(packQualityProblems(m)).toEqual([]);
    expect(extendsAgainst(m, core)).toEqual([]);
    expect(neededLevel(m, core)).toBe('starter');
    expect(m.sheets.map((s) => [s.ref, s.folder, s.kind])).toEqual([
      ['review', 'core:suppliers', 'log'],
      ['requirement', 'core:suppliers', 'library'],
      ['check', 'core:suppliers', 'register'],
    ]);
    expect(m.extends!.map((e) => e.sheet)).toEqual(['suppliers', 'documents', 'risk', 'nc']);
    // Core's Owner, Status, Criticality and Next review are used, never added again
    expect(onSuppliers.fields!.map((f) => f.key)).toEqual([
      'suppliermanagement_approval_step',
      'suppliermanagement_category',
      'suppliermanagement_personal_data',
      'suppliermanagement_reviews',
      'suppliermanagement_extra',
      'suppliermanagement_checks',
      'suppliermanagement_met',
      'suppliermanagement_pct_met',
      'suppliermanagement_worst',
      'suppliermanagement_expired',
      'suppliermanagement_sync',
      'suppliermanagement_documents',
      'suppliermanagement_risks',
      'suppliermanagement_nonconformities',
      'suppliermanagement_notes',
    ]);
    // no framework column of its own: Core's shared Requirements column is on Suppliers already
    expect(
      onSuppliers.fields!.some((f) => f.type === 'requirement' && !f.config?.targetSheetRef),
    ).toBe(false);
  });

  it('installs on Core: the checks, reviews and columns join Core’s Suppliers, both ways', () => {
    const { p, coreRefs, payload } = plan();
    expect(p.state).toBe('ready');
    expect(p.preview.conflicts).toEqual([]);
    const suppliers = coreRefs['sheet:suppliers']!;
    for (const s of payload.sheets.filter((x) => !x.parent_sheet_id))
      expect(s.folder_id).toBe(coreRefs['folder:suppliers']);
    expect(payload.sheets.some((s) => s.ref === 'supplier')).toBe(false);
    const field = (ref: string) => payload.fields.find((f) => f.ref === ref)!;
    const cfg = (ref: string) => field(ref).config as Row;
    // the checks and reviews link to Core's suppliers, their inverses on Core's Suppliers
    expect(cfg('check.supplier').targetSheetId).toBe(suppliers);
    expect(cfg('check.supplier').inverseFieldId).toBe(
      field('core:suppliers.suppliermanagement_checks').id,
    );
    expect(cfg('core:suppliers.suppliermanagement_checks').inverseFieldId).toBe(
      field('check.supplier').id,
    );
    expect(cfg('review.supplier').targetSheetId).toBe(suppliers);
    expect(field('core:suppliers.suppliermanagement_checks').sheet_id).toBe(suppliers);
    // two Core registers joined by this add-on, both ways: a supplier's documents and a document's suppliers
    const docs = field('core:documents.suppliermanagement_suppliers');
    const supDocs = field('core:suppliers.suppliermanagement_documents');
    expect([(docs.config as Row).targetSheetId, (docs.config as Row).inverseFieldId]).toEqual([
      suppliers,
      supDocs.id,
    ]);
    expect([(supDocs.config as Row).targetSheetId, (supDocs.config as Row).inverseFieldId]).toEqual(
      [coreRefs['sheet:documents'], docs.id],
    );
    expect((cfg('core:suppliers.suppliermanagement_met') as Row).linkFieldKey).toBe(
      'suppliermanagement_checks',
    );
  });

  it('adds the example suppliers to Core with their checks, review, documents and risk', () => {
    const { coreRefs, payload } = plan();
    const item = (ref: string) => payload.items.find((i) => i.ref === ref)!;
    const cloud = item('core:suppliers.suppliermanagement_cloudhost');
    expect([cloud.sheet_id, cloud.name]).toEqual([
      coreRefs['sheet:suppliers'],
      'Example: Northwind Cloud Hosting',
    ]);
    const field = (ref: string) => payload.fields.find((f) => f.ref === ref)!.id;
    const linked = (fieldRef: string, from: string) =>
      payload.links
        .filter((l) => l.field_id === field(fieldRef) && l.from_item === item(from).id)
        .map((l) => payload.items.find((i) => i.id === l.to_item)?.ref)
        .sort();
    expect(
      linked(
        'core:suppliers.suppliermanagement_checks',
        'core:suppliers.suppliermanagement_cloudhost',
      ),
    ).toEqual([
      'check.cloudhost_cert',
      'check.cloudhost_contract',
      'check.cloudhost_dpa',
      'check.cloudhost_transfers',
    ]);
    expect(
      linked(
        'core:suppliers.suppliermanagement_reviews',
        'core:suppliers.suppliermanagement_cloudhost',
      ),
    ).toEqual(['review.cloudhost_2026']);
    expect(
      linked(
        'core:documents.suppliermanagement_suppliers',
        'core:documents.suppliermanagement_code_of_conduct',
      ),
    ).toEqual([
      'core:suppliers.suppliermanagement_cloudhost',
      'core:suppliers.suppliermanagement_fasteners',
    ]);
    expect(
      linked(
        'core:risk.suppliermanagement_supplier',
        'core:risk.suppliermanagement_hosting_outage',
      ),
    ).toEqual(['core:suppliers.suppliermanagement_cloudhost']);
    // Core's own columns carry the example's status and criticality; they are not added again
    const values = cloud.values as Row;
    expect(values[coreRefs['field:suppliers.criticality']!]).toBe('opt_high');
    expect(values[coreRefs['field:suppliers.status']!]).toBe('opt_approved');
    expect(
      payload.fields.filter(
        (f) =>
          f.sheet_id === coreRefs['sheet:suppliers'] &&
          ['owner', 'status', 'criticality', 'next_review'].includes(String(f.key)),
      ),
    ).toEqual([]);
  });

  it('keeps the requirement checks in step on Core’s suppliers, reading the add-on’s columns', () => {
    const { coreRefs, payload } = plan();
    const checks = payload.sheets.find((s) => s.ref === 'check')!;
    expect((checks.settings as Row).uniqueLinkPair).toEqual(['supplier', 'requirement']);
    const sync = payload.automations.filter((a) =>
      (a.actions as Row[]).some((x) => x.type === 'sync_requirement_checks'),
    );
    expect(sync).toHaveLength(10);
    for (const a of sync)
      expect((a.actions as Row[])[0]).toMatchObject({
        sheetId: checks.id,
        categoryKey: 'suppliermanagement_category',
        personalDataKey: 'suppliermanagement_personal_data',
        manualKey: 'suppliermanagement_extra',
      });
    // six on the supplier (Core's Suppliers), four on the library
    expect(sync.filter((a) => a.sheet_id === coreRefs['sheet:suppliers'])).toHaveLength(6);
    const onCriticality = sync.find((a) => a.ref === 'sync_on_criticality')!;
    expect(onCriticality.trigger).toMatchObject({ fieldKey: 'criticality' });
  });

  it('approves suppliers on Core’s Suppliers with its own workflow, Core’s Status and an owner who can be named', () => {
    const { coreRefs, payload } = plan();
    const w = onSuppliers.workflows![0]!;
    expect(w.id).toBe('suppliermanagement_supplier_approval');
    expect(w.requiredFields).toEqual(['owner', 'suppliermanagement_category', 'criticality']);
    expect(w.steps.map((s) => s.approvers)).toEqual([
      { kind: 'field', fieldKey: 'owner' },
      { kind: 'jobRole', roleName: 'Top management' },
    ]);
    expect(w.statusField).toMatchObject({
      fieldKey: 'status',
      onSubmit: 'opt_review',
      onApproved: 'opt_approved',
      onRejected: 'opt_blocked',
    });
    expect(payload.workflows?.map((x) => [x.sheet_id, (x.workflow as Row).id])).toEqual([
      [coreRefs['sheet:suppliers'], 'suppliermanagement_supplier_approval'],
    ]);
  });

  it('reads Core’s Suppliers on the dashboard and in the setup checklist', () => {
    const { coreRefs, payload } = plan();
    const widgets = (payload.dashboards[0]!.config as { widgets: Row[] }).widgets;
    const w = (id: string) => widgets.find((x) => x.id === id)!;
    expect(w('w_status').sheetId).toBe(coreRefs['sheet:suppliers']);
    expect(w('w_criticality').sheetId).toBe(coreRefs['sheet:suppliers']);
    // open supplier nonconformities, of the supplier nonconformities
    expect(w('w_nc')).toMatchObject({
      sheetId: coreRefs['sheet:nc'],
      scope: [{ fieldKey: 'source', op: 'is_any_of', value: ['opt_supplier'] }],
      conditions: [{ fieldKey: 'stage', op: 'is_not_done' }],
    });
    expect(m.setup!.steps.map((s) => s.target.sheetRef)).toEqual([
      'core:suppliers',
      'requirement',
      'check',
      'core:suppliers',
    ]);
  });

  it('ships its forms on Core’s Suppliers and Nonconformities, internal, and quiet notifying automations', () => {
    const forms = m.extends!.flatMap((e) =>
      (e.forms ?? []).map((f) => [e.sheet, f.name, f.access]),
    );
    expect(forms).toEqual([
      ['suppliers', 'Supplier self-assessment', 'internal'],
      ['suppliers', 'Suggest a new supplier', 'internal'],
      ['nc', 'Report a supplier problem', 'internal'],
    ]);
    const all = [...m.automations, ...m.extends!.flatMap((e) => e.automations ?? [])];
    expect(
      all
        .filter((a) => a.advanced)
        .map((a) => a.ref)
        .sort(),
    ).toEqual(
      [
        'review_failed_nc',
        'review_next_cycle',
        'review_overdue_escalate',
        'resync_on_new_requirement',
        'sync_on_create',
      ].sort(),
    );
    for (const a of all.filter((x) => x.actions.some((y) => y.type === 'notify')))
      expect(startsInTestMode(a), a.ref).toBe(true);
    for (const s of m.sheets.filter((x) => !x.isLibrary))
      for (const i of s.items) expect(i.name).toMatch(/^Example: /);
    for (const i of onSuppliers.items ?? []) expect(i.name).toMatch(/^Example: /);
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

describe('Supplier management 3.1.1: Met checks with expired evidence', () => {
  const w = pack.dashboards.flatMap((d) => d.widgets).find((x) => x.ref === 'w_expired')!;
  const check = pack.sheets.find((s) => s.ref === 'check')!;

  it('is a count of Met checks whose evidence expired, the condition of the Expired evidence view', () => {
    // 3.1.0 had an Overdue widget filtered to Met: Overdue leaves out done items and Met is done, so it read 0
    expect(w).toEqual({
      ref: 'w_expired',
      type: 'count',
      title: 'Met checks with expired evidence',
      sheetRef: 'check',
      conditions: [
        { fieldKey: 'status', op: 'is_any_of', value: ['opt_met'] },
        { fieldKey: 'evidence_expiry', op: 'before', value: 'today' },
      ],
    });
    const view = check.views.find((v) => v.name === 'Expired evidence')!;
    expect((view.config as { filters: unknown[] }).filters).toContainEqual(w.conditions![1]);
    expect(check.fields.find((f) => f.key === 'status')!.config).toMatchObject({
      options: expect.arrayContaining([
        { id: 'opt_met', label: 'Met', color: 'green', done: true },
      ]),
    });
  });

  it('counts a Met check with expired evidence, not one still valid or one not met', () => {
    const fields = check.fields
      .filter((f) => f.key === 'status' || f.key === 'evidence_expiry')
      .map((f, i) =>
        makeField(f.type, f.config ?? {}, {
          key: f.key,
          id: `f-${f.key}`,
          name: f.name,
          position: `a${i}`,
        }),
      );
    const items = [
      makeItem({ 'f-status': 'opt_met', 'f-evidence_expiry': '2026-10-01' }, { id: 'expired' }),
      makeItem({ 'f-status': 'opt_met', 'f-evidence_expiry': '2027-10-01' }, { id: 'valid' }),
      makeItem({ 'f-status': 'opt_not_met', 'f-evidence_expiry': '2026-10-01' }, { id: 'not-met' }),
    ];
    const ctx = makeCtx({ fields, items });
    const source = { sheet: fixtureSheet, fields, items, ctx };
    const result = computeWidget(
      {
        id: 'w_expired',
        type: 'count',
        title: w.title,
        sheetId: fixtureSheet.id,
        conditions: w.conditions as Condition[],
      },
      {
        today: '2026-11-11',
        timeZone: 'Europe/London',
        months: 6,
        sheet: (id) => (id === fixtureSheet.id ? source : undefined),
        sheets: () => [source],
        changes: [],
        evidence: [],
        runs: [],
      },
    );
    expect(result).toMatchObject({ kind: 'stat', value: 1 });
  });

  it('updates 3.1.0 without a conflict: only the widget changes', () => {
    const from = packManifestSchema.parse(
      JSON.parse(
        readFileSync(
          join(process.cwd(), 'tests/e2e/fixtures/catalogue/supplier-management@3.1.0.json'),
          'utf8',
        ),
      ),
    );
    expect(from.version).toBe('3.1.0');
    const { snap } = withCore();
    const p = planPackInstall(from, snap, env).payload!;
    const all = afterInstall(snap, p, 'inst-addon');
    for (const f of Object.values(all.foreign ?? {}))
      for (const x of f.fields) if (p.fields.some((y) => y.id === x.id)) x.installId = 'inst-addon';
    const up = planPackUpgrade({
      from: { manifest: from, hash: 'h-from' },
      to: { manifest: pack, hash: 'h-to' },
      state: installedStateOf(p, 'inst-addon'),
      snapshot: { ...all, installs: all.installs.filter((i) => i.id !== 'inst-addon') },
      env,
    });
    expect(up.preview.blockers).toEqual([]);
    expect(up.preview.conflicts).toEqual([]);
    expect(up.state).toBe('ready');
    expect(up.preview.added).toEqual([]);
    expect(up.preview.archived).toEqual([]);
    expect(up.preview.changed.map((c) => `${c.kind}:${c.ref}`)).toEqual(['dashboard:overview']);
    const dash = up.payload!.update.dashboards[0]!;
    const widgets = (dash.config as { widgets: Row[] }).widgets;
    expect(widgets.find((x) => x.id === 'w_expired')).toMatchObject({
      type: 'count',
      conditions: w.conditions,
    });
  });
});

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
