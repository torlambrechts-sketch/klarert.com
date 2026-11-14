import { describe, expect, it } from 'vitest';
import { planPackInstall, previewLines, type PackSnapshot } from '@/engine/packs';
import { extendsAgainst, extensionUses, neededLevel } from '@/engine/packs/extend';
import { afterInstall, refMapOf } from '@/engine/packs/installed.fixture';
import { startsInTestMode } from '@/engine/packs/safety';
import { appProblems } from '@/lib/apps/manifest';
import { repoPacks } from './catalogue';
import { REVIEW_PACK_SOURCES } from './management-review';
import { packQualityProblems } from './quality';

// The ISO/IEC 27001:2022 add-on (docs/11 The ISO/IEC 27001 add-on, Phase 2): it requires the Core registers, adds its
// own scope and treatment plan sheets in Core's domains and everything else to the shared registers, builds on the
// 27001 library and meets the pack quality bar.
const packs = repoPacks();
const pack = packs.find((p) => p.key === 'iso-27001')!;
const core = packs.find((p) => p.key === 'core')!;
const LIB = '00000000-0000-4000-8000-00000000f001';

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

/** Core (Full, as the add-on needs) installed, the 27001 library adopted with a few requirements. */
function withCore() {
  const corePlan = planPackInstall(core, snapshot(), env, { level: 'full' });
  const coreRefs = refMapOf(corePlan.payload!);
  const reqs = ['A.5.17', 'A.6.3', 'A.8.5', 'A.8.7', '4.1', '4.3', '5.2', '9.9.9'];
  const snap = afterInstall(
    snapshot({
      libraries: [{ library: 'iso-27001@2022', sheetId: LIB }],
      requirementItems: Object.fromEntries(reqs.map((r, i) => [`iso-27001@2022#${r}`, `req-${i}`])),
    }),
    corePlan.payload!,
    'inst-core',
  );
  return { snap, coreRefs };
}

describe('ISO 27001 add-on', () => {
  it('is a new major version that requires Core, stands for ISO 27001 and builds on the library', () => {
    expect(pack.version).toBe('2.0.0');
    expect(pack.requires).toEqual([{ pack: 'core', range: '^1.0.0' }]);
    expect(pack.standard).toMatchObject({ id: 'iso27001', label: 'ISO 27001' });
    expect(pack.frameworks).toEqual([{ key: 'iso-27001', version: '2022' }]);
    expect(pack.levels).toBeUndefined();
  });

  it('meets the pack quality bar', () => {
    expect(packQualityProblems(pack)).toEqual([]);
  });

  it('adds its own sheets only where Core has none, in Core domains', () => {
    expect(pack.sheets.map((s) => [s.name, s.folder, s.kind])).toEqual([
      ['ISMS scope and context', 'core:management', 'register'],
      ['Risk treatment plan', 'core:risk', 'actions'],
    ]);
    expect(pack.folders).toEqual([]);
  });

  it('extends only Core sheets and keys that exist, and needs Core Full', () => {
    expect(extendsAgainst(pack, core)).toEqual([]);
    expect(neededLevel(pack, core)).toBe('full');
    expect(pack.extends!.map((e) => e.sheet)).toEqual([
      'risk_category',
      'risk',
      'controls',
      'assets',
      'documents',
      'objectives',
      'legal',
      'training',
      'audits',
      'reviews',
      'incidents',
      'nc',
      'actions',
    ]);
    // the dashboard and the app read Core columns too: an update of Core may not take them away
    const uses = extensionUses(pack, 'core');
    expect([...uses.get('nc')!]).toEqual(
      expect.arrayContaining(['stage', 'due_date', 'standards']),
    );
    expect([...uses.get('training')!]).toContain('expires_on');
  });

  it('never ships the text of the standard', () => {
    for (const s of pack.sheets) for (const i of s.items) expect(i.name).toMatch(/^Example: /);
    for (const e of pack.extends!)
      if (e.sheet !== 'documents' && e.sheet !== 'risk_category')
        for (const i of e.items ?? []) expect(i.name, `${e.sheet}.${i.ref}`).toMatch(/^Example: /);
  });

  it('plans onto Core: its sheets in Core folders, columns on the shared registers, examples linked to Annex A', () => {
    const { snap, coreRefs } = withCore();
    const plan = planPackInstall(pack, snap, env);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    const p = plan.payload!;
    expect(p.sheets.filter((s) => !s.parent_sheet_id).map((s) => [s.ref, s.folder_id])).toEqual([
      ['scope', coreRefs['folder:management']],
      ['treatment', coreRefs['folder:risk']],
    ]);
    // the risk register gets the 27001 columns as system columns after Core's
    const riskCols = p.fields.filter((f) => f.sheet_id === coreRefs['sheet:risk']);
    expect(riskCols.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'iso27001_controls',
        'iso27001_residual_score',
        'iso27001_treatment',
      ]),
    );
    expect(riskCols.every((f) => f.system === true)).toBe(true);
    // the example phishing risk links to Annex A controls of the adopted library
    const phishing = p.items.find((i) => i.ref === 'core:risk.iso27001_phishing')!;
    const controls = riskCols.find((f) => f.key === 'iso27001_controls')!;
    expect(
      p.links
        .filter((l) => l.from_item === phishing.id && l.field_id === controls.id)
        .map((l) => l.to_item),
    ).toEqual(['req-1', 'req-3', 'req-2']);
    // and to its treatment plan, both ways
    const mfa = p.items.find((i) => i.ref === 'treatment.ex_mfa')!;
    expect(p.links.some((l) => l.from_item === phishing.id && l.to_item === mfa.id)).toBe(true);
    expect(p.links.some((l) => l.from_item === mfa.id && l.to_item === phishing.id)).toBe(true);
    // the Information security risk category and the ISO 27001 tag
    expect(p.items.find((i) => i.ref === 'core:risk_category.iso27001_infosec')?.name).toBe(
      'Information security',
    );
    expect(p.options!.map((o) => o.ref)).toEqual(
      expect.arrayContaining([
        'core:risk.standards.iso27001',
        'core:documents.doc_type.iso27001_soa',
      ]),
    );
    expect(previewLines(plan.preview).join('\n')).toMatch(/Adds to Risk register: 10 columns/);
  });

  it('ships the forms internal, notifying automations in test mode and the approval workflows', () => {
    const forms = pack.extends!.flatMap((e) =>
      (e.forms ?? []).map((f) => [e.sheet, f.name, f.access]),
    );
    expect(forms).toEqual([
      ['incidents', 'Report a security incident', 'internal'],
      ['nc', 'Report a problem', 'internal'],
    ]);
    const all = [...pack.automations, ...pack.extends!.flatMap((e) => e.automations ?? [])];
    const advanced = all.filter((a) => a.advanced);
    expect(advanced.length).toBeGreaterThanOrEqual(4);
    for (const a of advanced) expect(a.description!.length).toBeLessThanOrEqual(400);
    const notifying = all.filter((a) => a.actions.some((x) => x.type === 'notify'));
    for (const a of notifying) expect(startsInTestMode(a), a.ref).toBe(true);
    expect(pack.sheets.flatMap((s) => (s.workflows ?? []).map((w) => [s.ref, w.id]))).toEqual([
      ['scope', 'scope-approval'],
      ['treatment', 'risk-acceptance'],
    ]);
    const acceptance = pack.sheets.find((s) => s.ref === 'treatment')!.workflows![0]!;
    expect(acceptance.steps.map((s) => s.approvers)).toEqual([
      { kind: 'field', fieldKey: 'risk_owner' },
      { kind: 'jobRole', roleName: 'Top management' },
    ]);
  });

  it('has one headline dashboard over Core and its own sheets, the ISMS CAPA app over Core', () => {
    expect(pack.dashboards.map((d) => [d.ref, d.headline])).toEqual([['isms_overview', true]]);
    const { snap, coreRefs } = withCore();
    const p = planPackInstall(pack, snap, env).payload!;
    const widgets = (p.dashboards[0]!.config as { widgets: { id: string; sheetId?: string }[] })
      .widgets;
    expect(widgets.find((w) => w.id === 'w_nc_open')!.sheetId).toBe(coreRefs['sheet:nc']);
    expect(widgets.find((w) => w.id === 'w_soa')!.sheetId).toBe(LIB);
    const app = pack.apps!.find((a) => a.key === 'isms-capa')!;
    expect(appProblems(app, pack, [core])).toEqual([]);
    expect(app.sections[0]!.screens.map((s) => [s.title, 'sheet' in s ? s.sheet : null])).toEqual([
      ['Report a problem', 'core:nc'],
      ['My actions', 'core:actions'],
      ['Needs my check', 'core:nc'],
    ]);
  });

  it('feeds the management review inputs from Core and its own sheets', () => {
    const def = REVIEW_PACK_SOURCES.find((d) => d.pack === 'iso-27001')!;
    expect(def.sheets).toMatchObject({
      reviews: 'core:reviews',
      context: 'scope',
      nonconformities: 'core:nc',
      risks: 'core:risk',
      treatments: 'treatment',
    });
    const reviews = pack.extends!.find((e) => e.sheet === 'reviews')!;
    const checks = Object.values(def.review.checks).flat();
    for (const k of checks)
      expect(
        reviews.fields!.some((f) => f.key === k),
        k,
      ).toBe(true);
  });
});
