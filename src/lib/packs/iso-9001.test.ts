import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  levelSummaries,
  manifestAtLevel,
  planPackInstall,
  previewLines,
  type PackSnapshot,
} from '@/engine/packs';
import '@/engine/fields/registry';
import { formula } from '@/engine/fields/formula';
import { makeCtx, makeField, makeItem } from '@/engine/testing/fixtures';
import type { Json } from '@/engine/types';
import { repoPacks } from './catalogue';
import { REVIEW_PACK_SOURCES } from './management-review';
import { packManifestSchema } from './manifest';

// The ISO 9001 pack (docs/11, version 1.1.0 on the 2026 edition): Starter and Full on the 9001 requirement library, example items linked to its
// clauses, the complaint and nonconformity forms, the automations that raise nonconformities and the management review
// inputs mapped by ref.
const pack = repoPacks().find((p) => p.key === 'iso-9001')!;
const LIB = '00000000-0000-4000-8000-00000000f901';

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
  libraries: [{ library: 'iso-9001@2026', sheetId: LIB }],
  ...over,
});
let n = 0;
const env = {
  today: '2026-11-13',
  now: new Date('2026-11-13T10:00:00Z'),
  timeZone: 'Europe/London',
  newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  hash: 'h',
  userId: 'u-1',
};

const STARTER = [
  'Context and interested parties',
  'Quality policy and objectives',
  'Processes',
  'Risks and opportunities',
  'Quality documents',
  'Nonconformities and corrective action',
  'Customer feedback and complaints',
];
const FULL_ADDS = [
  'External providers',
  'Competence and training',
  'Measuring equipment',
  'Internal audit programme',
  'Audit findings',
  'Management review',
  'Design and development',
  'Release records',
];

describe('ISO 9001 pack', () => {
  it('ships Starter and Full and builds on the 9001 library', () => {
    expect(pack.version).toBe('1.1.0');
    expect(pack.levels!.map((l) => l.key)).toEqual(['starter', 'full']);
    expect(pack.frameworks).toEqual([{ key: 'iso-9001', version: '2026' }]);
    const [starter, full] = levelSummaries(pack);
    expect(starter!.sheets).toEqual(STARTER);
    expect(full!.adds).toEqual(FULL_ADDS);
    expect(pack.setup!.steps).toHaveLength(8);
    expect(pack.dashboards.map((d) => d.name)).toEqual(['QMS overview']);
  });

  it('never ships the text of the standard: example items are marked as examples', () => {
    for (const s of pack.sheets)
      for (const i of s.items)
        if (s.register !== 'documents') expect(i.name, `${s.ref}.${i.ref}`).toMatch(/^Example: /);
  });

  it('names only requirements the ISO 9001:2026 library has', () => {
    const fw = JSON.parse(
      readFileSync(join(process.cwd(), 'templates/frameworks/iso-9001-2026.json'), 'utf8'),
    ) as { requirements: { ref: string }[] };
    const refs = new Set(fw.requirements.map((r) => `iso-9001@2026#${r.ref}`));
    let count = 0;
    for (const s of pack.sheets)
      for (const i of s.items)
        for (const k of Object.values(i.requirements ?? {}).flat()) {
          expect(refs.has(k), `${s.ref}.${i.ref} → ${k}`).toBe(true);
          count += 1;
        }
    expect(count).toBeGreaterThan(20);
  });

  it('plans Starter into an empty workspace, the dashboard reading the library', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    expect(plan.preview.sheets.map((s) => s.name)).toEqual(STARTER);
    const refs = plan.payload!.automations.map((a) => a.ref);
    expect(refs).toEqual(
      expect.arrayContaining([
        'objective_review_due',
        'document_review_due',
        'complaint_nc',
        'nc_overdue',
        'nc_action_overdue',
      ]),
    );
    for (const r of ['calibration_due', 'supplier_reevaluation_due', 'finding_nc'])
      expect(refs).not.toContain(r);
    const widgets = (
      plan.payload!.dashboards[0]!.config as { widgets: { id: string; sheetId?: string }[] }
    ).widgets;
    expect(widgets.find((w) => w.id === 'w_clauses')!.sheetId).toBe(LIB);
    expect(plan.preview.frameworks).toEqual([{ library: 'iso-9001@2026', adopted: true }]);
    expect(previewLines(plan.preview)[0]).toMatch(/^Installs 1 folder, 7 sheets/);
    expect(plan.preview.forms).toEqual([
      {
        sheet: 'Nonconformities and corrective action',
        name: 'Report a nonconformity',
        access: 'internal',
      },
      { sheet: 'Customer feedback and complaints', name: 'Report a complaint', access: 'internal' },
    ]);
  });

  it('says the framework is adopted first when the workspace has not adopted it', () => {
    const plan = planPackInstall(pack, snapshot({ libraries: [] }), env, { level: 'full' });
    expect(plan.state).toBe('ready');
    expect(plan.preview.frameworks).toEqual([{ library: 'iso-9001@2026', adopted: false }]);
  });

  it('plans Full whole, with the reminders and the automations that raise nonconformities', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'full' });
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.preview.sheets).toHaveLength(15);
    expect(plan.payload!.automations.map((a) => a.ref)).toEqual(
      expect.arrayContaining(['calibration_due', 'supplier_reevaluation_due', 'finding_nc']),
    );
    expect(plan.payload!.automations.every((a) => a.enabled)).toBe(true);
  });

  it('raises a linked nonconformity from a complaint that needs corrective action', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    const p = plan.payload!;
    const sheet = (ref: string) => p.sheets.find((s) => s.ref === ref)!.id;
    const a = p.automations.find((x) => x.ref === 'complaint_nc')!;
    expect(a.sheet_id).toBe(sheet('complaint'));
    expect(a.trigger).toEqual({ type: 'field_becomes', fieldKey: 'nc_needed', value: 'true' });
    const action = (a.actions as { type: string; sheetId: string; link: boolean }[])[0]!;
    expect(action).toMatchObject({ type: 'create_item', sheetId: sheet('nc'), link: true });
    // the corrective actions (sub-items) have their own overdue reminder
    const actions = p.sheets.find((s) => s.ref === 'nc.subitems')!;
    const overdue = p.automations.find((x) => x.ref === 'nc_action_overdue')!;
    expect(overdue.sheet_id).toBe(actions.id);
    expect(plan.preview.automations.find((x) => x.name === overdue.name)!.sheet).toBe(
      'Nonconformities and corrective action › Actions',
    );
  });

  it('links example items to the clauses they show (complaint → 9.1.2 and 8.7, supplier → 8.4)', () => {
    const keys = [
      ...new Set(
        pack.sheets.flatMap((s) =>
          s.items.flatMap((i) => Object.values(i.requirements ?? {}).flat()),
        ),
      ),
    ];
    const requirementItems = Object.fromEntries(keys.map((k, i) => [k, `lib-item-${i}`]));
    const plan = planPackInstall(pack, snapshot({ requirementItems }), env, { level: 'full' });
    expect(plan.state).toBe('ready');
    expect(plan.preview.warnings).toEqual([]);
    const field = (ref: string) => plan.payload!.fields.find((f) => f.ref === ref)!.id;
    const item = (ref: string) => plan.payload!.items.find((i) => i.ref === ref)!.id;
    const linked = (fieldRef: string, itemRef: string) =>
      plan
        .payload!.links.filter(
          (l) => l.field_id === field(fieldRef) && l.from_item === item(itemRef),
        )
        .map((l) => keys[Number(l.to_item.replace('lib-item-', ''))]);
    expect(linked('complaint.clause', 'complaint.ex_late')).toEqual([
      'iso-9001@2026#9.1.2',
      'iso-9001@2026#8.7',
    ]);
    expect(linked('supplier.clause', 'supplier.ex_boards')).toEqual(['iso-9001@2026#8.4']);
    expect(linked('nc.clause', 'nc.ex_wrong_label')).toEqual([
      'iso-9001@2026#10.2',
      'iso-9001@2026#8.7',
    ]);
    expect(linked('equipment.clause', 'equipment.ex_caliper')).toEqual(['iso-9001@2026#7.1.5']);
    // and to each other: the complaint to its nonconformity, the process to its risk
    const own = (fieldRef: string, itemRef: string) =>
      plan
        .payload!.links.filter(
          (l) => l.field_id === field(fieldRef) && l.from_item === item(itemRef),
        )
        .map((l) => l.to_item);
    expect(own('complaint.nonconformity', 'complaint.ex_labels')).toEqual([
      item('nc.ex_wrong_label'),
    ]);
    expect(own('process.risks', 'process.ex_order')).toEqual([item('risk.ex_capacity')]);
  });

  it('asks for complaints and nonconformities through internal forms, linked from the setup checklist', () => {
    const complaint = pack.sheets.find((s) => s.ref === 'complaint')!;
    const form = complaint.forms.find((f) => f.ref === 'report')!;
    expect(form.name).toBe('Report a complaint');
    expect(form.access).toBe('internal');
    expect(form.notice).toBeDefined();
    const nc = pack.sheets.find((s) => s.ref === 'nc')!;
    expect(nc.forms.map((f) => [f.name, f.access])).toEqual([
      ['Report a nonconformity', 'internal'],
    ]);
    const plan = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    const view = plan.payload!.views.find((v) => v.ref === 'complaint.form.report')!;
    expect((view.config as { form: { status: string } }).form.status).toBe('draft');
    const step = pack.setup!.steps.find((s) => s.ref === 'complaints')!;
    expect(step.target).toEqual({ sheetRef: 'complaint', view: 'Report a complaint' });
  });

  it('adds only what is missing when Full is installed on top of Starter', () => {
    const starter = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    const p = starter.payload!;
    const refMap: Record<string, string> = {};
    for (const [kind, rows] of [
      ['folder', p.folders],
      ['sheet', p.sheets],
      ['field', p.fields],
      ['group', p.groups],
      ['view', p.views],
      ['item', p.items],
      ['automation', p.automations],
      ['dashboard', p.dashboards],
    ] as const)
      for (const r of rows) refMap[`${kind}:${String(r.ref)}`] = String(r.id);
    const live = {
      id: 'inst-1',
      packKey: 'iso-9001',
      version: pack.version,
      status: 'installed' as const,
      level: 'starter',
      refMap,
    };
    const full = planPackInstall(
      pack,
      snapshot({ installs: [live], prefixes: p.sheets.map((s) => String(s.id_prefix)) }),
      env,
      { level: 'full' },
    );
    expect(full.state).toBe('ready');
    const q = full.payload!;
    expect(q.extend_install).toBe('inst-1');
    expect(q.folders).toEqual([]);
    expect(q.dashboards).toEqual([]);
    expect(full.preview.sheets.map((s) => s.name)).toEqual(FULL_ADDS);
    for (const rows of [q.sheets, q.fields, q.groups, q.views, q.items, q.automations])
      for (const r of rows) expect(Object.values(refMap)).not.toContain(r.id);
    const raise = q.automations.find((a) => a.ref === 'finding_nc')!;
    expect((raise.actions as { sheetId: string }[])[0]!.sheetId).toBe(refMap['sheet:nc']);
    expect(full.preview.renamedPrefixes).toEqual([]);
  });

  it('installs next to the ISO 27001 pack without a prefix clash', () => {
    const iso27001 = repoPacks().find((p) => p.key === 'iso-27001')!;
    const taken = iso27001.sheets.map((s) => s.idPrefix);
    const plan = planPackInstall(pack, snapshot({ prefixes: taken }), env, { level: 'full' });
    expect(plan.preview.renamedPrefixes).toEqual([]);
  });

  it('maps its sheets, fields and groups for the management review inputs', () => {
    const def = REVIEW_PACK_SOURCES.find((d) => d.pack === 'iso-9001')!;
    const full = manifestAtLevel(pack, 'full');
    const sheet = (ref: string) => full.sheets.find((s) => s.ref === ref);
    for (const ref of Object.values(def.sheets)) expect(sheet(ref), ref).toBeDefined();
    for (const [src, key] of Object.entries({ ...def.dateFields, ...def.detailFields })) {
      const s = sheet(def.sheets[src as keyof typeof def.sheets]!)!;
      expect(
        s.fields.some((f) => f.key === key),
        `${src}.${key}`,
      ).toBe(true);
    }
    for (const g of [...def.partyGroups, ...def.issueGroups, def.review.groupRef]) {
      const [s, ref] = g.split('.');
      expect(
        sheet(s!)!.groups.some((x) => x.ref === ref),
        g,
      ).toBe(true);
    }
    const review = sheet(def.sheets.reviews!)!;
    for (const key of Object.values(def.review.checks).flat())
      expect(review.fields.find((f) => f.key === key)?.type, key).toBe('check');
  });

  it('says whether an objective meets its target, either way round', () => {
    const sheet = pack.sheets.find((s) => s.ref === 'objective')!;
    const fields = sheet.fields
      .filter((f) => ['target', 'actual', 'lower_better', 'result'].includes(f.key))
      .map((f) => makeField(f.type, f.config ?? {}, { key: f.key }));
    const ctx = makeCtx({ fields });
    const result = fields.find((f) => f.key === 'result')!;
    const of = (values: Record<string, Json>) =>
      formula.compute!(
        makeItem(Object.fromEntries(Object.entries(values).map(([k, v]) => [`f-${k}`, v]))),
        result as never,
        ctx,
      );
    expect(of({ target: 95, actual: 96 })).toBe('Met');
    expect(of({ target: 95, actual: 91, lower_better: false })).toBe('Not met');
    expect(of({ target: 2, actual: 1, lower_better: true })).toBe('Met');
    expect(of({ target: 2, actual: 3, lower_better: true })).toBe('Not met');
    expect(of({ target: 2 })).toBeNull();
  });

  it('refuses an unknown level and stays valid when parsed again', () => {
    expect(planPackInstall(pack, snapshot(), env, { level: 'gold' }).preview.conflicts).toContain(
      '"gold" is not a level of this pack.',
    );
    expect(packManifestSchema.safeParse(JSON.parse(JSON.stringify(pack))).success).toBe(true);
  });
});
