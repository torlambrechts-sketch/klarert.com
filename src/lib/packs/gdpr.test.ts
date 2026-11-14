import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { levelSummaries, planPackInstall, previewLines, type PackSnapshot } from '@/engine/packs';
import '@/engine/fields/registry';
import { formula } from '@/engine/fields/formula';
import { isPersonalField, readRetention, retentionDue } from '@/engine/retention';
import { makeCtx, makeField, makeItem } from '@/engine/testing/fixtures';
import type { Field, Json } from '@/engine/types';
import { repoPacks } from './catalogue';

// The GDPR pack (docs/11): Starter and Full on the GDPR library, the request deadline, the breach clock and its
// alerts, retention rules shipped as data, forms without notices (each workspace writes its own) and examples linked
// to the articles they show.
const pack = repoPacks().find((p) => p.key === 'gdpr')!;
const LIB = '00000000-0000-4000-8000-00000000d901';

const snapshot = (over: Partial<PackSnapshot> = {}): PackSnapshot => ({
  orgId: 'org-1',
  prefixes: [],
  folders: [],
  installs: [],
  members: [],
  jobRoles: [{ id: 'jr-dpo', name: 'Data protection officer' }],
  teams: [],
  lastSheetPosition: null,
  lastFolderPosition: null,
  lastDashboardPosition: null,
  libraries: [{ library: 'gdpr@2016', sheetId: LIB }],
  ...over,
});
let n = 0;
const env = {
  today: '2026-11-14',
  now: new Date('2026-11-14T10:00:00Z'),
  timeZone: 'Europe/Berlin',
  newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  hash: 'h',
  userId: 'u-1',
};

const STARTER = [
  'Records of processing',
  'Data subject requests',
  'Personal data breaches',
  'DPIAs',
  'Processors and DPAs',
  'Transfers outside the EEA',
  'Retention schedule',
];
const FULL_ADDS = ['Consent records', 'DPO and training'];
const sheet = (ref: string) => pack.sheets.find((s) => s.ref === ref)!;

describe('GDPR pack', () => {
  it('ships Starter and Full and builds on the GDPR library', () => {
    expect(pack.version).toBe('1.0.0');
    expect(pack.levels!.map((l) => l.key)).toEqual(['starter', 'full']);
    expect(pack.frameworks).toEqual([{ key: 'gdpr', version: '2016' }]);
    const [starter, full] = levelSummaries(pack);
    expect(starter!.sheets).toEqual(STARTER);
    expect(full!.adds).toEqual(FULL_ADDS);
    expect(pack.setup!.steps).toHaveLength(8);
    expect(pack.dashboards.map((d) => d.name)).toEqual(['Privacy overview']);
  });

  it('marks examples and links them only to articles the GDPR library has', () => {
    const fw = JSON.parse(
      readFileSync(join(process.cwd(), 'templates/frameworks/gdpr-2016.json'), 'utf8'),
    ) as { requirements: { ref: string }[] };
    const refs = new Set(fw.requirements.map((r) => `gdpr@2016#${r.ref}`));
    const seen = new Set<string>();
    for (const s of pack.sheets)
      for (const i of s.items) {
        expect(i.name, `${s.ref}.${i.ref}`).toMatch(/^Example: /);
        for (const k of Object.values(i.requirements ?? {}).flat()) {
          expect(refs.has(k), `${s.ref}.${i.ref} → ${k}`).toBe(true);
          seen.add(k.split('#')[1]!);
        }
      }
    for (const a of [
      'Art. 30',
      'Art. 15',
      'Art. 17',
      'Art. 33',
      'Art. 34',
      'Art. 35',
      'Art. 28',
      'Art. 44',
      'Art. 46',
    ])
      expect(seen, a).toContain(a);
  });

  it('plans Starter into an empty workspace with the forms as internal drafts without a notice', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.state).toBe('ready');
    expect(plan.preview.sheets.map((s) => s.name)).toEqual(STARTER);
    expect(previewLines(plan.preview)[0]).toMatch(/^Installs 1 folder, 7 sheets/);
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
      // owner decision: privacy notices are each workspace's own, the form shows it as to review
      expect(form.notice).toBeUndefined();
    }
    const refs = plan.payload!.automations.map((a) => a.ref);
    expect(refs).toEqual([
      'dsr_deadline_soon',
      'dsr_overdue',
      'dsr_new',
      'dsr_closed_on',
      'breach_24h',
      'breach_60h',
      'breach_reported',
      'breach_high_risk',
      'dpia_review_due',
      'dpa_review_due',
    ]);
    expect(plan.payload!.automations.every((a) => a.enabled)).toBe(true);
    const widgets = (
      plan.payload!.dashboards[0]!.config as { widgets: { id: string; sheetId?: string }[] }
    ).widgets;
    expect(widgets.find((w) => w.id === 'w_articles')!.sheetId).toBe(LIB);
  });

  it('the public form needs nothing a public form refuses (no files, no people)', () => {
    const dsr = sheet('dsr');
    const form = dsr.forms.find((f) => f.ref === 'submit')!;
    const types = form.layout.fields.map((f) => dsr.fields.find((x) => x.key === f.key)!.type);
    for (const t of types)
      expect(['people', 'attachment', 'evidence', 'team', 'role', 'entity']).not.toContain(t);
  });

  it('breach alerts at 24 and 60 hours of the 72-hour clock, to the lead, the DPO field and the DPO role', () => {
    const plan = planPackInstall(pack, snapshot(), env, { level: 'starter' });
    const a = (ref: string) => plan.payload!.automations.find((x) => x.ref === ref)!;
    expect(a('breach_24h').trigger).toEqual({
      type: 'clock_warning',
      fieldKey: 'authority_clock',
      hoursLeft: 48,
    });
    expect(a('breach_60h').trigger).toEqual({
      type: 'clock_warning',
      fieldKey: 'authority_clock',
      hoursLeft: 12,
    });
    const to = (a('breach_24h').actions as { to: string[] }[])[0]!.to;
    expect(to).toEqual(['field:owner', 'field:dpo', 'jobRole:jr-dpo']);
    const clock = sheet('breach').fields.find((f) => f.key === 'authority_clock')!;
    expect(clock.config).toEqual({
      startFieldKey: 'aware_at',
      hours: 72,
      stopFieldKey: 'reported_at',
    });
  });

  it('without a DPO job role the alerts still go to the people on the breach', () => {
    const plan = planPackInstall(pack, snapshot({ jobRoles: [] }), env, { level: 'starter' });
    const a = plan.payload!.automations.find((x) => x.ref === 'breach_24h')!;
    expect((a.actions as { to: string[] }[])[0]!.to).toEqual(['field:owner', 'field:dpo']);
    expect(a.enabled).toBe(true);
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
    expect(value({ [received.id]: '2026-01-31', [extension.id]: 'opt_none' })).toBe('2026-02-28');
    expect(value({ [received.id]: '2026-01-31', [extension.id]: 'opt_one' })).toBe('2026-03-31');
    expect(value({ [received.id]: '2026-01-31', [extension.id]: 'opt_two' })).toBe('2026-04-30');
    expect(value({})).toBeNull();
    // the deadline reminders watch the formula
    const auto = pack.automations.find((a) => a.ref === 'dsr_overdue')!;
    expect(auto.trigger).toEqual({ type: 'date_arrives', fieldKey: 'deadline', offsetDays: 1 });
  });

  it('ships retention rules as data: personal fields marked, groups and periods resolved at install', () => {
    const dsr = sheet('dsr');
    expect(
      dsr.fields
        .filter((f) => isPersonalField({ config: (f.config ?? {}) as Json }))
        .map((f) => f.key),
    ).toEqual(['requester', 'requester_email', 'requester_details']);
    const plan = planPackInstall(pack, snapshot(), env, { level: 'full' });
    const planned = plan.payload!.sheets.find((s) => s.ref === 'dsr')!;
    const r = readRetention(planned.settings);
    expect(r.personalNames).toBe(true);
    expect(r.rules.map((x) => [x.id, x.period, x.action])).toEqual([
      ['dsr_closed_3y', { n: 3, unit: 'years' }, 'erase'],
    ]);
    expect(r.rules[0]!.note).toMatch(/^A suggestion, not advice/);
    const consent = readRetention(plan.payload!.sheets.find((s) => s.ref === 'consent')!.settings);
    expect(consent.rules.map((x) => x.id)).toEqual(['consent_withdrawn_2y']);
    // a closed request is due 3 years after its closing date, an open one never
    const closedOn = makeField('date', { relative: false }, { key: 'closed_on' });
    const status = makeField(
      'status',
      dsr.fields.find((f) => f.key === 'status')!.config as Record<string, unknown>,
      {
        key: 'status',
      },
    );
    const old = makeItem({ [closedOn.id]: '2023-11-14', [status.id]: 'opt_closed' }, { id: 'old' });
    const open = makeItem(
      { [closedOn.id]: '2023-11-14', [status.id]: 'opt_working' },
      { id: 'open' },
    );
    const ctx = makeCtx(
      { fields: [closedOn, status], items: [old, open] },
      { today: '2026-11-14' },
    );
    expect(retentionDue(r.rules, [old, open], ctx).map((d) => [d.itemId, d.dueOn])).toEqual([
      ['old', '2026-11-14'],
    ]);
  });

  it('links examples to each other and into the library', () => {
    const keys = [
      ...new Set(
        pack.sheets.flatMap((s) =>
          s.items.flatMap((i) => Object.values(i.requirements ?? {}).flat()),
        ),
      ),
    ];
    const requirementItems = Object.fromEntries(keys.map((k, i) => [k, `lib-item-${i}`]));
    const plan = planPackInstall(pack, snapshot({ requirementItems }), env, { level: 'full' });
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
    expect(
      linked('breach.articles', 'breach.ex_payslips').map(
        (x) => keys[Number(x.replace('lib-item-', ''))],
      ),
    ).toEqual(['gdpr@2016#Art. 33', 'gdpr@2016#Art. 34']);
  });

  it('installs next to the ISO packs without a prefix clash', () => {
    const taken = repoPacks()
      .filter((p) => p.key === 'iso-27001' || p.key === 'iso-9001')
      .flatMap((p) => p.sheets.map((s) => s.idPrefix));
    const plan = planPackInstall(pack, snapshot({ prefixes: taken }), env, { level: 'full' });
    expect(plan.preview.renamedPrefixes).toEqual([]);
    expect(plan.preview.sheets).toHaveLength(9);
  });
});
