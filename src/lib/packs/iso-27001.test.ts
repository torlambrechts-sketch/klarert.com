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
import { repoPacks } from './catalogue';
import { packManifestSchema } from './manifest';

// The ISO/IEC 27001:2022 pack (P4, docs/11): levels, the framework it builds on, the dashboard on the library and
// installing Full on top of Starter.
const pack = repoPacks().find((p) => p.key === 'iso-27001')!;
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
  libraries: [{ library: 'iso-27001@2022', sheetId: LIB }],
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

describe('ISO 27001 pack', () => {
  it('ships Starter and Full and builds on the 27001 library', () => {
    expect(pack.version).toBe('1.3.0');
    expect(pack.levels!.map((l) => l.key)).toEqual(['starter', 'full']);
    expect(pack.frameworks).toEqual([{ key: 'iso-27001', version: '2022' }]);
    const [starter, full] = levelSummaries(pack);
    expect(starter!.sheets).toEqual([
      'Scope and context',
      'Risk register',
      'Risk treatment plan',
      'ISMS documents',
      'Nonconformities and CAPA',
    ]);
    expect(full!.adds).toEqual([
      'Asset register',
      'Internal audit programme',
      'Audit findings',
      'Management review',
      'Security incidents',
      'Training and awareness',
    ]);
    expect(pack.setup!.steps).toHaveLength(8);
  });

  it('never ships the text of the standard: example items are marked as examples', () => {
    for (const s of pack.sheets)
      for (const i of s.items)
        if (s.register !== 'documents') expect(i.name, `${s.ref}.${i.ref}`).toMatch(/^Example: /);
  });

  it('plans Starter into an empty workspace, the dashboard reading the library', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    expect(plan.payload!.pack.level).toBe('starter');
    expect(plan.preview.sheets.map((s) => s.ref)).toEqual([
      'scope',
      'risk',
      'treatment',
      'documents',
      'nc',
    ]);
    // automations of Full sheets stay out
    expect(plan.payload!.automations.map((a) => a.ref)).not.toContain('finding_nc');
    const widgets = (
      plan.payload!.dashboards[0]!.config as { widgets: { id: string; sheetId?: string }[] }
    ).widgets;
    expect(widgets.find((w) => w.id === 'w_soa')!.sheetId).toBe(LIB);
    expect(plan.preview.frameworks).toEqual([{ library: 'iso-27001@2022', adopted: true }]);
    expect(previewLines(plan.preview)[0]).toMatch(/^Installs 1 folder, 5 sheets/);
  });

  it('says the framework is adopted first when the workspace has not adopted it', () => {
    const plan = planPackInstall(pack, snapshot({ libraries: [] }), env, { level: 'full' });
    expect(plan.state).toBe('ready');
    expect(plan.preview.frameworks).toEqual([{ library: 'iso-27001@2022', adopted: false }]);
  });

  it('plans Full whole, with the automations that raise nonconformities', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'full' });
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.preview.sheets).toHaveLength(11);
    expect(plan.payload!.automations.map((a) => a.ref)).toEqual(
      expect.arrayContaining(['finding_nc', 'incident_nc']),
    );
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
      packKey: 'iso-27001',
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
    expect(full.preview.extendsLevel).toEqual({ key: 'starter', name: 'Starter' });
    const q = full.payload!;
    expect(q.extend_install).toBe('inst-1');
    expect(q.folders).toEqual([]);
    expect(q.dashboards).toEqual([]);
    expect(q.sheets.map((s) => s.ref)).toEqual([
      'asset',
      'audit',
      'finding',
      'review',
      'incident',
      'training',
    ]);
    // no row the install already has, and new rows point at the existing sheets and folder
    for (const rows of [q.sheets, q.fields, q.groups, q.views, q.items, q.automations])
      for (const r of rows) expect(Object.values(refMap)).not.toContain(r.id);
    expect(q.sheets.every((s) => s.folder_id === refMap['folder:isms'])).toBe(true);
    const assetRisks = q.fields.find((f) => f.ref === 'asset.risks')!;
    expect((assetRisks.config as { targetSheetId: string }).targetSheetId).toBe(
      refMap['sheet:risk'],
    );
    const raise = q.automations.find((a) => a.ref === 'finding_nc')!;
    expect((raise.actions as { sheetId: string }[])[0]!.sheetId).toBe(refMap['sheet:nc']);
    // prefixes of the install's own sheets are not "taken"
    expect(full.preview.renamedPrefixes).toEqual([]);
    expect(full.preview.sheets).toHaveLength(6);

    // the same level again: nothing to do
    const again = planPackInstall(pack, snapshot({ installs: [{ ...live, level: 'full' }] }), env, {
      level: 'full',
    });
    expect(again.state).toBe('installed');
    const lower = planPackInstall(pack, snapshot({ installs: [{ ...live, level: 'full' }] }), env, {
      level: 'starter',
    });
    expect(lower.state).toBe('installed');
  });

  it('tells the action owner when a corrective action (a sub-item) is overdue', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    const actions = plan.payload!.sheets.find((s) => s.ref === 'nc.subitems')!;
    const a = plan.payload!.automations.find((x) => x.ref === 'capa_action_overdue')!;
    expect(a.sheet_id).toBe(actions.id);
    expect(a.enabled).toBe(true);
    expect(a.trigger).toEqual({ type: 'date_arrives', fieldKey: 'due_date', offsetDays: 1 });
    expect(plan.preview.automations.find((x) => x.name === a.name)!.sheet).toBe(
      'Nonconformities and CAPA › Actions',
    );
    // the nonconformity's own due date keeps its reminder
    expect(plan.payload!.automations.map((x) => x.ref)).toContain('capa_overdue');
  });

  it('links the example risks and treatments to Annex A controls of the adopted library', () => {
    const keys = [
      ...new Set(
        pack.sheets.flatMap((s) =>
          s.items.flatMap((i) => Object.values(i.requirements ?? {}).flat()),
        ),
      ),
    ];
    // every key names a requirement of the library the pack builds on
    const requirementItems = Object.fromEntries(keys.map((k, i) => [k, `lib-item-${i}`]));
    const plan = planPackInstall(pack, snapshot({ requirementItems }), env, { level: 'starter' });
    expect(plan.state).toBe('ready');
    const field = (ref: string) => plan.payload!.fields.find((f) => f.ref === ref)!.id;
    const item = (ref: string) => plan.payload!.items.find((i) => i.ref === ref)!.id;
    const linked = (fieldRef: string, itemRef: string) =>
      plan
        .payload!.links.filter(
          (l) => l.field_id === field(fieldRef) && l.from_item === item(itemRef),
        )
        .map((l) => keys[Number(l.to_item.replace('lib-item-', ''))]);
    expect(linked('risk.controls', 'risk.ex_phishing')).toEqual([
      'iso-27001@2022#A.6.3',
      'iso-27001@2022#A.8.7',
    ]);
    expect(linked('risk.controls', 'risk.ex_laptop')).toEqual([
      'iso-27001@2022#A.8.1',
      'iso-27001@2022#A.7.9',
    ]);
    expect(linked('risk.controls', 'risk.ex_supplier')).toEqual([
      'iso-27001@2022#A.5.19',
      'iso-27001@2022#A.5.30',
    ]);
    expect(linked('treatment.control', 'treatment.ex_mfa')).toEqual(['iso-27001@2022#A.8.5']);
    expect(plan.preview.warnings).toEqual([]);
  });

  it('names only requirements the ISO/IEC 27001:2022 library has', () => {
    const fw = JSON.parse(
      readFileSync(join(process.cwd(), 'templates/frameworks/iso-27001-2022.json'), 'utf8'),
    ) as { requirements: { ref: string }[] };
    const refs = new Set(fw.requirements.map((r) => `iso-27001@2022#${r.ref}`));
    for (const s of pack.sheets)
      for (const i of s.items)
        for (const k of Object.values(i.requirements ?? {}).flat())
          expect(refs.has(k), `${s.ref}.${i.ref} → ${k}`).toBe(true);
  });

  it('asks for incidents through an internal form at Full, linked from the setup checklist', () => {
    const incidents = pack.sheets.find((s) => s.ref === 'incident')!;
    const form = incidents.forms.find((f) => f.ref === 'report')!;
    expect(form.name).toBe('Report a security incident');
    expect(form.access).toBe('internal');
    expect(form.layout.fields.map((f) => f.key)).toEqual([
      'description',
      'detected',
      'affected',
      'severity',
      'reporter_name',
      'reporter_email',
    ]);
    const full = planPackInstall(pack, snapshot(), env, { level: 'full' });
    expect(full.preview.forms).toEqual([
      { sheet: 'Nonconformities and CAPA', name: 'Report a problem', access: 'internal' },
      { sheet: 'Security incidents', name: 'Report a security incident', access: 'internal' },
    ]);
    const view = full.payload!.views.find((v) => v.ref === 'incident.form.report')!;
    expect((view.config as { form: { status: string } }).form.status).toBe('draft');
    expect(planPackInstall(pack, snapshot(), env, { level: 'starter' }).preview.forms).toEqual([
      { sheet: 'Nonconformities and CAPA', name: 'Report a problem', access: 'internal' },
    ]);
    const step = pack.setup!.steps.find((s) => s.ref === 'incidents')!;
    expect(step.target).toEqual({ sheetRef: 'incident', view: 'Report a security incident' });
    expect(step.levels!.starter!.target).toEqual({ sheetRef: 'nc' });
  });

  it('refuses an unknown level', () => {
    expect(planPackInstall(pack, snapshot(), env, { level: 'gold' }).preview.conflicts).toContain(
      '"gold" is not a level of this pack.',
    );
  });
});

describe('manifest levels', () => {
  const base = JSON.parse(JSON.stringify(pack)) as Record<string, unknown> & {
    sheets: { ref: string; level?: string; fields: { key: string; config?: object }[] }[];
  };
  const problems = (m: unknown) => {
    const r = packManifestSchema.safeParse(m);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('accepts the pack and filters it by level', () => {
    expect(problems(base)).toEqual([]);
    expect(manifestAtLevel(pack, 'starter').sheets).toHaveLength(5);
    expect(manifestAtLevel(pack, 'full').sheets).toHaveLength(11);
  });

  it('refuses a Starter sheet that links to a Full sheet', () => {
    const m = structuredClone(base);
    m.sheets
      .find((s) => s.ref === 'risk')!
      .fields.push({
        key: 'assets',
        config: { targetSheetRef: 'asset', multiple: true },
        ...{ name: 'Assets', type: 'link' },
      } as never);
    expect(problems(m).join(' ')).toMatch(/installed only from Full/);
  });

  it('refuses unknown levels and levels on a pack without levels', () => {
    const m = structuredClone(base);
    m.sheets[0]!.level = 'gold';
    expect(problems(m)).toContain('Unknown level "gold".');
    const plain = structuredClone(base);
    delete plain.levels;
    delete plain.setup;
    expect(problems(plain).join(' ')).toMatch(/the pack has no levels/);
  });

  it('refuses a setup step that names a sheet its level does not install', () => {
    const m = structuredClone(base) as typeof base & {
      setup: { steps: { levels?: Record<string, unknown> }[] };
    };
    delete m.setup.steps[1]!.levels;
    expect(problems(m).join(' ')).toMatch(/"assets" uses "asset" at Starter/);
  });
});

describe('document approval (1.3.0)', () => {
  const documents = pack.sheets.find((s) => s.ref === 'documents')!;

  it('ships an approval workflow on ISMS documents: owner review, then top management, locked when approved', () => {
    const [w] = documents.workflows ?? [];
    expect(w).toMatchObject({
      id: 'document-approval',
      name: 'Document approval',
      lockOnApproval: true,
      allowSelfApproval: false,
      requiredFields: ['document_id', 'owner'],
      statusField: { fieldKey: 'status', onSubmit: 'opt_review', onApproved: 'opt_approved' },
    });
    expect(w!.steps.map((s) => [s.name, s.approvers])).toEqual([
      ['Owner review', { kind: 'field', fieldKey: 'owner' }],
      ['Management approval', { kind: 'jobRole', roleName: 'Top management' }],
    ]);
    expect(w!.steps[1]!.onReject).toEqual({ to: 'step', stepId: 'owner-review' });
    expect(documents.fields.find((f) => f.key === 'approval_step')?.type).toBe('workflowstep');
  });

  it('installs the workflow into the sheet settings', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    const sheet = plan.payload!.sheets.find((s) => s.ref === 'documents')!;
    expect((sheet.settings as { workflows: { id: string }[] }).workflows.map((w) => w.id)).toEqual([
      'document-approval',
    ]);
  });

  it('refuses a workflow that names a field the sheet does not have, or a person', () => {
    const m = JSON.parse(JSON.stringify(pack)) as {
      sheets: { ref: string; workflows: { steps: { approvers: object }[] }[] }[];
    };
    const flows = m.sheets.find((s) => s.ref === 'documents')!.workflows;
    flows[0]!.steps[0]!.approvers = { kind: 'field', fieldKey: 'nobody' };
    const r = packManifestSchema.safeParse(m);
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues.map((i) => i.message).join(' ')).toMatch(
      /choose a people field for the approvers/,
    );
    flows[0]!.steps[0]!.approvers = { kind: 'people', userIds: ['u-1'] };
    expect(packManifestSchema.safeParse(m).success).toBe(false);
  });
});
