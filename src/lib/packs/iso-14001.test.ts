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

// The ISO 14001 add-on (docs/11 The ISO 14001 add-on, 2.0.0 on ISO 14001:2026): aspects with significance,
// monitoring and environmental communications of its own; compliance obligations in Core's Legal register (so Core
// installs Full), objectives, risks, incidents, nonconformities and documents on the shared registers.
const pack = packByKey('iso-14001');

describe('ISO 14001 add-on', () => {
  it('is a 2.0.0 add-on to Core on the 2026 library that meets the pack quality bar', () => {
    expect(pack.version).toBe('2.0.0');
    expect(pack.requires).toEqual([{ pack: 'core', range: '^1.0.0' }]);
    expect(pack.frameworks).toEqual([{ key: 'iso-14001', version: '2026' }]);
    expect(extendsAgainst(pack, core)).toEqual([]);
    expect(packQualityProblems(pack)).toEqual([]);
    // compliance obligations go into the Legal register, which Core installs from Full
    expect(neededLevel(pack, core)).toBe('full');
  });

  it('keeps the 1.0.0 refs it builds on and adds emergency preparedness in Full', () => {
    expect(levelSummaries(pack).map((l) => [l.key, l.adds])).toEqual([
      [
        'starter',
        ['Environmental aspects', 'Environmental monitoring', 'Environmental communications'],
      ],
      ['full', ['Emergency preparedness']],
    ]);
    const risk = pack.extends!.find((e) => e.sheet === 'risk')!;
    expect(risk.fields!.map((f) => f.key)).toContain('iso14001_aspect');
    expect(risk.items!.map((i) => i.ref)).toContain('iso14001_spill');
    expect(pack.extends!.find((e) => e.sheet === 'incidents')!.options).toEqual({
      incident_type: [{ id: 'iso14001_environmental', label: 'Environmental', color: 'green' }],
    });
  });

  it('treats environmental communications as personal data: restricted, with retention', () => {
    const comms = pack.sheets.find((s) => s.ref === 'communications')!;
    expect(comms.personalData).toBe(true);
    expect(
      comms.fields.filter((f) => (f.config as { personalData?: boolean })?.personalData),
    ).toHaveLength(2);
    expect(comms.retention?.rules[0]?.note).toMatch(/suggestion/);
    const { plan } = planAddon(pack, 'starter');
    expect(plan.payload!.sheets.find((s) => s.ref === 'communications')!.restricted).toBe(true);
  });

  it('names only requirements the ISO 14001:2026 library has and links its examples to them', () => {
    const library = libraryItems('iso-14001', '2026');
    for (const k of requirementKeysOf(pack)) expect(library[k], k).toBeDefined();
    const { plan } = planAddon(pack, 'full');
    expect(plan.preview.conflicts).toEqual([]);
    const p = plan.payload!;
    expect(linkedRequirements(p, 'aspects.clauses', 'aspects.coolant')).toEqual([
      'iso-14001@2026#6.1.2',
      'iso-14001@2026#8.1',
    ]);
    expect(
      linkedRequirements(p, 'core:legal.iso14001_clauses', 'core:legal.iso14001_discharge'),
    ).toEqual(['iso-14001@2026#6.1.3', 'iso-14001@2026#9.1.2']);
  });

  it('puts compliance obligations in the Legal register, linked both ways to the aspects', () => {
    const { plan, corePayload } = planAddon(pack, 'starter');
    const refs = refMapOf(corePayload);
    const p = plan.payload!;
    const legalCols = p.fields.filter((f) => f.sheet_id === refs['sheet:legal']);
    expect(legalCols.map((f) => f.key)).toEqual([
      'iso14001_aspects',
      'iso14001_permit',
      'iso14001_nc',
      'iso14001_clauses',
    ]);
    const obligations = p.fields.find((f) => f.ref === 'aspects.obligations')!;
    expect(obligations.config).toMatchObject({
      targetSheetId: refs['sheet:legal'],
      inverseFieldId: legalCols[0]!.id,
    });
    const discharge = p.items.find((i) => i.ref === 'core:legal.iso14001_discharge')!;
    expect(discharge.sheet_id).toBe(refs['sheet:legal']);
  });

  it('declares the significance approval and a response plan approval', () => {
    expect(pack.sheets.flatMap((s) => (s.workflows ?? []).map((w) => [s.ref, w.id]))).toEqual([
      ['aspects', 'significance-approval'],
      ['emergency', 'response-plan-approval'],
    ]);
  });

  it('ships advanced automations: significance, monitoring cascade, SLA clocks, compliance cycle', () => {
    const all = [...pack.automations, ...(pack.extends ?? []).flatMap((e) => e.automations ?? [])];
    expect(all.filter((a) => a.advanced && a.description).length).toBeGreaterThanOrEqual(8);
    const { plan, corePayload } = planAddon(pack, 'full');
    const rows = plan.payload!.automations;
    const row = (ref: string) => rows.find((a) => a.ref === ref)!;
    expect(row('communication_answer_late').mode).toBe('test');
    expect(row('iso14001_not_compliant').mode).toBe('test');
    expect(row('monitoring_over_limit').mode ?? 'live').toBe('live');
    const create = (
      row('monitoring_over_limit').actions as { type: string; sheetId?: string }[]
    )[1];
    expect(create).toMatchObject({
      type: 'create_item',
      sheetId: refMapOf(corePayload)['sheet:nc'],
    });
  });

  it('works out how far a measurement is over its limit', () => {
    const sheet = pack.sheets.find((s) => s.ref === 'monitoring')!;
    const fields = sheet.fields
      .filter((f) => ['value', 'limit', 'margin', 'result'].includes(f.key))
      .map((f) => makeField(f.type, f.config ?? {}, { key: f.key }));
    const ctx = makeCtx({ fields });
    const of = (key: string, values: Record<string, Json>) =>
      formula.compute!(
        makeItem(Object.fromEntries(Object.entries(values).map(([k, v]) => [`f-${k}`, v]))),
        fields.find((f) => f.key === key)! as never,
        ctx,
      );
    expect(of('margin', { value: 9.4, limit: 9 })).toBeCloseTo(0.4);
    expect(of('result', { value: 9.4, limit: 9 })).toBe('Over limit');
    expect(of('result', { value: 8.2, limit: 9 })).toBe('Within limit');
    expect(of('margin', { value: 4.6 })).toBe(0);
  });

  it('reads Core registers from its headline dashboard', () => {
    const { plan, corePayload } = planAddon(pack, 'starter');
    const refs = refMapOf(corePayload);
    const widgets = (
      plan.payload!.dashboards[0]!.config as { widgets: { id: string; sheetId?: string }[] }
    ).widgets;
    expect(widgets.find((w) => w.id === 'w_obligations')!.sheetId).toBe(refs['sheet:legal']);
    expect(widgets.find((w) => w.id === 'w_incidents')!.sheetId).toBe(refs['sheet:incidents']);
  });

  it('previews before Core is there: Core is installed first, nothing blocks', () => {
    const plan = previewBeforeCore(pack);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    expect(plan.payload).toBeNull();
    expect(previewLines(plan.preview)).toContain('Installs Core registers 1.2.0 (Full) first.');
  });
});
