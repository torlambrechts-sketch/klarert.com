import { describe, expect, it } from 'vitest';
import { extendsAgainst, extensionUses, neededLevel, STANDARDS_KEY } from '@/engine/packs/extend';
import { manifestAtLevel } from '@/engine/packs/levels';
import { repoPacks } from '@/lib/packs/catalogue';

// The Core registers (docs/11 Core registers) and the ISO 14001 demonstration add-on as the catalogue ships them.
const packs = repoPacks();
const core = packs.find((p) => p.key === 'core')!;
const iso14001 = packs.find((p) => p.key === 'iso-14001')!;

describe('Core registers', () => {
  it('is a system pack with five domain folders in menu order', () => {
    expect(core.system).toBe(true);
    expect(core.folders.map((f) => [f.name, f.domain])).toEqual([
      ['Management system', 'management'],
      ['Risk and controls', 'risk'],
      ['Operations', 'operations'],
      ['Privacy and security', 'privacy'],
      ['Suppliers', 'suppliers'],
    ]);
  });

  it('puts every sheet in a domain, with a Standards field and default views', () => {
    for (const s of core.sheets) {
      expect(
        core.folders.some((f) => f.ref === s.folder && f.domain),
        s.ref,
      ).toBe(true);
      const standards = s.fields.find((f) => f.key === STANDARDS_KEY);
      expect(standards?.type, s.ref).toBe('multiselect');
      // a status field gets a board; a date field a calendar (the risk categories are a short list)
      if (s.ref !== 'risk_category') {
        expect(
          s.views.some((v) => v.type === 'kanban'),
          s.ref,
        ).toBe(true);
        expect(
          s.views.some((v) => v.type === 'calendar'),
          s.ref,
        ).toBe(true);
      }
    }
  });

  it('keeps Starter small: Privacy and security and Suppliers stay empty until an add-on fills them', () => {
    const starter = manifestAtLevel(core, 'starter');
    expect(starter.sheets.map((s) => s.name)).toEqual([
      'Documents and policies',
      'Objectives and KPIs',
      'Risk register',
      'Risk categories',
      'Incidents',
      'Nonconformities and CAPA',
      'Actions',
    ]);
    const full = manifestAtLevel(core, 'full');
    expect(full.sheets).toHaveLength(13);
    for (const domain of ['privacy', 'suppliers'])
      expect(full.sheets.some((s) => s.folder === domain)).toBe(false);
  });

  it('scores each risk against its category: scales and appetite are data', () => {
    const risk = core.sheets.find((s) => s.ref === 'risk')!;
    expect(risk.fields.find((f) => f.key === 'category')?.config).toMatchObject({
      targetSheetRef: 'risk_category',
    });
    expect(risk.fields.find((f) => f.key === 'appetite')?.type).toBe('lookup');
    const cats = core.sheets.find((s) => s.ref === 'risk_category')!;
    expect(cats.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['likelihood_scale', 'impact_scale', 'appetite']),
    );
  });

  it('ships no text of a standard: example items say so, the description names no clause', () => {
    for (const s of core.sheets)
      for (const i of s.items)
        expect(i.name === 'General' || i.name.startsWith('Example:')).toBe(true);
    expect(JSON.stringify(core)).not.toMatch(/clause \d|Annex A/);
  });
});

describe('ISO 14001 add-on', () => {
  it('requires Core, stands for ISO 14001 and extends only Core sheets that exist', () => {
    expect(iso14001.requires).toEqual([{ pack: 'core', range: '^1.0.0' }]);
    expect(iso14001.standard).toMatchObject({ id: 'iso14001', label: 'ISO 14001' });
    expect(extendsAgainst(iso14001, core)).toEqual([]);
  });

  it('needs only the Starter level of Core', () => {
    expect(neededLevel(iso14001, core)).toBe('starter');
  });

  it('puts its own sheet in the Operations domain and links it to Core both ways', () => {
    const aspects = iso14001.sheets.find((s) => s.ref === 'aspects')!;
    expect(aspects.folder).toBe('core:operations');
    expect(aspects.fields.find((f) => f.key === 'risks')?.config).toMatchObject({
      targetSheetRef: 'core:risk',
      inverseKey: 'iso14001_aspect',
    });
  });

  it('says which Core keys it uses, so an update of Core cannot take them away', () => {
    const uses = extensionUses(iso14001, 'core');
    expect([...uses.keys()].sort()).toEqual(['incidents', 'objectives', 'risk', 'risk_category']);
    expect([...uses.get('risk')!].sort()).toEqual(
      expect.arrayContaining(['category', 'score', 'standards', 'status']),
    );
    expect(uses.get('incidents')!.has('incident_type')).toBe(true);
  });
});
