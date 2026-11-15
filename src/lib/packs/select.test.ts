import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoPacks } from './catalogue';
import { parsePack } from './manifest';
import { packLogText } from '@/engine/packs/audit';
import { afterInstall } from '@/engine/packs/installed.fixture';
import { manifestAtLevel } from '@/engine/packs/levels';
import { manifestFor } from '@/engine/packs/optional';
import { planPackInstall, type PackSnapshot } from '@/engine/packs/plan';
import {
  appsAfter,
  bundleParts,
  canChooseFolder,
  closeExclusions,
  selectionCounts,
  selectManifest,
  togglePart,
} from '@/engine/packs/select';
import type { PackManifest } from '@/engine/packs/types';

const pack = (key: string) => repoPacks().find((p) => p.key === key)!;
// CAPA as Create shows it in a workspace without the Core registers (docs/11 Optional requirements)
const capaAlone = () => manifestFor(pack('start-capa'), []);
/** Supplier management 1.1.0, a standalone pack with a documents register, a library and a public form. */
const standalone = () =>
  parsePack(
    JSON.parse(
      readFileSync(new URL('./fixtures/supplier-management-1.1.0.json', import.meta.url), 'utf8'),
    ),
  );

const snapshot: PackSnapshot = {
  orgId: 'org-1',
  prefixes: [],
  folders: [{ id: 'f-ops', name: 'Operations', archived: false }],
  installs: [],
  members: [],
  jobRoles: [],
  teams: [],
  lastSheetPosition: null,
  lastFolderPosition: null,
  lastDashboardPosition: null,
};
const env = {
  today: '2026-11-14',
  now: new Date('2026-11-14T09:00:00Z'),
  timeZone: 'Europe/London',
  newId: randomUUID,
  hash: 'h'.repeat(64),
  userId: 'u-1',
};

describe('bundle parts', () => {
  it('lists sheets, forms, automations and dashboards with what they need', () => {
    const parts = bundleParts(standalone());
    const byId = new Map(parts.map((p) => [p.id, p]));
    expect(parts.filter((p) => p.kind === 'sheet')).not.toHaveLength(0);
    expect(byId.get('sheet:supplier')!.requires).toEqual(
      expect.arrayContaining(['sheet:review', 'sheet:requirement', 'sheet:document']),
    );
    expect(byId.get('automation:review_failed')!.requires).toEqual(['sheet:review']);
    expect(byId.get('dashboard:overview')!.requires).toContain('sheet:supplier');
    const form = byId.get('form:supplier.self_assessment')!;
    expect(form.flags.map((f) => f.kind)).toEqual(['public_form']);
    expect(form.requires).toEqual(['sheet:supplier']);
  });

  it('makes a form trigger depend on its form', () => {
    const parts = bundleParts(capaAlone());
    const auto = parts.find((p) => p.id === 'automation:reported_add_steps')!;
    expect(auto.requires).toEqual(['sheet:capa', 'form:capa.nonconformity']);
  });

  it('flags and turns off automations that send data out', () => {
    const m: PackManifest = {
      ...capaAlone(),
      automations: [
        {
          ref: 'hook',
          sheet: 'capa',
          name: 'Tell the ticket system',
          enabled: true,
          trigger: { type: 'item_created' },
          conditions: [],
          actions: [{ type: 'webhook', url: 'https://example.com/hook' }],
        },
      ],
    };
    const part = bundleParts(m).find((p) => p.id === 'automation:hook')!;
    expect(part.flags[0]!.kind).toBe('outbound');
    expect(part.detail).toBe('Created off');
    expect(selectManifest(m, []).automations[0]!.enabled).toBe(false);
  });
});

describe('ticking and unticking', () => {
  const parts = bundleParts(capaAlone());

  it('unticking a sheet leaves out what is on it, with a note', () => {
    const s = togglePart(parts, [], 'sheet:capa', false);
    expect(new Set(s.excluded)).toEqual(new Set(parts.map((p) => p.id)));
    expect(s.note).toMatch(/^Also leaves out 1 form, 1 automation and 1 dashboard that need/);
  });

  it('unticking a form leaves out the automation it starts', () => {
    const s = togglePart(parts, [], 'form:capa.nonconformity', false);
    expect(s.excluded).toEqual(['form:capa.nonconformity', 'automation:reported_add_steps']);
    expect(s.note).toContain('Problem reported');
  });

  it('ticking brings back what a part needs', () => {
    const off = togglePart(parts, [], 'sheet:capa', false).excluded;
    const s = togglePart(parts, off, 'automation:reported_add_steps', true);
    expect(s.excluded).toEqual(['dashboard:capa_overview']);
    expect(s.note).toMatch(/^Also adds back 1 sheet and 1 form/);
  });

  it('closes what the browser sent over dependents and ignores unknown ids', () => {
    expect([...closeExclusions(parts, ['form:capa.nonconformity', 'sheet:nope'])]).toEqual([
      'form:capa.nonconformity',
      'automation:reported_add_steps',
    ]);
  });

  it('counts what is left', () => {
    expect(selectionCounts(parts, ['dashboard:capa_overview'])).toMatchObject({
      sheets: 1,
      forms: 1,
      automations: 1,
      dashboards: 0,
    });
  });
});

describe('the chosen manifest', () => {
  it('plans without the parts left out', () => {
    const m = selectManifest(standalone(), ['dashboard:overview', 'automation:review_due']);
    const plan = planPackInstall(m, snapshot, env);
    expect(plan.state).toBe('ready');
    expect(plan.payload!.dashboards).toHaveLength(0);
    const refs = plan.payload!.automations.map((a) => a.ref);
    expect(refs).toContain('review_failed');
    expect(refs).not.toContain('review_due');
  });

  it('drops folders nobody uses and applies a folder choice', () => {
    const m = pack('start-incident');
    expect(selectManifest(m, ['sheet:incident']).folders).toEqual([]);
    const none = selectManifest(m, [], { mode: 'none' });
    expect(none.folders).toEqual([]);
    expect(none.sheets[0]!.folder).toBeUndefined();
    const chosen = selectManifest(m, [], { mode: 'folder', name: 'Operations' });
    expect(chosen.folders).toEqual([{ ref: 'chosen_folder', name: 'Operations' }]);
    const plan = planPackInstall(chosen, snapshot, env);
    expect(plan.preview.folders).toEqual([{ name: 'Operations', action: 'reuse' }]);
  });

  it('keeps a pack with a restricted folder in its own folders', () => {
    const m: PackManifest = {
      ...pack('start-incident'),
      folders: [{ ref: 'audit_and_capa', name: 'Audit and CAPA', restricted: true }],
    };
    expect(canChooseFolder(m)).toBe(false);
    expect(selectManifest(m, [], { mode: 'none' }).folders).toHaveLength(1);
  });

  it('drops setup steps on a left-out sheet and counts the app screens that stay', () => {
    const iso = manifestAtLevel(pack('iso-27001'), 'full');
    const sheet = iso.sheets.find((s) =>
      iso.setup?.steps.some((st) => st.target.sheetRef === s.ref),
    )!;
    const chosen = selectManifest(iso, [`sheet:${sheet.ref}`]);
    expect(chosen.setup!.steps.every((st) => st.target.sheetRef !== sheet.ref)).toBe(true);
    const capa = capaAlone();
    expect(appsAfter(capa, [])).toEqual([{ title: 'CAPA', screens: 6 }]);
    expect(appsAfter(capa, ['dashboard:capa_overview'])).toEqual([{ title: 'CAPA', screens: 5 }]);
    expect(appsAfter(capa, ['sheet:capa'])).toEqual([]);
  });

  it('counts an add-on app’s screens over the Core registers (they read Core’s install)', () => {
    const iso = pack('iso-27001');
    const app = iso.apps!.find((a) => a.key === 'isms-capa')!;
    const all = app.sections.flatMap((s) => s.screens).length;
    expect(appsAfter(iso, [])).toEqual([{ title: app.title, screens: all }]);
    // leaving out its own dashboard hides only that screen
    const dash = app.sections.flatMap((s) => s.screens).find((s) => s.kind === 'dashboard') as {
      dashboard: string;
    };
    expect(appsAfter(iso, [`dashboard:${dash.dashboard}`])).toEqual([
      { title: app.title, screens: all - 1 },
    ]);
  });
});

describe('Supplier management 3.0.0 from Create (an add-on on Core’s Suppliers)', () => {
  const m = () => pack('supplier-management');
  const core = pack('core');
  const onCore = () => {
    const corePlan = planPackInstall(core, { ...snapshot, folders: [] }, env, {
      level: 'starter',
    });
    return afterInstall({ ...snapshot, folders: [] }, corePlan.payload!, 'inst-core');
  };

  it('offers the whole add-on with its setup on Core’s Suppliers', () => {
    const chosen = parsePack(selectManifest(m(), []));
    expect(chosen.version).toBe('3.1.0');
    expect(chosen.setup!.steps.map((s) => s.ref)).toEqual([
      'suppliers',
      'requirements',
      'checks',
      'approve',
    ]);
    expect(planPackInstall(chosen, onCore(), env).state).toBe('ready');
  });

  it('leaving the checks out leaves out what needs them on Core’s Suppliers too', () => {
    const ex = closeExclusions(bundleParts(m()), ['sheet:check']);
    expect([...ex]).toEqual(expect.arrayContaining(['sheet:check', 'sheet:requirement']));
    const chosen = parsePack(selectManifest(m(), ['sheet:check']));
    const suppliers = chosen.extends!.find((e) => e.sheet === 'suppliers')!;
    const keys = suppliers.fields!.map((f) => f.key);
    for (const k of [
      'suppliermanagement_checks',
      'suppliermanagement_met',
      'suppliermanagement_pct_met',
      'suppliermanagement_worst',
      'suppliermanagement_expired',
      'suppliermanagement_extra',
    ])
      expect(keys).not.toContain(k);
    expect(keys).toContain('suppliermanagement_category');
    // no sync left to run, no view sorted by a column that is gone
    expect(
      suppliers.automations!.some((a) =>
        a.actions.some((x) => x.type === 'sync_requirement_checks'),
      ),
    ).toBe(false);
    expect(suppliers.views ?? []).toEqual([]);
    expect(chosen.setup!.steps.map((s) => s.ref)).toEqual(['suppliers', 'approve']);
    const plan = planPackInstall(chosen, onCore(), env);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
  });
});

describe('bundle entries of the activity log', () => {
  it('reads as sentences', () => {
    const v = { name: 'Customer complaints', title: 'Corrective action (CAPA)', version: '1.1.0' };
    expect(packLogText('bundle.created', v)).toBe(
      'Created Customer complaints via Create from Corrective action (CAPA) 1.1.0.',
    );
    expect(packLogText('bundle.reviewed', v)).toBe('Marked Customer complaints reviewed.');
  });
});
