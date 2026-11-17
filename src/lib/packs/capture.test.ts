import { describe, expect, it } from 'vitest';
import {
  captureManifest,
  leftOutReport,
  suggestVersion,
  type WorkspaceSnapshot,
} from '@/engine/packs/capture';
import { extendsAgainst } from '@/engine/packs/extend';
import { afterInstall, installedStateOf } from '@/engine/packs/installed.fixture';
import { planPackInstall, type InstallPayload } from '@/engine/packs/plan';
import { planPackUpgrade } from '@/engine/packs/upgrade';
import type { Json } from '@/engine/types';
import { core, emptySnapshot, env } from './addon.fixture';
import { parsePack } from './manifest';
import { packQualityProblems } from './quality';

// "Save your setup" end to end without a database (docs/11 Your own packs): a consultant's workspace built on Core
// (Core installed, plus their own sheet, columns and an option added to Core's registers, automations with a webhook
// and named people) is captured as a private pack, checked by the manifest schema and against Core, planned into a
// client workspace that has Core, and a second version is planned as an update that keeps the client's own change.

const ORG = 'a1b2c3d4-0000-4000-8000-000000000000';
const KEY = 'wa1b2c3d4-our-method';
const U1 = 'u0000000-0000-4000-8000-000000000001';
const ROLE = 'r0000000-0000-4000-8000-000000000001';

type Row = Record<string, Json>;
const str = (v: Json | undefined) => (typeof v === 'string' ? v : '');

/** Workspace A: Core installed (as the payload wrote it), then what the consultant built on it. */
function workspaceA(extra?: (s: WorkspaceSnapshot) => void) {
  const coreP = planPackInstall(core, emptySnapshot(), env, { level: 'full' }).payload!;
  const inst = 'inst-core-a';
  const sheetOf = (ref: string) => coreP.sheets.find((s) => s.ref === ref)!;
  const risk = str(sheetOf('risk').id);
  const suppliers = str(sheetOf('suppliers').id);
  const snap: WorkspaceSnapshot = {
    org: { id: ORG, name: 'Practice' },
    installs: [
      { id: inst, packKey: 'core', version: core.version, title: core.title, manifest: core },
    ],
    folders: [
      ...coreP.folders.map((f) => ({
        id: str(f.id),
        name: str(f.name),
        restricted: false,
        packInstallId: inst,
        packRef: str(f.ref),
      })),
      { id: 'fold-own', name: 'Method', restricted: false, packInstallId: null, packRef: null },
    ],
    sheets: [
      ...coreP.sheets.map((s: Row) => ({
        id: str(s.id),
        name: str(s.name),
        description: null,
        itemLabel: str(s.item_label),
        idPrefix: str(s.id_prefix) || null,
        folderId: str(s.folder_id) || null,
        restricted: false,
        isLibrary: false,
        parentSheetId: str(s.parent_sheet_id) || null,
        packInstallId: inst,
        packRef: str(s.ref),
        settings: (s.settings ?? {}) as Json,
      })),
      {
        id: 'sheet-checks',
        name: 'Supplier checks',
        description: 'Our yearly supplier check.',
        itemLabel: 'Check',
        idPrefix: 'CHK-',
        folderId: 'fold-own',
        restricted: false,
        isLibrary: false,
        parentSheetId: null,
        packInstallId: null,
        packRef: null,
        settings: {
          tabs: [{ id: 'table' }, { id: 'view-board' }, { id: 'calendar', hidden: true }],
          defaultViewId: 'view-board',
          workflows: [
            {
              id: 'signoff',
              name: 'Sign-off',
              enabled: true,
              steps: [
                {
                  id: 'lead',
                  name: 'Quality lead',
                  approvers: { kind: 'jobRole', roleId: ROLE, roleName: 'Quality lead' },
                  mode: 'any',
                  onReject: { to: 'draft' },
                },
              ],
              requiredFields: ['rating'],
            },
            {
              id: 'named',
              name: 'Named approver',
              enabled: true,
              steps: [
                {
                  id: 's1',
                  name: 'Ann',
                  approvers: { kind: 'people', userIds: [U1] },
                  mode: 'any',
                  onReject: { to: 'draft' },
                },
              ],
            },
          ],
        },
      },
    ],
    fields: [
      ...coreP.fields.map((f: Row) => ({
        id: str(f.id),
        sheetId: str(f.sheet_id),
        key: str(f.key),
        // the consultant renamed a shipped column: not carried
        name: f.ref === 'risk.owner' ? 'Accountable' : str(f.name),
        type: str(f.type),
        description: null,
        required: !!f.required,
        locked: !!f.locked,
        config:
          f.ref === 'risk.treatment'
            ? {
                ...(f.config as Row),
                options: [
                  ...((f.config as Row).options as Json[]),
                  { id: 'opt-escalate', label: 'Escalate to board', color: 'red' },
                ],
              }
            : ((f.config ?? {}) as Json),
        rules: [],
        visibility: null,
        restrictedTo: null,
        position: str(f.position),
        packInstallId: inst,
      })),
      ...[
        {
          id: 'f-status',
          key: 'status',
          name: 'Status',
          type: 'status',
          config: {
            options: [
              { id: 'open', label: 'Open', color: 'blue' },
              { id: 'done', label: 'Done', color: 'green', done: true },
            ],
          },
        },
        {
          id: 'f-owner',
          key: 'owner',
          name: 'Owner',
          type: 'people',
          config: { multiple: false, default: U1 },
        },
        { id: 'f-rating', key: 'rating', name: 'Rating', type: 'number', config: {} },
        {
          id: 'f-double',
          key: 'double',
          name: 'Double',
          type: 'formula',
          config: { expression: '{rating} * 2' },
        },
        { id: 'f-due', key: 'due', name: 'Next check', type: 'date', config: {} },
        {
          id: 'f-contact',
          key: 'contact',
          name: 'Contact person',
          type: 'text',
          config: { personalData: true },
        },
        {
          id: 'f-supplier',
          key: 'supplier',
          name: 'Supplier',
          type: 'link',
          config: { targetSheetId: suppliers, multiple: false, inverseFieldId: 'f-checks' },
        },
      ].map((f, i) => ({
        ...f,
        config: f.config as Json,
        sheetId: 'sheet-checks',
        description: null,
        required: false,
        locked: false,
        rules: [],
        visibility: null,
        restrictedTo: null,
        position: `a${i}`,
        packInstallId: null,
      })),
      // columns the consultant added to Core's registers
      {
        id: 'f-checks',
        sheetId: suppliers,
        key: 'checks',
        name: 'Checks',
        type: 'link',
        config: { targetSheetId: 'sheet-checks', multiple: true, inverseFieldId: 'f-supplier' },
        description: null,
        required: false,
        locked: false,
        rules: [],
        visibility: null,
        restrictedTo: null,
        position: 'z0',
        packInstallId: null,
      },
      {
        id: 'f-extref',
        sheetId: risk,
        key: 'ext_ref',
        name: 'Client reference',
        type: 'text',
        config: {},
        description: null,
        required: false,
        locked: false,
        rules: [],
        visibility: null,
        restrictedTo: { roles: ['admin'], userIds: [U1] },
        position: 'z1',
        packInstallId: null,
      },
    ],
    groups: [
      ...coreP.groups.map((g: Row) => ({
        id: str(g.id),
        sheetId: str(g.sheet_id),
        name: str(g.name),
        color: str(g.color),
        position: str(g.position),
        packInstallId: inst,
        packRef: str(g.ref),
      })),
      {
        id: 'g-open',
        sheetId: 'sheet-checks',
        name: 'Open',
        color: 'blue',
        position: 'a0',
        packInstallId: null,
        packRef: null,
      },
      {
        id: 'g-done',
        sheetId: 'sheet-checks',
        name: 'Done',
        color: 'green',
        position: 'a1',
        packInstallId: null,
        packRef: null,
      },
      {
        id: 'g-watch',
        sheetId: risk,
        name: 'Watch list',
        color: 'orange',
        position: 'z0',
        packInstallId: null,
        packRef: null,
      },
    ],
    views: [
      ...coreP.views.map((v: Row) => ({
        id: str(v.id),
        sheetId: str(v.sheet_id),
        name: str(v.name),
        type: str(v.type),
        config: (v.config ?? {}) as Json,
        position: str(v.position),
        ownerId: null,
        packInstallId: inst,
        packRef: str(v.ref),
      })),
      {
        id: 'view-board',
        sheetId: 'sheet-checks',
        name: 'By status',
        type: 'kanban',
        config: { filters: [], sort: [], hidden: [], labelFieldKey: 'status' },
        position: 'a0',
        ownerId: null,
        packInstallId: null,
        packRef: null,
      },
      {
        id: 'view-mine',
        sheetId: 'sheet-checks',
        name: 'Mine',
        type: 'list',
        config: {
          filters: [{ fieldKey: 'owner', op: 'any_of', value: [U1] }],
          sort: [],
          hidden: [],
        },
        position: 'a1',
        ownerId: null,
        packInstallId: null,
        packRef: null,
      },
      {
        id: 'view-personal',
        sheetId: 'sheet-checks',
        name: 'My own',
        type: 'list',
        config: { filters: [], sort: [], hidden: [] },
        position: 'a2',
        ownerId: U1,
        packInstallId: null,
        packRef: null,
      },
      {
        id: 'view-form',
        sheetId: 'sheet-checks',
        name: 'Report a check',
        type: 'form',
        config: {
          filters: [],
          sort: [],
          hidden: [],
          form: {
            status: 'open',
            access: 'internal',
            fields: [{ key: 'rating' }, { key: 'due' }],
            notify: [U1],
            groupId: 'g-open',
          },
        },
        position: 'a3',
        ownerId: null,
        packInstallId: null,
        packRef: null,
      },
      {
        id: 'view-risk',
        sheetId: risk,
        name: 'Client view',
        type: 'list',
        config: {
          filters: [{ fieldKey: 'ext_ref', op: 'is_not_empty' }],
          sort: [],
          hidden: ['ext_ref'],
        },
        position: 'z0',
        ownerId: null,
        packInstallId: null,
        packRef: null,
      },
    ],
    automations: [
      {
        id: 'auto-escalate',
        sheetId: 'sheet-checks',
        name: 'Escalate a failed check',
        enabled: true,
        trigger: { type: 'field_changed', fieldKey: 'status' },
        conditions: [{ fieldKey: 'rating', op: 'lt', value: 3 }],
        actions: [
          {
            type: 'notify',
            to: [`user:${U1}`, `jobRole:${ROLE}`, 'field:owner'],
            message: '{name} failed ({double}).',
          },
          { type: 'webhook', url: 'https://hooks.example.com/abc', preset: 'generic' },
        ],
      },
      {
        id: 'auto-risk',
        sheetId: risk,
        name: 'New client risk',
        enabled: true,
        trigger: { type: 'item_created' },
        conditions: [{ fieldKey: 'ext_ref', op: 'is_not_empty' }],
        actions: [
          { type: 'notify', to: [`user:${U1}`], message: 'New risk {ext_ref}.' },
          { type: 'post_update', message: 'Client risk {ext_ref} logged.' },
        ],
      },
    ].map((a) => ({
      ...a,
      trigger: a.trigger as Json,
      conditions: a.conditions as Json,
      actions: a.actions as Json,
      packInstallId: null,
    })),
    dashboards: [
      {
        id: 'dash-1',
        name: 'Method overview',
        position: 'a0',
        packInstallId: null,
        config: {
          widgets: [{ id: 'w1', type: 'count', title: 'Open checks', sheetId: 'sheet-checks' }],
        },
      },
    ],
    jobRoles: [{ id: ROLE, name: 'Quality lead' }],
    teams: [],
    memberIds: [U1],
    ownFrameworks: [],
  };
  extra?.(snap);
  return { snap, coreP, risk, suppliers };
}

const opts = {
  key: KEY,
  version: '1.0.0',
  title: 'Our method',
  description: 'How we run supplier checks.',
  excluded: [],
};

describe('captureManifest on a workspace built on Core', () => {
  const { snap } = workspaceA();
  const cap = captureManifest(snap, opts);
  const m = parsePack(cap.manifest);

  it('passes the manifest schema and the checks against Core', () => {
    expect(extendsAgainst(m, core)).toEqual([]);
    expect(m.requires).toEqual([{ pack: 'core', range: `^${core.version}` }]);
  });

  it('makes the own sheet the pack sheet with stable refs, tabs, a form draft and the kept workflow', () => {
    const s = m.sheets.find((x) => x.name === 'Supplier checks')!;
    expect(s.ref).toMatch(/^s_[0-9a-f]{10}$/);
    expect(s.items).toEqual([]);
    expect(s.personalData).toBe(true);
    expect(s.fields.find((f) => f.key === 'supplier')!.config).toMatchObject({
      targetSheetRef: 'core:suppliers',
      inverseKey: 'wa1b2c3d4ourmethod_checks',
    });
    expect(s.fields.find((f) => f.key === 'owner')!.config).not.toHaveProperty('default');
    expect(s.tabs?.map((t) => t.ref)).toEqual(['table', 'By status', 'calendar']);
    expect(s.defaultView).toBe('By status');
    expect(s.views.map((v) => v.name)).toEqual(['By status', 'Mine']);
    expect(s.views[1]!.config).toMatchObject({ filters: [] });
    expect(s.forms).toHaveLength(1);
    expect(s.forms[0]!.groupRef).toMatch(/^g_/);
    expect(s.workflows?.map((w) => w.id)).toEqual(['signoff']);
    expect(s.workflows?.[0]!.steps[0]!.approvers).toEqual({
      kind: 'jobRole',
      roleName: 'Quality lead',
    });
    expect(captureManifest(snap, opts).manifest.sheets[0]!.ref).toBe(s.ref);
  });

  it('adds what was built on Core as extends, namespaced, with every reference rewritten', () => {
    const risk = m.extends!.find((e) => e.sheet === 'risk')!;
    expect(risk.fields!.map((f) => f.key)).toEqual(['wa1b2c3d4ourmethod_ext_ref']);
    expect(risk.groups!.map((g) => g.name)).toEqual(['Watch list']);
    expect(risk.options!.treatment!.map((o) => o.label)).toEqual(['Escalate to board']);
    expect(risk.views![0]!.config).toMatchObject({
      filters: [{ fieldKey: 'wa1b2c3d4ourmethod_ext_ref' }],
      hidden: ['wa1b2c3d4ourmethod_ext_ref'],
    });
    const auto = risk.automations![0]!;
    expect(auto.conditions[0]!.fieldKey).toBe('wa1b2c3d4ourmethod_ext_ref');
    // the notification told only a named person: it goes, and the automation installs off
    expect(auto.actions).toEqual([
      { type: 'post_update', message: 'Client risk {wa1b2c3d4ourmethod_ext_ref} logged.' },
    ]);
    expect(auto.enabled).toBe(false);
    expect(m.extends!.find((e) => e.sheet === 'suppliers')!.fields![0]!.config).toMatchObject({
      inverseKey: 'supplier',
    });
  });

  it('never copies people or webhook addresses, and every automation starts in test mode', () => {
    const json = JSON.stringify(m);
    expect(json).not.toContain(U1);
    expect(json).not.toContain('hooks.example.com');
    expect(json).not.toContain(ROLE);
    const a = m.automations.find((x) => x.name === 'Escalate a failed check')!;
    expect(a.actions).toEqual([
      {
        type: 'notify',
        to: ['jobRole:Quality lead', 'field:owner'],
        message: '{name} failed ({double}).',
      },
    ]);
    expect(
      [...m.automations, ...m.extends!.flatMap((e) => e.automations ?? [])].every(
        (x) => x.startInTestMode,
      ),
    ).toBe(true);
    expect(m.dashboards[0]!.widgets[0]!.sheetRef).toBe(m.sheets[0]!.ref);
  });

  it('reports what was left out', () => {
    const report = leftOutReport(cap.leftOut);
    const text = report.map((g) => `${g.heading}: ${g.lines.join(' | ')}`).join('\n');
    expect(report.map((g) => g.kind)).toEqual([
      'items',
      'webhook',
      'people',
      'restricted',
      'shipped',
    ]);
    expect(text).toContain('The webhook to hooks.example.com is left out');
    expect(text).toContain('Named approver: Its approvers are named people');
    expect(text).toContain('Renamed from "Risk owner"');
    expect(text).toContain('Client reference: Who may see this restricted column is not carried');
    expect(text).toContain('example items come later');
  });

  it('leaves out a sheet the person unticks, and what needs it', () => {
    const sheetPart = cap.parts.find((p) => p.kind === 'sheet')!;
    const less = captureManifest(snap, { ...opts, excluded: [sheetPart.id] });
    expect(less.excluded).toContain(sheetPart.id);
    expect(less.manifest.sheets).toEqual([]);
    expect(less.manifest.automations).toEqual([]);
    expect(less.manifest.dashboards).toEqual([]);
    // the Checks column on Core's Suppliers links to the sheet left out
    expect(less.manifest.extends!.some((e) => e.sheet === 'suppliers')).toBe(false);
    expect(() => parsePack(less.manifest)).not.toThrow();
  });

  it('shows the quality bar as advice only', () => {
    expect(packQualityProblems(m).length).toBeGreaterThan(0);
  });

  it('installs into a client workspace that has Core', () => {
    const coreB = planPackInstall(core, emptySnapshot({ orgId: 'org-b' }), env, {
      level: 'full',
    }).payload!;
    const snapB = afterInstall(emptySnapshot({ orgId: 'org-b' }), coreB, 'inst-core-b');
    const plan = planPackInstall(m, snapB, { ...env, hash: 'h1' }, {});
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    const p = plan.payload!;
    expect(p.automations.every((a) => a.mode === 'test' || a.enabled === false)).toBe(true);
    expect(p.sheets.find((s) => s.name === 'Supplier checks')).toBeTruthy();
  });

  it('suggests the next version from the difference, and the update keeps the client’s own change', () => {
    const { snap: snap2 } = workspaceA((s) => {
      s.fields.push({
        id: 'f-evidence',
        sheetId: 'sheet-checks',
        key: 'evidence',
        name: 'Evidence',
        type: 'longtext',
        config: {},
        description: null,
        required: false,
        locked: false,
        rules: [],
        visibility: null,
        restrictedTo: null,
        position: 'b0',
        packInstallId: null,
      });
      const sh = s.sheets.find((x) => x.id === 'sheet-checks')!;
      sh.description = 'Our yearly supplier check, with evidence.';
    });
    const m2 = parsePack(captureManifest(snap2, { ...opts, version: '1.1.0' }).manifest);
    expect(suggestVersion({ version: '1.0.0', manifest: m }, m2)).toMatchObject({
      version: '1.1.0',
      kind: 'minor',
    });
    expect(
      suggestVersion({ version: '1.0.0', manifest: m }, { ...m, version: '1.0.1' }),
    ).toMatchObject({ kind: 'same' });
    const reworded = { ...m, sheets: m.sheets.map((s) => ({ ...s, description: 'New words.' })) };
    expect(suggestVersion({ version: '1.0.0', manifest: m }, reworded)).toMatchObject({
      version: '1.0.1',
      kind: 'patch',
    });

    const coreB = planPackInstall(core, emptySnapshot({ orgId: 'org-b' }), env, {
      level: 'full',
    }).payload!;
    const withCore = afterInstall(emptySnapshot({ orgId: 'org-b' }), coreB, 'inst-core-b');
    const mine = planPackInstall(m, withCore, { ...env, hash: 'h1' }, {})
      .payload! as InstallPayload;
    const all = afterInstall(withCore, mine, 'inst-mine');
    for (const f of Object.values(all.foreign ?? {}))
      for (const x of f.fields)
        if (mine.fields.some((y) => y.id === x.id)) x.installId = 'inst-mine';
    const state = installedStateOf(mine, 'inst-mine');
    // the client renamed the sheet
    const sheet = state.sheets.find((s) => s.name === 'Supplier checks')!;
    sheet.name = 'Vendor checks';
    const up = planPackUpgrade({
      from: { manifest: m, hash: 'h1' },
      to: { manifest: m2, hash: 'h2' },
      state,
      snapshot: { ...all, installs: all.installs.filter((i) => i.id !== 'inst-mine') },
      env,
    });
    expect(up.preview.blockers).toEqual([]);
    expect(up.state).toBe('ready');
    expect(up.payload!.add.fields.map((f) => f.key)).toEqual(['evidence']);
    // the description is the pack's change; the name stays the client's
    expect(up.payload!.update.sheets).toEqual([
      expect.objectContaining({ description: 'Our yearly supplier check, with evidence.' }),
    ]);
    expect(up.payload!.update.sheets[0]).not.toHaveProperty('name');
  });
});
