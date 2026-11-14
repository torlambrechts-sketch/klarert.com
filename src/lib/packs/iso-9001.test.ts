import { describe, expect, it } from 'vitest';
import '@/engine/fields/registry';
import { formula } from '@/engine/fields/formula';
import { extendsAgainst, extensionUses, neededLevel } from '@/engine/packs/extend';
import { levelSummaries, manifestAtLevel } from '@/engine/packs/levels';
import { refMapOf } from '@/engine/packs/installed.fixture';
import { makeCtx, makeField, makeItem } from '@/engine/testing/fixtures';
import type { Json } from '@/engine/types';
import {
  core,
  libraryItems,
  linkedRequirements,
  packByKey,
  planAddon,
  previewBeforeCore,
  requirementKeysOf,
} from './addon.fixture';
import { REVIEW_PACK_SOURCES } from './management-review';
import { packManifestSchema } from './manifest';
import { packQualityProblems } from './quality';
import { previewLines } from '@/engine/packs/plan';

// The ISO 9001 add-on (docs/11 The ISO 9001 add-on, 2.0.0 on ISO 9001:2026): its own sheets for what only a quality
// system needs, in the Core domains; everything else added to the shared Core registers: columns, the Quality risk
// category, examples linked to the 2026 clauses, approval workflows, forms, advanced automations and the headline
// dashboard reading the Core registers by the ISO 9001 tag.
const pack = packByKey('iso-9001');

describe('ISO 9001 add-on', () => {
  it('is a 2.0.0 add-on to Core on the 2026 library that meets the pack quality bar', () => {
    expect(pack.version).toBe('2.0.0');
    expect(pack.requires).toEqual([{ pack: 'core', range: '^1.0.0' }]);
    expect(pack.standard).toEqual({ id: 'iso9001', label: 'ISO 9001', color: 'blue' });
    expect(pack.frameworks).toEqual([{ key: 'iso-9001', version: '2026' }]);
    expect(extendsAgainst(pack, core)).toEqual([]);
    expect(neededLevel(pack, core)).toBe('starter');
    expect(packQualityProblems(pack)).toEqual([]);
    expect(packManifestSchema.safeParse(JSON.parse(JSON.stringify(pack))).success).toBe(true);
  });

  it('keeps Starter to two sheets and puts every own sheet in a Core domain', () => {
    expect(levelSummaries(pack).map((l) => [l.key, l.adds])).toEqual([
      ['starter', ['Processes', 'Customer feedback and complaints']],
      [
        'full',
        ['External providers', 'Measuring equipment', 'Release records', 'Design and development'],
      ],
    ]);
    expect(manifestAtLevel(pack, 'starter').dashboards.map((d) => d.name)).toEqual([
      'ISO 9001 audit readiness',
    ]);
    expect(pack.folders).toEqual([]);
    expect(Object.fromEntries(pack.sheets.map((s) => [s.ref, s.folder]))).toEqual({
      process: 'core:management',
      complaint: 'core:operations',
      supplier: 'core:suppliers',
      equipment: 'core:operations',
      release: 'core:operations',
      design: 'core:operations',
    });
  });

  it('adds to the shared registers instead of copying them', () => {
    expect((pack.extends ?? []).map((e) => e.sheet)).toEqual([
      'risk_category',
      'risk',
      'objectives',
      'nc',
      'documents',
      'actions',
    ]);
    const uses = extensionUses(pack, 'core');
    expect([...uses.get('nc')!]).toEqual(
      expect.arrayContaining(['source', 'stage', 'due_date', 'effective', 'standards']),
    );
  });

  it('names only requirements the ISO 9001:2026 library has', () => {
    const library = libraryItems('iso-9001', '2026');
    const keys = requirementKeysOf(pack);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) expect(library[k], k).toBeDefined();
  });

  it('plans Starter on Core: system columns, the ISO 9001 tag and view, and the Quality category', () => {
    const { plan, corePayload } = planAddon(pack, 'starter');
    expect(plan.preview.conflicts).toEqual([]);
    const p = plan.payload!;
    const refs = refMapOf(corePayload);
    expect(p.sheets.map((s) => s.name)).toEqual(['Processes', 'Customer feedback and complaints']);
    // own sheets sit in Core's domain folders
    expect(p.sheets.map((s) => s.folder_id)).toEqual([
      refs['folder:management'],
      refs['folder:operations'],
    ]);
    const ncCols = p.fields.filter((f) => f.sheet_id === refs['sheet:nc']);
    expect(ncCols.map((f) => f.key)).toEqual([
      'iso9001_description',
      'iso9001_product',
      'iso9001_disposition',
      'iso9001_correction',
      'iso9001_feedback',
      'iso9001_reporter',
      'iso9001_clauses',
    ]);
    expect(ncCols.every((f) => f.system === true)).toBe(true);
    expect(p.views.filter((v) => v.name === 'ISO 9001 view').map((v) => v.sheet_id)).toHaveLength(
      6,
    );
    const quality = p.items.find((i) => i.ref === 'core:risk_category.iso9001_quality')!;
    expect(quality.name).toBe('Quality');
    expect((quality.values as Record<string, Json>)[refs['field:risk_category.appetite']!]).toBe(8);
  });

  it('links example items to the 2026 clauses they show, on its own sheets and on Core', () => {
    const { plan } = planAddon(pack, 'full');
    expect(plan.preview.warnings.filter((w) => w.includes('library'))).toEqual([]);
    const p = plan.payload!;
    expect(linkedRequirements(p, 'complaint.clauses', 'complaint.ex_late')).toEqual([
      'iso-9001@2026#8.7',
      'iso-9001@2026#9.1.2',
    ]);
    expect(linkedRequirements(p, 'supplier.clauses', 'supplier.ex_boards')).toEqual([
      'iso-9001@2026#8.4',
    ]);
    expect(linkedRequirements(p, 'core:nc.iso9001_clauses', 'core:nc.iso9001_label')).toEqual([
      'iso-9001@2026#10.2',
      'iso-9001@2026#8.7',
    ]);
    expect(
      linkedRequirements(p, 'core:documents.iso9001_clauses', 'core:documents.iso9001_policy'),
    ).toEqual(['iso-9001@2026#5.2']);
  });

  it('declares approval workflows: process approval in Starter, provider, release and design in Full', () => {
    const flows = Object.fromEntries(
      pack.sheets.map((s) => [s.ref, (s.workflows ?? []).map((w) => w.id)]),
    );
    expect(flows).toEqual({
      process: ['process-approval'],
      complaint: [],
      supplier: ['provider-approval'],
      equipment: [],
      release: ['release-authorisation'],
      design: ['design-release'],
    });
    const { plan } = planAddon(pack, 'starter');
    const process = plan.payload!.sheets.find((s) => s.ref === 'process')!;
    const [flow] = (process.settings as { workflows: { steps: { approvers: unknown }[] }[] })
      .workflows;
    expect(flow!.steps.map((s) => s.approvers)).toEqual([
      { kind: 'field', fieldKey: 'owner' },
      { kind: 'jobRole', roleName: 'Quality manager' },
    ]);
  });

  it('ships advanced automations with plain-words descriptions, the notifying ones in test mode', () => {
    const all = [...pack.automations, ...(pack.extends ?? []).flatMap((e) => e.automations ?? [])];
    const advanced = all.filter((a) => a.advanced);
    expect(advanced.length).toBeGreaterThanOrEqual(8);
    for (const a of advanced) expect(a.description?.length, a.ref).toBeGreaterThan(40);
    const { plan, corePayload } = planAddon(pack, 'full');
    const rows = plan.payload!.automations;
    const mode = (ref: string) => rows.find((a) => a.ref === ref)!.mode ?? 'live';
    expect(mode('complaint_answer_late')).toBe('test');
    expect(mode('iso9001_nc_escalate_management')).toBe('test');
    // the gate and the cascades only change data: live
    expect(mode('iso9001_nc_close_gate')).toBe('live');
    expect(mode('complaint_nc')).toBe('live');
    // a complaint raises a nonconformity on Core's register, linked back
    const raise = rows.find((a) => a.ref === 'complaint_nc')!;
    expect((raise.actions as { sheetId: string; link: boolean }[])[0]).toMatchObject({
      sheetId: refMapOf(corePayload)['sheet:nc'],
      link: true,
    });
  });

  it('asks for complaints, feedback and quality problems through internal forms with a privacy notice', () => {
    const forms = [
      ...pack.sheets.flatMap((s) => s.forms),
      ...(pack.extends ?? []).flatMap((e) => e.forms ?? []),
    ];
    expect(forms.map((f) => [f.name, f.access])).toEqual([
      ['Report a complaint', 'internal'],
      ['Share feedback or an idea', 'internal'],
      ['Report a quality problem', 'internal'],
    ]);
    for (const f of forms) expect(f.notice?.purpose, f.ref).toBeTruthy();
  });

  it('reads the Core registers from its headline dashboard by the ISO 9001 tag', () => {
    const [dash] = pack.dashboards;
    expect(dash!.headline).toBe(true);
    const { plan, corePayload } = planAddon(pack, 'starter');
    const refs = refMapOf(corePayload);
    const widgets = (
      plan.payload!.dashboards[0]!.config as { widgets: { id: string; sheetId?: string }[] }
    ).widgets;
    const sheetOf = (id: string) => widgets.find((w) => w.id === id)!.sheetId;
    expect(sheetOf('w_nc_open')).toBe(refs['sheet:nc']);
    expect(sheetOf('w_objectives')).toBe(refs['sheet:objectives']);
    expect(sheetOf('w_clauses')).toBe('lib:iso-9001@2026');
  });

  it('feeds customer feedback to the management review; Core feeds the rest', () => {
    const own = REVIEW_PACK_SOURCES.find((d) => d.pack === 'iso-9001')!;
    const complaint = pack.sheets.find((s) => s.ref === own.sheets.feedback)!;
    expect(complaint.fields.some((f) => f.key === own.dateFields.feedback)).toBe(true);
    expect(complaint.fields.some((f) => f.key === own.detailFields.feedback)).toBe(true);
    const coreDef = REVIEW_PACK_SOURCES.find((d) => d.pack === 'core')!;
    for (const [key, ref] of Object.entries(coreDef.sheets)) {
      const sheet = core.sheets.find((s) => s.ref === ref);
      expect(sheet, key).toBeDefined();
      const date = coreDef.dateFields[key as keyof typeof coreDef.dateFields];
      if (date) expect(sheet!.fields.some((f) => f.key === date)).toBe(true);
    }
  });

  it('works out when a complaint must be answered: 10 days after it was received', () => {
    const sheet = pack.sheets.find((s) => s.ref === 'complaint')!;
    const fields = sheet.fields
      .filter((f) => ['received_on', 'answer_due'].includes(f.key))
      .map((f) => makeField(f.type, f.config ?? {}, { key: f.key }));
    const ctx = makeCtx({ fields });
    const due = fields.find((f) => f.key === 'answer_due')!;
    const of = (received?: string) =>
      formula.compute!(makeItem(received ? { 'f-received_on': received } : {}), due as never, ctx);
    expect(of('2026-11-02')).toBe('2026-11-12');
    expect(of()).toBeNull();
  });

  it('previews before Core is there: Core is installed first, nothing blocks', () => {
    const plan = previewBeforeCore(pack);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    expect(plan.payload).toBeNull();
    expect(previewLines(plan.preview)).toContain('Installs Core registers 1.0.0 (Starter) first.');
  });
});
