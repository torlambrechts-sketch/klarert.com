import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planPackInstall, type PackSnapshot } from '@/engine/packs';
import { extendsAgainst, neededLevel } from '@/engine/packs/extend';
import { afterInstall } from '@/engine/packs/installed.fixture';
import { settingDefaults, settingFields } from '@/engine/packs/settings';
import '@/engine/fields/registry';
import { formula } from '@/engine/fields/formula';
import { makeCtx, makeField, makeItem } from '@/engine/testing/fixtures';
import type { Field, Json } from '@/engine/types';
import { repoPacks } from './catalogue';
import { packQualityProblems } from './quality';

// The NIS2 add-on 1.0.0 (docs/11 The NIS2 add-on): scope self-check and registration, the Art. 21 measures in Core's
// Controls library, incident reports with the 24-hour, 72-hour and one-month stages, management body approval and
// training, and the country setting that fills in the authority and CSIRT (owner decision, 14 Nov 2026).
const packs = repoPacks();
const pack = packs.find((p) => p.key === 'nis2')!;
const core = packs.find((p) => p.key === 'core')!;
const LIB = '00000000-0000-4000-8000-00000000e201';

let n = 0;
const env = {
  today: '2026-11-14',
  now: new Date('2026-11-14T10:00:00Z'),
  timeZone: 'Europe/Oslo',
  newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  hash: 'h',
  userId: 'u-1',
};
const withCore = (over: Partial<PackSnapshot> = {}): PackSnapshot => {
  const snap: PackSnapshot = {
    orgId: 'org-1',
    prefixes: [],
    folders: [],
    installs: [],
    members: [],
    jobRoles: [
      { id: 'jr-iso', name: 'Information security officer' },
      { id: 'jr-top', name: 'Top management' },
    ],
    teams: [],
    lastSheetPosition: null,
    lastFolderPosition: null,
    lastDashboardPosition: null,
    libraries: [{ library: 'nis2@2022', sheetId: LIB }],
    ...over,
  };
  const c = planPackInstall(core, snap, env, { level: neededLevel(pack, core) });
  return afterInstall(snap, c.payload!, 'install-core');
};
const sheet = (ref: string) => pack.sheets.find((s) => s.ref === ref)!;
const country = pack.settings![0]!;

describe('NIS2 add-on', () => {
  it('is a 1.0.0 add-on to Core (Full: Controls and training) on the NIS2 library that meets the quality bar', () => {
    expect(pack.version).toBe('1.0.0');
    expect(pack.requires).toEqual([{ pack: 'core', range: '^1.0.0' }]);
    expect(pack.frameworks).toEqual([{ key: 'nis2', version: '2022' }]);
    expect(neededLevel(pack, core)).toBe('full');
    expect(extendsAgainst(pack, core)).toEqual([]);
    expect(packQualityProblems(pack)).toEqual([]);
    expect(pack.sheets.map((s) => [s.ref, s.folder, s.kind])).toEqual([
      ['scope', 'core:privacy', 'register'],
      ['reports', 'core:privacy', 'log'],
      ['oversight', 'core:management', 'register'],
    ]);
    expect(pack.dashboards.filter((d) => d.headline).map((d) => d.name)).toEqual(['NIS2 overview']);
  });

  it('plans on top of Core with the ten Art. 21 measures in the Controls library', () => {
    const plan = planPackInstall(pack, withCore(), env, { settings: { country: 'de' } });
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    const controls = plan.payload!.items.filter((i) => String(i.ref).startsWith('core:controls.'));
    expect(controls).toHaveLength(10);
    const measure = plan.payload!.fields.find((f) => f.ref === 'core:controls.nis2_measure')!.id;
    expect(controls.map((c) => (c.values as Record<string, Json>)[String(measure)])).toEqual(
      'abcdefghij'.split('').map((l) => `nis2_${l}`),
    );
    const ext = Object.fromEntries(plan.preview.extends.map((e) => [e.sheet, e]));
    expect(ext['Controls library']!.views).toEqual(['NIS2 view']);
    expect(plan.preview.forms.map((f) => [f.sheet, f.name, f.access])).toEqual([
      ['NIS2 scope and registration', 'NIS2 scope self-check', 'internal'],
      ['Incidents', 'Report a cyber incident', 'internal'],
      ['Incidents', 'Tell us about an incident at your company', 'internal'],
    ]);
  });

  it('every measure links to its Art. 21(2) requirement of the library', () => {
    const fw = JSON.parse(
      readFileSync(join(process.cwd(), 'templates/frameworks/nis2-2022.json'), 'utf8'),
    ) as { requirements: { ref: string }[] };
    const refs = new Set(fw.requirements.map((r) => `nis2@2022#${r.ref}`));
    const keys = [
      ...pack.sheets.flatMap((s) =>
        s.items.flatMap((i) => Object.values(i.requirements ?? {}).flat()),
      ),
      ...(pack.extends ?? []).flatMap((e) =>
        (e.items ?? []).flatMap((i) => Object.values(i.requirements ?? {}).flat()),
      ),
    ];
    for (const k of keys) expect(refs.has(k), k).toBe(true);
    for (const l of 'abcdefghij') expect(keys).toContain(`nis2@2022#Art. 21(2)(${l})`);
  });

  it('reporting stages: 24-hour and 72-hour clocks from awareness, the final report a month after the notification', () => {
    const f = (k: string) => sheet('reports').fields.find((x) => x.key === k)!;
    expect(f('ew_clock').config).toEqual({
      startFieldKey: 'aware_at',
      hours: 24,
      stopFieldKey: 'ew_sent_at',
    });
    expect(f('notification_clock').config).toEqual({
      startFieldKey: 'aware_at',
      hours: 72,
      stopFieldKey: 'notified_at',
    });
    const notified = makeField('datetime', {}, { key: 'notified_at' });
    const due = makeField('formula', f('final_due').config as Record<string, unknown>, {
      key: 'final_due',
    });
    const fields = [notified, due] as Field[];
    const value = (v: Record<string, Json>) => {
      const item = makeItem(v);
      return formula.compute!(item, due as never, makeCtx({ fields, items: [item] }));
    };
    expect(value({ [notified.id]: '2026-11-12T16:00:00Z' })).toBe('2026-12-12');
    expect(value({})).toBeNull();
    // the clocks escalate: the lead and the security officer first, then top management
    const plan = planPackInstall(pack, withCore(), env);
    const a = (ref: string) => plan.payload!.automations.find((x) => x.ref === ref)!;
    expect(a('early_warning_clock').trigger).toEqual({
      type: 'clock_warning',
      fieldKey: 'ew_clock',
      hoursLeft: 8,
    });
    expect((a('early_warning_escalation').actions as { to: string[] }[])[0]!.to).toEqual([
      'field:owner',
      'jobRole:jr-iso',
      'jobRole:jr-top',
    ]);
    expect((a('early_warning_clock') as { mode?: string }).mode).toBe('test');
    expect((a('early_warning_sent') as { mode?: string }).mode ?? 'live').toBe('live');
  });

  it('an incident marked possibly significant opens a linked NIS2 report', () => {
    const plan = planPackInstall(pack, withCore(), env);
    const auto = plan.payload!.automations.find((x) =>
      String(x.ref).endsWith('nis2_incident_to_report'),
    )!;
    const create = (auto.actions as Record<string, Json>[])[0]!;
    expect(create.sheetId).toBe(plan.payload!.sheets.find((s) => s.ref === 'reports')!.id);
    expect(create.link).toBe(true);
    // a failing NIS2 control opens a corrective action in the shared Actions register
    const failing = plan.payload!.automations.find((x) =>
      String(x.ref).endsWith('nis2_control_failing'),
    )!;
    expect((failing.actions as Record<string, Json>[])[0]!.type).toBe('create_item');
  });

  it('the management body approves through a two-step workflow, every member approving', () => {
    const w = sheet('oversight').workflows![0]!;
    expect(w.id).toBe('management-body-approval');
    expect(w.steps.map((s) => [s.approvers, s.mode])).toEqual([
      [{ kind: 'jobRole', roleName: 'Information security officer' }, 'any'],
      [{ kind: 'jobRole', roleName: 'Top management' }, 'all'],
    ]);
    expect(w.lockOnApproval).toBe(true);
  });

  it('the scope self-check suggests essential or important from sector, size and the size-free rules', () => {
    const fields = Object.fromEntries(
      ['sector', 'special_case'].map((k) => {
        const def = sheet('scope').fields.find((f) => f.key === k)!;
        return [k, makeField('dropdown', def.config as Record<string, unknown>, { key: k })];
      }),
    );
    const nums = Object.fromEntries(
      ['employees', 'turnover', 'balance'].map((k) => [k, makeField('number', {}, { key: k })]),
    );
    const formulas = Object.fromEntries(
      ['annex', 'size', 'suggested'].map((k) => {
        const def = sheet('scope').fields.find((f) => f.key === k)!;
        return [k, makeField('formula', def.config as Record<string, unknown>, { key: k })];
      }),
    );
    const all = [
      ...Object.values(fields),
      ...Object.values(nums),
      ...Object.values(formulas),
    ] as Field[];
    const suggest = (v: Record<string, Json>) => {
      const values: Record<string, Json> = {};
      for (const [k, x] of Object.entries(v)) values[(fields[k] ?? nums[k])!.id] = x;
      const item = makeItem(values);
      return formula.compute!(
        item,
        formulas.suggested as never,
        makeCtx({ fields: all, items: [item] }),
      );
    };
    expect(suggest({ sector: 'opt_transport', employees: 320 })).toBe('Essential');
    expect(suggest({ sector: 'opt_transport', employees: 80 })).toBe('Important');
    expect(suggest({ sector: 'opt_manufacturing', employees: 400 })).toBe('Important');
    expect(suggest({ sector: 'opt_manufacturing', employees: 20, turnover: 5, balance: 4 })).toBe(
      'Probably not in scope',
    );
    expect(
      suggest({ sector: 'opt_digital_infra', employees: 5, special_case: 'opt_always_essential' }),
    ).toBe('Essential');
    expect(suggest({ sector: 'opt_digital_infra', employees: 5, special_case: 'opt_ecomms' })).toBe(
      'Important',
    );
    expect(suggest({ sector: 'opt_food', turnover: 60, balance: 50 })).toBe('Important');
    expect(suggest({})).toBeNull();
  });
});

describe('NIS2 country setting (owner decision, 14 Nov 2026)', () => {
  it('lists every EU member state and the three EEA countries, each sourced and marked unverified', () => {
    expect(country.key).toBe('country');
    const eu = country.choices.filter((c) => c.group === 'EU member states');
    const eea = country.choices.filter((c) => c.group === 'EEA countries (not EU)');
    expect(eu).toHaveLength(27);
    expect(eea.map((c) => c.label)).toEqual(['Iceland', 'Liechtenstein', 'Norway']);
    for (const c of country.choices) {
      expect(c.verified, c.id).toBe(false);
      expect(c.note, c.id).toMatch(/^Not verified/);
      expect(c.sources.length, c.id).toBeGreaterThanOrEqual(2);
      for (const k of ['country', 'law', 'authority', 'csirt', 'registration', 'deadlines'])
        expect(c.values[k], `${c.id}.${k}`).toBeTruthy();
    }
    // Norway: EEA, the Digital Security Act, NIS2 not yet in the EEA Agreement
    const no = country.choices.find((c) => c.id === 'no')!;
    expect(no.values.law).toMatch(/Digital Security Act/);
    expect(no.values.law).toMatch(/not yet taken into the EEA Agreement/);
  });

  it('sets the authority, CSIRT and registration route as defaults of the pack’s own fields', () => {
    expect(settingFields(pack).map((f) => f.ref)).toEqual([
      'field:scope.member_state',
      'field:scope.authority',
      'field:scope.csirt',
      'field:scope.registration_route',
      'field:scope.national_notes',
      'field:reports.recipient',
      'field:reports.deadline_notes',
    ]);
    const no = country.choices.find((c) => c.id === 'no')!;
    const plan = planPackInstall(pack, withCore(), env, { settings: { country: 'no' } });
    const cfg = (ref: string) =>
      plan.payload!.fields.find((f) => f.ref === ref)!.config as Record<string, Json>;
    expect(cfg('scope.authority').default).toBe(no.values.authority);
    expect(cfg('reports.recipient').default).toBe(no.values.csirt);
    // example values follow the choice too
    const entity = plan.payload!.items.find((i) => i.ref === 'scope.ex_entity')!;
    const csirt = plan.payload!.fields.find((f) => f.ref === 'scope.csirt')!.id;
    expect((entity.values as Record<string, Json>)[String(csirt)]).toBe(no.values.csirt);
    // without a choice there is no default, never a token
    const none = planPackInstall(pack, withCore(), env);
    const plain = none.payload!.fields.find((f) => f.ref === 'reports.recipient')!.config as Record<
      string,
      Json
    >;
    expect(plain.default).toBeUndefined();
    expect(JSON.stringify(none.payload)).not.toMatch(/\$setting:/);
    // changing the setting later rewrites the defaults
    const de = settingDefaults(pack, { country: 'de' });
    expect(de.find((d) => d.ref === 'field:reports.recipient')!.default).toMatch(/BSI/);
    expect(settingDefaults(pack, {}).every((d) => d.default === null)).toBe(true);
  });
});
