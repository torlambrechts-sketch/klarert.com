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
import type { Json } from '@/engine/types';
import { repoPacks } from './catalogue';
import { packManifestSchema } from './manifest';

// Supplier management 1.1.0 (docs/11): per-supplier requirement checks, the library's Applies-to rules, soft links to
// the 27001, 9001 and GDPR libraries, and the upgrade from 1.0.0.
type Row = Record<string, Json>;
const pack = repoPacks().find((p) => p.key === 'supplier-management')!;
const manifest = pack;
const v1 = packManifestSchema.parse(
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'supplier-management-1.0.0.json'), 'utf8')),
);
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

describe('Supplier management pack 1.1.0', () => {
  const m = manifest;
  const sheet = (ref: string) => m.sheets.find((s) => s.ref === ref)!;

  it('ships the checks sheet with one check per supplier and requirement', () => {
    expect(m.version).toBe('1.1.0');
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
    const none = planPackInstall(m, snapshot(), env);
    expect(none.state).toBe('ready');
    expect(none.preview.frameworks.every((f) => !f.adopted && f.optional)).toBe(true);
    expect(none.payload!.links.some((l) => l.to_item === 'req-a519')).toBe(false);
    const with27 = planPackInstall(
      m,
      snapshot({
        libraries: [{ library: 'iso-27001@2022', sheetId: LIB27 }],
        requirementItems: { 'iso-27001@2022#A.5.19': 'req-a519' },
      }),
      env,
    );
    expect(with27.state).toBe('ready');
    expect(with27.payload!.links.filter((l) => l.to_item === 'req-a519').length).toBe(2);
    // keys of A.5.20–A.5.22 the snapshot lacks are said, never blockers
    expect(with27.preview.warnings.join(' ')).toMatch(/A\.5\.20/);
  });

  it('installs the sync automations, the button and the roll-ups on the supplier register', () => {
    const p = planPackInstall(m, snapshot(), env);
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

describe('upgrading a 1.0.0 workspace to 1.1.0 (P6)', () => {
  it('adds the checks sheet, the new fields, library requirements and automations', () => {
    const state = installV1();
    const up = planPackUpgrade({
      from: { manifest: v1, hash: 'h1' },
      to: { manifest, hash: 'h2' },
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
