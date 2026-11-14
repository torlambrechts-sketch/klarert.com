import { describe, expect, it } from 'vitest';
import '@/engine/fields/registry';
import { formula } from '@/engine/fields/formula';
import { extendsAgainst, neededLevel } from '@/engine/packs/extend';
import { levelSummaries } from '@/engine/packs/levels';
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
import { packQualityProblems } from './quality';
import { previewLines } from '@/engine/packs/plan';

// The ISO 45001 add-on (docs/11 The ISO 45001 add-on, 1.0.0 on ISO 45001:2018, a new edition expected in 2027):
// hazards (HIRA) with the hierarchy of controls and worker consultation of its own; injuries, near misses and ill
// health in Core's Incidents register; contractors, drills and health surveillance in Full.
const pack = packByKey('iso-45001');

describe('ISO 45001 add-on', () => {
  it('is a 1.1.0 add-on to Core Starter on the 2018 library that meets the pack quality bar', () => {
    expect(pack.version).toBe('1.1.0');
    // 1.1.0 links contractors to Core's Suppliers register (Core 1.1.0), from Full
    expect(pack.requires).toEqual([{ pack: 'core', range: '^1.1.0' }]);
    expect(pack.extends!.find((e) => e.sheet === 'suppliers')!.level).toBe('full');
    expect(pack.frameworks).toEqual([{ key: 'iso-45001', version: '2018' }]);
    expect(pack.description).toMatch(/new edition of ISO 45001 is expected in 2027/);
    expect(extendsAgainst(pack, core)).toEqual([]);
    expect(neededLevel(pack, core)).toBe('starter');
    expect(packQualityProblems(pack)).toEqual([]);
  });

  it('offers HIRA and consultation in Starter, the rest in Full', () => {
    expect(levelSummaries(pack).map((l) => [l.key, l.adds])).toEqual([
      ['starter', ['Hazards and OH&S risks (HIRA)', 'Worker consultation and participation']],
      ['full', ['Contractors', 'Emergency drills', 'Health surveillance']],
    ]);
    expect(pack.sheets.find((s) => s.ref === 'hazards')!.folder).toBe('core:risk');
    expect(pack.sheets.find((s) => s.ref === 'contractors')!.folder).toBe('core:suppliers');
  });

  it('assesses each hazard with the hierarchy of controls and accepts it through a workflow', () => {
    const hazards = pack.sheets.find((s) => s.ref === 'hazards')!;
    const hierarchy = hazards.fields.find((f) => f.key === 'hierarchy')!;
    expect(
      (hierarchy.config as { options: { label: string }[] }).options.map((o) => o.label),
    ).toEqual([
      '1 Eliminate',
      '2 Substitute',
      '3 Engineering controls',
      '4 Administrative controls',
      '5 Protective equipment',
    ]);
    const [flow] = hazards.workflows!;
    expect(flow!.name).toBe('Risk acceptance');
    expect(flow!.requiredFields).toEqual(expect.arrayContaining(['hierarchy', 'controls']));
    expect(flow!.steps.map((s) => s.approvers)).toEqual([
      { kind: 'field', fieldKey: 'owner' },
      { kind: 'jobRole', roleName: 'HSE manager' },
    ]);
  });

  it('scores the risk before and after controls', () => {
    const hazards = pack.sheets.find((s) => s.ref === 'hazards')!;
    const keys = ['residual_likelihood', 'residual_severity', 'residual', 'residual_level'];
    const fields = hazards.fields
      .filter((f) => keys.includes(f.key))
      .map((f) => makeField(f.type, f.config ?? {}, { key: f.key }));
    const ctx = makeCtx({ fields });
    const of = (key: string, values: Record<string, Json>) =>
      formula.compute!(
        makeItem(Object.fromEntries(Object.entries(values).map(([k, v]) => [`f-${k}`, v]))),
        fields.find((f) => f.key === key)! as never,
        ctx,
      );
    expect(of('residual', { residual_likelihood: 2, residual_severity: 5 })).toBe(10);
    expect(of('residual_level', { residual_likelihood: 2, residual_severity: 5 })).toBe('Medium');
    expect(of('residual_level', { residual_likelihood: 3, residual_severity: 4 })).toBe('High');
    expect(of('residual_level', {})).toBeNull();
  });

  it('keeps health surveillance restricted as personal data', () => {
    const health = pack.sheets.find((s) => s.ref === 'health')!;
    expect(health.personalData).toBe(true);
    expect(
      health.fields
        .filter((f) => (f.config as { personalData?: boolean })?.personalData)
        .map((f) => f.key),
    ).toEqual(['person', 'fitness', 'restrictions']);
    const { plan } = planAddon(pack, 'full');
    expect(plan.payload!.sheets.find((s) => s.ref === 'health')!.restricted).toBe(true);
  });

  it('records injuries, near misses and ill health in the shared Incidents register', () => {
    const { plan, corePayload } = planAddon(pack, 'starter');
    expect(plan.preview.conflicts).toEqual([]);
    const refs = refMapOf(corePayload);
    const p = plan.payload!;
    expect(
      p.fields.filter((f) => f.sheet_id === refs['sheet:incidents']).map((f) => f.key),
    ).toEqual([
      'iso45001_outcome',
      'iso45001_days_lost',
      'iso45001_reportable',
      'iso45001_workers_involved',
      'iso45001_hazard',
      'iso45001_clauses',
    ]);
    expect(p.options!.map((o) => o.ref)).toEqual(
      expect.arrayContaining([
        'core:incidents.incident_type.iso45001_ill_health',
        'core:incidents.standards.iso45001',
      ]),
    );
    const form = p.views.find((v) => v.ref === 'core:incidents.form.iso45001_report')!;
    expect(form.name).toBe('Report an injury or near miss');
    // the near miss links to the hazard it showed, both ways
    const hazard = p.fields.find((f) => f.ref === 'core:incidents.iso45001_hazard')!;
    const nearMiss = p.items.find((i) => i.ref === 'core:incidents.iso45001_near_miss')!;
    const forklift = p.items.find((i) => i.ref === 'hazards.ex_forklift')!;
    expect(p.links).toContainEqual({
      field_id: hazard.id,
      from_item: nearMiss.id,
      to_item: forklift.id,
    });
  });

  it('names only requirements the ISO 45001:2018 library has and links its examples to them', () => {
    const library = libraryItems('iso-45001', '2018');
    for (const k of requirementKeysOf(pack)) expect(library[k], k).toBeDefined();
    const { plan } = planAddon(pack, 'full');
    expect(linkedRequirements(plan.payload!, 'hazards.clauses', 'hazards.ex_forklift')).toEqual([
      'iso-45001@2018#6.1.2',
      'iso-45001@2018#8.1.2',
    ]);
    expect(
      linkedRequirements(plan.payload!, 'consultation.clauses', 'consultation.ex_committee'),
    ).toEqual(['iso-45001@2018#5.4']);
  });

  it('ships advanced automations, the notifying ones in test mode', () => {
    const all = [...pack.automations, ...(pack.extends ?? []).flatMap((e) => e.automations ?? [])];
    expect(all.filter((a) => a.advanced && a.description).length).toBeGreaterThanOrEqual(8);
    const { plan } = planAddon(pack, 'full');
    const mode = (ref: string) =>
      plan.payload!.automations.find((a) => a.ref === ref)!.mode ?? 'live';
    expect(mode('hazard_high_residual')).toBe('test');
    expect(mode('iso45001_reportable')).toBe('test');
    expect(mode('concern_action')).toBe('live');
    expect(mode('drill_next')).toBe('live');
  });

  it('previews before Core is there: Core is installed first, nothing blocks', () => {
    const plan = previewBeforeCore(pack);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    expect(plan.payload).toBeNull();
    expect(previewLines(plan.preview)).toContain('Installs Core registers 1.2.0 (Starter) first.');
  });
});
