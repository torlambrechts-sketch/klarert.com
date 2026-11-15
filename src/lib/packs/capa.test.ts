import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveApps, type AppInstall } from '@/engine/apps/resolve';
import type { AppScreen } from '@/engine/apps/types';
import { appStarts } from '@/engine/create/apps';
import { neededLevel } from '@/engine/packs/extend';
import { afterInstall, installedStateOf, refMapOf } from '@/engine/packs/installed.fixture';
import {
  installCase,
  liveOptional,
  manifestFor,
  packCases,
  workspaceCase,
} from '@/engine/packs/optional';
import { planPackInstall } from '@/engine/packs/plan';
import { appNeeds, bundleParts } from '@/engine/packs/select';
import { planPackUpgrade } from '@/engine/packs/upgrade';
import type { PackManifest } from '@/engine/packs/types';
import { appProblems } from '@/lib/apps/manifest';
import { core, emptySnapshot, env, packByKey } from './addon.fixture';
import { parsePack } from './manifest';

// CAPA reuses Core's register (owner decision 15 Nov 2026, docs/11 Optional requirements): start-capa 1.2.0 has an
// optional requirement on the Core registers. With Core live it makes no register of its own: its app, form and
// overview work on Core's Nonconformities and CAPA (and Actions). Without Core it keeps its own register, as 1.1.0 did.

const capa = packByKey('start-capa');
const target = (x: AppScreen) => (x.kind === 'dashboard' ? x.dashboard : x.sheet);
const archived = (key: string, version: string): PackManifest =>
  parsePack(
    JSON.parse(
      readFileSync(
        join(process.cwd(), `tests/e2e/fixtures/catalogue/${key}@${version}.json`),
        'utf8',
      ),
    ) as unknown,
  );

/** Core at Starter (Nonconformities and CAPA, Actions), installed as `inst-core`. */
function withCore(level = 'starter') {
  const p = planPackInstall(core, emptySnapshot(), env, { level }).payload!;
  return { payload: p, snap: afterInstall(emptySnapshot(), p, 'inst-core') };
}

describe('start-capa 1.2.0: one pack, two cases', () => {
  it('declares Core as an optional requirement and its own register as made only without it', () => {
    expect(capa.version).toBe('1.2.0');
    expect(capa.requires).toEqual([{ pack: 'core', range: '^1.1.0', optional: true }]);
    expect(capa.sheets.map((s) => [s.ref, s.onlyWithout])).toEqual([['capa', 'core']]);
    expect(packCases(capa)).toEqual([[], ['core']]);
    // the same app key in each case
    expect(capa.apps!.map((a) => a.key)).toEqual(['capa', 'capa']);
  });

  it('without Core: its own register, form, steps automation and overview, and nothing that names Core', () => {
    const m = manifestFor(capa, []);
    expect(m.requires).toEqual([]);
    expect(m.sheets.map((s) => s.ref)).toEqual(['capa']);
    expect(m.folders.map((f) => f.name)).toEqual(['Audit and CAPA']);
    expect(m.automations.map((a) => a.ref)).toEqual(['reported_add_steps']);
    expect(m.dashboards.map((d) => d.ref)).toEqual(['capa_overview']);
    expect(m.extends).toBeUndefined();
    expect(m.apps!.map((a) => a.sections.flatMap((s) => s.screens.map((x) => target(x))))).toEqual([
      ['capa', 'capa', 'capa', 'capa', 'capa_overview', 'capa'],
    ]);
    // exactly what 1.1.0 was, but the version
    const old = archived('start-capa', '1.1.0');
    expect({ ...m, version: old.version }).toEqual(old);
  });

  it('with Core: no register of its own; the app, the form and the overview are on Core’s registers', () => {
    const m = manifestFor(capa, ['core']);
    expect(m.requires).toEqual([{ pack: 'core', range: '^1.1.0' }]);
    expect(m.sheets).toEqual([]);
    expect(m.folders).toEqual([]);
    expect(m.automations).toEqual([]);
    expect(m.dashboards.map((d) => [d.ref, d.name])).toEqual([
      ['capa_core_overview', 'CAPA overview'],
    ]);
    expect(m.dashboards[0]!.widgets.every((w) => w.sheetRef?.startsWith('core:'))).toBe(true);
    expect(m.extends!.map((e) => [e.sheet, (e.forms ?? []).map((f) => f.ref)])).toEqual([
      ['nc', ['startcapa_report']],
      ['actions', []],
    ]);
    const app = m.apps!.find((a) => a.key === 'capa')!;
    expect(m.apps).toHaveLength(1);
    expect(app.sections.flatMap((s) => s.screens.map((x) => [x.key, target(x)]))).toEqual([
      ['report', 'core:nc'],
      ['my-actions', 'core:actions'],
      ['approvals', 'core:nc'],
      ['all', 'core:nc'],
      ['overview', 'capa_core_overview'],
      ['workflow', 'core:nc'],
    ]);
    // every field the screens name is a Core column
    expect(appProblems(app, m, [core])).toEqual([]);
    // Core at Starter has both registers
    expect(neededLevel(m, core)).toBe('starter');
  });

  it('the case comes from the workspace: Core live (any version) means Core’s register', () => {
    expect(liveOptional(capa, [])).toEqual([]);
    expect(liveOptional(capa, [{ packKey: 'core' }])).toEqual(['core']);
    expect(liveOptional(capa, [{ packKey: 'core', status: 'archived' }])).toEqual([]);
    // a live install keeps the case it was made in, whatever is live now
    expect(installCase(capa, { 'sheet:capa': 's1' })).toEqual([]);
    expect(installCase(capa, { 'dashboard:capa_core_overview': 'd1' })).toEqual(['core']);
    expect(
      workspaceCase(capa, [
        { packKey: 'core' },
        { packKey: 'start-capa', refMap: { 'sheet:capa': 's1' } },
      ]),
    ).toEqual([]);
  });

  it('every other pack has no optional requirement: manifestFor leaves it as it is', () => {
    for (const key of ['core', 'iso-27001', 'supplier-management', 'start-documents'])
      expect(manifestFor(packByKey(key), ['core'])).toBe(packByKey(key));
  });
});

describe('installing start-capa', () => {
  it('in a workspace without Core: plans its own register and never installs Core', () => {
    const plan = planPackInstall(capa, emptySnapshot(), env);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    expect(plan.preview.sheets.map((s) => s.name)).toEqual(['Corrective action (CAPA)']);
    expect(plan.preview.installsFirst).toEqual([]);
    expect(installCase(capa, refMapOf(plan.payload!))).toEqual([]);
  });

  it('in a Core workspace: no second register; the form goes on Core’s Nonconformities and CAPA', () => {
    const { snap } = withCore();
    const plan = planPackInstall(capa, snap, env);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    const p = plan.payload!;
    expect(p.sheets).toEqual([]);
    expect(p.fields).toEqual([]);
    expect(p.folders).toEqual([]);
    expect(p.automations).toEqual([]);
    expect(p.dashboards.map((d) => d.ref)).toEqual(['capa_core_overview']);
    const ncId = snap.foreign!['core:nc']!.sheetId;
    const form = p.views.find((v) => v.ref === 'core:nc.form.startcapa_report')!;
    expect(form.sheet_id).toBe(ncId);
    // the overview reads Core's registers
    const widgets = (p.dashboards[0]!.config as { widgets: { sheetId?: string }[] }).widgets;
    expect(widgets.map((w) => w.sheetId)).toContain(ncId);
    expect(widgets.map((w) => w.sheetId)).toContain(snap.foreign!['core:actions']!.sheetId);
    // the install says which case it was made in
    expect(installCase(capa, refMapOf(p))).toEqual(['core']);
  });

  it('with Core at a version out of range: blocked with a reason, never a second register', () => {
    const { snap } = withCore();
    const old = {
      ...snap,
      installs: snap.installs.map((i) => (i.packKey === 'core' ? { ...i, version: '1.0.0' } : i)),
    };
    const plan = planPackInstall(capa, old, env);
    expect(plan.state).toBe('blocked');
    expect(plan.preview.conflicts).toContain(
      'The pack "core" is at 1.0.0; this pack needs ^1.1.0.',
    );
  });

  it('Create’s parts in a Core workspace: one dashboard, and the app’s six screens stay', () => {
    const m = manifestFor(capa, ['core']);
    expect(bundleParts(m).map((p) => p.id)).toEqual(['dashboard:capa_core_overview']);
    expect(appNeeds(m)).toEqual([
      {
        key: 'capa',
        title: 'CAPA',
        screens: [[], [], [], [], ['dashboard:capa_core_overview'], []],
      },
    ]);
  });
});

describe('the CAPA app on Core', () => {
  it('resolves through Core’s install and its own: Core’s registers, its form and its overview', () => {
    const { payload: coreP, snap } = withCore();
    const p = planPackInstall(capa, snap, env).payload!;
    const coreMap = refMapOf(coreP);
    const refMap = refMapOf(p);
    const m = manifestFor(capa, installCase(capa, refMap));
    const install: AppInstall = {
      id: 'inst-capa',
      packKey: 'start-capa',
      refMap,
      apps: m.apps!,
      pack: {
        sheets: (m.extends ?? []).map((e) => ({
          ref: `${e.pack}:${e.sheet}`,
          views: e.views ?? [],
        })),
      },
      required: { core: coreMap },
    };
    const [app] = resolveApps([install], 'owner');
    const screens = app!.sections.flatMap((s) => s.screens);
    expect(screens.map((s) => s.key)).toEqual([
      'report',
      'my-actions',
      'approvals',
      'all',
      'overview',
      'workflow',
    ]);
    expect(screens.find((s) => s.key === 'all')!.sheetId).toBe(coreMap['sheet:nc']);
    expect(screens.find((s) => s.key === 'my-actions')!.sheetId).toBe(coreMap['sheet:actions']);
    expect(screens.find((s) => s.key === 'report')!.viewId).toBe(
      refMap['view:core:nc.form.startcapa_report'],
    );
    expect(screens.find((s) => s.key === 'overview')!.dashboardId).toBe(
      refMap['dashboard:capa_core_overview'],
    );
  });

  it('an install made without Core keeps its own screens when Core arrives later', () => {
    const own = planPackInstall(capa, emptySnapshot(), env).payload!;
    const refMap = refMapOf(own);
    const m = manifestFor(capa, installCase(capa, refMap));
    const [app] = resolveApps(
      [
        {
          id: 'inst-capa',
          packKey: 'start-capa',
          refMap,
          apps: m.apps!,
          pack: { sheets: m.sheets.map((s) => ({ ref: s.ref, views: s.views })) },
          required: {},
        },
      ],
      'owner',
    );
    expect(app!.sections.flatMap((s) => s.screens).every((s) => s.sheetId !== 'core')).toBe(true);
    expect(app!.sections.flatMap((s) => s.screens.map((x) => x.sheetId ?? x.dashboardId))).toEqual([
      refMap['sheet:capa'],
      refMap['sheet:capa.subitems'],
      refMap['sheet:capa'],
      refMap['sheet:capa'],
      refMap['dashboard:capa_overview'],
      refMap['sheet:capa'],
    ]);
  });

  it('Create › App in a Core workspace: CAPA is new and uses Core’s registers', () => {
    const catalogue = [
      { key: 'core', version: core.version, title: core.title, manifest: core },
      {
        key: 'start-capa',
        version: capa.version,
        title: capa.title,
        manifest: manifestFor(capa, ['core']),
      },
    ];
    const [start] = appStarts({
      catalogue,
      installs: [{ packKey: 'core', version: core.version }],
      resolved: [],
      role: 'owner',
    }).filter((a) => a.key === 'capa');
    expect(start!.state).toBe('new');
    expect(start!.packKey).toBe('start-capa');
    expect(start!.uses).toEqual([
      'Nonconformities and CAPA (Core registers)',
      'Actions (Core registers)',
    ]);
    expect(start!.sections[1]!.screens.map((s) => s.reads)).toEqual([
      'Nonconformities and CAPA',
      'CAPA overview',
      'Nonconformities and CAPA',
    ]);
  });
});

describe('updating start-capa 1.1.0 → 1.2.0', () => {
  const from = archived('start-capa', '1.1.0');

  function update(snapBefore: ReturnType<typeof emptySnapshot>) {
    const p = planPackInstall(from, snapBefore, env).payload!;
    const after = afterInstall(snapBefore, p, 'inst-capa');
    return planPackUpgrade({
      from: { manifest: from, hash: 'h-from' },
      to: { manifest: capa, hash: 'h-to' },
      state: installedStateOf(p, 'inst-capa'),
      snapshot: { ...after, installs: after.installs.filter((i) => i.id !== 'inst-capa') },
      env,
    });
  }

  it('without Core: a same-major update with nothing to change', () => {
    const plan = update(emptySnapshot());
    expect(plan.preview.blockers).toEqual([]);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.preview.added).toEqual([]);
    expect(plan.preview.changed).toEqual([]);
    expect(plan.preview.archived).toEqual([]);
    expect(plan.state).toBe('ready');
  });

  it('with Core installed later: the update keeps its own register (nothing is moved or archived)', () => {
    const plan = update(withCore().snap);
    expect(plan.preview.blockers).toEqual([]);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.preview.added).toEqual([]);
    expect(plan.preview.archived).toEqual([]);
  });
});

describe('optional requirements in the manifest (docs/11)', () => {
  const raw = () => JSON.parse(JSON.stringify(capa)) as PackManifest;

  it('an optional requirement needs a sheet made only without it', () => {
    const m = raw();
    delete m.sheets[0]!.onlyWithout;
    expect(() => parsePack(m)).toThrow(
      /An optional requirement needs a sheet made only without it/,
    );
  });

  it('onlyWithout names an optional requirement', () => {
    const m = raw();
    m.requires = [{ pack: 'core', range: '^1.1.0' }];
    expect(() => parsePack(m)).toThrow(/"core" is not an optional requirement of the pack/);
  });

  it('each case is checked as a whole manifest, and a problem says which case it is in', () => {
    const m = raw();
    const onCore = m.apps![1]!;
    onCore.sections[1]!.screens[1] = {
      key: 'overview',
      kind: 'dashboard',
      title: 'Overview',
      dashboard: 'nope',
    };
    expect(() => parsePack(m)).toThrow(/Unknown dashboard "nope"\. \(with core\)/);
    // the two apps share a key only because each belongs to one case
    const both = raw();
    both.apps = [both.apps![0]!, both.apps![0]!];
    expect(() => parsePack(both)).toThrow(/Duplicate app key "capa"\. \(without core\)/);
  });
});
