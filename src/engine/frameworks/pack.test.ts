import { describe, expect, it } from 'vitest';
import { planPackInstall, type PackSnapshot } from '../packs/plan';
import { controlsSheets, withControlsLink } from './adopt';
import { frameworkToPack, IMPLEMENTATION_OPTIONS, LIBRARY_KEYS } from './pack';
import type { Framework } from './types';

const framework: Framework = {
  key: 'iso-x',
  version: '2024',
  revision: 2,
  title: 'ISO X:2024',
  shortTitle: 'X',
  publisher: 'ISO',
  kind: 'standard',
  source: 'ISO X:2024 (reference numbers only)',
  licence: 'Reference numbers only. Titles are our own words.',
  url: 'https://example.com/x',
  titles: 'own-words',
  library: {
    name: 'ISO X requirements',
    itemLabel: 'Requirement',
    idPrefix: 'X-',
    folder: 'Frameworks',
    soa: { name: 'Statement of applicability', refStartsWith: 'A.' },
  },
  requirements: [
    {
      ref: '4',
      parent: null,
      kind: 'theme',
      position: 0,
      title: 'Context',
      guidance: null,
      tags: [],
    },
    {
      ref: '4.1',
      parent: '4',
      kind: 'clause',
      position: 1,
      title: 'Issues',
      guidance: null,
      tags: [],
    },
    {
      ref: '4.1.1',
      parent: '4.1',
      kind: 'clause',
      position: 2,
      title: 'Internal',
      guidance: 'Ours.',
      tags: [],
    },
    {
      ref: 'A.5',
      parent: null,
      kind: 'theme',
      position: 3,
      title: 'Controls',
      guidance: null,
      tags: [],
    },
    {
      ref: 'A.5.1',
      parent: 'A.5',
      kind: 'control',
      position: 4,
      title: 'Policy',
      guidance: null,
      tags: [],
    },
  ],
};

const snapshot = (over: Partial<PackSnapshot> = {}): PackSnapshot => ({
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
  ...over,
});

let n = 0;
const env = () => {
  n = 0;
  return {
    today: '2026-11-13',
    now: new Date('2026-11-13T09:00:00Z'),
    timeZone: 'Europe/London',
    newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
    hash: 'f'.repeat(64),
    userId: 'u',
  };
};

describe('frameworkToPack', () => {
  const pack = frameworkToPack(framework);
  const sheet = pack.sheets[0]!;

  it('is a pack keyed by the framework, versioned by edition and revision', () => {
    expect(pack.key).toBe('framework-iso-x');
    expect(pack.version).toBe('2024.2.0');
    expect(pack.folders).toEqual([{ ref: 'frameworks', name: 'Frameworks' }]);
  });

  it('one library sheet: themes become groups, every other requirement an item with its key', () => {
    expect(sheet.isLibrary).toBe(true);
    expect(sheet.framework).toEqual({ key: 'iso-x', version: '2024', refFieldKey: 'ref' });
    expect(sheet.groups.map((g) => g.name)).toEqual(['Context', 'Controls']);
    expect(sheet.items.map((i) => [i.name, i.group, i.requirementRef])).toEqual([
      ['Issues', sheet.groups[0]!.ref, 'iso-x@2024#4.1'],
      ['Internal', sheet.groups[0]!.ref, 'iso-x@2024#4.1.1'],
      ['Policy', sheet.groups[1]!.ref, 'iso-x@2024#A.5.1'],
    ]);
    expect(sheet.items[1]!.values).toEqual({
      ref: '4.1.1',
      part_of: '4.1 Issues',
      guidance: 'Ours.',
    });
    expect(sheet.items[2]!.values).toEqual({ ref: 'A.5.1', part_of: 'Controls' });
    expect(sheet.description).toContain(framework.licence);
  });

  it('has the statement of applicability fields, the Ref locked', () => {
    expect(sheet.fields.map((f) => f.key)).toEqual([
      'ref',
      'part_of',
      'guidance',
      'applicable',
      'justification',
      'status',
      'owner',
      'evidence',
      'last_reviewed',
    ]);
    expect(sheet.fields[0]!.locked).toBe(true);
    const status = sheet.fields.find((f) => f.key === LIBRARY_KEYS.status)!;
    expect((status.config as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(
      IMPLEMENTATION_OPTIONS.map((o) => o.label),
    );
    const just = sheet.fields.find((f) => f.key === LIBRARY_KEYS.justification)!;
    expect(just.config).toEqual({ whenFieldKey: 'applicable', whenValues: ['not_applicable'] });
  });

  it('a statement of applicability view and an Insights layout, from the data', () => {
    expect(sheet.views.map((v) => [v.name, v.type])).toEqual([
      ['All requirements', 'table'],
      ['Statement of applicability', 'table'],
      ['Applicability', 'insights'],
    ]);
    expect(sheet.views[1]!.config.filters).toEqual([
      { fieldKey: 'ref', op: 'starts_with', value: 'A.' },
    ]);
    const plain = frameworkToPack({
      ...framework,
      library: { ...framework.library, soa: undefined },
    });
    expect(plain.sheets[0]!.views.map((v) => v.name)).toEqual([
      'All requirements',
      'Applicability',
    ]);
  });

  it('plans like any pack: the sheet keeps its framework, items their requirement', () => {
    const plan = planPackInstall(pack, snapshot(), env());
    expect(plan.state).toBe('ready');
    const p = plan.payload!;
    expect(p.sheets[0]!.is_library).toBe(true);
    expect((p.sheets[0]!.settings as Record<string, unknown>).framework).toEqual(sheet.framework);
    expect(p.items.map((i) => i.requirement_ref)).toEqual([
      'iso-x@2024#4.1',
      'iso-x@2024#4.1.1',
      'iso-x@2024#A.5.1',
    ]);
    expect(p.views.map((v) => v.name)).toEqual([
      'All requirements',
      'Statement of applicability',
      'Applicability',
    ]);
  });
});

describe('adoption with a controls sheet', () => {
  const sheets = [
    { id: 's-ctl', name: 'Controls', isLibrary: false, parentSheetId: null },
    { id: 's-lib', name: 'Old library', isLibrary: true, parentSheetId: null },
    { id: 's-one', name: 'Policies', isLibrary: false, parentSheetId: null },
  ];
  const fields = [
    {
      id: 'f-req',
      sheetId: 's-ctl',
      name: 'Requirements',
      type: 'requirement',
      position: 'a1',
      config: { targetSheetId: null },
    },
    {
      id: 'f-one',
      sheetId: 's-one',
      name: 'Requirement',
      type: 'requirement',
      position: 'a1',
      config: { targetSheetId: 's-lib' },
    },
    {
      id: 'f-lib',
      sheetId: 's-lib',
      name: 'Requirement',
      type: 'requirement',
      position: 'a1',
      config: { targetSheetId: null },
    },
  ];

  it('offers sheets with a requirement field that links to any library', () => {
    expect(controlsSheets(sheets, fields)).toEqual([
      { sheetId: 's-ctl', sheetName: 'Controls', fieldId: 'f-req', fieldName: 'Requirements' },
    ]);
  });

  it('adds a Controls link field mirrored by the requirement field', () => {
    const e = env();
    const plan = planPackInstall(frameworkToPack(framework), snapshot(), e);
    const out = withControlsLink(plan, controlsSheets(sheets, fields)[0]!, e.newId);
    const f = out.payload!.fields.at(-1)!;
    expect(f).toMatchObject({
      ref: 'library.controls',
      key: 'controls',
      type: 'link',
      config: { targetSheetId: 's-ctl', multiple: true, inverseFieldId: 'f-req' },
    });
    expect(String(f.position) > String(plan.payload!.fields.at(-1)!.position)).toBe(true);
    expect(out.preview.links).toContainEqual({
      from: 'ISO X requirements',
      field: 'Controls',
      to: 'Controls',
      twoWay: true,
    });
    expect(out.preview.counts.fields).toBe(plan.preview.counts.fields + 1);
    expect(withControlsLink(plan, null, e.newId)).toBe(plan);
  });
});
