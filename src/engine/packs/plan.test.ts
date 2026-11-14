import { describe, expect, it } from 'vitest';
import { planPackInstall, previewLines, type PackSnapshot } from './plan';
import { packLogText } from './audit';
import { compareVersions, satisfies } from './semver';
import type { PackManifest } from './types';

const manifest = (over: Partial<PackManifest> = {}): PackManifest => ({
  key: 'suppliers',
  version: '1.0.0',
  title: 'Suppliers',
  description: 'Suppliers and reviews.',
  requires: [],
  people: [
    {
      ref: 'maria',
      email: 'Maria@Example.com',
      name: 'Maria',
      initials: 'MP',
      jobRole: 'Quality',
      team: 'Quality',
      role: 'owner',
    },
    {
      ref: 'nobody',
      email: 'nobody@example.com',
      name: 'Nobody',
      initials: 'NB',
      jobRole: 'Quality',
      team: 'Quality',
      role: 'editor',
    },
  ],
  folders: [{ ref: 'sup', name: 'Suppliers' }],
  sheets: [
    {
      ref: 'supplier',
      name: 'Supplier register',
      itemLabel: 'Supplier',
      idPrefix: 'SUP-',
      folder: 'sup',
      isLibrary: false,
      groups: [{ ref: 'active', name: 'Active', color: 'green' }],
      fields: [
        { key: 'owner', name: 'Owner', type: 'people', config: { multiple: false } },
        { key: 'status', name: 'Status', type: 'status' },
        {
          key: 'reviews',
          name: 'Reviews',
          type: 'link',
          config: { targetSheetRef: 'review', multiple: true, inverseKey: 'supplier' },
        },
      ],
      views: [{ name: 'Board', type: 'kanban', config: { labelFieldKey: 'status' } }],
      items: [
        {
          ref: 'acme',
          group: 'active',
          name: 'Acme',
          values: { owner: ['$person:maria'], status: 'opt_wip' },
          links: { reviews: ['acme_2026'] },
        },
        { ref: 'beta', group: 'active', name: 'Beta', values: { owner: ['$person:nobody'] } },
      ],
      forms: [
        {
          ref: 'intake',
          name: 'Supplier intake',
          access: 'internal',
          layout: { fields: [{ key: 'status' }] },
        },
      ],
      columnGroups: [],
    },
    {
      ref: 'review',
      name: 'Supplier reviews',
      itemLabel: 'Review',
      idPrefix: 'SRV-',
      folder: 'sup',
      isLibrary: false,
      groups: [{ ref: 'done', name: 'Done', color: 'green' }],
      fields: [
        {
          key: 'supplier',
          name: 'Supplier',
          type: 'link',
          config: { targetSheetRef: 'supplier', multiple: false, inverseKey: 'reviews' },
        },
        { key: 'review_date', name: 'Review date', type: 'date' },
      ],
      views: [],
      items: [
        { ref: 'acme_2026', group: 'done', name: 'Acme 2026', values: { review_date: '$in:-3' } },
      ],
      forms: [],
      columnGroups: [],
    },
  ],
  automations: [
    {
      ref: 'stuck',
      sheet: 'supplier',
      name: 'Stuck → notify the owner and the buyer',
      enabled: true,
      trigger: { type: 'field_becomes', fieldKey: 'status', value: 'opt_stuck' },
      conditions: [],
      actions: [
        { type: 'notify', to: ['field:owner', 'jobRole:Buyer'], message: '{name} is stuck.' },
      ],
    },
  ],
  dashboards: [
    {
      ref: 'overview',
      name: 'Supplier overview',
      widgets: [
        {
          ref: 'w1',
          type: 'by_option',
          title: 'By status',
          sheetRef: 'supplier',
          fieldKey: 'status',
        },
      ],
    },
  ],
  ...over,
});

const snapshot = (over: Partial<PackSnapshot> = {}): PackSnapshot => ({
  orgId: 'org',
  prefixes: [],
  folders: [],
  installs: [],
  members: [
    { id: 'u-maria', name: 'Maria', initials: 'MP', color: 'blue', email: 'maria@example.com' },
  ],
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
    userId: 'u-maria',
  };
};

describe('planPackInstall', () => {
  it('plans every row with its ref, ids resolved from refs', () => {
    const plan = planPackInstall(manifest(), snapshot(), env());
    expect(plan.state).toBe('ready');
    const p = plan.payload!;
    expect(p.pack).toEqual({ key: 'suppliers', version: '1.0.0', hash: 'f'.repeat(64) });
    expect(p.folders.map((f) => f.ref)).toEqual(['sup']);
    expect(p.sheets.map((s) => [s.ref, s.id_prefix, s.folder_id])).toEqual([
      ['supplier', 'SUP-', p.folders[0]!.id],
      ['review', 'SRV-', p.folders[0]!.id],
    ]);
    expect(p.fields.map((f) => f.ref)).toEqual([
      'supplier.owner',
      'supplier.status',
      'supplier.reviews',
      'review.supplier',
      'review.review_date',
    ]);
    expect(p.views.map((v) => [v.ref, v.type])).toEqual([
      ['supplier.view.1', 'kanban'],
      ['supplier.form.intake', 'form'],
    ]);
    expect(p.items.map((i) => i.ref)).toEqual([
      'supplier.acme',
      'supplier.beta',
      'review.acme_2026',
    ]);
    // a link field's target is the planned sheet's id, and the inverse field's id
    const reviews = p.fields.find((f) => f.ref === 'supplier.reviews')!.config as Record<
      string,
      unknown
    >;
    expect(reviews.targetSheetId).toBe(p.sheets[1]!.id);
    expect(reviews.inverseFieldId).toBe(p.fields.find((f) => f.ref === 'review.supplier')!.id);
    // links by item ref, both directions
    const id = (ref: string) => p.items.find((i) => i.ref === ref)!.id;
    expect(p.links).toEqual([
      {
        field_id: p.fields[2]!.id,
        from_item: id('supplier.acme'),
        to_item: id('review.acme_2026'),
      },
      {
        field_id: p.fields[3]!.id,
        from_item: id('review.acme_2026'),
        to_item: id('supplier.acme'),
      },
    ]);
    // dashboards: the sheet by ref becomes its id, the widget id is its ref
    expect(p.dashboards[0]!.config).toEqual({
      widgets: [
        {
          id: 'w1',
          type: 'by_option',
          title: 'By status',
          sheetId: p.sheets[0]!.id,
          fieldKey: 'status',
        },
      ],
    });
    expect(p.automations.map((a) => [a.ref, a.sheet_id])).toEqual([['stuck', p.sheets[0]!.id]]);
    expect(plan.operations.filter((o) => o.action === 'create').map((o) => o.kind)).toContain(
      'dashboard',
    );
  });

  it('renames a taken ID prefix with a number and says so', () => {
    const plan = planPackInstall(
      manifest(),
      snapshot({ prefixes: ['SUP-', 'SUP2-', 'SRV-'] }),
      env(),
    );
    expect(plan.payload!.sheets.map((s) => s.id_prefix)).toEqual(['SUP3-', 'SRV2-']);
    expect(plan.preview.renamedPrefixes).toEqual([
      { sheet: 'Supplier register', from: 'SUP-', to: 'SUP3-' },
      { sheet: 'Supplier reviews', from: 'SRV-', to: 'SRV2-' },
    ]);
    expect(previewLines(plan.preview)).toContain(
      'Supplier register uses the prefix SUP3-: SUP- is taken in this workspace.',
    );
  });

  it('keeps renamed six-character prefixes valid', () => {
    const m = manifest();
    m.sheets[0]!.idPrefix = 'ABCDEF-';
    const plan = planPackInstall(m, snapshot({ prefixes: ['ABCDEF-'] }), env());
    expect(plan.payload!.sheets[0]!.id_prefix).toBe('ABCDE2-');
  });

  it('uses an active folder with the same name instead of making one', () => {
    const plan = planPackInstall(
      manifest(),
      snapshot({ folders: [{ id: 'f-old', name: 'suppliers', archived: false }] }),
      env(),
    );
    expect(plan.payload!.folders).toEqual([]);
    expect(plan.payload!.sheets[0]!.folder_id).toBe('f-old');
    expect(plan.preview.folders).toEqual([{ name: 'suppliers', action: 'reuse' }]);
    expect(plan.operations.find((o) => o.kind === 'folder')!.action).toBe('reuse');
  });

  it('skips a pack that is already installed at the same version', () => {
    const plan = planPackInstall(
      manifest(),
      snapshot({
        installs: [{ id: 'i1', packKey: 'suppliers', version: '1.0.0', status: 'installed' }],
      }),
      env(),
    );
    expect(plan.state).toBe('installed');
    expect(plan.payload).toBeNull();
    expect(new Set(plan.operations.map((o) => o.action))).toEqual(new Set(['skip']));
    expect(previewLines(plan.preview)[0]).toBe(
      'Suppliers 1.0.0 is already installed. Nothing to do.',
    );
  });

  it('installs again after the earlier install was archived', () => {
    const plan = planPackInstall(
      manifest(),
      snapshot({
        installs: [{ id: 'i1', packKey: 'suppliers', version: '1.0.0', status: 'archived' }],
        prefixes: ['SUP-', 'SRV-'],
      }),
      env(),
    );
    expect(plan.state).toBe('ready');
    expect(plan.payload!.sheets.map((s) => s.id_prefix)).toEqual(['SUP2-', 'SRV2-']);
  });

  it('blocks another version of an installed pack, a missing requirement and a cross-pack link', () => {
    const m = manifest({ version: '1.1.0', requires: [{ pack: 'iso27001', range: '^2.0.0' }] });
    m.sheets[1]!.fields.push({
      key: 'control',
      name: 'Control',
      type: 'link',
      config: { targetSheetRef: 'iso27001:annex_a', multiple: true },
    });
    const plan = planPackInstall(
      m,
      snapshot({
        installs: [{ id: 'i1', packKey: 'suppliers', version: '1.0.0', status: 'installed' }],
      }),
      env(),
    );
    expect(plan.state).toBe('blocked');
    expect(plan.payload).toBeNull();
    expect(plan.preview.conflicts).toEqual([
      'Version 1.0.0 is installed. Upgrading to 1.1.0 is not available yet: archive the installed version first.',
      'Install the pack "iso27001" (^2.0.0) first.',
      'This pack needs the sheet "annex_a" of "iso27001", which is not installed here.',
    ]);
    expect(plan.operations.filter((o) => o.action === 'conflict')).toHaveLength(3);
  });

  it('blocks a requirement at the wrong version and accepts a matching one', () => {
    const m = manifest({ requires: [{ pack: 'base', range: '^1.2.0' }] });
    const at = (version: string) =>
      planPackInstall(
        m,
        snapshot({ installs: [{ id: 'b', packKey: 'base', version, status: 'installed' }] }),
        env(),
      );
    expect(at('1.1.9').preview.conflicts).toEqual([
      'The pack "base" is at 1.1.9; this pack needs ^1.2.0.',
    ]);
    expect(at('1.4.0').state).toBe('ready');
  });

  it('leaves out people and job roles the workspace does not have, and says so', () => {
    const plan = planPackInstall(manifest(), snapshot(), env());
    const values = (ref: string) =>
      plan.payload!.items.find((i) => i.ref === ref)!.values as Record<string, unknown>;
    const owner = plan.payload!.fields.find((f) => f.ref === 'supplier.owner')!.id as string;
    expect(values('supplier.acme')[owner]).toEqual(['u-maria']);
    expect(values('supplier.beta')[owner]).toBeUndefined();
    expect(plan.preview.warnings).toEqual([
      'Automation "Stuck → notify the owner and the buyer": no job role "Buyer" in the workspace.',
      'Example values naming "nobody" are left empty: no such person in the workspace.',
    ]);
    // the owner is still told, so the automation stays on with the job role left out
    const a = plan.payload!.automations[0]!;
    expect(a.enabled).toBe(true);
    expect((a.actions as { to: string[] }[])[0]!.to).toEqual(['field:owner']);
  });

  it('writes a preview people can read', () => {
    const plan = planPackInstall(manifest(), snapshot(), env());
    expect(plan.preview.counts).toMatchObject({
      folders: 1,
      sheets: 2,
      fields: 5,
      forms: 1,
      items: 3,
      links: 2,
      automations: 1,
      dashboards: 1,
    });
    expect(plan.preview.links).toEqual([
      { from: 'Supplier register', field: 'Reviews', to: 'Supplier reviews', twoWay: true },
    ]);
    expect(previewLines(plan.preview)).toEqual(
      expect.arrayContaining([
        'Installs 1 folder, 2 sheets, 5 fields, 1 view, 1 form, 3 example items, 2 links, 1 automation and 1 dashboard.',
        'New folder Suppliers.',
        'Supplier register (SUP-): 3 fields, 2 example items.',
        'Supplier register links to Supplier reviews through Reviews, both ways.',
        'Supplier register: When Status becomes Stuck, then notify Owner. (test mode)',
        'Supplier register: form Supplier intake (internal, draft).',
        'Dashboard Supplier overview with 1 widget.',
      ]),
    );
  });

  it('reports a dashboard widget that does not fit its sheet', () => {
    const m = manifest();
    m.dashboards[0]!.widgets[0]!.fieldKey = 'owner';
    const plan = planPackInstall(m, snapshot(), env());
    expect(plan.state).toBe('blocked');
    expect(plan.preview.conflicts).toEqual([
      'Dashboard Supplier overview › By status: Choose a field of this sheet that the widget can use.',
    ]);
  });

  it('refuses a document that would start approved', () => {
    const m = manifest();
    m.sheets[1]!.register = 'documents';
    m.sheets[1]!.fields.push({
      key: 'status',
      name: 'Status',
      type: 'status',
      config: { options: [{ id: 'opt_ok', label: 'Approved', color: 'green', done: true }] },
    });
    m.sheets[1]!.items[0]!.values.status = 'opt_ok';
    const plan = planPackInstall(m, snapshot(), env());
    expect(plan.preview.conflicts).toEqual([
      'Supplier reviews › Acme 2026: a document starts as a draft.',
    ]);
    expect(plan.payload).toBeNull();
  });

  it('installs an automation that notifies in test mode, an outbound one off (docs/11 Pack quality bar)', () => {
    const m = manifest();
    const stuck = m.automations[0]!;
    m.automations.push(
      {
        ...stuck,
        ref: 'hook',
        name: 'Stuck → tell Teams',
        actions: [{ type: 'webhook', url: 'https://hooks.example.com/x', preset: 'teams' }],
      },
      {
        ...stuck,
        ref: 'quiet',
        name: 'Stuck → post',
        actions: [{ type: 'post_update', message: '{name} is stuck.' }],
      },
      { ...stuck, ref: 'loud', name: 'Stuck → notify now', startInTestMode: false },
    );
    const rows = (plan: ReturnType<typeof planPackInstall>) =>
      plan.payload!.automations.map((a) => [a.ref, a.enabled, a.mode ?? 'live']);
    const plan = planPackInstall(m, snapshot(), env());
    expect(rows(plan)).toEqual([
      ['stuck', true, 'test'],
      ['hook', false, 'test'],
      ['quiet', true, 'live'],
      ['loud', true, 'live'],
    ]);
    expect(plan.operations.filter((o) => o.kind === 'automation').map((o) => o.note)).toEqual([
      'Installed in test mode.',
      'Installed off.',
      undefined,
      undefined,
    ]);
    // opted in at install: outbound on; sample data (the seed): every automation live
    expect(rows(planPackInstall(m, snapshot(), env(), { allowOutbound: true }))[1]).toEqual([
      'hook',
      true,
      'test',
    ]);
    expect(rows(planPackInstall(m, snapshot(), env(), { live: true })).map((r) => r[2])).toEqual([
      'live',
      'live',
      'live',
      'live',
    ]);
  });

  it('installs a sheet with personal data restricted', () => {
    const m = manifest();
    m.sheets[1]!.personalData = true;
    m.sheets[1]!.fields.push({
      key: 'contact',
      name: 'Contact',
      type: 'text',
      config: { personalData: true },
    });
    const plan = planPackInstall(m, snapshot(), env());
    expect(plan.payload!.sheets.map((x) => x.restricted ?? false)).toEqual([false, true]);
    expect(plan.preview.sheets[1]!.restricted).toBe(true);
  });

  it('marks libraries and documents registers', () => {
    const m = manifest();
    m.sheets[1]!.isLibrary = true;
    const plan = planPackInstall(m, snapshot(), env());
    expect(plan.payload!.sheets[1]!.is_library).toBe(true);
    expect(plan.preview.counts.libraryItems).toBe(1);
  });
});

describe('planPackInstall: sub-items and library links', () => {
  /** The register with corrective actions as sub-items, an automation on them and Annex A links on Acme. */
  const withActions = (): PackManifest => {
    const m = manifest({ frameworks: [{ key: 'iso-27001', version: '2022' }] });
    const reg = m.sheets[0]!;
    reg.fields.push({
      key: 'controls',
      name: 'Controls',
      type: 'requirement',
      config: { multiple: true },
    });
    reg.subitems = {
      label: 'Actions',
      blockClose: true,
      lockCascade: false,
      fields: [
        { key: 'owner', name: 'Owner', type: 'people', config: { multiple: false } },
        { key: 'status', name: 'Status', type: 'status' },
        { key: 'due_date', name: 'Due date', type: 'date' },
      ],
      items: [],
    };
    reg.items[0]!.requirements = {
      controls: ['iso-27001@2022#A.5.19', 'iso-27001@2022#A.5.30', 'iso-27001@2022#A.99'],
    };
    m.automations.push({
      ref: 'action_overdue',
      sheet: 'supplier',
      subitems: true,
      name: 'Action overdue → tell the action owner',
      enabled: true,
      trigger: { type: 'date_arrives', fieldKey: 'due_date', offsetDays: 1 },
      conditions: [{ fieldKey: 'status', op: 'is_not_done' }],
      actions: [{ type: 'notify', to: ['field:owner'], message: '{name} is overdue.' }],
    });
    return m;
  };
  const LIB = 'lib-27001';
  const REQS = {
    'iso-27001@2022#A.5.19': 'req-a519',
    'iso-27001@2022#A.5.30': 'req-a530',
  };

  it("puts an automation on the sheet's sub-items: the child sheet, its fields", () => {
    const plan = planPackInstall(withActions(), snapshot(), env());
    expect(plan.preview.conflicts).toEqual([]);
    const child = plan.payload!.sheets.find((s) => s.ref === 'supplier.subitems')!;
    const parent = plan.payload!.sheets.find((s) => s.ref === 'supplier')!;
    expect(child.parent_sheet_id).toBe(parent.id);
    const a = plan.payload!.automations.find((x) => x.ref === 'action_overdue')!;
    expect(a.sheet_id).toBe(child.id);
    expect(a.enabled).toBe(true);
    // the condition names the sub-items' Status, read from the child sheet
    expect(a.conditions).toEqual([{ fieldKey: 'status', op: 'is_not_done' }]);
    const sentence = plan.preview.automations.find((x) => x.name === a.name)!;
    expect(sentence.sheet).toBe('Supplier register › Actions');
    expect(sentence.sentence).toMatch(/Due date/);
  });

  it('refuses an automation on sub-items of a sheet without them, or naming a parent field', () => {
    const m = withActions();
    m.sheets[0]!.subitems = undefined;
    expect(planPackInstall(m, snapshot(), env()).preview.conflicts.join(' ')).toMatch(
      /has no sub-items/,
    );
    const p = withActions();
    p.automations.at(-1)!.trigger = { type: 'date_arrives', fieldKey: 'reviews', offsetDays: 1 };
    expect(planPackInstall(p, snapshot(), env()).state).toBe('blocked');
  });

  it('links example items to library items by requirement key, and says what the library lacks', () => {
    const plan = planPackInstall(
      withActions(),
      snapshot({
        libraries: [{ library: 'iso-27001@2022', sheetId: LIB }],
        requirementItems: REQS,
      }),
      env(),
    );
    expect(plan.state).toBe('ready');
    const field = plan.payload!.fields.find((f) => f.ref === 'supplier.controls')!;
    const acme = plan.payload!.items.find((i) => i.ref === 'supplier.acme')!;
    expect(plan.payload!.links.filter((l) => l.field_id === field.id)).toEqual([
      { field_id: field.id, from_item: acme.id, to_item: 'req-a519' },
      { field_id: field.id, from_item: acme.id, to_item: 'req-a530' },
    ]);
    expect(plan.preview.warnings).toContain(
      'Supplier register › Acme: the library has no requirement A.99, so it is not linked.',
    );
  });

  it('leaves library links for the install when the library is not adopted yet', () => {
    const plan = planPackInstall(withActions(), snapshot(), env());
    expect(plan.state).toBe('ready');
    const field = plan.payload!.fields.find((f) => f.ref === 'supplier.controls')!;
    expect(plan.payload!.links.some((l) => l.field_id === field.id)).toBe(false);
    expect(plan.preview.warnings.join(' ')).not.toMatch(/no requirement/);
  });
});

describe('semver', () => {
  it('compares and matches ranges', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('0.3.1', '^0.3.0')).toBe(true);
    expect(satisfies('0.4.0', '^0.3.0')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfies('3.0.0', '>=1.2.0')).toBe(true);
    expect(satisfies('9.9.9', '*')).toBe(true);
    expect(satisfies('1.0', '*')).toBe(false);
  });
});

describe('packLogText', () => {
  it('words the install and archive entries', () => {
    expect(
      packLogText('pack.installed', {
        title: 'Suppliers',
        version: '1.0.0',
        counts: { sheets: 2, fields: 5, automations: 1, items: 0 },
      }),
    ).toBe('Installed Suppliers 1.0.0: 2 sheets, 5 fields and 1 automation.');
    expect(
      packLogText('pack.archived', {
        title: 'Suppliers',
        version: '1.0.0',
        counts: { sheets: 2, folders: 1, automations: 1, dashboards: 0 },
      }),
    ).toBe(
      'Archived Suppliers 1.0.0: 2 sheets archived, 1 folder archived, 1 automation turned off. Items and the activity log are kept.',
    );
  });
});
