import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { levelSummaries, planPackInstall, type PackSnapshot } from '@/engine/packs';
import { extendsAgainst, neededLevel } from '@/engine/packs/extend';
import { afterInstall } from '@/engine/packs/installed.fixture';
import '@/engine/fields/registry';
import { formula } from '@/engine/fields/formula';
import { isPersonalField, readRetention, retentionDue } from '@/engine/retention';
import { makeCtx, makeField, makeItem } from '@/engine/testing/fixtures';
import type { Field, Json } from '@/engine/types';
import { repoPacks } from './catalogue';
import { packQualityProblems } from './quality';

// The GDPR add-on 2.0.0 (docs/11 The GDPR add-on): its own sheets in Core's Privacy and security and Suppliers
// domains, the request deadline, the breach clock and its escalation, the cascades from the shared registers, the
// approval workflows, retention rules as data and examples linked to the articles they show.
const packs = repoPacks();
const pack = packs.find((p) => p.key === 'gdpr')!;
const core = packs.find((p) => p.key === 'core')!;
const LIB = '00000000-0000-4000-8000-00000000d901';

let n = 0;
const env = {
  today: '2026-11-14',
  now: new Date('2026-11-14T10:00:00Z'),
  timeZone: 'Europe/Berlin',
  newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  hash: 'h',
  userId: 'u-1',
};
const empty = (over: Partial<PackSnapshot> = {}): PackSnapshot => ({
  orgId: 'org-1',
  prefixes: [],
  folders: [],
  installs: [],
  members: [],
  jobRoles: [
    { id: 'jr-dpo', name: 'Data protection officer' },
    { id: 'jr-top', name: 'Top management' },
  ],
  teams: [],
  lastSheetPosition: null,
  lastFolderPosition: null,
  lastDashboardPosition: null,
  libraries: [{ library: 'gdpr@2016', sheetId: LIB }],
  ...over,
});
/** A workspace with the Core registers installed at the level GDPR needs. */
const withCore = (over: Partial<PackSnapshot> = {}): PackSnapshot => {
  const snap = empty(over);
  const c = planPackInstall(core, snap, env, { level: neededLevel(pack, core) });
  return afterInstall(snap, c.payload!, 'install-core');
};
const sheet = (ref: string) => pack.sheets.find((s) => s.ref === ref)!;

describe('GDPR add-on', () => {
  it('is a 2.0.0 add-on to Core Starter on the GDPR library that meets the quality bar', () => {
    expect(pack.version).toBe('2.0.0');
    expect(pack.requires).toEqual([{ pack: 'core', range: '^1.0.0' }]);
    expect(pack.standard).toEqual({ id: 'gdpr', label: 'GDPR', color: 'purple' });
    expect(pack.frameworks).toEqual([{ key: 'gdpr', version: '2016' }]);
    // only Starter registers of Core: a GDPR install never pulls in the Full registers
    expect(neededLevel(pack, core)).toBe('starter');
    expect(extendsAgainst(pack, core)).toEqual([]);
    expect(packQualityProblems(pack)).toEqual([]);
    const [starter, full] = levelSummaries(pack);
    expect(starter!.sheets).toEqual([
      'Records of processing',
      'Data subject requests',
      'Personal data breaches',
      'DPIAs',
      'Processors and DPAs',
    ]);
    expect(full!.adds).toEqual([
      'Transfers outside the EEA',
      'Retention schedule',
      'Consent records',
    ]);
  });

  it('places its sheets in Core’s domains: privacy, and processors with the suppliers', () => {
    expect(pack.folders).toEqual([]);
    const folders = Object.fromEntries(pack.sheets.map((s) => [s.ref, s.folder]));
    expect(folders).toEqual({
      ropa: 'core:privacy',
      dsr: 'core:privacy',
      breach: 'core:privacy',
      dpia: 'core:privacy',
      processor: 'core:suppliers',
      transfer: 'core:privacy',
      retention: 'core:privacy',
      consent: 'core:privacy',
    });
    // personal data sheets install restricted
    expect(pack.sheets.filter((s) => s.personalData).map((s) => s.ref)).toEqual([
      'dsr',
      'breach',
      'consent',
    ]);
  });

  it('plans Starter on top of Core: its sheets, the GDPR additions and the standard view', () => {
    const plan = planPackInstall(pack, withCore(), env, { level: 'starter' });
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    expect(plan.preview.sheets.map((s) => s.name)).toHaveLength(5);
    const ext = Object.fromEntries(plan.preview.extends.map((e) => [e.sheet, e]));
    expect(Object.keys(ext).sort()).toEqual([
      'Actions',
      'Documents and policies',
      'Incidents',
      'Risk categories',
      'Risk register',
    ]);
    expect(ext['Risk register']!.views).toEqual(['GDPR view']);
    expect(ext['Incidents']!.options).toContain('Personal data breach in Type');
    // personal data sheets restricted
    const restricted = plan.payload!.sheets.filter((s) => s.restricted).map((s) => s.ref);
    expect(restricted).toEqual(['dsr', 'breach']);
    // the forms install as internal drafts without a notice (each workspace writes its own)
    expect(plan.preview.forms).toEqual([
      { sheet: 'Data subject requests', name: 'Submit a data subject request', access: 'internal' },
      {
        sheet: 'Personal data breaches',
        name: 'Report a personal data breach',
        access: 'internal',
      },
    ]);
    for (const f of plan.payload!.views.filter((v) => v.type === 'form')) {
      const form = (f.config as { form: { status: string; notice?: unknown } }).form;
      expect(form.status).toBe('draft');
      expect(form.notice).toBeUndefined();
    }
    const widgets = (
      plan.payload!.dashboards[0]!.config as { widgets: { id: string; sheetId?: string }[] }
    ).widgets;
    expect(widgets.find((w) => w.id === 'w_articles')!.sheetId).toBe(LIB);
  });

  it('notifying automations start in test mode, the review cycle live', () => {
    const plan = planPackInstall(pack, withCore(), env, { level: 'starter' });
    const mode = Object.fromEntries(
      plan.payload!.automations.map((a) => [a.ref, (a as { mode?: string }).mode ?? 'live']),
    );
    expect(mode['dsr_overdue']).toBe('test');
    expect(mode['breach_60h']).toBe('test');
    expect(mode['core:incidents.gdpr_incident_to_breach'] ?? mode['gdpr_incident_to_breach']).toBe(
      'test',
    );
    expect(mode['ropa_review_cycle']).toBe('live');
    expect(mode['dsr_closed_on']).toBe('live');
    // at least four advanced automations, each said in plain words
    const advanced = [
      ...pack.automations,
      ...(pack.extends ?? []).flatMap((e) => e.automations ?? []),
    ].filter((a) => a.advanced);
    expect(advanced.length).toBeGreaterThanOrEqual(4);
    for (const a of advanced) expect(a.description, a.ref).toMatch(/^[A-Z].{40,}\.$/);
  });

  it('escalates the breach clock from the lead and the DPO to top management', () => {
    const plan = planPackInstall(pack, withCore(), env, { level: 'starter' });
    const a = (ref: string) => plan.payload!.automations.find((x) => x.ref === ref)!;
    expect(a('breach_24h').trigger).toEqual({
      type: 'clock_warning',
      fieldKey: 'authority_clock',
      hoursLeft: 48,
    });
    expect((a('breach_24h').actions as { to: string[] }[])[0]!.to).toEqual([
      'field:owner',
      'field:dpo',
      'jobRole:jr-dpo',
    ]);
    expect((a('breach_60h').actions as { to: string[] }[])[0]!.to).toEqual([
      'field:owner',
      'field:dpo',
      'jobRole:jr-dpo',
      'jobRole:jr-top',
    ]);
    const clock = sheet('breach').fields.find((f) => f.key === 'authority_clock')!;
    expect(clock.config).toEqual({
      startFieldKey: 'aware_at',
      hours: 72,
      stopFieldKey: 'reported_at',
    });
  });

  it('an incident marked as a personal data breach opens a linked breach record', () => {
    const plan = planPackInstall(pack, withCore(), env, { level: 'starter' });
    const auto = plan.payload!.automations.find((a) =>
      String(a.ref).endsWith('gdpr_incident_to_breach'),
    )!;
    expect(auto.trigger).toEqual({
      type: 'field_becomes',
      fieldKey: 'incident_type',
      value: 'gdpr_personal_data',
    });
    const create = (auto.actions as Record<string, Json>[])[0]!;
    expect(create.type).toBe('create_item');
    expect(create.sheetId).toBe(plan.payload!.sheets.find((s) => s.ref === 'breach')!.id);
    expect(create.link).toBe(true);
    // the link field on Incidents is a system column of the shared register, two-way with the breach
    const f = plan.payload!.fields.find((x) => x.ref === 'core:incidents.gdpr_breach')!;
    expect(f.system).toBe(true);
  });

  it('ships approval workflows: processing record approval, DPIA sign-off and breach decisions', () => {
    expect(sheet('ropa').workflows!.map((w) => w.id)).toEqual(['processing-approval']);
    const dpia = sheet('dpia').workflows![0]!;
    expect(dpia.steps.map((s) => s.approvers)).toEqual([
      { kind: 'jobRole', roleName: 'Data protection officer' },
      { kind: 'jobRole', roleName: 'Top management' },
    ]);
    expect(dpia.lockOnApproval).toBe(true);
    const breach = sheet('breach').workflows![0]!;
    expect(breach.steps[0]!.sla).toEqual({ amount: 12, unit: 'hours' });
    // deciding not to report starts the DPO's sign-off
    const gate = pack.automations.find((a) => a.ref === 'breach_not_reporting')!;
    expect(gate.actions).toEqual([{ type: 'start_workflow', workflowId: 'breach-decisions' }]);
  });

  it('the request deadline: one month, plus one or two when extended', () => {
    const def = sheet('dsr').fields.find((f) => f.key === 'deadline')!;
    const ext = sheet('dsr').fields.find((f) => f.key === 'extension')!;
    const received = makeField('date', { relative: false }, { key: 'received_on' });
    const extension = makeField('dropdown', ext.config as Record<string, unknown>, {
      key: 'extension',
    });
    const deadline = makeField('formula', def.config as Record<string, unknown>, {
      key: 'deadline',
    });
    const fields = [received, extension, deadline] as Field[];
    const value = (v: Record<string, Json>) => {
      const item = makeItem(v);
      return formula.compute!(item, deadline as never, makeCtx({ fields, items: [item] }));
    };
    expect(value({ [received.id]: '2026-01-31' })).toBe('2026-02-28');
    expect(value({ [received.id]: '2026-01-31', [extension.id]: 'opt_one' })).toBe('2026-03-31');
    expect(value({ [received.id]: '2026-01-31', [extension.id]: 'opt_two' })).toBe('2026-04-30');
    expect(value({})).toBeNull();
    const auto = pack.automations.find((a) => a.ref === 'dsr_overdue')!;
    expect(auto.trigger).toEqual({ type: 'date_arrives', fieldKey: 'deadline', offsetDays: 1 });
  });

  it('keeps retention rules as data: personal fields marked, groups and periods resolved at install', () => {
    const dsr = sheet('dsr');
    expect(
      dsr.fields
        .filter((f) => isPersonalField({ config: (f.config ?? {}) as Json }))
        .map((f) => f.key),
    ).toEqual(['requester', 'requester_email', 'requester_details']);
    const plan = planPackInstall(pack, withCore(), env, { level: 'full' });
    expect(plan.preview.conflicts).toEqual([]);
    const r = readRetention(plan.payload!.sheets.find((s) => s.ref === 'dsr')!.settings);
    expect(r.personalNames).toBe(true);
    expect(r.rules.map((x) => [x.id, x.period, x.action])).toEqual([
      ['dsr_closed_3y', { n: 3, unit: 'years' }, 'erase'],
    ]);
    expect(r.rules[0]!.note).toMatch(/^A suggestion, not advice/);
    const consent = readRetention(plan.payload!.sheets.find((s) => s.ref === 'consent')!.settings);
    expect(consent.rules.map((x) => x.id)).toEqual(['consent_withdrawn_2y']);
    const closedOn = makeField('date', { relative: false }, { key: 'closed_on' });
    const status = makeField(
      'status',
      dsr.fields.find((f) => f.key === 'status')!.config as Record<string, unknown>,
      { key: 'status' },
    );
    const old = makeItem({ [closedOn.id]: '2023-11-14', [status.id]: 'opt_closed' }, { id: 'old' });
    const open = makeItem({ [closedOn.id]: '2023-11-14', [status.id]: 'opt_working' }, { id: 'o' });
    const ctx = makeCtx(
      { fields: [closedOn, status], items: [old, open] },
      { today: '2026-11-14' },
    );
    expect(retentionDue(r.rules, [old, open], ctx).map((d) => [d.itemId, d.dueOn])).toEqual([
      ['old', '2026-11-14'],
    ]);
  });

  it('links examples to each other, to the shared registers and into the library', () => {
    const fw = JSON.parse(
      readFileSync(join(process.cwd(), 'templates/frameworks/gdpr-2016.json'), 'utf8'),
    ) as { requirements: { ref: string }[] };
    const refs = new Set(fw.requirements.map((r) => `gdpr@2016#${r.ref}`));
    const keys = [
      ...new Set(
        pack.sheets.flatMap((s) =>
          s.items.flatMap((i) => Object.values(i.requirements ?? {}).flat()),
        ),
      ),
    ];
    for (const k of keys) expect(refs.has(k), k).toBe(true);
    for (const s of pack.sheets) for (const i of s.items) expect(i.name).toMatch(/^Example: /);
    const requirementItems = Object.fromEntries(keys.map((k, i) => [k, `lib-item-${i}`]));
    const plan = planPackInstall(pack, withCore({ requirementItems }), env, { level: 'full' });
    expect(plan.state).toBe('ready');
    expect(plan.preview.warnings).toEqual([]);
    const field = (ref: string) => plan.payload!.fields.find((f) => f.ref === ref)!.id;
    const item = (ref: string) => plan.payload!.items.find((i) => i.ref === ref)!.id;
    const linked = (fieldRef: string, itemRef: string) =>
      plan
        .payload!.links.filter(
          (l) => l.field_id === field(fieldRef) && l.from_item === item(itemRef),
        )
        .map((l) => l.to_item);
    expect(linked('ropa.processors', 'ropa.ex_payroll')).toEqual([
      item('processor.ex_payroll_provider'),
    ]);
    expect(linked('dpia.processing', 'dpia.ex_cctv_dpia')).toEqual([item('ropa.ex_cctv')]);
    // the example privacy risk sits in the Privacy category and links to the newsletter processing
    expect(linked('core:risk.gdpr_processing', 'core:risk.gdpr_export')).toEqual([
      item('ropa.ex_newsletter'),
    ]);
    expect(
      linked('breach.articles', 'breach.ex_payslips').map(
        (x) => keys[Number(x.replace('lib-item-', ''))],
      ),
    ).toEqual(['gdpr@2016#Art. 33', 'gdpr@2016#Art. 34']);
  });

  it('installs next to the ISO and NIS2 packs without a prefix clash', () => {
    const taken = packs
      .filter((p) => ['iso-27001', 'iso-9001', 'nis2', 'core'].includes(p.key))
      .flatMap((p) => p.sheets.map((s) => s.idPrefix));
    const plan = planPackInstall(pack, withCore({ prefixes: taken }), env, { level: 'full' });
    expect(plan.preview.renamedPrefixes).toEqual([]);
    expect(plan.preview.sheets).toHaveLength(8);
  });
});
