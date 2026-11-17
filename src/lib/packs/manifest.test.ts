import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packManifestSchema, parsePack } from './manifest';

const supplier = () =>
  JSON.parse(
    readFileSync(
      // 1.1.0, a standalone pack (2.0.0 is an add-on to the Core registers): the schema's own cases
      new URL('./fixtures/supplier-management-1.1.0.json', import.meta.url),
      'utf8',
    ),
  );
const problems = (raw: unknown) => {
  const r = packManifestSchema.safeParse(raw);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('pack manifest', () => {
  it('accepts the supplier pack and fills the defaults', () => {
    const m = parsePack(supplier());
    expect(m.sheets.map((s) => [s.ref, s.isLibrary, s.register ?? null])).toEqual([
      ['supplier', false, null],
      ['review', false, null],
      ['requirement', true, null],
      ['document', false, 'documents'],
      ['check', false, null],
    ]);
    expect(m.requires).toEqual([]);
    expect(m.sheets[1]!.views).toEqual([]);
  });

  it('wants a semver version, a key and refs', () => {
    const raw = { ...supplier(), version: '1.0', key: 'Bad Key' };
    raw.sheets[0].ref = 'Supplier';
    expect(problems(raw)).toEqual(
      expect.arrayContaining([
        'key: Use lower-case letters, digits and "-".',
        'version: Use a version like 1.0.0.',
        'sheets.0.ref: Use a short lower-case ref.',
      ]),
    );
  });

  it('refuses duplicate refs', () => {
    const raw = supplier();
    raw.folders.push({ ref: 'suppliers', name: 'Again' });
    raw.sheets[1].ref = 'supplier';
    raw.sheets[0].items[1].ref = 'cloudhost';
    raw.automations[1].ref = 'review_due';
    expect(problems(raw)).toEqual(
      expect.arrayContaining([
        'folders: Duplicate folder ref "suppliers".',
        'sheets: Duplicate sheet ref "supplier".',
        'sheets.0.items: Duplicate item ref "cloudhost".',
        'automations: Duplicate automation ref "review_due".',
      ]),
    );
  });

  it('refuses duplicate ID prefixes inside a pack (the workspace renames, the pack cannot)', () => {
    const raw = supplier();
    raw.sheets[1].idPrefix = 'SUP-';
    expect(problems(raw)).toContain('sheets: Duplicate ID prefix "SUP-".');
  });

  it('checks folder, link and item refs across sheets', () => {
    const raw = supplier();
    raw.sheets[0].folder = 'nowhere';
    raw.sheets[0].items[0].links.reviews = ['missing'];
    raw.sheets[0].items[0].links.notes = ['cloudhost_2026'];
    raw.sheets[1].fields[0].config.targetSheetRef = 'Not a ref';
    expect(problems(raw)).toEqual(
      expect.arrayContaining([
        'sheets.0.folder: Unknown folder "nowhere".',
        'sheets.0.items.0: Unknown linked item "missing" on "review".',
        'sheets.0.items.0: "notes" is not a link field.',
        'sheets.1.fields.0: "Not a ref" is not a sheet ref.',
      ]),
    );
  });

  it('names another pack only through requires, and never links example items into it', () => {
    const raw = supplier();
    raw.sheets[0].fields.push({
      key: 'control',
      name: 'Control',
      type: 'link',
      config: { targetSheetRef: 'iso27001:annex_a', multiple: true },
    });
    expect(problems(raw)).toContain(
      'sheets.0.fields.16: "iso27001:annex_a" names the pack "iso27001", which is not in requires.',
    );
    raw.requires = [{ pack: 'iso27001', range: '^1.0.0' }];
    expect(problems(raw)).toEqual([]);
    raw.sheets[0].items[0].links.control = ['a5_1'];
    expect(problems(raw)).toContain(
      'sheets.0.items.0: "control" links to another pack: example links to it are not allowed.',
    );
    // its own key is the same as no key
    const own = supplier();
    own.sheets[1].fields[0].config.targetSheetRef = 'supplier-management:supplier';
    expect(problems(own)).toEqual([]);
  });

  it('runs the template checks on every sheet (fields, views, forms, automations)', () => {
    const raw = supplier();
    raw.sheets[0].views[0].config.labelFieldKey = 'nope';
    raw.sheets[0].forms[0].layout.fields.push({ key: 'ghost' });
    raw.automations[0].sheet = 'nowhere';
    expect(problems(raw)).toEqual(
      expect.arrayContaining([
        'sheets.0.views.0: Unknown field "nope".',
        'sheets.0.forms.0: Unknown field "ghost".',
        'automations.0: Unknown sheet "nowhere".',
      ]),
    );
  });

  it('lets a field name the roles that see it, never people, and no example values', () => {
    const ok = supplier();
    ok.sheets[0].fields.find((f: { key: string }) => f.key === 'notes').restrictedTo = {
      roles: ['admin', 'auditor'],
    };
    expect(problems(ok)).toEqual([]);
    expect(parsePack(ok).sheets[0]!.fields.find((f) => f.key === 'notes')!.restrictedTo).toEqual({
      roles: ['admin', 'auditor'],
    });
    const bad = supplier();
    const fields = bad.sheets[0].fields as { key: string; restrictedTo?: unknown }[];
    fields.find((f) => f.key === 'notes')!.restrictedTo = { roles: ['admin'], userIds: ['u1'] };
    fields.find((f) => f.key === 'owner')!.restrictedTo = { roles: ['owner'] };
    const list = problems(bad);
    expect(list.some((p) => p.startsWith('sheets.0.fields.') && p.includes('userIds'))).toBe(true);
    expect(list.some((p) => p.startsWith('sheets.0.fields.') && p.includes('roles.0'))).toBe(true);
    // an example item's value for a restricted column (the install's log would hold it in clear)
    const valued = supplier();
    valued.sheets[0].fields.find((f: { key: string }) => f.key === 'status').restrictedTo = {
      roles: [],
    };
    expect(problems(valued)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"status" is restricted: example items carry no values for it.'),
      ]),
    );
  });

  it('checks dashboards against the sheets and the widget registry', () => {
    const raw = supplier();
    raw.dashboards[0].widgets.push(
      { ref: 'w_x', type: 'sparkle', title: 'Nope' },
      { ref: 'w_y', type: 'count', title: 'Count', sheetRef: 'gone' },
      { ref: 'w_z', type: 'by_option', title: 'By', sheetRef: 'supplier', fieldKey: 'colour' },
      { ref: 'w_x', type: 'count', title: 'Again' },
    );
    expect(problems(raw)).toEqual(
      expect.arrayContaining([
        'dashboards.0.widgets: Duplicate widget ref "w_x".',
        'dashboards.0.widgets.4: Unknown widget "sparkle".',
        'dashboards.0.widgets.5: Unknown sheet "gone".',
        'dashboards.0.widgets.6: Unknown field "colour" on "supplier".',
      ]),
    );
  });

  it('wants a status field on a documents register and valid requirement ranges', () => {
    const raw = supplier();
    raw.sheets[3].fields = raw.sheets[3].fields.filter(
      (f: { type: string }) => f.type !== 'status',
    );
    raw.requires = [{ pack: 'base', range: 'latest' }];
    expect(problems(raw)).toEqual(
      expect.arrayContaining([
        'sheets.3.register: A documents register needs a status field.',
        'requires.0.range: Use a range like ^1.0.0.',
      ]),
    );
  });

  it('puts an automation on sub-items only of a sheet that has them, naming their fields', () => {
    const raw = supplier();
    raw.automations.push({ ...raw.automations[0], ref: 'on_actions', subitems: true });
    const ai = raw.automations.length - 1;
    expect(problems(raw)).toEqual([`automations.${ai}: "supplier" has no sub-items.`]);
    raw.sheets[0].subitems = {
      label: 'Actions',
      fields: [{ key: 'due_date', name: 'Due date', type: 'date' }],
    };
    raw.automations[ai].trigger = { type: 'date_arrives', fieldKey: 'due_date', offsetDays: 1 };
    raw.automations[ai].conditions = [{ fieldKey: 'status', op: 'is_not_done' }];
    expect(problems(raw)).toEqual([`automations.${ai}: Unknown sub-item field "status".`]);
    raw.automations[ai].conditions = [];
    expect(problems(raw)).toEqual([]);
  });

  it('links example items to requirements of a framework the pack builds on', () => {
    const raw = supplier();
    raw.sheets[0].fields.push({
      key: 'controls',
      name: 'Controls',
      type: 'requirement',
      config: { multiple: true },
    });
    delete raw.frameworks;
    raw.sheets[0].items[0].requirements = { controls: ['iso-27001@2022#A.5.19'], owner: [] };
    expect(problems(raw)).toEqual(
      expect.arrayContaining([
        'sheets.0.items.0: "iso-27001@2022#A.5.19" is not in a framework the pack builds on (frameworks).',
        'sheets.0.items.0: "owner" is not a requirement field.',
      ]),
    );
    raw.frameworks = [
      { key: 'iso-27001', version: '2022' },
      { key: 'iso-9001', version: '2015', optional: true },
      { key: 'gdpr', version: '2016', optional: true },
    ];
    delete raw.sheets[0].items[0].requirements.owner;
    expect(problems(raw)).toEqual([]);
    raw.sheets[0].items[0].requirements.controls = ['A.5.19'];
    expect(problems(raw)).toContain(
      'sheets.0.items.0.requirements.controls.0: Use <framework>@<version>#<ref>.',
    );
  });

  it('reads the quality bar keys (docs/11 Pack quality bar)', () => {
    const raw = supplier();
    raw.sheets[0].kind = 'register';
    raw.sheets[0].personalData = true;
    raw.automations[0].advanced = true;
    raw.automations[0].description =
      'Asks the owner to review a supplier two weeks before the date.';
    raw.automations[0].startInTestMode = false;
    raw.dashboards[0].headline = true;
    raw.formsNotApplicable = 'Not needed.';
    // a personal data sheet marks its personal fields, and is never installed open
    expect(problems(raw)).toEqual([
      'sheets.0.personalData: Mark the fields that hold personal data with config.personalData.',
    ]);
    raw.sheets[0].fields[0].config = { ...raw.sheets[0].fields[0].config, personalData: true };
    raw.sheets[0].restricted = false;
    raw.automations[1].advanced = true;
    expect(problems(raw)).toEqual([
      'sheets.0.restricted: A sheet with personal data is always installed restricted.',
      'automations.1: An advanced automation needs a description in plain words.',
    ]);
    expect(problems({ ...raw, sheets: [{ ...raw.sheets[0], kind: 'list' }] })).toContain(
      'sheets.0.kind: Invalid option: expected one of "register"|"actions"|"log"|"library"|"plan"',
    );
    delete raw.sheets[0].restricted;
    delete raw.automations[1].advanced;
    const m = parsePack(raw);
    expect([m.sheets[0]!.kind, m.sheets[0]!.personalData, m.dashboards[0]!.headline]).toEqual([
      'register',
      true,
      true,
    ]);
    expect(m.automations[0]).toMatchObject({ advanced: true, startInTestMode: false });
    expect(m.formsNotApplicable).toBe('Not needed.');
  });

  it('throws with every problem listed', () => {
    expect(() => parsePack({ ...supplier(), sheets: [] })).toThrow(
      /Pack is not valid:\n[\s\S]* {2}sheets: A pack needs a sheet or an extends entry\./,
    );
  });
});
