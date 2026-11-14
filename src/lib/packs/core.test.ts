import { describe, expect, it } from 'vitest';
import { extendsAgainst, extensionUses, neededLevel, STANDARDS_KEY } from '@/engine/packs/extend';
import { manifestAtLevel } from '@/engine/packs/levels';
import { planPackInstall, type PackSnapshot } from '@/engine/packs/plan';
import { afterInstall } from '@/engine/packs/installed.fixture';
import { selectManifest } from '@/engine/packs/select';
import { repoPacks } from '@/lib/packs/catalogue';

// The Core registers (docs/11 Core registers) and the ISO 14001 add-on (2.0.0) as the catalogue ships them.
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

  it('keeps its lowest level small: Foundations, then Starter, then Full', () => {
    expect(core.levels?.map((l) => l.key)).toEqual(['foundations', 'starter', 'full']);
    const names = (level: string) => manifestAtLevel(core, level).sheets.map((s) => s.name);
    expect(names('foundations')).toEqual([
      'Context and interested parties',
      'Documents and policies',
      'Objectives and KPIs',
      'Risk register',
      'Risk categories',
    ]);
    // Starter is what Core 1.0.0 called Starter, plus Context and Suppliers: an install at Starter keeps every sheet
    expect(names('starter')).toEqual([
      ...names('foundations'),
      'Incidents',
      'Nonconformities and CAPA',
      'Actions',
      'Suppliers',
    ]);
    const full = manifestAtLevel(core, 'full');
    expect(full.sheets).toHaveLength(15);
    expect(full.sheets.some((s) => s.folder === 'privacy')).toBe(false);
    expect(full.sheets.filter((s) => s.folder === 'suppliers').map((s) => s.ref)).toEqual([
      'suppliers',
    ]);
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

  it('needs Core at Full: compliance obligations live in the Legal register', () => {
    expect(neededLevel(iso14001, core)).toBe('full');
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
    expect([...uses.keys()].sort()).toEqual([
      'actions',
      'documents',
      'incidents',
      'legal',
      'nc',
      'objectives',
      'risk',
      'risk_category',
    ]);
    expect([...uses.get('risk')!].sort()).toEqual(
      expect.arrayContaining(['category', 'score', 'standards', 'status']),
    );
    expect(uses.get('incidents')!.has('incident_type')).toBe(true);
  });

  it('still plans in Create with its own sheet left out: the link to it is left out too', () => {
    const snap: PackSnapshot = {
      orgId: 'org',
      prefixes: [],
      folders: [],
      installs: [],
      members: [],
      jobRoles: [],
      teams: [],
      lastSheetPosition: null,
      lastFolderPosition: null,
      lastDashboardPosition: null,
    };
    let n = 0;
    const env = {
      today: '2026-11-14',
      now: new Date('2026-11-14T09:00:00Z'),
      timeZone: 'Europe/Oslo',
      newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
      hash: 'h',
      userId: 'u1',
    };
    const withCore = afterInstall(
      snap,
      planPackInstall(core, snap, env, { level: 'full' }).payload!,
      'inst-core',
    );
    const chosen = selectManifest(iso14001, ['sheet:aspects']);
    // the sheets that link to the aspects go with them
    expect(chosen.sheets.map((s) => s.ref)).not.toContain('aspects');
    expect(chosen.sheets.map((s) => s.ref)).not.toContain('monitoring');
    const plan = planPackInstall(chosen, withCore, env);
    expect(plan.preview.conflicts).toEqual([]);
    const keys = plan.payload!.fields.map((f) => f.key);
    expect(keys).not.toContain('iso14001_aspect');
    expect(keys).not.toContain('iso14001_aspects');
    expect(plan.payload!.items.map((i) => i.name)).toEqual(
      expect.arrayContaining(['Environmental', 'Example: Coolant spill reaches a surface drain']),
    );
  });
});
